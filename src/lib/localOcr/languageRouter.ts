import type { OcrLanguageHint, OcrRouteId } from '../../types/localOcr.ts';
import { ROUTE_TO_MODEL_ID } from './modelManifest.ts';

export type DetectedScript = 'latin' | 'hangul' | 'kana' | 'han_only' | 'mixed' | 'unknown';

export interface ResolvedLanguageRoute {
  routeId: OcrRouteId;
  ocrModelId: string;
  effectiveLanguage: 'en' | 'ko' | 'ja' | 'zh';
  routingReason: string;
  isAmbiguousAutoRoute: boolean;
}

const HANGUL_RE = /[\p{Script=Hangul}]/u;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN_RE = /[\p{Script=Han}]/u;
const LATIN_RE = /[A-Za-z]/;

/**
 * Secondary Unicode script detector.
 * Never guesses between Japanese and Chinese on Han-only text.
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
 * Resolves explicit OCR model route for English, Korean, Japanese, and Chinese.
 * - Korean is NEVER silently routed through Japanese/Chinese recognizer.
 * - Ambiguous Han-only text strictly respects the caller's languageHint.
 */
export function resolveOcrLanguageRoute(
  languageHint: OcrLanguageHint,
  sampleText?: string
): ResolvedLanguageRoute {
  switch (languageHint) {
    case 'en':
      return {
        routeId: 'en_ppocrv6_small',
        ocrModelId: ROUTE_TO_MODEL_ID.en_ppocrv6_small,
        effectiveLanguage: 'en',
        routingReason: 'Explicit caller language hint: en -> PP-OCRv6 small',
        isAmbiguousAutoRoute: false,
      };
    case 'ko':
      return {
        routeId: 'ko_ppocrv5_mobile',
        ocrModelId: ROUTE_TO_MODEL_ID.ko_ppocrv5_mobile,
        effectiveLanguage: 'ko',
        routingReason: 'Explicit caller language hint: ko -> PP-OCRv5 mobile Korean',
        isAmbiguousAutoRoute: false,
      };
    case 'ja':
      return {
        routeId: 'ja_zh_ppocrv6_manga',
        ocrModelId: ROUTE_TO_MODEL_ID.ja_zh_ppocrv6_manga,
        effectiveLanguage: 'ja',
        routingReason: 'Explicit caller language hint: ja -> PP-OCRv6 Manga v0.3 FP32',
        isAmbiguousAutoRoute: false,
      };
    case 'zh':
      return {
        routeId: 'ja_zh_ppocrv6_manga',
        ocrModelId: ROUTE_TO_MODEL_ID.ja_zh_ppocrv6_manga,
        effectiveLanguage: 'zh',
        routingReason: 'Explicit caller language hint: zh -> PP-OCRv6 Manga v0.3 FP32',
        isAmbiguousAutoRoute: false,
      };
    case 'auto':
    default: {
      const script = sampleText ? detectScriptSignal(sampleText) : 'unknown';
      if (script === 'hangul') {
        return {
          routeId: 'ko_ppocrv5_mobile',
          ocrModelId: ROUTE_TO_MODEL_ID.ko_ppocrv5_mobile,
          effectiveLanguage: 'ko',
          routingReason: 'Secondary Unicode script signal detected Hangul -> PP-OCRv5 mobile Korean',
          isAmbiguousAutoRoute: false,
        };
      }
      if (script === 'kana') {
        return {
          routeId: 'ja_zh_ppocrv6_manga',
          ocrModelId: ROUTE_TO_MODEL_ID.ja_zh_ppocrv6_manga,
          effectiveLanguage: 'ja',
          routingReason: 'Secondary Unicode script signal detected Kana -> PP-OCRv6 Manga v0.3 FP32',
          isAmbiguousAutoRoute: false,
        };
      }
      if (script === 'latin') {
        return {
          routeId: 'en_ppocrv6_small',
          ocrModelId: ROUTE_TO_MODEL_ID.en_ppocrv6_small,
          effectiveLanguage: 'en',
          routingReason: 'Secondary Unicode script signal detected Latin -> PP-OCRv6 small',
          isAmbiguousAutoRoute: false,
        };
      }
      // Ambiguous Han-only or unknown text under 'auto' cannot safely assume Japanese vs Chinese
      // without a caller languageHint, so flag ambiguity while routing to Manga CJK baseline.
      return {
        routeId: 'ja_zh_ppocrv6_manga',
        ocrModelId: ROUTE_TO_MODEL_ID.ja_zh_ppocrv6_manga,
        effectiveLanguage: 'ja',
        routingReason:
          script === 'han_only'
            ? 'Ambiguous Han-only text with languageHint="auto"; supply explicit ja/zh project language hint'
            : 'No language hint or script cue provided; defaulted to PP-OCRv6 Manga baseline',
        isAmbiguousAutoRoute: true,
      };
    }
  }
}
