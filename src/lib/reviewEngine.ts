import { getPageBlob, getPageBubbles, savePageBubbles, getProjectLore } from '../services/db';
import { getChapterIntelligence } from '../services/intelligence';
import type { BubbleItem, ReviewFlagItem, ReviewFlagCategory, GeminiModelKey, EloquenceLevel } from '../types/workbench';
import { resolveCanonicalTyper } from '../types/typers';
import { buildVisualPageReviewInstruction, buildChapterReviewSystemInstruction } from './promptBuilder';
import { humanizeArabicText } from './arabicHumanizer';
import { blobToBase64 } from './geminiScan';

export interface SinglePageVisualReviewOptions {
  pageId: string;
  chapterId?: string;
  projectId?: string | null;
  isDraft?: boolean;
  apiKey: string;
  selectedModel: GeminiModelKey | string;
  eloquenceLevel: EloquenceLevel;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
}

export interface ChapterReviewOptions {
  chapterId: string;
  projectId?: string | null;
  isDraft?: boolean;
  pages: { pageId: string; pageIndex: number; bubbles?: BubbleItem[] }[];
  apiKey: string;
  selectedModel: GeminiModelKey | string;
  eloquenceLevel: EloquenceLevel;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
}

export interface ReviewAuditResult {
  chapterSummary: string;
  updatedBubblesByPage: Record<string, BubbleItem[]>;
  totalFlagsFound: number;
}

function normalizeBoundingBox(coords: any): [number, number, number, number] {
  if (!Array.isArray(coords) || coords.length !== 4) {
    return [300, 300, 500, 500];
  }
  let [ymin, xmin, ymax, xmax] = coords.map((v) => {
    const n = Number(v);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(1000, Math.round(n)));
  });
  if (ymin >= ymax) ymax = Math.min(1000, ymin + 50);
  if (xmin >= xmax) xmax = Math.min(1000, xmin + 50);
  return [ymin, xmin, ymax, xmax];
}

/**
 * Executes a 1-Page Multimodal Visual QC Audit.
 * Sends the actual page artwork to verify bounding boxes, missed speech in the art,
 * artwork artifacts, visual character genders, and bubble overflow.
 */
