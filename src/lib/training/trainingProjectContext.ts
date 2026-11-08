/**
 * Dragonfly 44 - Training Studio Project Context & Architectural Memory
 * Provides authoritative, task-scoped architectural rules and system invariants.
 * Prevents indiscriminate context dumping by serving precise system constraints.
 */

import type { TrainingTaskType } from '../../types/training';

export interface TaskSystemContext {
  task: TrainingTaskType;
  primarySystem: string;
  architecturalDirectives: string[];
  entityModelRules: string[];
  dataIntegrityInvariants: string[];
}

const TASK_CONTEXT_REGISTRY: Record<TrainingTaskType, TaskSystemContext> = {
  scanning_classification: {
    task: 'scanning_classification',
    primarySystem: 'System #3 (Manga Scanning & Classification Engine)',
    architecturalDirectives: [
      'Detect what is visibly present in the artwork. Never trade source fidelity for confident-looking output.',
      'Panels and text-bearing regions must be indexed with normalized 0-1000 integer bounding boxes [ymin, xmin, ymax, xmax].',
      'Classify text units into generic functional classes (dialogue, thought, narration, caption, vocalization, sfx, environmental_text, unknown) strictly decoupled from custom user typers.',
    ],
    entityModelRules: [
      'Panel candidates represent geometric frame boundaries.',
      'TextRegion candidates represent the bounding area of text glyphs within or outside balloons.',
      'Speaker candidates must reflect visible character cues in the artwork without inventing off-panel characters.',
    ],
    dataIntegrityInvariants: [
      'Coordinate scale must remain strictly within [0, 1000].',
      'Never omit visible text to simplify the scene.',
      'Classification must be generic and evidence-based.',
    ],
  },

  speech_balloon_detection: {
    task: 'speech_balloon_detection',
    primarySystem: 'System #3 (Physical Balloon & Translation Unit Boundary)',
    architecturalDirectives: [
      'CRITICAL BALLOON SEPARATION: Each physically distinct speech balloon must be detected as an independent region with its own bounding box.',
      'DOUBLE BALLOON INVARIANT: Connected, stacked, or adjacent balloons sharing a dialogue continuation are separate PhysicalBalloons, even if they belong to a single logical TranslationUnit.',
      'SINGLE BALLOON INTEGRATION: If multiple lines of text sit inside a single physical balloon boundary, output ONE region enclosing the entire balloon with all its text.',
      'Distinguish physical tails and bridges from the body of speech balloons.',
    ],
    entityModelRules: [
      'PhysicalBalloon: Represents the physical drawn bubble in the comic artwork.',
      'TranslationUnit (TU): Represents the logical translation entity that groups one or more physical balloons for cohesive translation.',
      'Balloon relationship: Use connected_tail or continuation to link secondary balloons back to the root speaker balloon.',
    ],
    dataIntegrityInvariants: [
      'Never merge two physically distinct balloons into one bounding box merely because their text forms a single sentence.',
      'Never split a single physical balloon into multiple boxes merely because it has multiple paragraphs.',
    ],
  },

  reading_order: {
    task: 'reading_order',
    primarySystem: 'System #3 (Hierarchical Reading Order Inference)',
    architecturalDirectives: [
      'Panel hierarchy takes absolute precedence: sequence panels first before ordering sub-bubbles within a panel.',
      'Manga Right-to-Left (RTL): Order panels and bubbles from top to bottom, right to left.',
      'Webtoon Vertical: Order sequentially from top to bottom along the scroll coordinate.',
      'Western Left-to-Right (LTR): Order from top to bottom, left to right.',
      'Conversational Flow: Order speaker before responder when visual cues indicate turn-taking.',
    ],
    entityModelRules: [
      'Reading order index is a 1-based sequential integer.',
      'Inter-panel bridges must connect to the containing panel of origin.',
    ],
    dataIntegrityInvariants: [
      'No cyclic reading order dependencies allowed.',
      'Reading convention candidates must be stated honestly based on visual layout evidence.',
    ],
  },

  ocr_text_region: {
    task: 'ocr_text_region',
    primarySystem: 'System #3 (Verbatim OCR Candidate Engine)',
    architecturalDirectives: [
      'Transcribe exact visible characters verbatim (Japanese kanji/kana, Korean hangul, Chinese hanzi, English).',
      'HONESTY IN AMBIGUITY: Never invent cut-off words, complete partial sentences, or silently fix perceived typos.',
      'When characters are ambiguous or blurry, record candidate readings in ocrAlternatives and set isAmbiguous: true.',
      'When text is clipped by panel boundaries or page trims, set isClipped: true.',
      'Detect vertical orientation (isVertical: true) for Japanese/traditional comic formatting.',
    ],
    entityModelRules: [
      'rawOCR represents the uncorrected verbatim transcription.',
      'ocrAlternatives captures valid visual interpretations under blur or distortion.',
    ],
    dataIntegrityInvariants: [
      'Never let AI hallucinate missing words to make grammatical sense.',
      'Raw source transcription must never be silently normalized or translated.',
    ],
  },

  sfx_classification: {
    task: 'sfx_classification',
    primarySystem: 'System #3 (Sound Effect & In-Art Text Engine)',
    architecturalDirectives: [
      'Distinguish environmental sound effects (rumble, wind, explosion) from character vocalizations (sigh, gasp, scream, laugh).',
      'Sound effects rendered directly into the illustration layer must be classified as "sfx".',
      'In-art environmental signage, book titles, and user interfaces must be classified as "environmental_text".',
      'Respect the pipeline SFX toggle: when SFX is disabled, environmental SFX must be excluded while dialogue and vocalizations remain.',
    ],
    entityModelRules: [
      'sfx: Acoustic/action sounds.',
      'vocalization: Human vocal sounds with emotional or speech intent.',
      'environmental_text: Scenery labels, street signs, screens.',
    ],
    dataIntegrityInvariants: [
      'Never misclassify spoken dialogue as SFX.',
      'Never discard vocalizations when SFX filtering is active.',
    ],
  },

  translation_quality: {
    task: 'translation_quality',
    primarySystem: 'System #2 (Translation & Eloquence Engine)',
    architecturalDirectives: [
      'Produce natural, dramatic Arabic scanlation that sounds authentic and idiomatic.',
      'Preserve correct Arabic orthography: retain required Hamzas (إلى، إن، أن، أحد) and meaningful Tanween (أخيراً، جداً).',
      'Normalize comic punctuation: convert em-dashes (—) to double dots (..) and semicolons (؛) to commas (،).',
      'Enforce character voice continuity across chapters and adhere to confirmed Project Lore terminology.',
      'Never infer regional dialect unless explicitly requested in master instructions.',
    ],
    entityModelRules: [
      'rawTranslatedText: Direct literary translation before humanization.',
      'humanizedTranslatedText: Polished scanlation output matching target eloquence profile.',
    ],
    dataIntegrityInvariants: [
      'Translations must preserve the dramatic intent of the source.',
      'Never alter character gender agreements when artwork or lore establishes character identity.',
    ],
  },

  review_qc: {
    task: 'review_qc',
    primarySystem: 'System #4 (Review & Quality Control Engine)',
    architecturalDirectives: [
      'Perform non-destructive quality evaluation across layout, OCR, translation, and consistency.',
      'Detect ambiguous OCR candidates and require explicit reviewer verification before approval.',
      'Maintain an immutable audit trail of review findings and corrections.',
      'Distinguish Introduced, Regression, and Pre-existing defects.',
    ],
    entityModelRules: [
      'ReviewFinding: Represents an identified quality issue with code, severity, and affected entity.',
      'ReviewSnapshot: Rollback checkpoint capturing page or chapter state prior to review changes.',
    ],
    dataIntegrityInvariants: [
      'Review suggestions must never overwrite manual user edits without confirmation.',
      'Defects must be classified by domain (layout, text, translation, formatting).',
    ],
  },
};

