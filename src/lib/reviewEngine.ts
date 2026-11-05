import { getProjectLore, savePageBubbles } from '../services/db';
import type { BubbleItem, ReviewFlagItem, ReviewFlagCategory, GeminiModelKey, EloquenceLevel } from '../types/workbench';
import { buildReviewSystemInstruction } from './promptBuilder';
import { humanizeArabicText } from './arabicHumanizer';

export interface ChapterReviewOptions {
  chapterId: string;
  projectId?: string | null;
  isDraft?: boolean;
  pages: { pageId: string; pageIndex: number; bubbles: BubbleItem[] }[];
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

/**
 * Executes a 2-Pass Chapter-Wide Proofreading and Multi-Flag QC Audit
 */
export async function auditChapterWithGemini(
  options: ChapterReviewOptions
): Promise<ReviewAuditResult> {
  const {
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
    throw new Error('Gemini API key is required to review chapter. Set it in Hardware Settings (Ctrl+,).');
  }

  // 1. Fetch project lore if in a project
  const projectLore = !isDraft && projectId ? await getProjectLore(projectId) : null;

  // 2. Build system instruction with 10-point proofreading checklist
  const systemInstruction = buildReviewSystemInstruction({
    eloquenceLevel,
    includeSFX: true,
    projectLore,
    masterPromptOverride,
    isMasterPromptActive,
  });

  // 3. Assemble structured chapter payload
  const chapterDataPayload = pages.map((p) => ({
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
    })),
  }));

  const effectiveModel = selectedModel || 'gemini-3.8-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`;

  const payload = {
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Audit the following complete chapter dataset for quality control issues. Flag name inconsistencies, reading order problems, OCR errors, grammar/gender mismatches, typer prefix errors, and ambiguous phrasing:\n\n${JSON.stringify(
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
    throw new Error(errorBody?.error?.message || `QC Audit request failed with HTTP ${response.status}`);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini returned an empty response for QC review.');
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
    console.error('Failed to parse QC Audit JSON:', cleanJson, err);
    throw new Error('Failed to parse structured JSON from QC Audit response.');
  }

  const flaggedList = Array.isArray(parsed.flaggedBubbles) ? parsed.flaggedBubbles : [];
  let totalFlagsFound = 0;

  // Build a lookup map of incoming flags by bubbleId
  const flagsByBubbleId = new Map<string, ReviewFlagItem[]>();
  const missedBubblesByPage = new Map<string, any[]>();

  flaggedList.forEach((item: any) => {
    const rawFlags = Array.isArray(item.flags) ? item.flags : [];
    const formattedFlags: ReviewFlagItem[] = rawFlags.map((f: any) => {
      totalFlagsFound++;
      return {
        id: `flag-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        category: (f.category || 'ambiguous_flow') as ReviewFlagCategory,
        reasonAr: humanizeArabicText(f.reasonAr || 'ملاحظة تدقيقية على الفقاعة.'),
        suggestedTextAr: f.suggestedTextAr ? humanizeArabicText(f.suggestedTextAr) : undefined,
        suggestedType: f.suggestedType,
        suggestedOrderIndex: typeof f.suggestedOrderIndex === 'number' ? f.suggestedOrderIndex : undefined,
        status: 'pending',
      };
    });

    if (item.bubbleId && !item.bubbleId.startsWith('new-missed')) {
      flagsByBubbleId.set(item.bubbleId, formattedFlags);
    } else if (item.pageId) {
      // Missed bubble detected: schedule placeholder creation
      const existing = missedBubblesByPage.get(item.pageId) || [];
      existing.push({
        box_2d: Array.isArray(item.missedBubbleCoords) ? item.missedBubbleCoords : [300, 300, 500, 500],
        flags: formattedFlags,
        sourceText: item.sourceText || '',
        suggestedText: formattedFlags[0]?.suggestedTextAr || '',
      });
      missedBubblesByPage.set(item.pageId, existing);
    }
  });

  // Attach flags to existing bubbles without overwriting user data
  const updatedBubblesByPage: Record<string, BubbleItem[]> = {};

  for (const page of pages) {
    const pageBubbles = [...page.bubbles];

    // 1. Attach flags to existing bubbles
    const modifiedBubbles = pageBubbles.map((b) => {
      const incomingFlags = flagsByBubbleId.get(b.id);
      if (!incomingFlags || incomingFlags.length === 0) return b;

      // Merge with existing flags without duplicating
      const existingFlagCategories = new Set(b.reviewFlags.map((f) => f.category));
      const newUniqueFlags = incomingFlags.filter((f) => !existingFlagCategories.has(f.category));

      return {
        ...b,
        reviewFlags: [...b.reviewFlags, ...newUniqueFlags],
      };
    });

    // 2. Append placeholder bubbles for detected missed bubbles
    const missedItems = missedBubblesByPage.get(page.pageId) || [];
    missedItems.forEach((missed, mIdx) => {
      const nextIndex = modifiedBubbles.length + mIdx + 1;
      const placeholderBubble: BubbleItem = {
        id: `missed-${Date.now()}-${nextIndex}-${Math.random().toString(36).substring(2, 6)}`,
        pageId: page.pageId,
        index: nextIndex,
        box_2d: missed.box_2d,
        type: 'dialogue',
        typerPrefix: '():',
        sourceText: missed.sourceText,
        originalSourceText: missed.sourceText,
        translatedText: missed.suggestedText || '',
        rawTranslatedText: missed.suggestedText || '',
        reviewFlags: missed.flags.length > 0 ? missed.flags : [
          {
            id: `flag-missed-${Date.now()}`,
            category: 'missed_bubble',
            reasonAr: 'تم اكتشاف فقاعة حوار تم تفويتها في المسح الأول. يمكنك قبول إضافتها أو حذفها.',
            suggestedTextAr: missed.suggestedText,
            status: 'pending',
          },
        ],
      };
      modifiedBubbles.push(placeholderBubble);
    });

    updatedBubblesByPage[page.pageId] = modifiedBubbles;

    // Persist to IndexedDB
    await savePageBubbles(page.pageId, modifiedBubbles);
  }

  return {
    chapterSummary: parsed.chapterSummary || `Found ${totalFlagsFound} QC flags across the chapter.`,
    updatedBubblesByPage,
    totalFlagsFound,
  };
}
