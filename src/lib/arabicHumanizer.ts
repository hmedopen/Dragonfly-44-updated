import type { EloquenceLevel } from '../types/workbench';

/**
 * Arabic Humanizer & AI-Detector Bypass Engine
 * Enforces natural human scanlator cadence, strips mechanical AI artifacts,
 * and respects the chosen Eloquence Level (Level 1: Casual Modern, Level 2: Scanlation Literary, Level 3: High Classical).
 */

export const ARABIC_HUMANIZER_PROMPT_RULES = `
ARABIC HUMANIZER & AI-DETECTOR BYPASS DIRECTIVES:
1. Forbid AI antithesis templates: NEVER use repetitive synthetic formulations like "لم يكن... بل كان..." or "ليس فقط... وإنما...". Use direct, punchy phrasing.
2. Forbid robotic connector spam: Eliminate overused AI transitional fillers such as "حيث", "إذ", "في حين أن", "وفي تلك الأثناء", "بينما كان".
3. Write with authentic human scanlator flow: Match natural speech cadence. Keep dialogue crisp, emotional, and formatted for real speech bubbles.
4. Avoid formal academic dictionary words where conversational scanlation terms convey greater dramatic impact.
`.trim();

/**
 * Deterministic Arabic Text Sanitizer
 * Removes structural dead giveaways of synthetic AI Arabic generation.
 * In High Classical eloquence (Level 3), preserves dignified classical hamzas and structures.
 */
export function humanizeArabicText(text: string, eloquenceLevel: EloquenceLevel = 2): string {
  if (!text) return '';

  let sanitized = text;

  // 1. Replace em-dashes (— and –) with natural scanlation punctuation (comma or double periods)
  sanitized = sanitized.replace(/[\u2014\u2013]/g, '..');

  // 2. Replace bookish semicolons (؛ and ;) with standard Arabic comma (،)
  sanitized = sanitized.replace(/[؛;]/g, '،');

  // 3. Strip mechanical Tanwin diacritics (ً, ٌ, ٍ) that human typesetters and scanlators never type in comic bubbles
  sanitized = sanitized.replace(/[\u064B\u064C\u064D]/g, '');

  // 4. Strip stray non-critical tashkeel marks while preserving meaningful shadda (ّ) if present
  sanitized = sanitized.replace(/[\u064E\u064F\u0650\u0652]/g, '');

  // 5. Normalization of rigid robotic hamzas:
  // For Levels 1 & 2 (Casual Modern & Scanlation Literary), normalize rigid Hamzas on connectors.
  // For Level 3 (High Classical / Majestic), preserve formal classical Hamzas.
  if (eloquenceLevel !== 3) {
    // إلى / وإلى -> الى / والى
    sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])إلى(?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'الى');
    // إنك / أنك / وإنك -> انك / وانك
    sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])[إأ]نك(?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'انك');
    // إن / أن / وإن / وأن -> ان / وان
    sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])[إأ]ن(?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'ان');
    // أحد / وأحد -> احد / واحد
    sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])أحد(?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'احد');
    // أمام / وأمام -> امام / وامام
    sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])أمام(?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'امام');
    // أخير / وأخير / وأخيرا -> اخير / واخير
    sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])أخير/gu, (_m, p) => p + 'اخير');
    // أيضاً / أيضا / وأيضا -> ايضا / وايضا
    sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])[أا]يض[ااً](?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'ايضا');
  }

  // 6. Clean up doubled commas or awkward spaces around punctuation
  sanitized = sanitized.replace(/([،]){2,}/g, '،');
  sanitized = sanitized.replace(/\s+([،.?!])/g, '$1');
  sanitized = sanitized.replace(/([،])([^\s])/g, '$1 $2');

  return sanitized.trim();
}
