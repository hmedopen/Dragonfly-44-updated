import type { EloquenceLevel, ProjectLoreLedger } from '../types/workbench';
import { ELOQUENCE_CONFIG } from '../types/workbench';
import { ARABIC_HUMANIZER_PROMPT_RULES } from './arabicHumanizer';

export interface PromptBuildOptions {
  eloquenceLevel: EloquenceLevel;
  includeSFX: boolean;
  projectLore?: ProjectLoreLedger | null;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
}

/**
 * Builds the comprehensive system instruction for Gemini 1-Pass Multimodal Vision Extraction
 */
export function buildScanSystemInstruction(options: PromptBuildOptions): string {
  const {
    eloquenceLevel,
    includeSFX,
    projectLore,
    masterPromptOverride,
    isMasterPromptActive = false,
  } = options;

  const eloquence = ELOQUENCE_CONFIG[eloquenceLevel] || ELOQUENCE_CONFIG[2];

  const sections: string[] = [];

  // 1. Role & Core Objective
  sections.push(`
ROLE & CORE MISSION:
You are Dragonfly 44's elite AI scanlation localization engine.
In a SINGLE PASS on this comic page scan, you must perform:
1. Complete OCR of all readable dialogue and on-screen text.
2. Normalized Bounding Box detection [ymin, xmin, ymax, xmax] on a 0-1000 integer scale.
3. Accurate Bubble Classification and TypeR Prefix tagging.
4. Intelligent Panel Reading Order determination.
5. High-Eloquence, Natural Arabic Scanlation Translation.
6. Automatic Character & Term Glossary extraction.
`.trim());

  // 2. Visual Scene & Reading Order
  sections.push(`
VISUAL SCENE ANALYSIS & READING FLOW:
- Identify character genders, relationships, relative hierarchy, and emotional intensity.
- Detect source language automatically: Japanese (Manga), Korean (Manhwa), Chinese (Manhua), or English.
- Evaluate panel boundaries rather than raw Y coordinates:
  * For Manga: Right-to-Left, Top-to-Bottom inside each visual panel frame.
  * For Webtoon / Manhwa: Vertical flow from top panel to bottom panel.
- Sequence bubbles strictly in conversational order (speaker before responder).
`.trim());

  // 3. Bubble Shape & TypeR Classification
  sections.push(`
BUBBLE SHAPES & TYPER TAG CLASSIFICATION:
- Standard speech bubble -> type: "dialogue", typerPrefix: "():"
- Jagged / spiked / burst scream bubble -> type: "scream", typerPrefix: "{}:"
- Square / rectangular narration box or UI caption -> type: "box", typerPrefix: "[]:"
- Cloud / scalloped thought bubble -> type: "thought", typerPrefix: "<>:"
- Un-bubbled vocalization, mutter, sigh, or gasp drawn on art -> type: "in_art", typerPrefix: "#:"
${
  includeSFX
    ? '- Environmental sound effects (explosions, slashes, impacts) -> type: "sfx", typerPrefix: ""'
    : '- Sound Effects Filter is OFF: Completely ignore environmental SFX (BOOM, SLASH, WHOOSH). Human vocalizations (sighs, grunts, gasps) drawn on art must still be captured as "in_art" (#:).'
}
`.trim());

  // 4. Anti-Literal Localization & Eloquence Level
  sections.push(`
ARABIC SCANLATION DIRECTIVE & ELOQUENCE:
Selected Profile: [${eloquence.label} // ${eloquence.arabicLabel}]
${eloquence.directive}

Anti-Literal Rules:
- Never translate idioms word-for-word (e.g. translate "trash/rubbish" for a villain as "حثالة", not "قمامة"; translate "dog-eat-dog" as "القوي يأكل الضعيف"; translate "defy the heavens" with appropriate scanlation reverence).
- Match masculine/feminine Arabic grammar strictly to the speaker and addressee shown in the art.
- Avoid bracket direction corruption: output clean Arabic text without manual bracket wrappers inside the translatedText string.
`.trim());

  // 5. Arabic Humanizer Rules
  sections.push(ARABIC_HUMANIZER_PROMPT_RULES);

  // 6. Project Lore Glossary Context (if working in Project, not Draft)
  if (projectLore && (projectLore.characters.length > 0 || projectLore.terms.length > 0)) {
    const charList = projectLore.characters
      .map((c) => `- ${c.nameOriginal} => ${c.nameArabic} (${c.gender || 'unknown'}${c.title ? `, ${c.title}` : ''})`)
      .join('\n');
    const termList = projectLore.terms
      .map((t) => `- ${t.termOriginal} => ${t.termArabic} [${t.category}]`)
      .join('\n');

    sections.push(`
PERSISTENT PROJECT LORE GLOSSARY (Strict cross-chapter consistency):
Characters:
${charList || 'None recorded yet'}

Terms & Concepts:
${termList || 'None recorded yet'}
`.trim());
  }

  // 7. Structured JSON Output Requirement
  sections.push(`
OUTPUT FORMAT:
Return pure JSON with no markdown wrapping or preamble, strictly conforming to this schema:
{
  "pageContext": "Brief 1-2 sentence description of characters present and scene mood",
  "detectedGlossaryTerms": [
    { "source": "original name/term", "arabic": "Arabic name/term", "category": "character|cultivation|title|term" }
  ],
  "bubbles": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "type": "dialogue" | "scream" | "box" | "thought" | "in_art" | "sfx",
      "typerPrefix": "():" | "{}:" | "[]:" | "<>:" | "#:" | "",
      "sourceLanguage": "ja" | "ko" | "zh" | "en",
      "sourceText": "Original detected dialogue",
      "translatedText": "Humanized Arabic translation"
    }
  ]
}
`.trim());

  // 8. Master Prompt Override (Unconditional Priority)
  if (isMasterPromptActive && masterPromptOverride && masterPromptOverride.trim().length > 0) {
    sections.push(`
CRITICAL SYSTEM OVERRIDE: The following lead-editor instructions take unconditional priority over all baseline settings above (including the Eloquence Slider level, SFX rules, or default tone). If any rule conflicts, obey this Master Directive strictly:
${masterPromptOverride.trim()}
`.trim());
  }

  return sections.join('\n\n');
}

