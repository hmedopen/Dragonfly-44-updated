import type { EloquenceLevel, ProjectLoreLedger, ChapterIntelligence } from '../types/workbench';
import type { CustomTyperConfig } from '../types/typers';
import { ELOQUENCE_CONFIG } from '../types/workbench';
import { ARABIC_HUMANIZER_PROMPT_RULES } from './arabicHumanizer';

export interface ScanPromptBuildOptions {
  eloquenceLevel: EloquenceLevel;
  includeSFX: boolean;
  projectLore?: ProjectLoreLedger | null;
  chapterIntelligence?: ChapterIntelligence | null;
  rollingContextSnippet?: string;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
  typers?: CustomTyperConfig[];
}

/**
 * Builds the comprehensive system instruction for Gemini Multimodal Vision Extraction & Contextual Translation.
 * Enforces strict hierarchy: Master Override > Project/Chapter Lore > Eloquence > Typers > Scene Flow > Humanizer.
 */
export function buildScanSystemInstruction(options: ScanPromptBuildOptions): string {
  const {
    eloquenceLevel,
    includeSFX,
    projectLore,
    chapterIntelligence,
    rollingContextSnippet,
    masterPromptOverride,
    isMasterPromptActive = false,
    typers = [],
  } = options;

  const eloquence = ELOQUENCE_CONFIG[eloquenceLevel] || ELOQUENCE_CONFIG[2];
  const sections: string[] = [];

  // 1. Role & Mission
  sections.push(`
ROLE & MISSION:
You are Dragonfly 44's elite scanlation localization engine.
In a high-precision multimodal pass on this comic/manga page scan, you must:
1. Detect all dialogue bubbles, narration boxes, shouts, thoughts, and floating text with normalized bounding boxes [ymin, xmin, ymax, xmax] on a 0-1000 scale.
2. Determine correct panel reading order (Manga: Right-to-Left, Top-to-Bottom within panels; Webtoon: Top-to-Bottom).
3. Classify each text unit into the appropriate configured Typer based on visual shape, typography, and functional context.
4. Perform non-literal, high-eloquence Arabic scanlation translation matching the scene mood and character voices.
5. Extract character names, fantasy terms, and speaker relationships for cross-page continuity.
`.trim());

  // 2. Visual Scene & Reading Flow
  sections.push(`
VISUAL SCENE ANALYSIS & READING ORDER:
- Sequence bubbles strictly in conversational order (speaker before responder).
- Respect comic panel borders: read panels in narrative sequence before reading sub-bubbles inside a panel.
- Identify speaker identities and genders directly from the artwork to enforce accurate Arabic verb and pronoun agreements.
`.trim());

  // 3. Typer Classification Rules
  const eligibleTypers = typers.filter(
    (t) => t.instructions && t.instructions.trim().length > 0
  );

  if (eligibleTypers.length > 0) {
    const typerRuleLines = eligibleTypers
      .map((t) => {
        const pfxDisplay = t.prefix ? `"${t.prefix}"` : '(empty prefix)';
        return `- Typer "${t.name}" [ID: "${t.id}", Prefix: ${pfxDisplay}]:
  Rules: ${t.instructions.trim()}`;
      })
      .join('\n\n');

    sections.push(`
TYPER CLASSIFICATION RULES:
You must classify every detected bubble into one of the following configured typers based on bubble shape, border style, typography, and functional context:

${typerRuleLines}

CLASSIFICATION CONSTRAINTS:
1. ONLY assign an ID from the list above if the text unit matches that typer's functional rules and visual appearance.
2. If no configured typer matches, return type: "none" and typerPrefix: "".
3. NEVER invent custom type names outside the configured list.
${
  includeSFX
    ? '4. Environmental sound effects (SFX) should be classified under the corresponding SFX typer.'
    : '4. Sound Effects Filter is OFF: Completely ignore background environmental SFX unless drawn as integral vocal speech.'
}
`.trim());
  } else {
    sections.push(`
TYPER CLASSIFICATION RULES:
No configured typers are eligible for automatic classification. Set type: "none" and typerPrefix: "" for all bubbles.
`.trim());
  }

  // 4. Eloquence Level & Arabic Directive
  sections.push(`
ARABIC SCANLATION DIRECTIVE & ELOQUENCE:
Selected Profile: [${eloquence.label} // ${eloquence.arabicLabel}]
${eloquence.directive}

Non-Literal Rules:
- Avoid word-for-word literal translation; adapt idioms into dramatic, natural Arabic expressions.
- Strict gender agreement: match Arabic pronouns and verbs (أنتَ vs أنتِ, قال vs قالت) to the characters depicted in the artwork.
- Output clean Arabic translation text without manual bracket wrappers inside the translatedText string.
`.trim());

  // 5. Arabic Humanizer Rules
  sections.push(ARABIC_HUMANIZER_PROMPT_RULES);

  // 6. Rolling Chapter Context (Sequential Page Continuity)
  if (rollingContextSnippet && rollingContextSnippet.trim().length > 0) {
    sections.push(`
ROLLING CHAPTER CONTEXT & PRECEDING DIALOGUE:
${rollingContextSnippet.trim()}
Use this preceding context to maintain conversational continuity, character pronouns, and speaking styles.
`.trim());
  }

  // 7. Project & Chapter Lore Memory
  const characters = [
    ...(projectLore?.characters || []),
    ...(chapterIntelligence?.characterRoster || []),
  ];
  const terms = [
    ...(projectLore?.terms || []),
    ...(chapterIntelligence?.termsHarvested || []),
  ];
  const relationships = [
    ...(projectLore?.speakerRelationships || []),
    ...(chapterIntelligence?.speakerPairs || []),
  ];

  if (characters.length > 0 || terms.length > 0 || relationships.length > 0) {
    const charList = Array.from(new Set(characters.map((c) => `- ${c.nameOriginal} => ${c.nameArabic} (${c.gender || 'unknown'}${c.title ? `, ${c.title}` : ''})`))).join('\n');
    const termList = Array.from(new Set(terms.map((t) => `- ${t.termOriginal} => ${t.termArabic} [${t.category}]`))).join('\n');
    const relList = Array.from(new Set(relationships.map((r) => `- ${r.speaker} to ${r.addressee}: Tone: ${r.tone}${r.pronouns ? `, Pronouns: ${r.pronouns}` : ''}`))).join('\n');

    sections.push(`
LORE & GLOSSARY MEMORY (Strict Continuity):
Characters:
${charList || 'None'}

Terminology:
${termList || 'None'}

Speaker Relationships:
${relList || 'None'}
`.trim());
  }

  // 8. Output Schema
  const allowedTypeExamples = eligibleTypers.length > 0
    ? eligibleTypers.map((t) => `"${t.id}"`).join(' | ') + ' | "none"'
    : '"none"';

  sections.push(`
OUTPUT FORMAT:
Return strictly pure JSON with no markdown wrapping or conversational preamble:
{
  "pageContext": "Brief 1-2 sentence description of characters present and scene mood",
  "detectedCharacters": [
    { "nameOriginal": "original name", "nameArabic": "Arabic name", "gender": "male" | "female" | "unknown", "title": "optional title" }
  ],
  "detectedGlossaryTerms": [
    { "source": "original term", "arabic": "Arabic term", "category": "character|cultivation|technique|title|term" }
  ],
  "detectedRelationships": [
    { "speaker": "Speaker Name", "addressee": "Addressee Name", "tone": "respectful|hostile|casual", "pronouns": "أنتَ / أنتِ" }
  ],
  "bubbles": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "type": ${allowedTypeExamples},
      "typerPrefix": "Exact prefix string corresponding to matched typer, or empty string",
      "sourceLanguage": "ja" | "ko" | "zh" | "en",
      "sourceText": "Original detected dialogue",
      "translatedText": "Humanized Arabic translation"
    }
  ]
}
`.trim());

  // 9. Master Prompt Override (Unconditional Lead-Editor Priority)
  if (isMasterPromptActive && masterPromptOverride && masterPromptOverride.trim().length > 0) {
    sections.push(`
CRITICAL SYSTEM OVERRIDE: The following lead-editor instructions take unconditional priority over all baseline settings above (including Eloquence level, SFX rules, or default tone). Obey this Master Directive strictly:
${masterPromptOverride.trim()}
`.trim());
  }

  return sections.join('\n\n');
}

