import { getPageBlob, getPageBubbles, savePageBubbles, savePageScan, getProjectLore } from '../services/db';
import { getChapterIntelligence, ingestPageIntelligence } from '../services/intelligence';
import type {
  BubbleItem,
  GeminiModelKey,
  EloquenceLevel,
  TranslationFidelity,
  HumanizerIntensity,
  OrthographyMode,
} from '../types/workbench';
import type { ReadingConvention, PageScanResult } from '../types/scanning';
import { loadTyperSettings } from '../types/typers';
import { compileInstructions } from './instructionCompiler';
import { humanizeArabicText } from './arabicHumanizer';
import { validateSingleBubbleOutput } from './translationValidator';
import { scanMangaPage } from './mangaScanner';
import { mergeScanWithExistingState } from './rescanMerge';
import { batchTranslateBubbles } from './batchTranslation';

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
  readingConvention?: ReadingConvention;
  translationFidelity?: TranslationFidelity;
  isHumanizerEnabled?: boolean;
  humanizerIntensity?: HumanizerIntensity;
  orthographyMode?: OrthographyMode;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
  precedingDialogueSnippet?: string;
  cropRetryLimit?: number;
  ocrConfidenceThreshold?: number;
  signal?: AbortSignal;
}

export interface ScanResult {
  bubbles: BubbleItem[];
  pageContext: string;
  detectedGlossaryTerms: Array<{ source: string; arabic: string; category: string }>;
  scanResult?: PageScanResult;
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
 * Executes an Orchestrated Manga Scan & Translation pass on a single comic page.
 * Keeps System #3 (Scanning & Classification) and System #2 (Translation & Eloquence)
 * as clean, separate engine responsibilities while preserving the seamless one-click workflow.
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
    readingConvention = 'auto',
    translationFidelity = 'localized',
    isHumanizerEnabled = true,
    humanizerIntensity = 'balanced',
    orthographyMode = 'correct_spelling',
    masterPromptOverride,
    isMasterPromptActive,
    precedingDialogueSnippet,
    cropRetryLimit = 3,
    ocrConfidenceThreshold = 0.65,
    signal,
  } = options;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Gemini API key is required. Please set it in Hardware Settings (Ctrl+,).');
  }

  // 1. SYSTEM #3: Canonical Multimodal Scan & Classification Pass
  const scanResult = await scanMangaPage({
    pageId,
    apiKey,
    selectedModel: selectedModel ? String(selectedModel) : 'gemini-3.8-flash',
    readingConvention,
    includeSFX,
    enableTargetedRetries: cropRetryLimit > 0,
    maxRetries: cropRetryLimit,
    ocrConfidenceThreshold,
    signal,
  });

  // 2. Fetch existing bubbles & Typer configurations for non-destructive rescan merge
  const existingBubbles = await getPageBubbles(pageId);
  const typerSettings = loadTyperSettings();

  // 3. Multi-signal merge: preserves manual edits, user typers, manual ordering, and user-drawn boxes
  const mergeResult = mergeScanWithExistingState({
    newScan: scanResult,
    existingBubbles,
    typerSettings,
  });

  // 4. SYSTEM #2: Batch Translation Pass for un-translated dialogue
  const projectLore = !isDraft && projectId ? await getProjectLore(projectId) : null;
  const chapterIntelligence = chapterId ? await getChapterIntelligence(chapterId) : null;

  const translationBatchResult = await batchTranslateBubbles({
    bubbles: mergeResult.mergedBubbles,
    pageContext: scanResult.visualContext || '',
    apiKey,
    selectedModel: selectedModel ? String(selectedModel) : 'gemini-3.8-flash',
    eloquenceLevel,
    translationFidelity,
    isHumanizerEnabled,
    humanizerIntensity,
    orthographyMode,
    masterPromptOverride,
    isMasterPromptActive,
    projectLore,
    chapterIntelligence,
    rollingContextSnippet: precedingDialogueSnippet,
    signal,
  });

  const translationMap = translationBatchResult.translationMap;

  // 5. Apply translations to non-manually-edited bubbles
  const now = Date.now();
  const finalBubbles = mergeResult.mergedBubbles.map((bubble) => {
    const translation = translationMap.get(bubble.id);
    if (!translation) return bubble;

    // Never overwrite translations the user manually edited
    if (bubble.isManuallyEdited && bubble.translatedText && bubble.translatedText.trim().length > 0) {
      return bubble;
    }

    const history = [...(bubble.translationHistory || [])];
    history.push({ timestamp: now, type: 'raw', text: translation.rawText });
    history.push({ timestamp: now, type: 'humanized', text: translation.humanizedText });

    return {
      ...bubble,
      translatedText: translation.humanizedText,
      rawTranslatedText: translation.rawText,
      humanizedTranslatedText: translation.humanizedText,
      translationHistory: history,
      updatedAt: now,
    };
  });

  // 6. Persist Canonical Scan Record & Workspace Bubbles to IndexedDB
  await savePageScan(pageId, mergeResult.updatedScanResult);
  await savePageBubbles(pageId, finalBubbles);

  // 7. Ingest newly detected entities into Chapter Intelligence (System #5)
  if (chapterId) {
    try {
      await ingestPageIntelligence({
        chapterId,
        projectId,
        pageId,
        pageIndex,
        sceneContext: scanResult.visualContext || '',
        detectedCharacters: (scanResult.detectedCharacters || []).map((c) => ({
          nameOriginal: c.nameOriginal,
          nameArabic: c.nameArabic,
          gender: c.gender === 'male' || c.gender === 'female' || c.gender === 'other' ? c.gender : 'unknown',
          title: c.title,
        })),
        detectedTerms: (scanResult.detectedGlossaryTerms || []).map((g: any) => ({
          termOriginal: g.source || '',
          termArabic: g.arabic || '',
          category: g.category || 'term',
        })),
        detectedRelationships: scanResult.detectedRelationships || [],
      });
    } catch (e) {
      console.warn('[GeminiScan] Could not ingest page intelligence:', e);
    }
  }

  return {
    bubbles: finalBubbles,
    pageContext: scanResult.visualContext || '',
    detectedGlossaryTerms: scanResult.detectedGlossaryTerms || [],
    scanResult: mergeResult.updatedScanResult,
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
