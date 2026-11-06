import { getPageBlob, getProjectLore } from '../services/db';
import { getChapterIntelligence, ingestPageIntelligence } from '../services/intelligence';
import type {
  BubbleItem,
  GeminiModelKey,
  EloquenceLevel,
  TranslationFidelity,
  HumanizerIntensity,
  OrthographyMode,
} from '../types/workbench';
import { loadTyperSettings, resolveCanonicalTyper } from '../types/typers';
import { compileInstructions } from './instructionCompiler';
import { humanizeArabicText } from './arabicHumanizer';
import { validatePageScanOutput, validateSingleBubbleOutput } from './translationValidator';

export interface ScanPageOptions {
  pageId: string;
  chapterId?: string;
  pageIndex?: number;
  projectId?: string | null;
  isDraft?: boolean;
  apiKey: string;
  selectedModel: GeminiModelKey | string;
  eloquenceLevel: EloquenceLevel;
  includeSFX: boolean;
  translationFidelity?: TranslationFidelity;
  isHumanizerEnabled?: boolean;
  humanizerIntensity?: HumanizerIntensity;
  orthographyMode?: OrthographyMode;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
  precedingDialogueSnippet?: string;
}

export interface ScanResult {
  bubbles: BubbleItem[];
  pageContext: string;
  detectedGlossaryTerms: Array<{ source: string; arabic: string; category: string }>;
}

/**
 * Converts a Blob or File to a base64 string without data prefix
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Validates and normalizes bounding box coordinates within [0, 1000].
 */
function normalizeBoundingBox(coords: any): [number, number, number, number] {
  if (!Array.isArray(coords) || coords.length !== 4) {
    return [200, 200, 400, 400];
  }

  let [ymin, xmin, ymax, xmax] = coords.map((val) => {
    const num = Number(val);
    if (isNaN(num)) return 0;
    return Math.max(0, Math.min(1000, Math.round(num)));
  });

  if (ymin >= ymax) ymax = Math.min(1000, ymin + 50);
  if (xmin >= xmax) xmax = Math.min(1000, xmin + 50);

  return [ymin, xmin, ymax, xmax];
}

/**
 * Executes a Multimodal Vision Scan with Chapter Context on a single comic page.
 */
