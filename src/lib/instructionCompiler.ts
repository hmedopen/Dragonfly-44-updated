import type {
  EloquenceLevel,
  TranslationFidelity,
  HumanizerIntensity,
  OrthographyMode,
  ProjectLoreLedger,
  ChapterIntelligence,
  CompiledInstructionPackage,
} from '../types/workbench';
import { ELOQUENCE_CONFIG, TRANSLATION_FIDELITY_CONFIG } from '../types/workbench';
import type { CustomTyperConfig } from '../types/typers';
import { compileHumanizerPromptDirectives } from './humanizerRulebook';

export interface SingleBubblePromptContext {
  index: number;
  type: string;
  typerPrefix?: string;
  sourceText?: string;
  pageContextText?: string;
  reviewNotesText?: string;
}

export interface InstructionCompilerOptions {
  task: 'page_scan' | 'single_bubble' | 'batch_translation' | 'visual_review' | 'chapter_review';
  eloquenceLevel?: EloquenceLevel;
  translationFidelity?: TranslationFidelity;
  isHumanizerEnabled?: boolean;
  humanizerIntensity?: HumanizerIntensity;
  orthographyMode?: OrthographyMode;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
  projectLore?: ProjectLoreLedger | null;
  chapterIntelligence?: ChapterIntelligence | null;
  projectMemoryPromptContext?: string;
  rollingContextSnippet?: string;
  typers?: CustomTyperConfig[];
  includeSFX?: boolean;
  singleBubbleContext?: SingleBubblePromptContext;
}

/**
 * Detects whether the user explicitly requested a regional Arabic dialect in their Master Prompt.
 * In accordance with System #2 Refinement #2:
 * "Never infer a regional dialect solely from isolated vocabulary. Respect explicit user instructions
 * and distinguish confirmed dialect requirements from uncertain context."
 */
export function detectExplicitDialect(promptText?: string): { isDialect: boolean; dialectName?: string } {
  if (!promptText || promptText.trim().length === 0) {
    return { isDialect: false };
  }

  const normalized = promptText.toLowerCase();

  // Explicit dialect indicators
  if (
    normalized.includes('جزائري') ||
    normalized.includes('الجزائرية') ||
    normalized.includes('دارجة') ||
    normalized.includes('algerian') ||
    normalized.includes('darija')
  ) {
    return { isDialect: true, dialectName: 'Algerian Arabic (الدارجة الجزائرية)' };
  }

  if (
    normalized.includes('مصري') ||
    normalized.includes('المصرية') ||
    normalized.includes('عامية مصرية') ||
    normalized.includes('egyptian')
  ) {
    return { isDialect: true, dialectName: 'Egyptian Arabic (العامية المصرية)' };
  }

  if (
    normalized.includes('شامي') ||
    normalized.includes('سوري') ||
    normalized.includes('لبناني') ||
    normalized.includes('levantine')
  ) {
    return { isDialect: true, dialectName: 'Levantine Arabic (اللهجة الشامية)' };
  }

  if (
    normalized.includes('لهجة') ||
    normalized.includes('عامية') ||
    normalized.includes('dialect') ||
    normalized.includes('colloquial')
  ) {
    return { isDialect: true, dialectName: 'Regional Dialect' };
  }

  return { isDialect: false };
}

/**
 * INSTRUCTION COMPILER
 * Assembles a unified, hierarchically disciplined instruction package.
 * Priority: Master Prompt Override > Presets/Fidelity > Genre/Lore > Humanizer > Default.
 */
