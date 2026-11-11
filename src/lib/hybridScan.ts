/**
 * Folio Script: System #3 — Hybrid Page Scanning & Classification Engine
 * Phase 2 Production Integration
 *
 * Divides responsibility cleanly without running two full OCR systems blindly:
 * - Local OCR Engine: Primary source of text-bearing geometry [ymin, xmin, ymax, xmax] (0-1000)
 *   and verbatim OCR text where its output is reliable.
 * - Gemini Multimodal: Contextual interpretation (panels, scene context, lore/relationships),
 *   functional classification (dialogue, thought, narration, caption, vocalization, sfx,
 *   environmental_text, unknown), duplicate/ambiguity resolution, targeted verification of
 *   low-confidence/mixed-script/empty candidates, and missed-region recovery.
 * - Gemini-only Full Pipeline (scanMangaPage): Reliable fallback when local OCR is unavailable,
 *   ineligible in production, not installed, lacks automatic language evidence, fails, or finds
 *   zero text candidates.
 */

import { getPageBlob } from '../services/db';
import { extractImageDimensions } from '../services/fileIngestion';
import {
  calculateBoxIoU,
  clampBox,
  computeBoxArea,
  createTransformRecord,
} from './coordinateTransforms';
import { performTargetedCropRetries } from './cropRetry';
import { blobToBase64 } from './geminiScan';
import { detectScriptSignal, resolveOcrLanguageRoute } from './localOcr/languageRouter';
import { runLocalPageOcr } from './localOcr/localOcrEngine';
import { createDefaultModelAssetProvider, type LocalModelAssetProvider } from './localOcr/modelClient';
import { getRequiredModelIdsForRoute } from './localOcr/modelManifest';
import {
  isMeaningfulLinguisticContent,
  normalizeExtractedDialogue,
  scanMangaPage,
  type ScanMangaPageOptions,
} from './mangaScanner';
import { inferHierarchicalReadingOrder, resolveReadingConvention } from './readingOrder';
import { buildHybridContextPrompt } from './scanPromptBuilder';
import { extractCleanJson } from './translationValidator';
import { createDiagnosticCorrelationId, emitDiagnosticBoundary } from './diagnosticTap';
import type {
  LocalOcrEngineOptions,
  LocalOcrScanResult,
  ModelStatusInfo,
  OcrLanguageHint,
  OcrRouteId,
} from '../types/localOcr';
import type {
  GenericTextClass,
  PageScanResult,
  PanelRegion,
  ReadingConvention,
  ScanIssue,
  ScanIssueFlag,
  TextRegion,
} from '../types/scanning';

const VALID_GENERIC_CLASSES = new Set<string>([
  'dialogue',
  'thought',
  'narration',
  'caption',
  'vocalization',
  'sfx',
  'environmental_text',
  'unknown',
]);

const LATIN_RE = /[A-Za-z]/;
const HANGUL_RE = /[\p{Script=Hangul}]/u;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN_RE = /[\p{Script=Han}]/u;

export type HybridFallbackReason =
  | 'language_route_refused'
  | 'provider_unavailable'
  | 'model_ineligible_production'
  | 'model_not_installed'
  | 'local_ocr_failed'
  | 'local_ocr_empty';

export interface HybridScanMetadata {
  ocrSource: 'hybrid' | 'gemini_fallback' | 'local_partial';
  resolvedRoute: OcrRouteId | null;
  effectiveLanguage: 'en' | 'ko' | 'ja' | 'zh' | null;
  fallbackReason?: HybridFallbackReason;
  warnings: string[];
  localCandidateCount: number;
  keptCandidateCount: number;
  verifiedCandidateCount: number;
  addedRegionCount: number;
  droppedCandidateCount: number;
  geminiContextFailed: boolean;
  cropRetryCount: number;
}

export interface HybridScanOutcome {
  scanResult: PageScanResult;
  meta: HybridScanMetadata;
}

export interface HybridGeminiCandidateInput {
  regionId: string;
  box_2d: [number, number, number, number];
  localOCR: string;
  ocrConfidence: number;
  kind: 'text_bubble' | 'text_free';
  needsVerification: boolean;
  verificationReasons: string[];
}

export interface HybridRegionDecision {
  regionId: string;
  action: 'keep' | 'verify' | 'drop';
  verifiedOCR?: string;
  ocrAlternatives?: string[];
  primaryClass: GenericTextClass;
  sourceLanguage?: string;
  refinedBox2d?: [number, number, number, number];
  isVertical?: boolean;
  speakerCandidate?: string;
  visualEvidence?: string;
  isAmbiguous?: boolean;
  isClipped?: boolean;
}

export interface ValidatedHybridContextOutput {
  pageContext: string;
  readingConventionCandidate?: string;
  panels: Array<{ panelId: string; box_2d: [number, number, number, number] }>;
  regionDecisions: HybridRegionDecision[];
  additionalRegions: Array<{
    regionId: string;
    box_2d: [number, number, number, number];
    rawOCR: string;
    ocrAlternatives?: string[];
    primaryClass: GenericTextClass;
    sourceLanguage?: string;
    isVertical?: boolean;
    speakerCandidate?: string;
    visualEvidence?: string;
    isAmbiguous?: boolean;
    isClipped?: boolean;
  }>;
  detectedCharacters: any[];
  detectedGlossaryTerms: any[];
  detectedRelationships: any[];
}

export interface HybridScanDependencies {
  getPageBlob?: (pageId: string) => Promise<Blob | null>;
  extractImageDimensions?: (blob: Blob) => Promise<{ width: number; height: number }>;
  getModelProvider?: () => LocalModelAssetProvider | null;
  runLocalOcr?: (options: LocalOcrEngineOptions) => Promise<LocalOcrScanResult>;
  runGeminiFullFallback?: (options: ScanMangaPageOptions) => Promise<PageScanResult>;
  runGeminiContextPass?: (options: {
    blob: Blob;
    pageId: string;
    apiKey: string;
    selectedModel: string;
    readingConvention: ReadingConvention;
    includeSFX: boolean;
    sourceLanguageHint: OcrLanguageHint | string;
    candidates: HybridGeminiCandidateInput[];
    signal?: AbortSignal;
  }) => Promise<ValidatedHybridContextOutput>;
  runCropRetries?: typeof performTargetedCropRetries;
}

