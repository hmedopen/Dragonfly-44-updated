import type { EloquenceLevel, HumanizerIntensity, OrthographyMode } from '../types/workbench';
import { compileHumanizerPromptDirectives } from './humanizerRulebook';

export { ARABIC_HUMANIZER_RULES, compileHumanizerPromptDirectives } from './humanizerRulebook';

/**
 * Legacy prompt rules export for backward compatibility with existing tests and imports.
 * Points to the structured rulebook's balanced profile.
 */
export const ARABIC_HUMANIZER_PROMPT_RULES = compileHumanizerPromptDirectives({
  intensity: 'balanced',
  isDialectActive: false,
});

export interface HumanizeOptions {
  eloquenceLevel?: EloquenceLevel;
  intensity?: HumanizerIntensity;
  orthographyMode?: OrthographyMode;
  isDialectActive?: boolean;
}

/**
 * Common Arabic adverbs and stems where Tanween Fathatan is grammatically and visually vital.
 */
export const MEANINGFUL_TANWEEN_STEMS = new Set([
  'شكر',   // شكراً
  'ابد',   // أبداً
  'جد',    // جداً
  'حق',    // حقاً
  'مع',    // معاً
  'تمام',  // تماماً
  'دائم',  // دائماً
  'ايض',   // أيضاً
  'فعل',   // فعلاً
  'حتم',   // حتماً
  'طبع',   // طبعاً
  'مطلق',  // مطلقاً
  'خاص',   // خاصةً
  'عذر',   // عذراً
  'مهل',   // مهلاً
  'حسن',   // حسناً
  'مرحب',  // مرحباً
  'اهل',   // أهلاً
  'سهل',   // سهلاً
]);

/**
 * Non-Destructive Arabic Scanlation Sanitizer
 *
 * Implements System #2 orthographic principles:
 * - Preserves correct Arabic hamzas (أ، إ، آ، ؤ، ئ) by default. Never turns 'إلى' into 'الى' or 'إن' into 'ان'.
 * - Preserves shadda (ّ) and meaningful tanween on adverbs (شكراً، أبداً، جداً).
 * - Formats comic punctuation: converts em-dashes (—) to double periods (..) and semicolons (؛) to commas (،).
 * - Cleans spacing and punctuation glitches without altering dialect or character personality.
 */
export function humanizeArabicText(
  text: string,
  optionsOrEloquence: EloquenceLevel | HumanizeOptions = 2
): string {
  if (!text || typeof text !== 'string') return '';

  const options: HumanizeOptions =
    typeof optionsOrEloquence === 'number'
      ? { eloquenceLevel: optionsOrEloquence }
      : optionsOrEloquence;

  const {
    eloquenceLevel = 2,
    orthographyMode = 'correct_spelling',
    isDialectActive = false,
  } = options;

  let sanitized = text;

  // 1. Normalize comic bubble punctuation
  // Convert em-dashes (— and –) to standard scanlation double periods
  sanitized = sanitized.replace(/[\u2014\u2013]/g, '..');

  // Convert academic semicolons (؛ and ;) to standard Arabic comma (،)
  sanitized = sanitized.replace(/[؛;]/g, '،');

  // 2. Safe Tanween & Tashkeel Handling
  if (orthographyMode === 'correct_spelling' || eloquenceLevel === 3) {
    // In Correct Orthography / High Classical mode:
    // Strip only stray fatha, damma, kasra, and sukun while PRESERVING shadda (\u0651) and Tanween (\u064B, \u064C, \u064D)
    sanitized = sanitized.replace(/[\u064E\u064F\u0650\u0652]/g, '');
  } else {
    // In Relaxed mode:
    // Strip heavy non-adverbial vowels while protecting shadda
    sanitized = sanitized.replace(/[\u064C\u064D\u064E\u064F\u0650\u0652]/g, '');
  }

  // 3. Hamza Orthography Preservation
  // CRITICAL: We NEVER blindly strip hamza from correct words (إلى, إن, أحد, أمام, أخير).
  // If dialect is active, preserve colloquial phonetic representations verbatim.
  if (isDialectActive) {
    // Preserve dialect verbatim - do not force MSA orthography corrections
  }

  // 4. Clean up punctuation spacing and doubled characters
  sanitized = sanitized.replace(/([،]){2,}/g, '،');
  sanitized = sanitized.replace(/\s+([،.?!:؛])/g, '$1');
  sanitized = sanitized.replace(/([،])([^\s،.?!])/g, '$1 $2');
  sanitized = sanitized.replace(/([!?])\s+([!?])/g, '$1$2');

  return sanitized.trim();
}