export async function scanPageWithGemini(options: ScanPageOptions): Promise<ScanResult> {
  const {
    pageId,
    chapterId,
    pageIndex = 1,
    projectId,
    isDraft = false,
    apiKey,
    selectedModel,
    eloquenceLevel,
    includeSFX,
    translationFidelity = 'localized',
    isHumanizerEnabled = true,
    humanizerIntensity = 'balanced',
    orthographyMode = 'correct_spelling',
    masterPromptOverride,
    isMasterPromptActive,
    precedingDialogueSnippet,
  } = options;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Gemini API key is required. Please set it in Hardware Settings (Ctrl+,).');
  }

  // 1. Retrieve the binary Blob from IndexedDB
  const blob = await getPageBlob(pageId);
  if (!blob) {
    throw new Error(`Page image blob not found in IndexedDB for ID: ${pageId}`);
  }

  // 2. Convert to base64 inlineData payload
  const mimeType = blob.type || 'image/png';
  const base64Data = await blobToBase64(blob);

  // 3. Fetch project lore and chapter intelligence
  const projectLore = !isDraft && projectId ? await getProjectLore(projectId) : null;
  const chapterIntelligence = chapterId ? await getChapterIntelligence(chapterId) : null;

  // 4. Fetch current configured typers
  const typerSettings = loadTyperSettings();

  // 5. Assemble system instruction via Instruction Compiler
  const compiled = compileInstructions({
    task: 'page_scan',
    eloquenceLevel,
    translationFidelity,
    isHumanizerEnabled,
    humanizerIntensity,
    orthographyMode,
    includeSFX,
    projectLore,
    chapterIntelligence,
    rollingContextSnippet: precedingDialogueSnippet,
    masterPromptOverride,
    isMasterPromptActive,
    typers: typerSettings.typers,
  });

  const effectiveModel = selectedModel || 'gemini-3.8-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`;

  const payload = {
    system_instruction: {
      parts: [{ text: compiled.systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Extract all dialogue bubbles, narration boxes, shouts, thoughts, and text from this page. Provide bounding boxes [ymin, xmin, ymax, xmax] on a 0-1000 scale, accurate TypeR prefixes, and natural Arabic translations in structured JSON format.',
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
      temperature: 0.2,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorMsg = errorBody?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(errorMsg);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  // Validate structural output locally
  const validated = validatePageScanOutput(rawText || '');
  if (!validated.isValid || !validated.data) {
    throw new Error(validated.errors[0] || 'Failed to parse structured JSON from Gemini response.');
  }

  const { bubbles: rawBubbles, pageContext, detectedGlossaryTerms, detectedCharacters, detectedRelationships } = validated.data;

  // Map into BubbleItem schema with canonical typer resolution & non-destructive humanizer
  const bubbles: BubbleItem[] = rawBubbles.map((item: any, idx: number) => {
    const rawArabic = item.translatedText || '';
    const humanizedArabic = isHumanizerEnabled
      ? humanizeArabicText(rawArabic, {
          eloquenceLevel,
          intensity: humanizerIntensity,
          orthographyMode,
          isDialectActive: compiled.isDialectActive,
        })
      : rawArabic;

    const canonicalTyper = resolveCanonicalTyper(item.type, typerSettings.typers);
    const safeBox = normalizeBoundingBox(item.box_2d);

    const now = Date.now();
    return {
      id: `b-${now}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
      pageId,
      chapterId,
      index: idx + 1,
      box_2d: safeBox,
      type: canonicalTyper.id,
      typerPrefix: item.typerPrefix !== undefined ? item.typerPrefix : canonicalTyper.prefix,
      sourceLanguage: item.sourceLanguage || 'ja',
      sourceText: item.sourceText || '',
      originalSourceText: item.sourceText || '',
      translatedText: humanizedArabic,
      rawTranslatedText: rawArabic,
      humanizedTranslatedText: humanizedArabic,
      translationHistory: [
        { timestamp: now, type: 'raw', text: rawArabic },
        { timestamp: now, type: 'humanized', text: humanizedArabic },
      ],
      reviewFlags: [],
      confidence: 0.9,
      isManuallyEdited: false,
      updatedAt: now,
    };
  });

  // Ingest newly detected entities into Chapter Intelligence & Project Lore
  if (chapterId) {
    try {
      await ingestPageIntelligence({
        chapterId,
        projectId,
        pageId,
        pageIndex,
        sceneContext: pageContext || '',
        detectedCharacters,
        detectedTerms: detectedGlossaryTerms.map((g: any) => ({
          termOriginal: g.source || '',
          termArabic: g.arabic || '',
          category: g.category || 'term',
        })),
        detectedRelationships,
      });
    } catch (e) {
      console.warn('[GeminiScan] Could not ingest page intelligence:', e);
    }
  }

  return {
    bubbles,
    pageContext,
    detectedGlossaryTerms,
  };
}

export interface TranslateSingleBubbleOptions {
  pageId: string;
  bubble: BubbleItem;
  surroundingBubbles?: BubbleItem[];
  projectId?: string | null;
  chapterId?: string;
  isDraft?: boolean;
  apiKey: string;
  selectedModel: GeminiModelKey | string;
  eloquenceLevel: EloquenceLevel;
  translationFidelity?: TranslationFidelity;
  isHumanizerEnabled?: boolean;
  humanizerIntensity?: HumanizerIntensity;
  orthographyMode?: OrthographyMode;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
}

export interface SingleBubbleTranslationResult {
  sourceText?: string;
  rawTranslatedText: string;
  humanizedTranslatedText: string;
  translatedText: string;
}

/**
 * Translates a single bubble into Arabic using Gemini.
 * Uses targeted single-bubble compilation, surrounding dialogue context, and QC review notes.
 */
export async function translateSingleBubbleWithGemini(
  options: TranslateSingleBubbleOptions
): Promise<SingleBubbleTranslationResult> {
  const {
    pageId,
    bubble,
    surroundingBubbles = [],
    projectId,
    chapterId,
    isDraft = false,
    apiKey,
    selectedModel,
    eloquenceLevel,
    translationFidelity = 'localized',
    isHumanizerEnabled = true,
    humanizerIntensity = 'balanced',
    orthographyMode = 'correct_spelling',
    masterPromptOverride,
    isMasterPromptActive,
  } = options;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Gemini API key is required. Please set it in Hardware Settings (Ctrl+,).');
  }

  const projectLore = !isDraft && projectId ? await getProjectLore(projectId) : null;
  const chapterIntelligence = chapterId ? await getChapterIntelligence(chapterId) : null;

  // Assemble contextual dialogue history from other page bubbles
  let pageContextText = '';
  if (surroundingBubbles && surroundingBubbles.length > 0) {
    const contextualLines = surroundingBubbles
      .filter((b) => b.id !== bubble.id && (b.translatedText || b.sourceText))
      .sort((a, b) => a.index - b.index)
      .map(
        (b) =>
          `#${String(b.index).padStart(2, '0')} [${b.type}]: Source: "${b.sourceText || ''}" -> Arabic: "${b.translatedText || ''}"`
      )
      .join('\n');
    if (contextualLines.trim().length > 0) {
      pageContextText = `\n\nPage Context / Surrounding Dialogues:\n${contextualLines}`;
    }
  }

  // Assemble review notes if previous review left flags
  let reviewFlagsText = '';
  if (bubble.reviewFlags && bubble.reviewFlags.length > 0) {
    const flagNotes = bubble.reviewFlags
      .filter((f) => f.status === 'pending')
      .map(
        (f) =>
          `- [${f.category}]: Reason: ${f.reasonAr}${f.suggestedTextAr ? ` | Suggested fix: "${f.suggestedTextAr}"` : ''}`
      )
      .join('\n');
    if (flagNotes.length > 0) {
      reviewFlagsText = `\n\nQC Audit Notes for this bubble:\n${flagNotes}\nPlease resolve these QC notes in the translation.`;
    }
  }

  // Compile targeted single bubble instruction package
  const compiled = compileInstructions({
    task: 'single_bubble',
    eloquenceLevel,
    translationFidelity,
    isHumanizerEnabled,
    humanizerIntensity,
    orthographyMode,
    masterPromptOverride,
    isMasterPromptActive,
    projectLore,
    chapterIntelligence,
    singleBubbleContext: {
      index: bubble.index,
      type: bubble.type,
      typerPrefix: bubble.typerPrefix,
      sourceText: bubble.sourceText,
      pageContextText,
      reviewNotesText: reviewFlagsText,
    },
  });

  const effectiveModel = selectedModel || 'gemini-3.8-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`;

  const hasSource = Boolean(bubble.sourceText && bubble.sourceText.trim().length > 0);
  let userParts: any[] = [];

  if (hasSource) {
    userParts = [
      {
        text: `Translate this single comic dialogue into natural Arabic scanlation format.\nBubble Index: #${String(bubble.index).padStart(2, '0')}\nBubble Type: ${bubble.type} (${bubble.typerPrefix || ''})\nSource Dialogue: "${bubble.sourceText.trim()}"${pageContextText}${reviewFlagsText}\n\nReturn strictly valid JSON:\n{\n  "translatedText": "Humanized Arabic translation"\n}`,
      },
    ];
  } else {
    // If no source text, extract visually from page image blob
    const blob = await getPageBlob(pageId);
    if (!blob) {
      throw new Error('No source dialogue text entered and scan page image not available.');
    }
    const mimeType = blob.type || 'image/png';
    const base64Data = await blobToBase64(blob);

    userParts = [
      {
        text: `Look at the comic dialogue bubble at normalized box [ymin, xmin, ymax, xmax] = [${bubble.box_2d.join(', ')}] on 0-1000 scale.\nTranscribe its original dialogue as sourceText, and translate it into natural Arabic as translatedText.${pageContextText}${reviewFlagsText}\n\nReturn strictly valid JSON:\n{\n  "sourceText": "Original text",\n  "translatedText": "Humanized Arabic translation"\n}`,
      },
      {
        inline_data: {
          mime_type: mimeType,
          data: base64Data,
        },
      },
    ];
  }

  const payload = {
    system_instruction: {
      parts: [{ text: compiled.systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: userParts,
      },
    ],
    generation_config: {
      response_mime_type: 'application/json',
      temperature: 0.2,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorMsg = errorBody?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(errorMsg);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  // Validate structural output locally
  const validated = validateSingleBubbleOutput(rawText || '', bubble.sourceText);
  if (!validated.isValid || !validated.data) {
    throw new Error(validated.errors[0] || 'Failed to parse structured JSON from Gemini response.');
  }

  const rawArabic = validated.data.translatedText;
  const humanizedArabic = isHumanizerEnabled
    ? humanizeArabicText(rawArabic, {
        eloquenceLevel,
        intensity: humanizerIntensity,
        orthographyMode,
        isDialectActive: compiled.isDialectActive,
      })
    : rawArabic;

  return {
    sourceText: validated.data.sourceText,
    rawTranslatedText: rawArabic,
    humanizedTranslatedText: humanizedArabic,
    translatedText: humanizedArabic,
  };
}
