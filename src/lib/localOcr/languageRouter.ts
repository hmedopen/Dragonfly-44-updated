import type { OcrLanguageHint, OcrRouteId } from '../../types/localOcr.ts';
import { ROUTE_TO_MODEL_ID } from './modelManifest.ts';

export type DetectedScript = 'latin' | 'hangul' | 'kana' | 'han_only' | 'mixed' | 'unknown';

export type LanguageHintKind = 'explicit' | 'auto' | 'unsupported';

export type LanguageResolutionStatus =
  | 'resolved'
  | 'ambiguous'
  | 'undetermined'
  | 'unsupported';

export interface ResolvedLanguageRoute {
  status: LanguageResolutionStatus;
  hintKind: LanguageHintKind;
  routeId: OcrRouteId | null;
  ocrModelId: string | null;
  effectiveLanguage: 'en' | 'ko' | 'ja' | 'zh' | null;
  detectedScript: DetectedScript | null;
  routingReason: string;
  isAmbiguousAutoRoute: boolean;
  requiresExplicitLanguageHint: boolean;
}

export class LanguageRouteError extends Error {
  public readonly resolution: ResolvedLanguageRoute;

  constructor(resolution: ResolvedLanguageRoute) {
    super(resolution.routingReason);
    this.name = 'LanguageRouteError';
    this.resolution = resolution;
  }
}

const HANGUL_RE = /[\p{Script=Hangul}]/u;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN_RE = /[\p{Script=Han}]/u;
const LATIN_RE = /[A-Za-z]/;

/**
 * Secondary Unicode script detector for automatic language routing when text evidence exists.
 * - Supports mixed Hangul + Latin (common in Korean manhwa) as 'hangul'.
 * - Treats Kana (with or without Han/Latin) as Japanese ('kana').
 * - Marks Han-only text as 'han_only' and never guesses Japanese vs Chinese.
 */
export function detectScriptSignal(text: string): DetectedScript {
  if (!text || text.trim().length === 0) return 'unknown';

  const hasHangul = HANGUL_RE.test(text);
  const hasKana = KANA_RE.test(text);
  const hasHan = HAN_RE.test(text);
  const hasLatin = LATIN_RE.test(text);

  if (hasHangul && !hasKana && !hasHan) return 'hangul';
  if (hasHangul && (hasKana || hasHan)) return 'mixed';
  if (hasKana) return 'kana';
  if (hasHan && !hasKana && !hasHangul) return 'han_only';
  if (hasLatin && !hasHangul && !hasKana && !hasHan) return 'latin';
  if (hasLatin) return 'mixed';

  return 'unknown';
}

/**
 * Resolves OCR model route for English, Korean, Japanese, Chinese, or automatic requests.
 * - Explicit hints ('en', 'ko', 'ja', 'zh') always win and are never overridden by sampleText.
 * - 'auto' inspects sampleText when available and supports mixed Hangul+Latin as Korean.
 * - 'auto' NEVER silently falls back to Japanese/Chinese when sampleText is absent, empty, or Han-only;
 *   instead it returns an explicit undetermined/ambiguous result requiring an explicit languageHint.
 * - Unsupported hints return an explicit 'unsupported' result rather than silently falling back.
 */