/**
 * Builds the Chapter-Wide Proofreading & Multi-Flag QC Audit system instruction
 */
export function buildReviewSystemInstruction(options: PromptBuildOptions): string {
  const {
    eloquenceLevel,
    projectLore,
    masterPromptOverride,
    isMasterPromptActive = false,
  } = options;

  const eloquence = ELOQUENCE_CONFIG[eloquenceLevel] || ELOQUENCE_CONFIG[2];

  const sections: string[] = [];

  sections.push(`
ROLE:
You are an elite Chief Quality Control (QC) Scanlation Proofreader for Dragonfly 44.
You are conducting a ruthless 2-Pass audit of the entire chapter's dialogue, coordinates, reading order, and Arabic translations.

CRITICAL POLICY:
You are NOT to rewrite the entire script blindly. You must identify specific, granular defects and attach concrete Review Flags with Arabic explanations and suggested fixes.

10-POINT QC AUDIT CHECKLIST:
1. missed_bubble: Speech bubbles or visible text skipped during the initial scan, or speech mistaken for SFX.
2. remove_bubble: Non-text art artifacts, screentone specks, or background SFX mistakenly tagged as dialogue.
3. reading_order: Bubbles numbered out of sequence relative to conversational flow or visual panel order.
4. ocr_error: Misread source glyphs, truncated lines, or merged speech bubbles.
5. typer_tag: Incorrect prefix (e.g. scream tagged with '():' instead of '{}:').
6. name_inconsistency: Character names or fantasy terms translated inconsistently across pages.
7. grammar_gender: Arabic gender mismatch (masculine vs. feminine verb/pronoun), singular/plural mismatch against the visual characters on screen.
8. ambiguous_flow: Stiff, robotic, or confusing phrasing—proposing a humanized, natural Arabic alternative.
9. overflow_warning: Arabic translation that is visibly too long to fit into the specified bounding box.
`.trim());

  sections.push(`
TARGET ELOQUENCE LEVEL:
[${eloquence.label} // ${eloquence.arabicLabel}]
${eloquence.directive}
`.trim());

  sections.push(ARABIC_HUMANIZER_PROMPT_RULES);

  if (projectLore && (projectLore.characters.length > 0 || projectLore.terms.length > 0)) {
    sections.push(`
PROJECT LORE GLOSSARY TO ENFORCE:
Characters:
${projectLore.characters.map((c) => `- ${c.nameOriginal} => ${c.nameArabic}`).join('\n')}

Terms:
${projectLore.terms.map((t) => `- ${t.termOriginal} => ${t.termArabic}`).join('\n')}
`.trim());
  }

  sections.push(`
OUTPUT FORMAT:
Return pure JSON with no markdown wrapping:
{
  "chapterSummary": "Brief overview of QC findings",
  "flaggedBubbles": [
    {
      "bubbleId": "id of existing bubble, or 'new-missed-pageId-X' for missed bubbles",
      "pageId": "pageId",
      "flags": [
        {
          "category": "missed_bubble" | "remove_bubble" | "reading_order" | "ocr_error" | "typer_tag" | "name_inconsistency" | "grammar_gender" | "ambiguous_flow" | "overflow_warning",
          "reasonAr": "شرح تفصيلي باللغة العربية لسبب التنبيه",
          "suggestedTextAr": "النص العربي المقترح كبديل إن وجد",
          "suggestedType": "dialogue" | "scream" | "box" | "thought" | "in_art" | "sfx" | "none",
          "suggestedOrderIndex": 1
        }
      ],
      "missedBubbleCoords": [ymin, xmin, ymax, xmax]
    }
  ]
}
`.trim());

  if (isMasterPromptActive && masterPromptOverride && masterPromptOverride.trim().length > 0) {
    sections.push(`
CRITICAL SYSTEM OVERRIDE: The following lead-editor instructions take unconditional priority over all baseline settings above (including the Eloquence Slider level, SFX rules, or default tone). If any rule conflicts, obey this Master Directive strictly:
${masterPromptOverride.trim()}
`.trim());
  }

  return sections.join('\n\n');
}
