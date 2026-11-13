import {
  getPageBlob,
  getPageBubbles,
  getPageScan,
  savePageBubbles,
  savePageScan,
  getProjectLore,
} from '../services/db';
import { getChapterIntelligence, ingestPageIntelligence } from '../services/intelligence';
import type {
  BubbleItem,
  GeminiModelKey,
  EloquenceLevel,
  TranslationFidelity,
  HumanizerIntensity,
  OrthographyMode,
} from '../types/workbench';
import type {
  ReadingConvention,
  PageScanResult,
  TextRegion,
  GenericTextClass,
  GeminiInterpretationRecord,
} from '../types/scanning';
import { loadTyperSettings, type CustomTyperConfig } from '../types/typers';
import { compileInstructions } from './instructionCompiler';
import { humanizeArabicText } from './arabicHumanizer';
import { validateSingleBubbleOutput } from './translationValidator';
import {
  scanMangaPageHybridWithMeta,
  type HybridGeminiCandidateInput,
  type HybridScanDependencies,
  type HybridScanMetadata,
} from './hybridScan';
import {
  validateGeminiReadingOrder,
  applyReadingOrder,
  inferHierarchicalReadingOrder,
} from './readingOrder';
import { defaultTyperForClass } from './scanAdapter';
import { mergeScanWithExistingState } from './rescanMerge';
import { batchTranslateBubbles } from './batchTranslation';
import { isMeaningfulLinguisticContent, normalizeExtractedDialogue } from './mangaScanner';
import { createDiagnosticCorrelationId, emitDiagnosticBoundary } from './diagnosticTap';

export interface ScanPageDeps {
  getPageBubbles?: typeof getPageBubbles;
  getPageScan?: typeof getPageScan;
  savePageBubbles?: typeof savePageBubbles;
  savePageScan?: typeof savePageScan;
  getProjectLore?: typeof getProjectLore;
  getChapterIntelligence?: typeof getChapterIntelligence;
  ingestPageIntelligence?: (...args: Parameters<typeof ingestPageIntelligence>) => Promise<unknown>;
  batchTranslateBubbles?: typeof batchTranslateBubbles;
}

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
  sourceLanguageHint?: string;
  sampleTextForAutoRoute?: string;
  readingConvention?: ReadingConvention;
  translationFidelity?: TranslationFidelity;
  isHumanizerEnabled?: boolean;
  humanizerIntensity?: HumanizerIntensity;
  orthographyMode?: OrthographyMode;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
  precedingDialogueSnippet?: string;
  enableCropRetries?: boolean;
  cropRetryLimit?: number;
  ocrConfidenceThreshold?: number;
  correlationId?: string;
  signal?: AbortSignal;
  hybridDeps?: HybridScanDependencies;
  scanDeps?: ScanPageDeps;
}

export interface ScanResult {
  bubbles: BubbleItem[];
  pageContext: string;
  detectedGlossaryTerms: Array<{ source: string; arabic: string; category: string }>;
  scanResult?: PageScanResult;
  ocrSource?: 'hybrid' | 'gemini_fallback' | 'local_partial';
  translationSuccess?: boolean;
  warnings?: string[];
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

export const HYBRID_OCR_DIAGNOSTIC_PREFIX = '[Folio Hybrid OCR Diagnostic]';

export interface HybridOcrDiagnosticEntry {
  pageId: string;
  pageIndex: number;
  ocrSource: HybridScanMetadata['ocrSource'];
  fallbackReason?: HybridScanMetadata['fallbackReason'];
  resolvedRoute: HybridScanMetadata['resolvedRoute'];
  effectiveLanguage: HybridScanMetadata['effectiveLanguage'];
  localCandidateCount: number;
  keptCandidateCount: number;
  verifiedCandidateCount: number;
  addedRegionCount: number;
  droppedCandidateCount: number;
  geminiContextFailed: boolean;
  warnings: string[];
}

function sanitizeDiagnosticWarning(warning: string): string {
  return warning
    .replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, '[REDACTED_API_KEY]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');
}

/**
 * Formats a safe diagnostic payload from HybridScanMetadata without exposing sensitive fields.
 */