export interface ScanMangaPageHybridOptions extends ScanMangaPageOptions {
  /** Verified sample text from existing page bubbles for safe auto-routing only. */
  sampleTextForAutoRoute?: string;
  /** Optional diagnostic correlation ID from outer orchestrator. */
  correlationId?: string;
  /** Optional injectable dependencies for tests. */
  hybridDeps?: HybridScanDependencies;
}

function createAbortError(message = 'Scan aborted by user.'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  if (e.name === 'AbortError') return true;
  return typeof e.message === 'string' && /aborted|cancelled by caller/i.test(e.message);
}

function normalizeOptionalBox(rawBox: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(rawBox) || rawBox.length !== 4) return undefined;
  const nums = rawBox.map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  return clampBox([nums[0], nums[1], nums[2], nums[3]], 1000, 10);
}

export function validateHybridContextOutput(rawText: string): {
  isValid: boolean;
  data: ValidatedHybridContextOutput | null;
  errors: string[];
} {
  if (!rawText || rawText.trim().length === 0) {
    return {
      isValid: false,
      data: null,
      errors: ['Gemini hybrid contextual pass returned an empty response.'],
    };
  }

  const cleanJson = extractCleanJson(rawText);
  let parsed: any = null;
  try {
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    return {
      isValid: false,
      data: null,
      errors: [`Failed to parse hybrid contextual JSON: ${(err as Error).message}`],
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      isValid: false,
      data: null,
      errors: ['Parsed hybrid contextual JSON root is not an object.'],
    };
  }

  const rawPanels = Array.isArray(parsed.panels) ? parsed.panels : [];
  const panels = rawPanels.map((p: any, idx: number) => ({
    panelId: typeof p?.panelId === 'string' && p.panelId.trim() ? p.panelId.trim() : `panel-${idx + 1}`,
    box_2d: normalizeOptionalBox(p?.box_2d) || ([0, 0, 1000, 1000] as [number, number, number, number]),
  }));

  const rawDecisions = Array.isArray(parsed.regionDecisions) ? parsed.regionDecisions : [];
  const regionDecisions: HybridRegionDecision[] = rawDecisions
    .filter((d: any) => typeof d?.regionId === 'string' && d.regionId.trim().length > 0)
    .map((d: any) => {
      const actionRaw = String(d.action || 'keep').toLowerCase();
      const action: 'keep' | 'verify' | 'drop' =
        actionRaw === 'verify' || actionRaw === 'drop' ? actionRaw : 'keep';
      const classCandidate = String(d.primaryClass || 'dialogue').toLowerCase();
      const primaryClass = (
        VALID_GENERIC_CLASSES.has(classCandidate) ? classCandidate : 'unknown'
      ) as GenericTextClass;

      return {
        regionId: d.regionId.trim(),
        action,
        verifiedOCR: typeof d.verifiedOCR === 'string' ? d.verifiedOCR.trim() : undefined,
        ocrAlternatives: Array.isArray(d.ocrAlternatives) ? d.ocrAlternatives.map(String) : undefined,
        primaryClass,
        sourceLanguage: typeof d.sourceLanguage === 'string' ? d.sourceLanguage : undefined,
        refinedBox2d: normalizeOptionalBox(d.refinedBox2d),
        isVertical: typeof d.isVertical === 'boolean' ? d.isVertical : undefined,
        speakerCandidate:
          typeof d.speakerCandidate === 'string' && d.speakerCandidate.trim().length > 0
            ? d.speakerCandidate
            : undefined,
        visualEvidence: typeof d.visualEvidence === 'string' ? d.visualEvidence : undefined,
        isAmbiguous: typeof d.isAmbiguous === 'boolean' ? d.isAmbiguous : undefined,
        isClipped: typeof d.isClipped === 'boolean' ? d.isClipped : undefined,
      };
    });

  const rawAdditional = Array.isArray(parsed.additionalRegions) ? parsed.additionalRegions : [];
  const additionalRegions = rawAdditional
    .map((r: any, idx: number) => {
      const box_2d = normalizeOptionalBox(r?.box_2d);
      if (!box_2d) return null;
      const classCandidate = String(r.primaryClass ?? r.type ?? 'dialogue').toLowerCase();
      const primaryClass = (
        VALID_GENERIC_CLASSES.has(classCandidate) ? classCandidate : 'unknown'
      ) as GenericTextClass;
      return {
        regionId:
          typeof r.regionId === 'string' && r.regionId.trim().length > 0
            ? r.regionId.trim()
            : `missed-${idx + 1}`,
        box_2d,
        rawOCR: String(r.rawOCR ?? r.sourceText ?? '').trim(),
        ocrAlternatives: Array.isArray(r.ocrAlternatives) ? r.ocrAlternatives.map(String) : [],
        primaryClass,
        sourceLanguage: typeof r.sourceLanguage === 'string' ? r.sourceLanguage : undefined,
        isVertical: Boolean(r.isVertical),
        speakerCandidate:
          typeof r.speakerCandidate === 'string' && r.speakerCandidate.trim().length > 0
            ? r.speakerCandidate
            : undefined,
        visualEvidence: typeof r.visualEvidence === 'string' ? r.visualEvidence : undefined,
        isAmbiguous: Boolean(r.isAmbiguous),
        isClipped: Boolean(r.isClipped),
      };
    })
    .filter((item: any): item is NonNullable<typeof item> => Boolean(item));

  return {
    isValid: true,
    data: {
      pageContext: typeof parsed.pageContext === 'string' ? parsed.pageContext : '',
      readingConventionCandidate:
        typeof parsed.readingConventionCandidate === 'string'
          ? parsed.readingConventionCandidate
          : undefined,
      panels,
      regionDecisions,
      additionalRegions,
      detectedCharacters: Array.isArray(parsed.detectedCharacters) ? parsed.detectedCharacters : [],
      detectedGlossaryTerms: Array.isArray(parsed.detectedGlossaryTerms)
        ? parsed.detectedGlossaryTerms
        : [],
      detectedRelationships: Array.isArray(parsed.detectedRelationships)
        ? parsed.detectedRelationships
        : [],
    },
    errors: [],
  };
}

function computeIntersectionOverMinArea(
  boxA: [number, number, number, number],
  boxB: [number, number, number, number]
): number {
  const interYmin = Math.max(boxA[0], boxB[0]);
  const interXmin = Math.max(boxA[1], boxB[1]);
  const interYmax = Math.min(boxA[2], boxB[2]);
  const interXmax = Math.min(boxA[3], boxB[3]);
  const interH = Math.max(0, interYmax - interYmin);
  const interW = Math.max(0, interXmax - interXmin);
  const interArea = interH * interW;
  if (interArea <= 0) return 0;

  const minArea = Math.min(computeBoxArea(boxA), computeBoxArea(boxB));
  return minArea > 0 ? interArea / minArea : 0;
}