export async function auditPageVisuallyWithGemini(
  options: SinglePageVisualReviewOptions
): Promise<ReviewAuditResult> {
  const {
    pageId,
    chapterId,
    projectId,
    isDraft = false,
    apiKey,
    selectedModel,
    eloquenceLevel,
    masterPromptOverride,
    isMasterPromptActive,
  } = options;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Gemini API key is required. Please set it in Hardware Settings (Ctrl+,).');
  }

  // 1. Retrieve page image blob and current bubbles
  const blob = await getPageBlob(pageId);
  if (!blob) {
    throw new Error(`Page image blob not found in IndexedDB for ID: ${pageId}`);
  }
  const existingBubbles = await getPageBubbles(pageId);
  const mimeType = blob.type || 'image/png';
  const base64Data = await blobToBase64(blob);

  // 2. Retrieve project lore and chapter intelligence
  const projectLore = !isDraft && projectId ? await getProjectLore(projectId) : null;
  const chapterIntelligence = chapterId ? await getChapterIntelligence(chapterId) : null;

  // 3. Build multimodal review system prompt
  const systemInstruction = buildVisualPageReviewInstruction({
    eloquenceLevel,
    masterPromptOverride,
    isMasterPromptActive,
    projectLore,
    chapterIntelligence,
  });

  const effectiveModel = selectedModel || 'gemini-3.8-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`;

  // 4. Structured bubbles payload for visual verification
  const currentBubblesPayload = existingBubbles.map((b) => ({
    id: b.id,
    index: b.index,
    box_2d: b.box_2d,
    type: b.type,
    typerPrefix: b.typerPrefix,
    sourceText: b.sourceText,
    translatedText: b.translatedText,
    isManuallyEdited: b.isManuallyEdited || false,
  }));

  const payload = {
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Visually audit this comic page against the detected dialogue units. Find missed bubbles in the artwork, gender/grammar mismatches against the depicted characters, reading order errors, and text overflow:\n\n${JSON.stringify(
              currentBubblesPayload,
              null,
              2
            )}`,
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generation_config: {
      response_mime_type: 'application/json',
      temperature: 0.1,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error?.message || `Visual QC Audit failed with HTTP ${response.status}`);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty response for Visual QC.');
  }

  let cleanJson = rawText.trim();
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    console.error('Failed to parse Visual QC JSON:', cleanJson, err);
    throw new Error('Failed to parse structured JSON from Visual QC response.');
  }

  const issuesList = Array.isArray(parsed.issues) ? parsed.issues : [];
  let totalFlagsFound = 0;

  // Process incoming issues with duplicate prevention and non-destructive merging
  const modifiedBubbles = [...existingBubbles];
  const newMissedBubbles: BubbleItem[] = [];

  for (const issue of issuesList) {
    const targetBubbleId = issue.bubbleId;
    const isMissed = !targetBubbleId || targetBubbleId.startsWith('new-missed') || issue.category === 'missed_bubble';

    if (isMissed) {
      // Validate spatial bounding box
      const safeBox = normalizeBoundingBox(issue.missedBubbleCoords);
      // Check if an existing bubble already covers this area to avoid duplicates
      const isAlreadyCovered = modifiedBubbles.some((b) => {
        const [ymin1, xmin1, ymax1, xmax1] = b.box_2d;
        const [ymin2, xmin2, ymax2, xmax2] = safeBox;
        const yOverlap = Math.max(0, Math.min(ymax1, ymax2) - Math.max(ymin1, ymin2));
        const xOverlap = Math.max(0, Math.min(xmax1, xmax2) - Math.max(xmin1, xmin2));
        const overlapArea = yOverlap * xOverlap;
        const bArea = (ymax1 - ymin1) * (xmax1 - xmin1);
        return bArea > 0 && overlapArea / bArea > 0.6;
      });

      if (!isAlreadyCovered) {
        totalFlagsFound++;
        const nextIndex = modifiedBubbles.length + newMissedBubbles.length + 1;
        const suggestedAr = issue.suggestedTextAr ? humanizeArabicText(issue.suggestedTextAr, eloquenceLevel) : '';
        const canonicalTyper = resolveCanonicalTyper(issue.suggestedType);

        const flagItem: ReviewFlagItem = {
          id: `flag-missed-${Date.now()}-${nextIndex}`,
          category: 'missed_bubble',
          severity: issue.severity || 'warning',
          reasonAr: humanizeArabicText(issue.reasonAr || 'تم اكتشاف فقاعة حوار تم تفويتها في المسح الأول.', eloquenceLevel),
          evidence: issue.evidence || 'Visible unextracted text in artwork',
          suggestedTextAr: suggestedAr,
          suggestedType: canonicalTyper.id,
          status: 'pending',
          createdAt: Date.now(),
        };

        const now = Date.now();
        const placeholder: BubbleItem = {
          id: `missed-${now}-${nextIndex}-${Math.random().toString(36).substring(2, 6)}`,
          pageId,
          chapterId,
          index: nextIndex,
          box_2d: safeBox,
          type: canonicalTyper.id,
          typerPrefix: canonicalTyper.prefix,
          sourceText: issue.sourceText || '',
          originalSourceText: issue.sourceText || '',
          translatedText: suggestedAr,
          rawTranslatedText: suggestedAr,
          humanizedTranslatedText: suggestedAr,
          translationHistory: [{ timestamp: now, type: 'humanized', text: suggestedAr }],
          reviewFlags: [flagItem],
          confidence: 0.85,
          isManuallyEdited: false,
          updatedAt: now,
        };
        newMissedBubbles.push(placeholder);
      }
    } else {
      // Find matching existing bubble
      const bubbleIdx = modifiedBubbles.findIndex((b) => b.id === targetBubbleId);
      if (bubbleIdx !== -1) {
        const bubble = modifiedBubbles[bubbleIdx];
        const existingFlags = bubble.reviewFlags || [];

        // Duplicate prevention: check if this category is already flagged on this bubble
        const isDuplicate = existingFlags.some(
          (f) => f.category === issue.category && (f.status === 'pending' || f.status === 'dismissed')
        );

        if (!isDuplicate) {
          totalFlagsFound++;
          const newFlag: ReviewFlagItem = {
            id: `flag-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            category: (issue.category || 'ambiguous_flow') as ReviewFlagCategory,
            severity: issue.severity || 'warning',
            reasonAr: humanizeArabicText(issue.reasonAr || 'ملاحظة تدقيقية مرئية على الفقاعة.', eloquenceLevel),
            evidence: issue.evidence,
            suggestedTextAr: issue.suggestedTextAr ? humanizeArabicText(issue.suggestedTextAr, eloquenceLevel) : undefined,
            suggestedType: issue.suggestedType ? resolveCanonicalTyper(issue.suggestedType).id : undefined,
            suggestedOrderIndex: typeof issue.suggestedOrderIndex === 'number' ? issue.suggestedOrderIndex : undefined,
            status: 'pending',
            createdAt: Date.now(),
          };

          modifiedBubbles[bubbleIdx] = {
            ...bubble,
            reviewFlags: [...existingFlags, newFlag],
            updatedAt: Date.now(),
          };
        }
      }
    }
  }

  const finalBubbles = [...modifiedBubbles, ...newMissedBubbles];
  await savePageBubbles(pageId, finalBubbles);

  return {
    chapterSummary: parsed.pageSummary || `Found ${totalFlagsFound} visual QC issues.`,
    updatedBubblesByPage: { [pageId]: finalBubbles },
    totalFlagsFound,
  };
}