export function buildHybridOcrDiagnosticEntry(
  pageId: string,
  pageIndex: number,
  meta: HybridScanMetadata
): HybridOcrDiagnosticEntry {
  return {
    pageId,
    pageIndex,
    ocrSource: meta.ocrSource,
    ...(meta.fallbackReason !== undefined ? { fallbackReason: meta.fallbackReason } : {}),
    resolvedRoute: meta.resolvedRoute,
    effectiveLanguage: meta.effectiveLanguage,
    localCandidateCount: meta.localCandidateCount,
    keptCandidateCount: meta.keptCandidateCount,
    verifiedCandidateCount: meta.verifiedCandidateCount,
    addedRegionCount: meta.addedRegionCount,
    droppedCandidateCount: meta.droppedCandidateCount,
    geminiContextFailed: meta.geminiContextFailed,
    warnings: (Array.isArray(meta.warnings) ? meta.warnings : []).map((warning) =>
      sanitizeDiagnosticWarning(String(warning))
    ),
  };
}

function logHybridOcrDiagnosticIfDev(
  pageId: string,
  pageIndex: number,
  meta: HybridScanMetadata
): void {
  if (!(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV)) {
    return;
  }

  try {
    const entry = buildHybridOcrDiagnosticEntry(pageId, pageIndex, meta);
    const summaryParts = [
      HYBRID_OCR_DIAGNOSTIC_PREFIX,
      `pageIndex=${entry.pageIndex}`,
      `pageId=${entry.pageId}`,
      `ocrSource=${entry.ocrSource}`,
    ];
    if (entry.fallbackReason !== undefined) {
      summaryParts.push(`fallbackReason=${entry.fallbackReason}`);
    }
    summaryParts.push(
      `resolvedRoute=${entry.resolvedRoute ?? 'null'}`,
      `effectiveLanguage=${entry.effectiveLanguage ?? 'null'}`,
      `warnings=${entry.warnings.length}`
    );
    console.log(summaryParts.join(' | '), entry);
  } catch {
    // Diagnostic logging must never alter or interrupt scanning behavior.
  }
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
    sourceLanguageHint = 'auto',
    sampleTextForAutoRoute,
    readingConvention = 'auto',
    translationFidelity = 'localized',
    isHumanizerEnabled = true,
    humanizerIntensity = 'balanced',
    orthographyMode = 'correct_spelling',
    masterPromptOverride,
    isMasterPromptActive,
    precedingDialogueSnippet,
    enableCropRetries,
    cropRetryLimit = 3,
    ocrConfidenceThreshold = 0.65,
    correlationId: providedCorrelationId,
    signal,
    hybridDeps,
    scanDeps,
  } = options;

  const correlationId = providedCorrelationId || createDiagnosticCorrelationId(`page-${pageIndex}`);
  const scanStart = Date.now();

  emitDiagnosticBoundary({
    subsystem: 'scanning-ocr',
    component: 'GeminiScanOrchestrator',
    operation: 'scanPageWithGemini',
    eventType: 'lifecycle',
    severity: 'info',
    status: 'running',
    correlationId,
    identifiers: { projectId: projectId || undefined, chapterId, pageId, pageIndex },
    payload: {
      selectedModel: String(selectedModel),
      sourceLanguageHint,
      readingConvention,
      includeSFX,
    },
    explanation: `Started scan and translation pipeline for page ${pageIndex} (${pageId}).`,
  });

  const loadBubbles = scanDeps?.getPageBubbles ?? getPageBubbles;
  const persistBubbles = scanDeps?.savePageBubbles ?? savePageBubbles;
  const persistScan = scanDeps?.savePageScan ?? savePageScan;
  const loadLore = scanDeps?.getProjectLore ?? getProjectLore;
  const loadChapterIntel = scanDeps?.getChapterIntelligence ?? getChapterIntelligence;
  const saveChapterIntel = scanDeps?.ingestPageIntelligence ?? ingestPageIntelligence;
  const translateBatch = scanDeps?.batchTranslateBubbles ?? batchTranslateBubbles;

  // 1. Fetch existing bubbles upfront for rescan sample-text evidence and non-destructive merge
  const existingBubbles = await loadBubbles(pageId);
  const nonSfxSample = existingBubbles
    .filter((b) => b.type !== 'sfx' && b.typerPrefix !== 'SFX:')
    .map((b) => (b.sourceText || '').trim())
    .filter((txt) => isMeaningfulLinguisticContent(txt))
    .join('\n');
  const existingSampleText =
    sampleTextForAutoRoute !== undefined
      ? sampleTextForAutoRoute
      : sourceLanguageHint === 'auto' && nonSfxSample.replace(/\s+/g, '').length >= 8
      ? nonSfxSample
      : undefined;

  const shouldRetryCrops = enableCropRetries !== undefined ? enableCropRetries : cropRetryLimit > 0;
  const typerSettings = loadTyperSettings();

  // 2. SYSTEM #3: Unified Hybrid Scan & Classification Pass (Local OCR primary + Gemini context/fallback)
  const hybridOutcome = await scanMangaPageHybridWithMeta({
    pageId,
    apiKey,
    selectedModel: selectedModel ? String(selectedModel) : 'gemini-3.8-flash',
    readingConvention,
    includeSFX,
    sourceLanguageHint,
    sampleTextForAutoRoute: existingSampleText || undefined,
    enableTargetedRetries: shouldRetryCrops,
    maxRetries: cropRetryLimit,
    ocrConfidenceThreshold,
    correlationId,
    configuredTypers: typerSettings.typers,
    signal,
    hybridDeps,
  });

  logHybridOcrDiagnosticIfDev(pageId, pageIndex, hybridOutcome.meta);

  const scanResult = hybridOutcome.scanResult;
  const warnings = [...hybridOutcome.meta.warnings];

  // 3. Multi-signal merge: preserves manual edits, user typers, manual ordering, and user-drawn boxes
  const mergeResult = mergeScanWithExistingState({
    newScan: scanResult,
    existingBubbles,
    typerSettings,
  });

  // 4. SYSTEM #2: Batch Translation Pass for un-translated dialogue (never drops extracted text on failure)
  const projectLore = !isDraft && projectId ? await loadLore(projectId) : null;
  const chapterIntelligence = chapterId ? await loadChapterIntel(chapterId) : null;

  let translationSuccess = true;
  let translationFailureReason: string | null = null;
  let translationMap = new Map<string, { rawText: string; humanizedText: string }>();

  const hasPendingTranslatable = mergeResult.mergedBubbles.some((b) => {
    if (!b.sourceText || b.sourceText.trim().length === 0) return false;
    if (b.isManuallyEdited) return false;
    if (!includeSFX && (b.type === 'sfx' || b.typerPrefix === 'SFX:')) return false;
    if (!b.translatedText || b.translatedText.trim().length === 0) return true;
    if (b.originalSourceText && b.originalSourceText.trim() !== b.sourceText.trim()) return true;
    return false;
  });

  if (hasPendingTranslatable) {
    if (!apiKey || apiKey.trim().length === 0) {
      translationSuccess = false;
      translationFailureReason =
        'Gemini API key is missing for translation; extracted source text was preserved.';
    } else {
      try {
        const translationBatchResult = await translateBatch({
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
          includeSFX,
          rollingContextSnippet: precedingDialogueSnippet,
          correlationId,
          signal,
        });

        translationMap = translationBatchResult.translationMap;
        if (!translationBatchResult.success) {
          translationSuccess = false;
          translationFailureReason =
            translationBatchResult.error ||
            'Batch translation failed; extracted source text was preserved.';
        }
      } catch (err: any) {
        if (signal?.aborted || err?.name === 'AbortError') {
          throw err;
        }
        translationSuccess = false;
        translationFailureReason = `Translation failed (${err?.message || 'unknown error'}); extracted source text was preserved.`;
        emitDiagnosticBoundary({
          subsystem: 'translation',
          component: 'GeminiScanOrchestrator',
          operation: 'batchTranslation',
          eventType: 'error',
          severity: 'warning',
          status: 'degraded',
          correlationId,
          identifiers: { pageId, pageIndex },
          explanation: `Translation failed on page ${pageIndex}; extracted source text was preserved.`,
          error: err,
        });
      }
    }
  }

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

  // Record partial status when translation fails so recoverable partial failures remain explicit
  let finalScanRecord = mergeResult.updatedScanResult;
  if (!translationSuccess && translationFailureReason) {
    warnings.push(translationFailureReason);
    finalScanRecord = {
      ...finalScanRecord,
      status: 'partial',
      issues: [
        ...finalScanRecord.issues,
        {
          issueId: `issue-${pageId}-translation-unavailable`,
          flag: 'STAGE_UNAVAILABLE',
          severity: 'warning',
          affectedRegionIds: finalBubbles
            .filter((b) => b.sourceText?.trim() && !b.translatedText?.trim())
            .map((b) => b.id),
          reason: translationFailureReason,
          retryable: true,
        },
      ],
    };
  }

  // 6. Persist Canonical Scan Record & Workspace Bubbles to IndexedDB
  await persistScan(pageId, finalScanRecord);
  await persistBubbles(pageId, finalBubbles);

  emitDiagnosticBoundary({
    subsystem: 'data-storage',
    component: 'GeminiScanOrchestrator',
    operation: 'persistPageResults',
    eventType: 'io',
    severity: 'info',
    status: 'succeeded',
    correlationId,
    identifiers: { pageId, pageIndex },
    payload: { bubbleCount: finalBubbles.length, scanStatus: finalScanRecord.status },
    explanation: `Database accepted ${finalBubbles.length} bubble(s) and canonical scan record (${finalScanRecord.status}) for page ${pageIndex}.`,
  });

  // 7. Ingest newly detected entities into Chapter Intelligence (System #5)
  if (
    chapterId &&
    (scanResult.visualContext ||
      (scanResult.detectedCharacters && scanResult.detectedCharacters.length > 0) ||
      (scanResult.detectedGlossaryTerms && scanResult.detectedGlossaryTerms.length > 0))
  ) {
    try {
      await saveChapterIntel({
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

  emitDiagnosticBoundary({
    subsystem: 'scanning-ocr',
    component: 'GeminiScanOrchestrator',
    operation: 'scanPageWithGemini',
    eventType: 'lifecycle',
    severity: translationSuccess && hybridOutcome.meta.ocrSource !== 'local_partial' ? 'healthy' : 'warning',
    status: translationSuccess && hybridOutcome.meta.ocrSource !== 'local_partial' ? 'succeeded' : 'degraded',
    durationMs: Date.now() - scanStart,
    correlationId,
    identifiers: { projectId: projectId || undefined, chapterId, pageId, pageIndex },
    payload: {
      ocrSource: hybridOutcome.meta.ocrSource,
      fallbackReason: hybridOutcome.meta.fallbackReason,
      bubbleCount: finalBubbles.length,
      translationSuccess,
      warningsCount: warnings.length,
    },
    explanation: translationSuccess
      ? `Page ${pageIndex} scan completed via ${hybridOutcome.meta.ocrSource} with ${finalBubbles.length} dialogue bubble(s).`
      : `Page ${pageIndex} scan completed partially (${hybridOutcome.meta.ocrSource}): translation did not succeed, source text preserved.`,
  });

  return {
    bubbles: finalBubbles,
    pageContext: scanResult.visualContext || '',
    detectedGlossaryTerms: scanResult.detectedGlossaryTerms || [],
    scanResult: finalScanRecord,
    ocrSource: hybridOutcome.meta.ocrSource,
    translationSuccess,
    warnings,
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
  const correlationId = createDiagnosticCorrelationId('single-bubble');
  const tStart = Date.now();

  emitDiagnosticBoundary({
    subsystem: 'translation',
    component: 'SingleBubbleTranslator',
    operation: 'translateSingleBubble',
    eventType: 'lifecycle',
    severity: 'info',
    status: 'running',
    correlationId,
    identifiers: { projectId: projectId || undefined, chapterId, pageId, bubbleId: bubble.id, modelId: String(effectiveModel) },
    payload: { hasSource: Boolean(bubble.sourceText?.trim()), eloquenceLevel, translationFidelity },
    explanation: `Requested single-bubble translation for bubble #${bubble.index} using ${effectiveModel}.`,
  });

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
    emitDiagnosticBoundary({
      subsystem: 'ai-services',
      component: 'GeminiApiClient',
      operation: 'translateSingleBubbleRequest',
      eventType: 'io',
      severity: 'error',
      status: 'failed',
      durationMs: Date.now() - tStart,
      correlationId,
      identifiers: { pageId, bubbleId: bubble.id, modelId: String(effectiveModel) },
      payload: { httpStatus: response.status },
      explanation: `Gemini single-bubble request failed with HTTP ${response.status}: ${errorMsg}`,
      error: new Error(errorMsg),
    });
    throw new Error(errorMsg);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  // Validate structural output locally
  const validated = validateSingleBubbleOutput(rawText || '', bubble.sourceText);
  if (!validated.isValid || !validated.data) {
    const errMsg = validated.errors[0] || 'Failed to parse structured JSON from Gemini response.';
    emitDiagnosticBoundary({
      subsystem: 'translation',
      component: 'SingleBubbleTranslator',
      operation: 'validateSingleBubbleOutput',
      eventType: 'error',
      severity: 'error',
      status: 'failed',
      durationMs: Date.now() - tStart,
      correlationId,
      identifiers: { pageId, bubbleId: bubble.id },
      explanation: `Single-bubble translation validation failed: ${errMsg}`,
      error: new Error(errMsg),
    });
    throw new Error(errMsg);
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

  emitDiagnosticBoundary({
    subsystem: 'translation',
    component: 'SingleBubbleTranslator',
    operation: 'translateSingleBubble',
    eventType: 'lifecycle',
    severity: 'healthy',
    status: 'succeeded',
    durationMs: Date.now() - tStart,
    correlationId,
    identifiers: { pageId, bubbleId: bubble.id, modelId: String(effectiveModel) },
    payload: {
      isHumanizerEnabled,
      rawTranslatedText: rawArabic,
      humanizedTranslatedText: humanizedArabic,
    },
    explanation: `Translated bubble #${bubble.index} in ${Date.now() - tStart}ms.`,
  });

  return {
    sourceText: validated.data.sourceText,
    rawTranslatedText: rawArabic,
    humanizedTranslatedText: humanizedArabic,
    translatedText: humanizedArabic,
  };
}

export interface InterpretPageVisualOptions {
  pageId: string;
  chapterId?: string;
  projectId?: string | null;
  apiKey: string;
  selectedModel?: GeminiModelKey | string;
  includeSFX?: boolean;
  readingConvention?: ReadingConvention;
  sourceLanguageHint?: string;
  configuredTypers?: CustomTyperConfig[];
  correlationId?: string;
  signal?: AbortSignal;
  scanDeps?: ScanPageDeps;
  hybridDeps?: HybridScanDependencies;
}

export interface InterpretPageVisualResult {
  success: boolean;
  pageId: string;
  bubbles: BubbleItem[];
  scanResult?: PageScanResult;
  interpretations: GeminiInterpretationRecord[];
  readingOrderSource: 'gemini_visual' | 'geometric_fallback';
  error?: string;
}

/**
 * Runs independent Gemini visual interpretation on existing local OCR extractions
 * without re-running local OCR. Updates reading order, typer assignment, and
 * semantic classifications on existing groups.
 */
export async function interpretPageVisualContext(
  options: InterpretPageVisualOptions
): Promise<InterpretPageVisualResult> {
  const {
    pageId,
    chapterId,
    projectId,
    apiKey,
    selectedModel = 'gemini-3.8-flash',
    includeSFX = true,
    readingConvention = 'auto',
    sourceLanguageHint = 'auto',
    configuredTypers: providedTypers,
    correlationId: providedCorrelationId,
    signal,
    scanDeps,
    hybridDeps,
  } = options;

  const correlationId = providedCorrelationId || createDiagnosticCorrelationId(`interpret-${pageId}`);
  const loadScan = scanDeps?.getPageScan ?? getPageScan;
  const loadBubbles = scanDeps?.getPageBubbles ?? getPageBubbles;
  const persistBubbles = scanDeps?.savePageBubbles ?? savePageBubbles;
  const persistScan = scanDeps?.savePageScan ?? savePageScan;
  const getBlob = hybridDeps?.getPageBlob ?? getPageBlob;
  const configuredTypers = providedTypers || loadTyperSettings().typers;

  const existingScan = await loadScan(pageId);
  const existingBubbles = await loadBubbles(pageId);

  if ((!existingScan || existingScan.regions.length === 0) && existingBubbles.length === 0) {
    return {
      success: false,
      pageId,
      bubbles: [],
      interpretations: [],
      readingOrderSource: 'geometric_fallback',
      error: 'No local OCR extraction found for this page. Please run Local OCR first.',
    };
  }

  const blob = await getBlob(pageId);
  if (!blob) {
    return {
      success: false,
      pageId,
      bubbles: existingBubbles,
      scanResult: existingScan || undefined,
      interpretations: [],
      readingOrderSource: 'geometric_fallback',
      error: 'Page image blob not found in storage.',
    };
  }

  // Use existing OCR regions if available; otherwise construct regions from existing bubbles
  const regions: TextRegion[] =
    existingScan && existingScan.regions.length > 0
      ? [...existingScan.regions]
      : existingBubbles.map((b) => ({
          regionId: b.id,
          geometry: {
            coordinateSpace: 'normalized_1000' as const,
            box_2d: b.box_2d,
            polygon: b.ocrPolygon,
          },
          rawOCR: b.sourceText || '',
          confidence: {
            imageQuality: 1.0,
            regionDetection: 0.9,
            ocr: b.confidence ?? 0.9,
            association: 0.9,
            readingOrder: 0.9,
            classification: 0.9,
          },
          classification: {
            primaryClass: (b.type === 'sfx' || b.typerPrefix === 'SFX:' ? 'sfx' : 'dialogue') as GenericTextClass,
            confidence: 0.9,
            needsReview: false,
          },
          sourceLanguage: b.sourceLanguage || 'auto',
          associations: {},
          order: {
            sequenceIndex: b.index,
            confidence: 0.9,
            rationale: 'Existing bubble sequence',
          },
          flags: [],
          isManuallyEdited: b.isManuallyEdited,
        }));

  const bubbleBoxMap = new Map<string, [number, number, number, number]>();
  for (const b of existingScan?.bubbleRegions || []) {
    bubbleBoxMap.set(b.bubbleId, b.geometry.box_2d);
  }

  const candidateInputs: HybridGeminiCandidateInput[] = regions.map((r) => ({
    regionId: r.regionId,
    box_2d: r.geometry.box_2d,
    polygon: r.geometry.polygon,
    lineCount: r.lineSegments?.length,
    isVertical: r.isVertical,
    associatedBubbleBox: r.associations?.bubbleId ? bubbleBoxMap.get(r.associations.bubbleId) : undefined,
    localOCR: normalizeExtractedDialogue(r.rawOCR),
    ocrConfidence: r.confidence?.ocr ?? 0.9,
    kind: r.associations?.bubbleId ? 'text_bubble' : 'text_free',
    needsVerification: false,
    verificationReasons: [],
  }));

  let geminiContext: any = null;
  try {
    if (hybridDeps?.runGeminiContextPass) {
      geminiContext = await hybridDeps.runGeminiContextPass({
        blob,
        pageId,
        apiKey,
        selectedModel: String(selectedModel),
        readingConvention,
        includeSFX,
        sourceLanguageHint,
        candidates: candidateInputs,
        configuredTypers,
        signal,
      });
    } else {
      // Default execution path calling defaultRunGeminiContextPass via dynamic import or direct execution
      const { scanMangaPageHybridWithMeta } = await import('./hybridScan');
      // HybridScan has defaultRunGeminiContextPass internally
      const outcome = await scanMangaPageHybridWithMeta({
        pageId,
        apiKey,
        selectedModel,
        readingConvention,
        includeSFX,
        sourceLanguageHint,
        correlationId,
        configuredTypers,
        signal,
        hybridDeps,
      });
      return {
        success: outcome.scanResult.status !== 'failed',
        pageId,
        bubbles: outcome.scanResult.regions.map((r) => {
          const matchedBubble = existingBubbles.find((b) => b.id === r.regionId);
          return {
            ...(matchedBubble || {}),
            id: r.regionId,
            pageId,
            index: r.order.sequenceIndex,
            box_2d: r.geometry.box_2d,
            ocrPolygon: r.geometry.polygon,
            interpretation: r.interpretation,
            type: matchedBubble?.isManuallyEdited && matchedBubble.type && matchedBubble.type !== 'none'
              ? matchedBubble.type
              : r.interpretation?.typerId || 'speech_bubbles',
            typerPrefix: matchedBubble?.isManuallyEdited && matchedBubble.typerPrefix !== undefined
              ? matchedBubble.typerPrefix
              : r.interpretation?.typerPrefix || '"":',
            sourceText: r.rawOCR,
            originalSourceText: r.rawOCR,
            confidence: r.confidence.ocr,
            updatedAt: Date.now(),
          } as BubbleItem;
        }),
        scanResult: outcome.scanResult,
        interpretations: outcome.scanResult.interpretations || [],
        readingOrderSource: outcome.scanResult.readingOrderSource || 'gemini_visual',
      };
    }
  } catch (err: any) {
    if (signal?.aborted || err?.name === 'AbortError') throw err;
    return {
      success: false,
      pageId,
      bubbles: existingBubbles,
      scanResult: existingScan || undefined,
      interpretations: [],
      readingOrderSource: 'geometric_fallback',
      error: `Visual interpretation failed: ${err?.message || 'unknown error'}`,
    };
  }

  // Validate reading order
  const candidateIds = regions.map((r) => r.regionId);
  const orderValidation = validateGeminiReadingOrder(geminiContext.readingOrder, candidateIds);
  let orderedRegions: TextRegion[];
  let readingOrderSource: 'gemini_visual' | 'geometric_fallback';

  if (orderValidation.isValid) {
    orderedRegions = applyReadingOrder(regions, orderValidation.orderedIds, {
      isFallback: false,
      confidence: 0.96,
      rationale: 'Gemini visual narrative reading order',
      ambiguities: geminiContext.orderingAmbiguities,
    });
    readingOrderSource = 'gemini_visual';
  } else {
    orderedRegions = inferHierarchicalReadingOrder(
      geminiContext.panels?.map((p: any, idx: number) => ({
        panelId: p.panelId || `panel-${idx + 1}`,
        geometry: { coordinateSpace: 'normalized_1000' as const, box_2d: p.box_2d },
        detectionConfidence: 0.9,
        sequenceIndex: idx + 1,
      })) || [],
      regions,
      readingConvention
    );
    readingOrderSource = 'geometric_fallback';
    orderedRegions = orderedRegions.map((r) => {
      const flags = [...r.flags];
      if (!flags.includes('READING_ORDER_CONFLICT')) flags.push('READING_ORDER_CONFLICT');
      return { ...r, flags };
    });
  }

  const decisionMap = new Map((geminiContext.regionDecisions || []).map((d: any) => [d.regionId, d]));
  const interpretations: GeminiInterpretationRecord[] = [];
  const interpretedRegions: TextRegion[] = orderedRegions.map((r) => {
    const dec: any = decisionMap.get(r.regionId);
    const primaryClass: GenericTextClass = dec?.primaryClass || r.classification.primaryClass;
    let assignedTyper = { id: 'speech_bubbles', prefix: '"":' };
    let isTyperAmbiguous = false;
    if (dec?.assignedTyperId) {
      const match = configuredTypers.find((t) => t.id.toLowerCase() === dec.assignedTyperId.toLowerCase());
      if (match) {
        assignedTyper = { id: match.id, prefix: match.prefix };
      } else {
        assignedTyper = defaultTyperForClass(primaryClass, configuredTypers);
        isTyperAmbiguous = true;
      }
    } else {
      assignedTyper = defaultTyperForClass(primaryClass, configuredTypers);
    }

    const flags = [...r.flags];
    if (isTyperAmbiguous && !flags.includes('CLASSIFICATION_AMBIGUOUS')) {
      flags.push('CLASSIFICATION_AMBIGUOUS');
    }

    const interp: GeminiInterpretationRecord = {
      regionId: r.regionId,
      orderIndex: r.order.sequenceIndex,
      primaryClass,
      typerId: assignedTyper.id,
      typerPrefix: assignedTyper.prefix,
      classificationConfidence: isTyperAmbiguous ? 0.6 : (dec?.typerConfidence ?? 0.95),
      orderingConfidence: r.order.confidence,
      speakerCandidate: dec?.speakerCandidate ?? r.associations?.speakerCandidate,
      visualEvidence: dec?.visualEvidence || r.classification?.evidence,
      flags,
      uncertaintyReasons: dec?.uncertaintyReasons,
      isFallbackOrdering: readingOrderSource !== 'gemini_visual',
    };
    interpretations.push(interp);

    return {
      ...r,
      classification: {
        ...r.classification,
        primaryClass,
        confidence: interp.classificationConfidence,
        evidence: interp.visualEvidence,
      },
      associations: {
        ...r.associations,
        speakerCandidate: interp.speakerCandidate,
      },
      flags,
      interpretation: interp,
    };
  });

  const interpByRegionId = new Map(interpretations.map((i) => [i.regionId, i]));
  const updatedBubbles: BubbleItem[] = existingBubbles.map((bubble) => {
    const interp = interpByRegionId.get(bubble.id) || interpByRegionId.get(bubble.regionId || '');
    if (!interp) return bubble;
    const isManuallyEdited = Boolean(bubble.isManuallyEdited);
    return {
      ...bubble,
      index: interp.orderIndex,
      type: isManuallyEdited && bubble.type && bubble.type !== 'none' ? bubble.type : interp.typerId,
      typerPrefix:
        isManuallyEdited && bubble.typerPrefix !== undefined ? bubble.typerPrefix : interp.typerPrefix,
      interpretation: interp,
      updatedAt: Date.now(),
    };
  });
  updatedBubbles.sort((a, b) => a.index - b.index);

  const updatedScan: PageScanResult = {
    ...(existingScan || {
      scanId: `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      pageId,
      sourceImageId: pageId,
      sourceDimensions: { width: 0, height: 0 },
      readingConvention,
      status: 'complete',
      panels: [],
      bubbleRegions: [],
      issues: [],
      transformLedger: { sourceImageId: pageId, sourceWidth: 0, sourceHeight: 0, steps: [] },
      visualContext: '',
      detectedGlossaryTerms: [],
      detectedCharacters: [],
      detectedRelationships: [],
      createdAt: Date.now(),
      version: 1,
    }),
    regions: interpretedRegions,
    interpretationStatus: 'complete',
    readingOrderSource,
    interpretations,
    visualContext: geminiContext.pageContext || existingScan?.visualContext || '',
    panels: (geminiContext.panels || []).map((p: any, idx: number) => ({
      panelId: p.panelId || `panel-${idx + 1}`,
      geometry: { coordinateSpace: 'normalized_1000' as const, box_2d: p.box_2d },
      detectionConfidence: 0.9,
      sequenceIndex: idx + 1,
    })),
    detectedCharacters: geminiContext.detectedCharacters || existingScan?.detectedCharacters || [],
    detectedGlossaryTerms: geminiContext.detectedGlossaryTerms || existingScan?.detectedGlossaryTerms || [],
    detectedRelationships: geminiContext.detectedRelationships || existingScan?.detectedRelationships || [],
  };

  await persistScan(pageId, updatedScan);
  await persistBubbles(pageId, updatedBubbles);

  return {
    success: true,
    pageId,
    bubbles: updatedBubbles,
    scanResult: updatedScan,
    interpretations,
    readingOrderSource,
  };
}