function normalizeComparableText(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function areDuplicateTexts(a: string, b: string): boolean {
  const normA = normalizeComparableText(a);
  const normB = normalizeComparableText(b);
  if (!normA && !normB) return true;
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const shorter = normA.length <= normB.length ? normA : normB;
  const longer = normA.length <= normB.length ? normB : normA;
  return shorter.length >= 2 && longer.includes(shorter);
}

/**
 * Suppresses overlapping empty `text_free` boxes and duplicate sub-line fragments
 * emitted by tiled detection, without dropping distinct bubbles or mixed-script text.
 */
export function deduplicateLocalCandidates(regions: TextRegion[]): {
  deduplicated: TextRegion[];
  droppedDuplicateCount: number;
} {
  if (regions.length <= 1) {
    return { deduplicated: [...regions], droppedDuplicateCount: 0 };
  }

  // Sort richest/highest-confidence first so fragments fold into complete boxes
  const sorted = [...regions].sort((a, b) => {
    const aMeaningful = isMeaningfulLinguisticContent(a.rawOCR) ? 1 : 0;
    const bMeaningful = isMeaningfulLinguisticContent(b.rawOCR) ? 1 : 0;
    if (aMeaningful !== bMeaningful) return bMeaningful - aMeaningful;

    const aLen = normalizeComparableText(a.rawOCR).length;
    const bLen = normalizeComparableText(b.rawOCR).length;
    if (aLen !== bLen) return bLen - aLen;

    const aScore = a.confidence.ocr * 0.6 + a.confidence.regionDetection * 0.4;
    const bScore = b.confidence.ocr * 0.6 + b.confidence.regionDetection * 0.4;
    return bScore - aScore;
  });

  const kept: TextRegion[] = [];
  let droppedDuplicateCount = 0;

  for (const candidate of sorted) {
    const box = clampBox(candidate.geometry.box_2d, 1000, 10);
    const hasText = isMeaningfulLinguisticContent(candidate.rawOCR);

    let duplicateOfIndex = -1;
    for (let i = 0; i < kept.length; i++) {
      const existing = kept[i];
      const existingBox = clampBox(existing.geometry.box_2d, 1000, 10);
      const iou = calculateBoxIoU(box, existingBox);
      const ioMin = computeIntersectionOverMinArea(box, existingBox);

      if (!hasText && ioMin >= 0.5) {
        duplicateOfIndex = i;
        break;
      }

      if ((ioMin >= 0.8 || iou >= 0.7) && areDuplicateTexts(candidate.rawOCR, existing.rawOCR)) {
        duplicateOfIndex = i;
        break;
      }
    }

    if (duplicateOfIndex >= 0) {
      droppedDuplicateCount++;
      continue;
    }

    kept.push({
      ...candidate,
      geometry: {
        ...candidate.geometry,
        coordinateSpace: 'normalized_1000',
        box_2d: box,
      },
    });
  }

  return { deduplicated: kept, droppedDuplicateCount };
}

export function assessCandidateVerification(
  candidate: TextRegion,
  routeId: OcrRouteId | null,
  effectiveLanguage: string | null,
  ocrConfidenceThreshold: number
): { needsVerification: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const rawText = normalizeExtractedDialogue(candidate.rawOCR);
  const hasMeaningful = isMeaningfulLinguisticContent(rawText);

  if (!hasMeaningful) {
    reasons.push('empty_or_non_linguistic_ocr');
  }
  if (/\uFFFD/.test(rawText)) {
    reasons.push('replacement_character_detected');
  }
  if (candidate.confidence.ocr < ocrConfidenceThreshold) {
    reasons.push(`low_ocr_confidence:${candidate.confidence.ocr.toFixed(2)}`);
  }
  if (routeId === 'ko_ppocrv5_mobile' && candidate.confidence.ocr < 0.85) {
    reasons.push('korean_uncalibrated_confidence_below_threshold');
  }
  const verifyFlags: ScanIssueFlag[] = [
    'OCR_AMBIGUOUS',
    'TEXT_CLIPPED',
    'REGION_BOUNDARY_UNCERTAIN',
    'BUBBLE_ASSOCIATION_AMBIGUOUS',
    'CLASSIFICATION_AMBIGUOUS',
  ];
  for (const flag of verifyFlags) {
    if (candidate.flags.includes(flag)) {
      reasons.push(`flag:${flag}`);
    }
  }

  if (hasMeaningful) {
    const scriptSignal = detectScriptSignal(rawText);
    const hasLatin = LATIN_RE.test(rawText);
    const hasHangul = HANGUL_RE.test(rawText);
    const hasKana = KANA_RE.test(rawText);
    const hasHan = HAN_RE.test(rawText);

    if (scriptSignal === 'mixed') {
      reasons.push('mixed_script_detected');
    } else if (effectiveLanguage === 'en' && (hasHangul || hasKana || hasHan)) {
      reasons.push('cjk_in_english_route');
    } else if (
      (effectiveLanguage === 'ko' || effectiveLanguage === 'ja' || effectiveLanguage === 'zh') &&
      hasLatin
    ) {
      reasons.push('latin_embedded_in_cjk_route');
    }
  }

  return {
    needsVerification: reasons.length > 0,
    reasons,
  };
}

function inferHybridRegionLanguage(
  geminiHint: string | undefined,
  text: string,
  routeLanguage: 'en' | 'ko' | 'ja' | 'zh' | null,
  pageHint: string | undefined
): string {
  const cleanHint = typeof geminiHint === 'string' ? geminiHint.trim().toLowerCase() : '';
  if (
    cleanHint === 'en' ||
    cleanHint === 'ko' ||
    cleanHint === 'ja' ||
    cleanHint === 'zh' ||
    cleanHint === 'mixed'
  ) {
    return cleanHint;
  }

  const scriptSignal = detectScriptSignal(text);
  const hasLatin = LATIN_RE.test(text);
  const hasHangul = HANGUL_RE.test(text);
  const hasKana = KANA_RE.test(text);
  const hasHan = HAN_RE.test(text);

  if (scriptSignal === 'mixed' || (hasLatin && (hasHangul || hasKana || hasHan))) {
    return 'mixed';
  }
  if (scriptSignal === 'hangul') return 'ko';
  if (scriptSignal === 'kana') return 'ja';
  if (scriptSignal === 'latin') return 'en';
  if (scriptSignal === 'han_only') {
    if (routeLanguage === 'ja' || routeLanguage === 'zh') return routeLanguage;
    if (pageHint === 'ja' || pageHint === 'zh') return pageHint;
    return 'zh';
  }

  if (routeLanguage) return routeLanguage;
  if (pageHint === 'en' || pageHint === 'ko' || pageHint === 'ja' || pageHint === 'zh') {
    return pageHint;
  }
  return 'ja';
}

function buildUniquePageRegionId(
  pageId: string,
  rawCandidateId: string,
  idx: number,
  seen: Set<string>
): string {
  const safePage = pageId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'page';
  const safeCandidate = rawCandidateId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || `r-${idx + 1}`;
  let candidate = `${safePage}__${safeCandidate}`;
  let counter = idx + 1;
  while (seen.has(candidate)) {
    candidate = `${safePage}__${safeCandidate}_${counter++}`;
  }
  seen.add(candidate);
  return candidate;
}

async function checkLocalModelsEligibleAndInstalled(
  provider: LocalModelAssetProvider | null,
  routeId: OcrRouteId
): Promise<{
  ready: boolean;
  reason?: 'provider_unavailable' | 'model_ineligible_production' | 'model_not_installed';
  warning?: string;
}> {
  if (!provider) {
    return {
      ready: false,
      reason: 'provider_unavailable',
      warning: 'Local model asset bridge is unavailable; using Gemini pipeline.',
    };
  }

  const requiredIds = getRequiredModelIdsForRoute(routeId);
  try {
    const statuses = await Promise.all(
      requiredIds.map(async (modelId): Promise<ModelStatusInfo | null> => {
        const res = await provider.getStatus(modelId);
        if (Array.isArray(res)) {
          return res.find((item) => item.modelId === modelId) ?? null;
        }
        return res ?? null;
      })
    );

    for (let i = 0; i < requiredIds.length; i++) {
      const modelId = requiredIds[i];
      const info = statuses[i];
      if (!info) {
        return {
          ready: false,
          reason: 'model_not_installed',
          warning: `Local model "${modelId}" status could not be verified; using Gemini pipeline.`,
        };
      }
      if (info.state === 'unsupported' || info.policy?.activationPermitted === false) {
        return {
          ready: false,
          reason: 'model_ineligible_production',
          warning:
            info.policy?.rejectionReason ||
            `Local model "${modelId}" is restricted in production; using Gemini pipeline.`,
        };
      }
      if (info.state !== 'installed') {
        return {
          ready: false,
          reason: 'model_not_installed',
          warning: `Local model "${modelId}" is "${info.state}"; using Gemini pipeline.`,
        };
      }
    }

    return { ready: true };
  } catch (err) {
    return {
      ready: false,
      reason: 'provider_unavailable',
      warning: `Local model status check failed (${(err as Error)?.message || 'unknown error'}); using Gemini pipeline.`,
    };
  }
}

async function defaultRunGeminiContextPass(options: {
  blob: Blob;
  apiKey: string;
  selectedModel: string;
  readingConvention: ReadingConvention;
  includeSFX: boolean;
  sourceLanguageHint: OcrLanguageHint | string;
  candidates: HybridGeminiCandidateInput[];
  signal?: AbortSignal;
}): Promise<ValidatedHybridContextOutput> {
  const {
    blob,
    apiKey,
    selectedModel,
    readingConvention,
    includeSFX,
    sourceLanguageHint,
    candidates,
    signal,
  } = options;

  const systemInstruction = buildHybridContextPrompt({
    readingConvention,
    includeSFX,
    sourceLanguageHint,
  });

  const mimeType = blob.type || 'image/png';
  const base64Data = await blobToBase64(blob);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;

  const candidatePayload = candidates.map((c) => ({
    regionId: c.regionId,
    box_2d: c.box_2d,
    localOCR: c.localOCR,
    confidence: Number(c.ocrConfidence.toFixed(3)),
    kind: c.kind,
    needsVerification: c.needsVerification,
    ...(c.verificationReasons.length > 0 ? { verificationReasons: c.verificationReasons } : {}),
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
            text:
              'Analyze this comic page alongside the local OCR candidates below. Detect panels, classify each candidate regionId ("keep", "verify", or "drop"), provide verifiedOCR only where needed, and list any genuinely missed regions.\n\nLOCAL OCR CANDIDATES:\n' +
              JSON.stringify(candidatePayload),
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
      temperature: 0.15,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorMsg = errorBody?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(errorMsg);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const validated = validateHybridContextOutput(rawText);
  if (!validated.isValid || !validated.data) {
    throw new Error(validated.errors[0] || 'Invalid JSON returned by hybrid contextual Gemini pass.');
  }
  return validated.data;
}

function buildPartialLocalOnlyResult(options: {
  pageId: string;
  dimensions: { width: number; height: number };
  effectiveConvention: ReadingConvention;
  localCandidates: Array<{ region: TextRegion; kind: 'text_bubble' | 'text_free' }>;
  bubbleRegions?: PageScanResult['bubbleRegions'];
  routeLanguage: 'en' | 'ko' | 'ja' | 'zh' | null;
  sourceLanguageHint: string;
  includeSFX: boolean;
  failureReason: string;
}): PageScanResult {
  const {
    pageId,
    dimensions,
    effectiveConvention,
    localCandidates,
    bubbleRegions,
    routeLanguage,
    sourceLanguageHint,
    includeSFX,
    failureReason,
  } = options;

  const transformLedger = createTransformRecord({
    sourceImageId: pageId,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
  });

  const meaningfulRegions: TextRegion[] = [];
  for (let i = 0; i < localCandidates.length; i++) {
    const { region, kind } = localCandidates[i];
    const cleanText = normalizeExtractedDialogue(region.rawOCR);
    if (!isMeaningfulLinguisticContent(cleanText)) continue;

    const inferredClass: GenericTextClass =
      region.classification?.primaryClass === 'sfx'
        ? 'sfx'
        : kind === 'text_bubble'
        ? 'dialogue'
        : 'environmental_text';
    if (!includeSFX && inferredClass === 'sfx') continue;
    const primaryClass = inferredClass;

    const flags = [...region.flags];
    if (!flags.includes('CLASSIFICATION_AMBIGUOUS')) {
      flags.push('CLASSIFICATION_AMBIGUOUS');
    }

    meaningfulRegions.push({
      ...region,
      rawOCR: cleanText,
      sourceLanguage: inferHybridRegionLanguage(
        region.sourceLanguage,
        cleanText,
        routeLanguage,
        sourceLanguageHint
      ),
      classification: {
        ...region.classification,
        primaryClass,
        confidence: kind === 'text_bubble' ? 0.72 : 0.55,
        needsReview: true,
        evidence: 'Preserved from local OCR after Gemini contextual pass failed.',
      },
      flags,
    });
  }

  const orderedRegions = inferHierarchicalReadingOrder([], meaningfulRegions, effectiveConvention);

  const issues: ScanIssue[] = [
    {
      issueId: `issue-${pageId}-gemini-context-unavailable`,
      flag: 'STAGE_UNAVAILABLE',
      severity: 'warning',
      affectedRegionIds: orderedRegions.map((r) => r.regionId),
      reason: failureReason,
      retryable: true,
    },
  ];

  return {
    scanId: `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    pageId,
    sourceImageId: pageId,
    sourceDimensions: dimensions,
    readingConvention: effectiveConvention,
    status: 'partial',
    panels: [],
    bubbleRegions,
    regions: orderedRegions,
    issues,
    transformLedger,
    visualContext: '',
    detectedGlossaryTerms: [],
    detectedCharacters: [],
    detectedRelationships: [],
    createdAt: Date.now(),
    version: 1,
  };
}

/**
 * Executes unified hybrid scanning (Local OCR primary + Gemini contextual/verification)
 * and returns both canonical PageScanResult and structured hybrid telemetry.
 */
export async function scanMangaPageHybridWithMeta(
  options: ScanMangaPageHybridOptions
): Promise<HybridScanOutcome> {
  const {
    pageId,
    apiKey,
    selectedModel = 'gemini-3.8-flash',
    readingConvention = 'auto',
    includeSFX = true,
    sourceLanguageHint = 'auto',
    sampleTextForAutoRoute,
    enableTargetedRetries = true,
    maxRetries = 3,
    ocrConfidenceThreshold = 0.65,
    correlationId: providedCorrelationId,
    signal,
    hybridDeps,
  } = options;

  const correlationId = providedCorrelationId || createDiagnosticCorrelationId('hybrid');

  if (signal?.aborted) {
    throw createAbortError();
  }

  const getBlob = hybridDeps?.getPageBlob ?? getPageBlob;
  const extractDims = hybridDeps?.extractImageDimensions ?? extractImageDimensions;
  const getProvider = hybridDeps?.getModelProvider ?? createDefaultModelAssetProvider;
  const execLocalOcr = hybridDeps?.runLocalOcr ?? runLocalPageOcr;
  const execGeminiFallback = hybridDeps?.runGeminiFullFallback ?? scanMangaPage;
  const execGeminiContext = hybridDeps?.runGeminiContextPass ?? defaultRunGeminiContextPass;
  const execCropRetries = hybridDeps?.runCropRetries ?? performTargetedCropRetries;

  const warnings: string[] = [];

  const runFallback = async (
    fallbackReason: HybridFallbackReason,
    resolvedRoute: OcrRouteId | null,
    effectiveLanguage: 'en' | 'ko' | 'ja' | 'zh' | null
  ): Promise<HybridScanOutcome> => {
    if (signal?.aborted) throw createAbortError();
    emitDiagnosticBoundary({
      subsystem: 'scanning-ocr',
      component: 'HybridScanner',
      operation: 'fallbackDecision',
      eventType: 'decision',
      severity: 'warning',
      status: 'degraded',
      correlationId,
      identifiers: { pageId, routeId: resolvedRoute || undefined },
      payload: { fallbackReason, resolvedRoute, effectiveLanguage, warnings },
      explanation: `Gemini full scan fallback selected (${fallbackReason}).`,
    });
    const fallbackResult = await execGeminiFallback({
      pageId,
      apiKey,
      selectedModel,
      readingConvention,
      includeSFX,
      sourceLanguageHint,
      enableTargetedRetries,
      maxRetries,
      ocrConfidenceThreshold,
      correlationId,
      signal,
    });
    return {
      scanResult: fallbackResult,
      meta: {
        ocrSource: 'gemini_fallback',
        resolvedRoute,
        effectiveLanguage,
        fallbackReason,
        warnings,
        localCandidateCount: 0,
        keptCandidateCount: 0,
        verifiedCandidateCount: 0,
        addedRegionCount: fallbackResult.regions.length,
        droppedCandidateCount: 0,
        geminiContextFailed: false,
        cropRetryCount: 0,
      },
    };
  };

  // 1. Check language routing BEFORE launching local OCR; never bypass 'auto' safeguard
  const normalizedHint = (sourceLanguageHint || 'auto').trim() || 'auto';
  const route = resolveOcrLanguageRoute(normalizedHint, sampleTextForAutoRoute);
  if (route.status !== 'resolved' || route.routeId === null || route.effectiveLanguage === null) {
    warnings.push(route.routingReason);
    return runFallback('language_route_refused', null, null);
  }

  // 2. Check model eligibility (production block on dev_only_*) & installed status
  const eligibilityCheck = await checkLocalModelsEligibleAndInstalled(getProvider(), route.routeId);
  if (!eligibilityCheck.ready) {
    if (eligibilityCheck.warning) warnings.push(eligibilityCheck.warning);
    return runFallback(
      eligibilityCheck.reason || 'provider_unavailable',
      route.routeId,
      route.effectiveLanguage
    );
  }

  // 3. Load page Blob & dimensions once for shared hybrid use
  const blob = await getBlob(pageId);
  if (!blob) {
    throw new Error(`Page image blob not found in IndexedDB for ID: ${pageId}`);
  }
  if (signal?.aborted) {
    throw createAbortError();
  }

  const dimensions = await extractDims(blob);
  const aspectRatio = dimensions.width > 0 ? dimensions.height / dimensions.width : 1.4;
  const effectiveConvention = resolveReadingConvention({ readingConvention, aspectRatio });

  // 4. Primary Detection + OCR via Phase 1.1 Local OCR
  let localResult: LocalOcrScanResult;
  try {
    localResult = await execLocalOcr({
      image: blob,
      pageId,
      languageHint: normalizedHint as OcrLanguageHint,
      sampleText: sampleTextForAutoRoute,
      readingConvention: effectiveConvention,
      correlationId,
      signal,
    });
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) {
      throw err;
    }
    warnings.push(
      `Local OCR failed (${(err as Error)?.message || 'unknown error'}); fell back to Gemini.`
    );
    return runFallback('local_ocr_failed', route.routeId, route.effectiveLanguage);
  }

  if (signal?.aborted) {
    throw createAbortError();
  }

  if (localResult.warnings?.length) {
    warnings.push(...localResult.warnings);
  }

  if (localResult.status === 'failed' || localResult.textRegions.length === 0) {
    warnings.push(localResult.error || 'Local OCR produced no text candidates; fell back to Gemini.');
    return runFallback(
      localResult.status === 'failed' ? 'local_ocr_failed' : 'local_ocr_empty',
      route.routeId,
      route.effectiveLanguage
    );
  }

  // 5. Assign unique page-scoped IDs and suppress overlapping sub-line / empty fragments
  const seenRegionIds = new Set<string>();
  const scopedRegions: TextRegion[] = localResult.textRegions.map((r, idx) => ({
    ...r,
    regionId: buildUniquePageRegionId(pageId, r.regionId || `local-${idx + 1}`, idx, seenRegionIds),
    geometry: {
      coordinateSpace: 'normalized_1000',
      box_2d: clampBox(r.geometry.box_2d, 1000, 10),
      polygon: r.geometry.polygon,
    },
  }));

  const { deduplicated, droppedDuplicateCount } = deduplicateLocalCandidates(scopedRegions);

  const localCandidates = deduplicated
    .map((region) => {
      const kind: 'text_bubble' | 'text_free' = region.associations?.bubbleId
        ? 'text_bubble'
        : 'text_free';
      return { region, kind };
    })
    // Discard unassociated empty `text_free` detector noise when low score
    .filter(({ region, kind }) => {
      if (isMeaningfulLinguisticContent(region.rawOCR)) return true;
      return kind === 'text_bubble';
    });

  if (localCandidates.length === 0) {
    warnings.push('All local OCR detections were empty noise; fell back to Gemini.');
    return runFallback('local_ocr_empty', route.routeId, route.effectiveLanguage);
  }

  // 6. Identify candidates needing targeted Gemini verification
  const geminiCandidateInputs: HybridGeminiCandidateInput[] = localCandidates.map(
    ({ region, kind }) => {
      const check = assessCandidateVerification(
        region,
        route.routeId,
        route.effectiveLanguage,
        ocrConfidenceThreshold
      );
      return {
        regionId: region.regionId,
        box_2d: region.geometry.box_2d,
        localOCR: normalizeExtractedDialogue(region.rawOCR),
        ocrConfidence: region.confidence.ocr,
        kind,
        needsVerification: check.needsVerification,
        verificationReasons: check.reasons,
      };
    }
  );

  // 7. Targeted Gemini Contextual & Verification Pass (preserving local OCR on Gemini failure!)
  let geminiContext: ValidatedHybridContextOutput | null = null;
  let geminiFailureReason: string | null = null;

  if (!apiKey || apiKey.trim().length === 0) {
    geminiFailureReason =
      'Gemini API key is not configured; local OCR regions preserved without contextual classification or translation.';
  } else {
    try {
      geminiContext = await execGeminiContext({
        blob,
        pageId,
        apiKey,
        selectedModel: String(selectedModel || 'gemini-3.8-flash'),
        readingConvention: effectiveConvention,
        includeSFX,
        sourceLanguageHint: normalizedHint,
        candidates: geminiCandidateInputs,
        signal,
      });
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) {
        throw err;
      }
      geminiFailureReason = `Gemini contextual verification failed (${(err as Error)?.message || 'unknown error'}); local OCR results preserved.`;
      warnings.push(geminiFailureReason);
    }
  }

  if (signal?.aborted) {
    throw createAbortError();
  }

    if (!geminiContext) {
    const partialScan = buildPartialLocalOnlyResult({
      pageId,
      dimensions,
      effectiveConvention,
      localCandidates,
      bubbleRegions: localResult.bubbleRegions,
      routeLanguage: route.effectiveLanguage,
      sourceLanguageHint: normalizedHint,
      includeSFX,
      failureReason: geminiFailureReason || 'Gemini contextual stage unavailable.',
    });

    emitDiagnosticBoundary({
      subsystem: 'scanning-ocr',
      component: 'HybridScanner',
      operation: 'geminiContextFallbackLocal',
      eventType: 'decision',
      severity: 'warning',
      status: 'degraded',
      correlationId,
      identifiers: { pageId, routeId: route.routeId },
      payload: {
        localCandidateCount: localCandidates.length,
        keptCandidateCount: partialScan.regions.length,
        failureReason: geminiFailureReason,
      },
      explanation: `Gemini contextual pass failed (${geminiFailureReason}); preserved ${partialScan.regions.length} local OCR region(s) as partial scan.`,
    });

    return {
      scanResult: partialScan,
      meta: {
        ocrSource: 'local_partial',
        resolvedRoute: route.routeId,
        effectiveLanguage: route.effectiveLanguage,
        warnings,
        localCandidateCount: localCandidates.length,
        keptCandidateCount: partialScan.regions.length,
        verifiedCandidateCount: 0,
        addedRegionCount: 0,
        droppedCandidateCount: droppedDuplicateCount,
        geminiContextFailed: true,
        cropRetryCount: 0,
      },
    };
  }

  // 8. Reconcile local OCR anchors with Gemini decisions (never blindly duplicate!)
  const panels: PanelRegion[] = geminiContext.panels.map((p, idx) => ({
    panelId: p.panelId || `panel-${idx + 1}`,
    geometry: {
      coordinateSpace: 'normalized_1000',
      box_2d: clampBox(p.box_2d, 1000, 10),
    },
    detectionConfidence: 0.92,
    sequenceIndex: idx + 1,
  }));

  const decisionById = new Map<string, HybridRegionDecision>();
  for (const decision of geminiContext.regionDecisions) {
    decisionById.set(decision.regionId, decision);
  }

  const finalRegions: TextRegion[] = [];
  let keptCandidateCount = 0;
  let verifiedCandidateCount = 0;
  let droppedByContextCount = droppedDuplicateCount;
  let filteredSfxCount = 0;

  for (const { region, kind } of localCandidates) {
    const dec = decisionById.get(region.regionId);
    const localCleanText = normalizeExtractedDialogue(region.rawOCR);
    const hasLocalText = isMeaningfulLinguisticContent(localCleanText);

    if (dec?.action === 'drop') {
      const overlapsKept = finalRegions.some((kept) => {
        const iou = calculateBoxIoU(region.geometry.box_2d, kept.geometry.box_2d);
        const ioMin = computeIntersectionOverMinArea(region.geometry.box_2d, kept.geometry.box_2d);
        return iou >= 0.35 || (ioMin >= 0.7 && areDuplicateTexts(localCleanText, kept.rawOCR));
      });
      const isStrongDistinctLocal =
        hasLocalText &&
        !overlapsKept &&
        region.confidence.ocr >= 0.78 &&
        normalizeComparableText(localCleanText).length >= 3 &&
        !(dec.primaryClass === 'sfx' && !includeSFX);

      if (!isStrongDistinctLocal) {
        droppedByContextCount++;
        continue;
      }
    }

    const primaryClass: GenericTextClass =
      dec?.primaryClass || (kind === 'text_bubble' ? 'dialogue' : 'environmental_text');

    // Enforce SFX opt-out strictly without suppressing ordinary text classes
    if (!includeSFX && primaryClass === 'sfx') {
      filteredSfxCount++;
      droppedByContextCount++;
      continue;
    }

    let finalText = localCleanText;
    const alternatives = [...(region.ocrAlternatives || [])];
    let usedVerifiedText = false;

    if (
      dec &&
      (dec.action === 'verify' || !hasLocalText) &&
      dec.verifiedOCR &&
      isMeaningfulLinguisticContent(dec.verifiedOCR)
    ) {
      const verifiedClean = normalizeExtractedDialogue(dec.verifiedOCR);
      if (hasLocalText && localCleanText !== verifiedClean && !alternatives.includes(localCleanText)) {
        alternatives.unshift(localCleanText);
      }
      finalText = verifiedClean;
      usedVerifiedText = true;
      verifiedCandidateCount++;
    } else if (!hasLocalText) {
      droppedByContextCount++;
      continue;
    }

    if (dec?.ocrAlternatives?.length) {
      for (const alt of dec.ocrAlternatives) {
        const normAlt = normalizeExtractedDialogue(alt);
        if (normAlt && normAlt !== finalText && !alternatives.includes(normAlt)) {
          alternatives.push(normAlt);
        }
      }
    }

    // Preserve local OCR normalized geometry; refine ONLY when local box was flagged uncertain/clipped
    let box_2d = region.geometry.box_2d;
    if (
      dec?.refinedBox2d &&
      (region.flags.includes('REGION_BOUNDARY_UNCERTAIN') || region.flags.includes('TEXT_CLIPPED'))
    ) {
      box_2d = clampBox(dec.refinedBox2d, 1000, 10);
    }

    const updatedFlags: ScanIssueFlag[] = [...region.flags];
    if (usedVerifiedText && dec?.isAmbiguous === false) {
      const ambIdx = updatedFlags.indexOf('OCR_AMBIGUOUS');
      if (ambIdx >= 0) updatedFlags.splice(ambIdx, 1);
    } else if (dec?.isAmbiguous && !updatedFlags.includes('OCR_AMBIGUOUS')) {
      updatedFlags.push('OCR_AMBIGUOUS');
    }
    if (dec?.isClipped && !updatedFlags.includes('TEXT_CLIPPED')) {
      updatedFlags.push('TEXT_CLIPPED');
    }

    const calibratedOcrConfidence = usedVerifiedText
      ? dec?.isAmbiguous
        ? 0.7
        : Math.max(region.confidence.ocr, 0.92)
      : region.confidence.ocr;

    finalRegions.push({
      ...region,
      geometry: {
        coordinateSpace: 'normalized_1000',
        box_2d,
        polygon: region.geometry.polygon,
      },
      rawOCR: finalText,
      normalizedText: finalText,
      ocrAlternatives: alternatives,
      sourceLanguage: inferHybridRegionLanguage(
        dec?.sourceLanguage,
        finalText,
        route.effectiveLanguage,
        normalizedHint
      ),
      isVertical: dec?.isVertical ?? region.isVertical,
      confidence: {
        ...region.confidence,
        ocr: calibratedOcrConfidence,
        classification: primaryClass === 'unknown' ? 0.55 : 0.9,
      },
      classification: {
        primaryClass,
        confidence: primaryClass === 'unknown' ? 0.55 : 0.9,
        needsReview: Boolean(primaryClass === 'unknown' || dec?.isAmbiguous),
        evidence: dec?.visualEvidence || region.classification.evidence,
      },
      associations: {
        ...region.associations,
        speakerCandidate: dec?.speakerCandidate ?? region.associations.speakerCandidate,
      },
      flags: updatedFlags,
      isManuallyEdited: false,
    });
    keptCandidateCount++;
  }

  // 9. Add genuinely missed regions (e.g. handwritten SFX when enabled, missed captions)
  let addedRegionCount = 0;
  for (let i = 0; i < geminiContext.additionalRegions.length; i++) {
    const extra = geminiContext.additionalRegions[i];
    const cleanExtraText = normalizeExtractedDialogue(extra.rawOCR);
    if (!isMeaningfulLinguisticContent(cleanExtraText)) continue;
    if (!includeSFX && extra.primaryClass === 'sfx') continue;

    const extraBox = clampBox(extra.box_2d, 1000, 10);
    const overlapsExisting = finalRegions.some((kept) => {
      const iou = calculateBoxIoU(extraBox, kept.geometry.box_2d);
      const ioMin = computeIntersectionOverMinArea(extraBox, kept.geometry.box_2d);
      if (iou >= 0.35 || ioMin >= 0.7) return true;
      return iou >= 0.15 && areDuplicateTexts(cleanExtraText, kept.rawOCR);
    });
    if (overlapsExisting) continue;

    const flags: ScanIssueFlag[] = [];
    if (extra.isAmbiguous) flags.push('OCR_AMBIGUOUS');
    if (extra.isClipped) flags.push('TEXT_CLIPPED');

    const extraRegionId = buildUniquePageRegionId(
      pageId,
      extra.regionId || `missed-${i + 1}`,
      finalRegions.length + 1,
      seenRegionIds
    );

    finalRegions.push({
      regionId: extraRegionId,
      geometry: {
        coordinateSpace: 'normalized_1000',
        box_2d: extraBox,
      },
      rawOCR: cleanExtraText,
      normalizedText: cleanExtraText,
      ocrAlternatives: (extra.ocrAlternatives || []).map(normalizeExtractedDialogue),
      sourceLanguage: inferHybridRegionLanguage(
        extra.sourceLanguage,
        cleanExtraText,
        route.effectiveLanguage,
        normalizedHint
      ),
      isVertical: extra.isVertical,
      confidence: {
        imageQuality: dimensions.width >= 1000 && dimensions.height >= 1400 ? 0.95 : 0.8,
        regionDetection: 0.88,
        ocr: extra.isAmbiguous ? 0.65 : 0.9,
        association: 0.88,
        readingOrder: 0.88,
        classification: extra.primaryClass === 'unknown' ? 0.5 : 0.9,
      },
      classification: {
        primaryClass: extra.primaryClass,
        confidence: extra.primaryClass === 'unknown' ? 0.5 : 0.9,
        needsReview: Boolean(extra.primaryClass === 'unknown' || extra.isAmbiguous),
        evidence: extra.visualEvidence,
      },
      associations: {
        speakerCandidate: extra.speakerCandidate,
      },
      order: {
        sequenceIndex: finalRegions.length + 1,
        confidence: 0.88,
      },
      flags,
      isManuallyEdited: false,
    });
    addedRegionCount++;
  }

  // Edge guard: if every local candidate was dropped (for reasons other than SFX opt-out)
  // and zero missed regions existed, fall back rather than silently erasing a page.
  if (
    finalRegions.length === 0 &&
    filteredSfxCount === 0 &&
    localCandidates.some((c) => isMeaningfulLinguisticContent(c.region.rawOCR))
  ) {
    warnings.push('Hybrid reconciliation yielded 0 regions; falling back to full Gemini pass.');
    return runFallback('local_ocr_empty', route.routeId, route.effectiveLanguage);
  }

  // 10. Hierarchical reading order inference
  let orderedRegions = inferHierarchicalReadingOrder(panels, finalRegions, effectiveConvention);

  // 11. Bounded targeted crop retries ONLY for regions still flagged after contextual pass
  let cropRetryCount = 0;
  const residualRetryNeeded = orderedRegions.some(
    (r) =>
      r.flags.includes('OCR_AMBIGUOUS') ||
      r.flags.includes('TEXT_CLIPPED') ||
      r.flags.includes('REGION_BOUNDARY_UNCERTAIN') ||
      r.confidence.ocr < ocrConfidenceThreshold
  );

  if (enableTargetedRetries && maxRetries > 0 && residualRetryNeeded && apiKey.trim().length > 0) {
    try {
      const retryResult = await execCropRetries({
        blob,
        regions: orderedRegions,
        sourceWidth: dimensions.width,
        sourceHeight: dimensions.height,
        apiKey,
        selectedModel: String(selectedModel || 'gemini-3.8-flash'),
        maxRetries,
        signal,
      });
      orderedRegions = retryResult.updatedRegions;
      cropRetryCount = retryResult.retriedCount;
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) {
        throw err;
      }
      console.warn('[HybridScan] Targeted crop retries experienced a non-fatal error:', err);
    }
  }

  if (signal?.aborted) {
    throw createAbortError();
  }

  // 12. Generate ScanIssues for any remaining region ambiguity flags
  const issues: ScanIssue[] = [];
  for (const r of orderedRegions) {
    for (const flag of r.flags) {
      issues.push({
        issueId: `issue-${r.regionId}-${flag}`,
        flag,
        severity: flag === 'OCR_AMBIGUOUS' ? 'warning' : 'suggestion',
        affectedRegionIds: [r.regionId],
        reason:
          flag === 'OCR_AMBIGUOUS'
            ? 'احتمالية غموض في قراءة الحروف بالرسم الأصلي'
            : flag === 'TEXT_CLIPPED'
            ? 'نص مقطوع جزئياً عند حافة الإطار'
            : 'تحديد حدود الإطار يحتاج تدقيقاً',
        retryable: true,
      });
    }
  }

  const transformLedger = createTransformRecord({
    sourceImageId: pageId,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
  });

  const scanResult: PageScanResult = {
    scanId: `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    pageId,
    sourceImageId: pageId,
    sourceDimensions: { width: dimensions.width, height: dimensions.height },
    readingConvention: effectiveConvention,
    status: 'complete',
    panels,
    bubbleRegions: localResult.bubbleRegions,
    regions: orderedRegions,
    issues,
    transformLedger,
    visualContext: geminiContext.pageContext || '',
    detectedGlossaryTerms: geminiContext.detectedGlossaryTerms || [],
    detectedCharacters: geminiContext.detectedCharacters || [],
    detectedRelationships: geminiContext.detectedRelationships || [],
    createdAt: Date.now(),
    version: 1,
  };

  emitDiagnosticBoundary({
    subsystem: 'scanning-ocr',
    component: 'HybridScanner',
    operation: 'hybridReconcile',
    eventType: 'decision',
    severity: 'healthy',
    status: 'succeeded',
    correlationId,
    identifiers: { pageId, routeId: route.routeId },
    payload: {
      localCandidateCount: localCandidates.length,
      keptCandidateCount,
      verifiedCandidateCount,
      addedRegionCount,
      droppedCandidateCount: droppedByContextCount,
      cropRetryCount,
    },
    explanation: `Hybrid reconciliation kept ${keptCandidateCount} local region(s) (${verifiedCandidateCount} verified, ${addedRegionCount} missed added, ${droppedByContextCount} rejected, ${cropRetryCount} crop retries).`,
  });

  return {
    scanResult,
    meta: {
      ocrSource: 'hybrid',
      resolvedRoute: route.routeId,
      effectiveLanguage: route.effectiveLanguage,
      warnings,
      localCandidateCount: localCandidates.length,
      keptCandidateCount,
      verifiedCandidateCount,
      addedRegionCount,
      droppedCandidateCount: droppedByContextCount,
      geminiContextFailed: false,
      cropRetryCount,
    },
  };
}

export async function scanMangaPageHybrid(
  options: ScanMangaPageHybridOptions
): Promise<PageScanResult> {
  const outcome = await scanMangaPageHybridWithMeta(options);
  return outcome.scanResult;
}