/**
 * Executes a Chapter-Wide Script & Continuity QC Audit across all pages.
 * Loads all pages directly from IndexedDB to guarantee complete chapter coverage.
 */
export async function auditChapterContinuityWithGemini(
  options: ChapterReviewOptions
): Promise<ReviewAuditResult> {
  const {
    chapterId,
    projectId,
    isDraft = false,
    pages,
    apiKey,
    selectedModel,
    eloquenceLevel,
    masterPromptOverride,
    isMasterPromptActive,
  } = options;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Gemini API key is required. Please set it in Hardware Settings (Ctrl+,).');
  }

  // 1. Fetch project lore and chapter intelligence
  const projectLore = !isDraft && projectId ? await getProjectLore(projectId) : null;
  const chapterIntelligence = await getChapterIntelligence(chapterId);

  // 2. Load all chapter bubbles directly from IndexedDB (guarantees zero missing pages)
  const fullChapterPages: Array<{ pageId: string; pageIndex: number; bubbles: BubbleItem[] }> = [];
  for (const p of pages) {
    const bubbles = await getPageBubbles(p.pageId);
    fullChapterPages.push({
      pageId: p.pageId,
      pageIndex: p.pageIndex,
      bubbles,
    });
  }

  // 3. Build chapter review prompt
  const systemInstruction = buildChapterReviewSystemInstruction({
    eloquenceLevel,
    projectLore,
    chapterIntelligence,
    masterPromptOverride,
    isMasterPromptActive,
  });

  const effectiveModel = selectedModel || 'gemini-3.8-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`;

  // 4. Assemble structured script payload
  const chapterDataPayload = fullChapterPages.map((p) => ({
    pageId: p.pageId,
    pageIndex: p.pageIndex,
    bubbles: p.bubbles.map((b) => ({
      id: b.id,
      index: b.index,
      box_2d: b.box_2d,
      type: b.type,
      typerPrefix: b.typerPrefix,
      sourceText: b.sourceText,
      translatedText: b.translatedText,
      isManuallyEdited: b.isManuallyEdited || false,
    })),
  }));

  const payload = {
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Audit the following complete chapter dataset for quality control and narrative continuity issues. Flag name inconsistencies, reading order problems, OCR transcript errors, grammar/gender mismatches, typer prefix errors, and ambiguous phrasing:\n\n${JSON.stringify(
              chapterDataPayload,
              null,
              2
            )}`,
          },
        ],
      },
    ],
    generation_config: {
      response_mime_type: 'application/json',
      temperature: 0.1,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error?.message || `Chapter QC Audit failed with HTTP ${response.status}`);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty response for Chapter QC.');
  }

  let cleanJson = rawText.trim();
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    console.error('Failed to parse Chapter QC JSON:', cleanJson, err);
    throw new Error('Failed to parse structured JSON from Chapter QC response.');
  }

  const flaggedList = Array.isArray(parsed.flaggedBubbles) ? parsed.flaggedBubbles : [];
  let totalFlagsFound = 0;

  // Build lookup of incoming flags by bubbleId
  const flagsByBubbleId = new Map<string, ReviewFlagItem[]>();

  for (const item of flaggedList) {
    const rawFlags = Array.isArray(item.flags) ? item.flags : [];
    const formattedFlags: ReviewFlagItem[] = rawFlags.map((f: any) => {
      totalFlagsFound++;
      return {
        id: `flag-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        category: (f.category || 'ambiguous_flow') as ReviewFlagCategory,
        severity: f.severity || 'warning',
        reasonAr: humanizeArabicText(f.reasonAr || 'ملاحظة تدقيقية على استمرارية الحوار.', eloquenceLevel),
        evidence: f.evidence,
        suggestedTextAr: f.suggestedTextAr ? humanizeArabicText(f.suggestedTextAr, eloquenceLevel) : undefined,
        suggestedType: f.suggestedType ? resolveCanonicalTyper(f.suggestedType).id : undefined,
        suggestedOrderIndex: typeof f.suggestedOrderIndex === 'number' ? f.suggestedOrderIndex : undefined,
        status: 'pending',
        createdAt: Date.now(),
      };
    });

    if (item.bubbleId) {
      flagsByBubbleId.set(item.bubbleId, formattedFlags);
    }
  }

  // Attach flags to existing bubbles without overwriting manual user text
  const updatedBubblesByPage: Record<string, BubbleItem[]> = {};

  for (const page of fullChapterPages) {
    const updatedBubbles = page.bubbles.map((b) => {
      const incomingFlags = flagsByBubbleId.get(b.id);
      if (!incomingFlags || incomingFlags.length === 0) return b;

      const existingFlags = b.reviewFlags || [];
      const newUniqueFlags = incomingFlags.filter(
        (newF) => !existingFlags.some((exF) => exF.category === newF.category && exF.status !== 'dismissed')
      );

      return {
        ...b,
        reviewFlags: [...existingFlags, ...newUniqueFlags],
        updatedAt: Date.now(),
      };
    });

    updatedBubblesByPage[page.pageId] = updatedBubbles;
    await savePageBubbles(page.pageId, updatedBubbles);
  }

  return {
    chapterSummary: parsed.chapterSummary || `Found ${totalFlagsFound} QC flags across the chapter.`,
    updatedBubblesByPage,
    totalFlagsFound,
  };
}

/**
 * Unified Chapter Review Orchestrator:
 * Automatically uses multimodal visual review for single-page requests,
 * and full-script continuity audit for multi-page requests.
 */
export async function auditChapterWithGemini(
  options: ChapterReviewOptions
): Promise<ReviewAuditResult> {
  const isSinglePage = options.pages.length === 1;

  if (isSinglePage) {
    return auditPageVisuallyWithGemini({
      pageId: options.pages[0].pageId,
      chapterId: options.chapterId,
      projectId: options.projectId,
      isDraft: options.isDraft,
      apiKey: options.apiKey,
      selectedModel: options.selectedModel,
      eloquenceLevel: options.eloquenceLevel,
      masterPromptOverride: options.masterPromptOverride,
      isMasterPromptActive: options.isMasterPromptActive,
    });
  }

  return auditChapterContinuityWithGemini(options);
}