/**
 * Retrieves concise, task-specific architectural directives and invariants.
 */
export function getTaskArchitecturalContext(task: TrainingTaskType): TaskSystemContext {
  return (
    TASK_CONTEXT_REGISTRY[task] || {
      task,
      primarySystem: 'Dragonfly 44 Core Architecture',
      architecturalDirectives: ['Follow standard Dragonfly 44 high-fidelity scanning and translation rules.'],
      entityModelRules: [],
      dataIntegrityInvariants: ['Maintain source fidelity and structural integrity.'],
    }
  );
}

/**
 * Builds a formatted instruction block of authoritative project context for prompt compilation.
 */
export function formatProjectContextForPrompt(tasks: TrainingTaskType[]): string {
  if (!tasks || tasks.length === 0) return '';

  const uniqueTasks = Array.from(new Set(tasks));
  const sections: string[] = [];

  sections.push('=== AUTHORITATIVE PROJECT ARCHITECTURE & SYSTEM DIRECTIVES ===');

  for (const t of uniqueTasks) {
    const ctx = getTaskArchitecturalContext(t);
    sections.push(`[${ctx.primarySystem}]`);
    for (const d of ctx.architecturalDirectives) {
      sections.push(`- ${d}`);
    }
    if (ctx.entityModelRules.length > 0) {
      sections.push('Entity Rules:');
      for (const r of ctx.entityModelRules) {
        sections.push(`  * ${r}`);
      }
    }
    if (ctx.dataIntegrityInvariants.length > 0) {
      sections.push('Non-Negotiable Integrity Invariants:');
      for (const inv of ctx.dataIntegrityInvariants) {
        sections.push(`  ! ${inv}`);
      }
    }
    sections.push('');
  }

  return sections.join('\n').trim();
}