export function compileInstructions(options: InstructionCompilerOptions): CompiledInstructionPackage {
  const {
    task,
    eloquenceLevel = 2,
    translationFidelity = 'localized',
    isHumanizerEnabled = true,
    humanizerIntensity = 'balanced',
    orthographyMode = 'correct_spelling',
    masterPromptOverride = '',
    isMasterPromptActive = true,
    projectLore,
    chapterIntelligence,
    projectMemoryPromptContext,
    rollingContextSnippet,
    typers = [],
    includeSFX = false,
  } = options;

  const sections: string[] = [];
  const appliedRuleIds: string[] = [];

  // 1. Resolve Eloquence & Fidelity
  const eloquence = ELOQUENCE_CONFIG[eloquenceLevel] || ELOQUENCE_CONFIG[2];
  const fidelity = TRANSLATION_FIDELITY_CONFIG[translationFidelity] || TRANSLATION_FIDELITY_CONFIG.localized;

  // 2. Resolve Master Prompt & Dialect Status
  const isMasterArmed = Boolean(isMasterPromptActive && masterPromptOverride && masterPromptOverride.trim().length > 0);
  const dialectInfo = isMasterArmed ? detectExplicitDialect(masterPromptOverride) : { isDialect: false };

  // 3. Task Definition Section
  if (task === 'page_scan') {
    sections.push(`
ROLE & MISSION:
You are Folio Script's elite comic/manga scanlation localization engine.
In a high-precision pass on this page scan, you must:
1. Detect all speech bubbles, narration boxes, shouts, thoughts, and floating text with normalized bounding boxes [ymin, xmin, ymax, xmax] on a 0-1000 scale.
2. Determine correct narrative reading order (Manga: Right-to-Left, Top-to-Bottom within panels; Webtoon: Top-to-Bottom).
3. Classify each text unit into the appropriate configured Typer based on visual shape, typography, and functional context.
4. Translate each text into natural, emotionally authentic Arabic matching scene mood and character voices.
5. Ingest character names, fantasy terms, and speaker relationships for cross-page continuity.
`.trim());

    sections.push(`
VISUAL SCENE ANALYSIS & READING ORDER:
- Sequence bubbles strictly in conversational order (speaker before responder).
- Respect comic panel borders: read panels in narrative sequence before reading sub-bubbles inside a panel.
- Identify speaker identities and genders directly from the artwork to enforce accurate Arabic verb and pronoun agreements.
`.trim());
  } else if (task === 'single_bubble') {
    sections.push(`
ROLE & MISSION:
You are Folio Script's targeted dialogue translation engine.
Your sole mission is to translate a specific comic speech bubble into natural, expressive Arabic.
- Preserve the exact meaning, conversational tone, and character voice of the source dialogue.
- Respect surrounding dialogue context and resolve any audit notes for this bubble.
- Produce a single, polished Arabic translation without wrapping commentary.
`.trim());
  } else if (task === 'batch_translation') {
    sections.push(`
ROLE & MISSION:
You are Folio Script's dedicated Batch Dialogue Translation Engine (System #2).
Your task is to take an ordered list of verified dialogue bubbles identified by unique IDs, and translate them into dramatic, natural Arabic scanlation format.
- Output MUST strictly be a JSON object containing a "translations" array of objects with "id" and "translatedText".
- Do NOT perform visual region detection or emit bounding boxes.
- Translate every requested bubble ID faithfully without omitting or hallucinating bubble IDs.
- Preserve emotional nuances, comedic timing, shouts, whispers, and character voice.
`.trim());
  } else if (task === 'visual_review') {
    sections.push(`
ROLE:
You are Folio Script's Chief Visual QC Scanlation Inspector.
You are inspecting this comic/manga page image against a list of already detected bubbles and Arabic translations.
Visually verify every bubble against the artwork and find defects: missed_bubble, remove_bubble, reading_order, grammar_gender, overflow_warning, typer_tag, ocr_error, ambiguous_flow.
`.trim());
  } else if (task === 'chapter_review') {
    sections.push(`
ROLE:
You are Folio Script's Chief Quality Control (QC) Chapter Proofreader.
You are auditing the complete chapter dataset across all pages to enforce narrative continuity, character voices, and scanlation quality.
Checklist: name_inconsistency, reading_order, grammar_gender, ambiguous_flow, ocr_error, typer_tag.
`.trim());
  }

  // 4. Typer Classification Rules (Page Scan only)
  if (task === 'page_scan') {
    const eligibleTypers = typers.filter((t) => t.instructions && t.instructions.trim().length > 0);

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
4. Return the configured prefix exactly, including its colon and the colon's position.
${
  includeSFX
    ? '5. Environmental sound effects (SFX) should be classified under the corresponding SFX typer.'
    : '5. Sound Effects Filter is OFF: Completely ignore background environmental SFX unless drawn as integral vocal speech.'
}
`.trim());
    } else {
      sections.push(`
TYPER CLASSIFICATION RULES:
No configured typers are eligible for automatic classification. Set type: "none" and typerPrefix: "" for all bubbles.
`.trim());
    }
  }

  // 5. Eloquence & Fidelity Directives
  sections.push(`
ARABIC SCANLATION DIRECTIVE & REGISTER:
Eloquence Level: [${eloquence.label} // ${eloquence.arabicLabel}]
${eloquence.directive}

Translation Fidelity: [${fidelity.label} // ${fidelity.arabicLabel}]
${fidelity.directive}

Core Linguistic Principles:
- Non-literal adaptation: adapt foreign idioms into natural Arabic equivalents; avoid stiff word-for-word translation.
- Strict gender agreement: match Arabic pronouns and verbs (أنتَ vs أنتِ, قال vs قالت) to characters depicted in the scene.
- Orthography: ${orthographyMode === 'correct_spelling' ? 'Maintain correct Arabic spelling, legitimate hamzas (أ، إ، آ، ؤ، ئ), and essential adverbs with tanween.' : 'Clean readable typography for fast comic typesetting.'}
`.trim());

  // 6. Arabic Humanizer Directives
  if (isHumanizerEnabled) {
    const humanizerDirectives = compileHumanizerPromptDirectives({
      intensity: humanizerIntensity,
      isDialectActive: dialectInfo.isDialect,
      textType: task === 'single_bubble' ? 'dialogue' : 'all',
      masterPromptOverride: isMasterArmed ? masterPromptOverride : undefined,
    });
    sections.push(humanizerDirectives);
  }

  // 7. Rolling Sequential Chapter Context
  if (rollingContextSnippet && rollingContextSnippet.trim().length > 0) {
    sections.push(`
ROLLING CHAPTER CONTEXT & PRECEDING DIALOGUE:
${rollingContextSnippet.trim()}
Use this preceding context to maintain conversational continuity, character pronouns, and speaking styles.
`.trim());
  }

  // 8. Project Lore & Character Continuity
  if (projectMemoryPromptContext && projectMemoryPromptContext.trim().length > 0) {
    sections.push(projectMemoryPromptContext.trim());
  } else {
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
      const charList = Array.from(
        new Set(
          characters.map(
            (c) =>
              `- ${c.nameOriginal} => ${c.nameArabic} (${c.gender || 'unknown'}${c.title ? `, ${c.title}` : ''})`
          )
        )
      ).join('\n');

      const termList = Array.from(
        new Set(terms.map((t) => `- ${t.termOriginal} => ${t.termArabic} [${t.category}]`))
      ).join('\n');

      const relList = Array.from(
        new Set(
          relationships.map(
            (r) =>
              `- ${r.speaker} to ${r.addressee}: Tone: ${r.tone}${r.pronouns ? `, Pronouns: ${r.pronouns}` : ''}`
          )
        )
      ).join('\n');

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
  }

  // 9. Output Schema Contract
  let outputContract = '';
  if (task === 'page_scan') {
    const eligibleTypers = typers.filter((t) => t.instructions && t.instructions.trim().length > 0);
    const allowedTypeExamples =
      eligibleTypers.length > 0
        ? eligibleTypers.map((t) => `"${t.id}"`).join(' | ') + ' | "none"'
        : '"none"';

    outputContract = `
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
`.trim();
    sections.push(outputContract);
  } else if (task === 'single_bubble') {
    outputContract = `
OUTPUT FORMAT:
Return strictly valid JSON with no markdown formatting:
{
  "sourceText": "Original dialogue text (if vision transcribe was required)",
  "translatedText": "Humanized Arabic translation"
}
`.trim();
    sections.push(outputContract);
  }

  // 10. Master Prompt Override (Highest Lead-Editor Priority)
  if (isMasterArmed) {
    sections.push(`
CRITICAL SYSTEM OVERRIDE (HIGHEST PRIORITY):
The following lead-editor instructions take unconditional priority over all baseline settings above (including Eloquence level, translation fidelity, default tone, or humanizer preferences). Obey this Master Directive strictly:
${masterPromptOverride.trim()}
`.trim());
  }

  return {
    systemInstruction: sections.join('\n\n'),
    effectiveEloquence: eloquenceLevel,
    effectiveFidelity: translationFidelity,
    effectiveIntensity: humanizerIntensity,
    isMasterPromptApplied: isMasterArmed,
    isDialectActive: dialectInfo.isDialect,
    detectedDialect: dialectInfo.dialectName,
    appliedRuleIds,
    outputContract,
  };
}