export function resolveOcrLanguageRoute(
  languageHint: OcrLanguageHint | string | undefined | null,
  sampleText?: string
): ResolvedLanguageRoute {
  switch (languageHint) {
    case 'en':
      return {
        status: 'resolved',
        hintKind: 'explicit',
        routeId: 'en_ppocrv6_small',
        ocrModelId: ROUTE_TO_MODEL_ID.en_ppocrv6_small,
        effectiveLanguage: 'en',
        detectedScript: null,
        routingReason: 'Explicit caller language hint: en -> PP-OCRv6 small',
        isAmbiguousAutoRoute: false,
        requiresExplicitLanguageHint: false,
      };
    case 'ko':
      return {
        status: 'resolved',
        hintKind: 'explicit',
        routeId: 'ko_ppocrv5_mobile',
        ocrModelId: ROUTE_TO_MODEL_ID.ko_ppocrv5_mobile,
        effectiveLanguage: 'ko',
        detectedScript: null,
        routingReason: 'Explicit caller language hint: ko -> PP-OCRv5 mobile Korean',
        isAmbiguousAutoRoute: false,
        requiresExplicitLanguageHint: false,
      };
    case 'ja':
      return {
        status: 'resolved',
        hintKind: 'explicit',
        routeId: 'ja_zh_ppocrv6_manga',
        ocrModelId: ROUTE_TO_MODEL_ID.ja_zh_ppocrv6_manga,
        effectiveLanguage: 'ja',
        detectedScript: null,
        routingReason: 'Explicit caller language hint: ja -> PP-OCRv6 Manga v0.3 FP32',
        isAmbiguousAutoRoute: false,
        requiresExplicitLanguageHint: false,
      };
    case 'zh':
      return {
        status: 'resolved',
        hintKind: 'explicit',
        routeId: 'ja_zh_ppocrv6_manga',
        ocrModelId: ROUTE_TO_MODEL_ID.ja_zh_ppocrv6_manga,
        effectiveLanguage: 'zh',
        detectedScript: null,
        routingReason: 'Explicit caller language hint: zh -> PP-OCRv6 Manga v0.3 FP32',
        isAmbiguousAutoRoute: false,
        requiresExplicitLanguageHint: false,
      };
    case 'auto': {
      const script = sampleText ? detectScriptSignal(sampleText) : 'unknown';
      if (script === 'hangul') {
        return {
          status: 'resolved',
          hintKind: 'auto',
          routeId: 'ko_ppocrv5_mobile',
          ocrModelId: ROUTE_TO_MODEL_ID.ko_ppocrv5_mobile,
          effectiveLanguage: 'ko',
          detectedScript: script,
          routingReason:
            'Automatic script evidence detected Hangul (with optional Latin/digits) -> PP-OCRv5 mobile Korean',
          isAmbiguousAutoRoute: false,
          requiresExplicitLanguageHint: false,
        };
      }
      if (script === 'kana') {
        return {
          status: 'resolved',
          hintKind: 'auto',
          routeId: 'ja_zh_ppocrv6_manga',
          ocrModelId: ROUTE_TO_MODEL_ID.ja_zh_ppocrv6_manga,
          effectiveLanguage: 'ja',
          detectedScript: script,
          routingReason:
            'Automatic script evidence detected Japanese Kana -> PP-OCRv6 Manga v0.3 FP32',
          isAmbiguousAutoRoute: false,
          requiresExplicitLanguageHint: false,
        };
      }
      if (script === 'latin') {
        return {
          status: 'resolved',
          hintKind: 'auto',
          routeId: 'en_ppocrv6_small',
          ocrModelId: ROUTE_TO_MODEL_ID.en_ppocrv6_small,
          effectiveLanguage: 'en',
          detectedScript: script,
          routingReason: 'Automatic script evidence detected Latin -> PP-OCRv6 small',
          isAmbiguousAutoRoute: false,
          requiresExplicitLanguageHint: false,
        };
      }
      if (script === 'han_only') {
        return {
          status: 'ambiguous',
          hintKind: 'auto',
          routeId: null,
          ocrModelId: null,
          effectiveLanguage: null,
          detectedScript: script,
          routingReason:
            'Ambiguous Han-only text with languageHint="auto"; cannot distinguish Japanese vs Chinese without an explicit ja or zh language hint.',
          isAmbiguousAutoRoute: true,
          requiresExplicitLanguageHint: true,
        };
      }
      if (script === 'mixed') {
        return {
          status: 'ambiguous',
          hintKind: 'auto',
          routeId: null,
          ocrModelId: null,
          effectiveLanguage: null,
          detectedScript: script,
          routingReason:
            'Ambiguous mixed CJK/Hangul scripts with languageHint="auto"; supply an explicit language hint (en, ko, ja, or zh).',
          isAmbiguousAutoRoute: true,
          requiresExplicitLanguageHint: true,
        };
      }
      return {
        status: 'undetermined',
        hintKind: 'auto',
        routeId: null,
        ocrModelId: null,
        effectiveLanguage: null,
        detectedScript: 'unknown',
        routingReason:
          'Automatic language detection (languageHint="auto") has no reliable text/script evidence; supply an explicit language hint (en, ko, ja, or zh) or sampleText.',
        isAmbiguousAutoRoute: true,
        requiresExplicitLanguageHint: true,
      };
    }
    default:
      return {
        status: 'unsupported',
        hintKind: 'unsupported',
        routeId: null,
        ocrModelId: null,
        effectiveLanguage: null,
        detectedScript: null,
        routingReason: `Unsupported or unavailable language hint "${String(languageHint)}". Expected 'en', 'ko', 'ja', 'zh', or 'auto' with script evidence.`,
        isAmbiguousAutoRoute: false,
        requiresExplicitLanguageHint: true,
      };
  }
}