export interface VisualReviewPromptOptions {
  eloquenceLevel: EloquenceLevel;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
  projectLore?: ProjectLoreLedger | null;
  chapterIntelligence?: ChapterIntelligence | null;
  typers?: CustomTyperConfig[];
}

/**
 * Builds the Multimodal Visual Review instruction for a single page.
 * Evaluates the actual page image alongside existing bubble bounding boxes.
 */
export function buildVisualPageReviewInstruction(options: VisualReviewPromptOptions): string {
  const {
    eloquenceLevel,
    masterPromptOverride,
    isMasterPromptActive = false,
    projectLore,
    chapterIntelligence,
  } = options;

  const eloquence = ELOQUENCE_CONFIG[eloquenceLevel] || ELOQUENCE_CONFIG[2];
  const sections: string[] = [];

  sections.push(`
ROLE:
You are Dragonfly 44's Chief Visual QC Scanlation Inspector.
You are inspecting this comic/manga page image against a list of already detected bubbles and Arabic translations.

YOUR OBJECTIVE:
Visually verify every bubble against the artwork and find defects:
1. missed_bubble: Any speech bubble, narration box, or floating dialogue visible in the artwork that was SKIPPED. Provide its real bounding box [ymin, xmin, ymax, xmax] (0-1000 scale), source text, and suggested Arabic translation.
2. remove_bubble: Any detected box that is NOT dialogue (e.g. screentone noise, background art, motion lines, or environmental SFX mistaken for dialogue).
3. reading_order: Bubbles numbered out of sequence relative to conversational flow or visual panel boundaries.
4. grammar_gender: Any Arabic verb/pronoun mismatch with the physical character depicted speaking in that panel (e.g. addressing a female character with masculine verbs). Quote the visual character evidence.
5. overflow_warning: Arabic translation that is visibly too long to fit into the dialogue bubble in the artwork.
6. typer_tag: Incorrect prefix for the bubble shape (e.g. scream bubble tagged with speech prefix).
7. ocr_error: Misread glyphs or truncated source text.
8. ambiguous_flow: Awkward or robotic Arabic phrasing that needs scanlation polish.
`.trim());

  sections.push(`
TARGET ELOQUENCE PROFILE:
[${eloquence.label} // ${eloquence.arabicLabel}]
${eloquence.directive}
`.trim());

  sections.push(ARABIC_HUMANIZER_PROMPT_RULES);

  if (projectLore || chapterIntelligence) {
    const characters = [
      ...(projectLore?.characters || []),
      ...(chapterIntelligence?.characterRoster || []),
    ];
    if (characters.length > 0) {
      sections.push(`
KNOWN CHARACTERS TO ENFORCE:
${characters.map((c) => `- ${c.nameOriginal} => ${c.nameArabic} (${c.gender || 'unknown'})`).join('\n')}
`.trim());
    }
  }

  sections.push(`
OUTPUT FORMAT:
Return strictly valid JSON:
{
  "pageSummary": "Brief summary of visual QC inspection",
  "issues": [
    {
      "bubbleId": "ID of existing bubble, or 'new-missed-N' for unextracted bubbles",
      "category": "missed_bubble" | "remove_bubble" | "reading_order" | "grammar_gender" | "overflow_warning" | "typer_tag" | "ocr_error" | "ambiguous_flow",
      "severity": "blocker" | "warning" | "suggestion",
      "reasonAr": "شرح تفصيلي باللغة العربية لسبب التنبيه مع ذكر الدليل المرئي من الرسم",
      "evidence": "Visual cue or source text evidence observed in the artwork",
      "suggestedTextAr": "النص العربي المقترح كبديل إن وجد",
      "suggestedType": "speech_bubbles" | "shouting" | "thought_bubbles" | "square_bubbles" | "outside_text" | "none",
      "suggestedOrderIndex": 1,
      "missedBubbleCoords": [ymin, xmin, ymax, xmax]
    }
  ]
}
`.trim());

  if (isMasterPromptActive && masterPromptOverride && masterPromptOverride.trim().length > 0) {
    sections.push(`
CRITICAL SYSTEM OVERRIDE:
${masterPromptOverride.trim()}
`.trim());
  }

  return sections.join('\n\n');
}

