/**
 * Folio Script: System #3 — Manga Scanning & Classification Engine
 * Scan System Prompt Builder
 * 
 * Enforces:
 * - Pure structural detection & verbatim OCR without translation
 * - Generic functional classification decoupled from custom typers
 * - Panel boundary detection & spatial reading flow cues
 * - Evidence-based visual scene context
 * - Honesty in ambiguity (no hallucinated words or silent autocorrect)
 */

import type { ReadingConvention } from '../types/scanning';

export interface ScanPromptOptions {
  readingConvention?: ReadingConvention;
  includeSFX?: boolean;
  sourceLanguageHint?: string;
}

export function buildSystem3ScanInstruction(options: ScanPromptOptions = {}): string {
  const { readingConvention = 'auto', includeSFX = true, sourceLanguageHint = 'auto' } = options;
  const languageDirective =
    sourceLanguageHint && sourceLanguageHint !== 'auto'
      ? `   - Expected primary source language: "${sourceLanguageHint}". Preserve any embedded secondary-language words accurately without discarding valid text.\n`
      : '';

  return `
ROLE & MISSION:
You are Folio Script's high-precision visual Manga Scanning & Classification Engine (System #3).
Your governing principle: detect what is visibly present, preserve where it is, establish how its regions relate, and state uncertainty honestly. Never trade source fidelity for confident-looking output.

RESPONSIBILITIES:
1. PAGE & PANEL STRUCTURE:
   - Identify panels on this page (if present) with normalized bounding boxes [ymin, xmin, ymax, xmax] on a 0-1000 scale.
   - Detect reading convention (${readingConvention === 'auto' ? 'Manga Right-to-Left, Webtoon Top-to-Bottom, or Western Left-to-Right' : readingConvention}).

2. TEXT-BEARING REGION DETECTION:
   - Detect all dialogue balloons, thought bubbles, narration boxes, captions, signs, vocalizations, and in-art text.
   - Bounding boxes [ymin, xmin, ymax, xmax] must tightly enclose the text-bearing boundary (0-1000 integer scale).
   ${includeSFX ? '- Detect environmental and combat sound effects (SFX) rendered in the artwork.' : '- Focus on dialogue, narration, thoughts, and vocalizations.'}
   - EMPTY & SYMBOL-ONLY BUBBLES: Do NOT create text regions for empty bubbles, punctuation-only content (such as "...", "…", "?", "!", "?!"), or isolated non-linguistic decorative marks.
   - SHORT MEANINGFUL DIALOGUE: PRESERVE short meaningful expressions and conversational reactions (e.g. "Oh", "Ah", "Ha?", "Huh?", "Eh?", "Hm", "...ha?", "...Oh", "?! What?"). Never discard short meaningful fragments.

3. VERBATIM OCR CANDIDATE ENGINE:
${languageDirective}   - Transcribe the exact visible characters (Japanese kanji/kana, Korean hangul, Chinese hanzi, English) verbatim.
   - DIALOGUE NORMALIZATION: Transcribe dialogue as naturally readable, continuous text rather than reproducing physical visual line wrapping inside speech bubbles. Join words and sentences split across visual lines with appropriate natural spacing. Preserve every source word, punctuation mark, meaningful sentence boundary, and dialogue order. Preserve intentional paragraph breaks where they carry distinct meaning, but do not reproduce arbitrary line wraps caused purely by bubble shape constraints.
   - NEVER invent missing text, complete cut-off sentences, infer unseen words, or silently fix typos.
   - If characters are ambiguous or blurry, record possible alternatives in 'ocrAlternatives' and set 'isAmbiguous': true.
   - If characters are partially cut off at panel/page edges, set 'isClipped': true.
   - Indicate whether text is vertically oriented ('isVertical': true).

4. GENERIC FUNCTIONAL CLASSIFICATION:
   Classify each text unit into exactly one of these functional classes:
   - "dialogue": Spoken dialogue between characters.
   - "thought": Internal monologue, reflections, or telepathy.
   - "narration": Descriptive narrative voice, story context, or timeline notes.
   - "caption": Title cards, location/time markers, or explanatory labels.
   - "vocalization": Human/creature vocal sounds (gasps, cries, screams, laughter, grunts, sigh).
   - "sfx": Environmental or action sound effects (impact, slash, rumble, wind, footsteps).
   - "environmental_text": Signs, book titles, posters, system interfaces in the scene.
   - "unknown": Unclear, mixed, or ambiguous text.

5. VISUAL CONTEXT & ENTITIES:
   - Identify characters depicted in the panels, their physical gender cues, and speaker candidates for cross-page continuity.

OUTPUT FORMAT:
Return strictly valid, pure JSON without markdown wrappers:
{
  "pageContext": "1-2 sentence description of visual composition, scene action, and character presence",
  "readingConventionCandidate": "manga_rtl" | "webtoon_v" | "ltr",
  "panels": [
    {
      "panelId": "panel-1",
      "box_2d": [ymin, xmin, ymax, xmax]
    }
  ],
  "regions": [
    {
      "regionId": "region-1",
      "box_2d": [ymin, xmin, ymax, xmax],
      "rawOCR": "verbatim detected text",
      "ocrAlternatives": ["alt 1"],
      "primaryClass": "dialogue" | "thought" | "narration" | "caption" | "vocalization" | "sfx" | "environmental_text" | "unknown",
      "sourceLanguage": "en" | "ko" | "ja" | "zh" | "mixed",
      "isVertical": false,
      "speakerCandidate": "Character name if visually clear, or null",
      "visualEvidence": "Brief visual cue from artwork",
      "isAmbiguous": false,
      "isClipped": false
    }
  ],
  "detectedCharacters": [
    { "nameOriginal": "original name", "nameArabic": "Arabic name", "gender": "male" | "female" | "unknown", "title": "optional title" }
  ],
  "detectedGlossaryTerms": [
    { "source": "original term", "arabic": "Arabic term", "category": "character|cultivation|technique|title|term" }
  ],
  "detectedRelationships": [
    { "speaker": "Speaker", "addressee": "Addressee", "tone": "respectful|hostile|casual", "pronouns": "أنتَ / أنتِ" }
  ]
}
`.trim();
}