export interface ChapterReviewPromptOptions {
  eloquenceLevel: EloquenceLevel;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
  projectLore?: ProjectLoreLedger | null;
  chapterIntelligence?: ChapterIntelligence | null;
}

/**
 * Builds the Chapter-Wide Proofreading & Continuity Audit instruction.
 * Evaluates the entire chapter's dialogue across all pages to ensure name, term, and tone consistency.
 */
export function buildChapterReviewSystemInstruction(options: ChapterReviewPromptOptions): string {
  const {
    eloquenceLevel,
    projectLore,
    chapterIntelligence,
    masterPromptOverride,
    isMasterPromptActive = false,
  } = options;

  const eloquence = ELOQUENCE_CONFIG[eloquenceLevel] || ELOQUENCE_CONFIG[2];
  const sections: string[] = [];

  sections.push(`
ROLE:
You are Dragonfly 44's Chief Quality Control (QC) Chapter Proofreader.
You are auditing the complete chapter dataset across all pages to enforce narrative continuity, character voices, and scanlation quality.

AUDIT CHECKLIST:
1. name_inconsistency: Character names or fantasy terms translated inconsistently across pages (e.g. Page 1 uses "لو تشين" while Page 4 uses "لو تشن").
2. reading_order: Cross-panel or inter-page conversational order anomalies.
3. grammar_gender: Arabic gender mismatch (masculine vs. feminine pronouns/verbs) between established speakers.
4. ambiguous_flow: Stiff, robotic, or confusing phrasing—propose a natural scanlation alternative.
5. ocr_error: Inconsistent or corrupted source transcriptions.
6. typer_tag: Incorrect typer tags violating character speaking patterns.
`.trim());

  sections.push(`
TARGET ELOQUENCE LEVEL:
[${eloquence.label} // ${eloquence.arabicLabel}]
${eloquence.directive}
`.trim());

  sections.push(ARABIC_HUMANIZER_PROMPT_RULES);

  if (projectLore || chapterIntelligence) {
    const characters = [
      ...(projectLore?.characters || []),
      ...(chapterIntelligence?.characterRoster || []),
    ];
    const terms = [
      ...(projectLore?.terms || []),
      ...(chapterIntelligence?.termsHarvested || []),
    ];

    sections.push(`
GLOSSARY & CHARACTER CONTINUITY TO ENFORCE:
Characters:
${characters.map((c) => `- ${c.nameOriginal} => ${c.nameArabic} (${c.gender || 'unknown'})`).join('\n') || 'None'}

Terms:
${terms.map((t) => `- ${t.termOriginal} => ${t.termArabic} [${t.category}]`).join('\n') || 'None'}
`.trim());
  }

  sections.push(`
OUTPUT FORMAT:
Return strictly valid JSON:
{
  "chapterSummary": "Brief overview of QC continuity findings",
  "flaggedBubbles": [
    {
      "bubbleId": "ID of existing bubble",
      "pageId": "pageId",
      "flags": [
        {
          "category": "name_inconsistency" | "reading_order" | "grammar_gender" | "ambiguous_flow" | "ocr_error" | "typer_tag",
          "severity": "blocker" | "warning" | "suggestion",
          "reasonAr": "شرح تفصيلي باللغة العربية لسبب التنبيه",
          "evidence": "Textual evidence from cross-page comparison",
          "suggestedTextAr": "النص العربي المقترح كبديل إن وجد",
          "suggestedType": "speech_bubbles" | "shouting" | "thought_bubbles" | "square_bubbles" | "outside_text" | "none",
          "suggestedOrderIndex": 1
        }
      ]
    }
  ]
}
`.trim());

  if (isMasterPromptActive && masterPromptOverride && masterPromptOverride.trim().length > 0) {
    sections.push(`
CRITICAL SYSTEM OVERRIDE:
${masterPromptOverride.trim()}
`.trim());
  }

  return sections.join('\n\n');
}

// Backward compatibility alias
export const buildReviewSystemInstruction = buildChapterReviewSystemInstruction;