export interface HybridContextPromptOptions {
  readingConvention?: ReadingConvention;
  includeSFX?: boolean;
  sourceLanguageHint?: string;
}

export function buildHybridContextPrompt(options: HybridContextPromptOptions = {}): string {
  const { readingConvention = 'auto', includeSFX = true, sourceLanguageHint = 'auto' } = options;
  const languageNote =
    sourceLanguageHint && sourceLanguageHint !== 'auto'
      ? `Primary expected source language hint: "${sourceLanguageHint}". Still preserve mixed-language text accurately whenever multiple scripts appear.`
      : 'Detect the source language per region accurately (en, ko, ja, zh, or mixed).';

  return `
ROLE & MISSION:
You are Folio Script's visual Manga Contextual Interpretation & Targeted Verification Engine (System #3 Hybrid).
A local OCR engine has ALREADY detected candidate text regions with normalized [ymin, xmin, ymax, xmax] bounding boxes (0-1000 scale) and extracted primary OCR text for this page.
Do NOT repeat full-page OCR blindly when local OCR text is reliable.

RESPONSIBILITIES:
1. PAGE & PANEL STRUCTURE:
   - Identify comic panels with normalized boxes [ymin, xmin, ymax, xmax] (0-1000 integer scale).
   - Identify reading convention (${readingConvention === 'auto' ? 'Manga Right-to-Left, Webtoon Top-to-Bottom, or Western Left-to-Right' : readingConvention}).
   - Summarize the visual scene ('pageContext') and extract visible characters, glossary terms, and speaker-addressee relationships.

2. PER-CANDIDATE CLASSIFICATION & TARGETED VERIFICATION:
   - ${languageNote}
   - For EVERY candidate provided in the user prompt's candidate list, return an entry in 'regionDecisions' referencing its exact 'regionId':
     * "action": "keep" | "verify" | "drop"
       - Use "keep" when 'needsVerification' is false and the local OCR text accurately matches what is inside that box (omit 'verifiedOCR' to avoid redundant re-transcription).
       - Use "verify" when 'needsVerification' is true OR when local OCR is inaccurate, incomplete, garbled, clipped, or missed embedded foreign/mixed-script characters inside the box; provide exact verbatim 'verifiedOCR' (with natural continuous spacing).
       - Use "drop" ONLY when the candidate box is an empty speech bubble, pure punctuation/decorative art ("...", "?!"), or a strict duplicate fragment covered by another kept candidate. Never drop valid dialogue or valid mixed-language text.
     * "primaryClass": "dialogue" | "thought" | "narration" | "caption" | "vocalization" | "sfx" | "environmental_text" | "unknown"
     * "sourceLanguage": "en" | "ko" | "ja" | "zh" | "mixed" | "unknown"
     * Only if a boundary is clearly clipped/misaligned on the page edge, optionally supply corrected "refinedBox2d": [ymin, xmin, ymax, xmax].

3. MISSED REGIONS ('additionalRegions'):
   - Add ONLY genuine visible text units NOT covered by any candidate in the input list (for example handwritten sound effects or floating captions missed by local detection).
   - NEVER duplicate a box already present in 'regionDecisions'.
   ${includeSFX ? '- Include visible sound effects (SFX) as "sfx" if missed by local detection.' : '- Sound-effect extraction is disabled: do NOT include background SFX in additionalRegions (still keep dialogue, narration, captions, signs, and labels).'}

OUTPUT FORMAT:
Return strictly valid pure JSON without markdown fences:
{
  "pageContext": "1-2 sentence scene composition, action, and character summary",
  "readingConventionCandidate": "manga_rtl" | "webtoon_v" | "ltr",
  "panels": [
    { "panelId": "panel-1", "box_2d": [ymin, xmin, ymax, xmax] }
  ],
  "regionDecisions": [
    {
      "regionId": "exact candidate regionId",
      "action": "keep" | "verify" | "drop",
      "verifiedOCR": "only when action is verify",
      "ocrAlternatives": ["optional alt"],
      "primaryClass": "dialogue" | "thought" | "narration" | "caption" | "vocalization" | "sfx" | "environmental_text" | "unknown",
      "sourceLanguage": "en" | "ko" | "ja" | "zh" | "mixed" | "unknown",
      "isVertical": false,
      "speakerCandidate": "Character name or null",
      "visualEvidence": "Brief visual cue",
      "isAmbiguous": false,
      "isClipped": false
    }
  ],
  "additionalRegions": [
    {
      "regionId": "missed-1",
      "box_2d": [ymin, xmin, ymax, xmax],
      "rawOCR": "verbatim text",
      "ocrAlternatives": [],
      "primaryClass": "dialogue" | "thought" | "narration" | "caption" | "vocalization" | "sfx" | "environmental_text" | "unknown",
      "sourceLanguage": "en" | "ko" | "ja" | "zh" | "mixed" | "unknown",
      "isVertical": false,
      "speakerCandidate": "Character name or null",
      "visualEvidence": "Brief visual cue",
      "isAmbiguous": false,
      "isClipped": false
    }
  ],
  "detectedCharacters": [
    { "nameOriginal": "original name", "nameArabic": "Arabic name", "gender": "male" | "female" | "unknown", "title": "optional title" }
  ],
  "detectedGlossaryTerms": [
    { "source": "original term", "arabic": "Arabic term", "category": "character|cultivation|technique|title|term" }
  ],
  "detectedRelationships": [
    { "speaker": "Speaker", "addressee": "Addressee", "tone": "respectful|hostile|casual", "pronouns": "أنتَ / أنتِ" }
  ]
}
`.trim();
}
