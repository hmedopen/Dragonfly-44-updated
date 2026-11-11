export type BubbleType = string;

export type TyperPrefix = string;

export type ReviewFlagCategory =
  | 'missed_bubble'
  | 'reading_order'
  | 'remove_bubble'
  | 'ocr_error'
  | 'typer_tag'
  | 'name_inconsistency'
  | 'grammar_gender'
  | 'ambiguous_flow'
  | 'overflow_warning';

export type ReviewFlagSeverity = 'blocker' | 'warning' | 'suggestion';

export interface ReviewFlagItem {
  id: string;
  category: ReviewFlagCategory;
  severity?: ReviewFlagSeverity;
  reasonAr: string;         // Arabic explanation of why this was flagged
  suggestedTextAr?: string; // Proposed Arabic translation fix
  suggestedType?: BubbleType;
  suggestedOrderIndex?: number;
  status: 'pending' | 'accepted' | 'dismissed';
  evidence?: string;        // Visual cue or textual proof of the issue
  confidence?: number;      // 0.0 - 1.0 confidence score
  createdAt?: number;
  resolvedAt?: number;
  resolutionDetail?: string; // Description of how it was resolved (e.g. 'accepted_text_fix', 'manual_edit')
}

export interface TranslationHistoryEntry {
  timestamp: number;
  type: 'raw' | 'humanized' | 'manual';
  text: string;
}

export interface BubbleItem {
  id: string;
  pageId: string;
  chapterId?: string;
  index: number;
  box_2d: [number, number, number, number]; // Normalized [ymin, xmin, ymax, xmax] (0-1000)
  regionId?: string;              // Physical visual region identity (enables multiple split records per physical bubble)
  type: BubbleType;
  typerPrefix: TyperPrefix;
  sourceLanguage?: string;
  sourceText: string;
  originalSourceText: string;     // Cached from initial scan for 1-click revert
  translatedText: string;         // Current workspace translation (editable)
  rawTranslatedText: string;      // Cached unmodified model output before post-processing
  humanizedTranslatedText?: string;// Intermediate translation after humanizer
  translationHistory?: TranslationHistoryEntry[]; // Reversible history of translations
  reviewFlags: ReviewFlagItem[];  // Supports multiple independent flags per bubble
  speakerCharacterId?: string;    // Linked to Chapter/Project Lore
  confidence?: number;            // 0.0 - 1.0 detection confidence
  isManuallyEdited?: boolean;     // Guards against AI overwrite
  updatedAt?: number;
  provenance?: 'auto_scan' | 'manual_selection';
  manualSelectionShape?: 'box' | 'bubble' | 'lasso';
  manualPolygon?: Array<[number, number]>;
  manualColorSnapshot?: string;
  manualExtractionStatus?: 'created' | 'ocr_pending' | 'ocr_running' | 'ocr_success' | 'ocr_partial' | 'ocr_failed' | 'manual_text';
  manualExtractionError?: string | null;
  manualExtractedGeometrySignature?: string;
  manualTranslationStatus?: 'untranslated' | 'translating' | 'translated' | 'translation_failed';
  manualTranslationError?: string | null;
}

export const BUBBLE_TYPE_CONFIG: Record<
  string,
  { label: string; prefix: TyperPrefix; sample: string }
> = {
  dialogue: { label: 'Dialogue ""', prefix: '"":', sample: '""' },
  speech_bubbles: { label: 'Speech Bubbles ""', prefix: '"":', sample: '""' },
  scream: { label: 'Scream %', prefix: '%:', sample: '%' },
  shouting: { label: 'Shouting %', prefix: '%:', sample: '%' },
  box: { label: 'Box [ ]', prefix: '[ ]:', sample: '[ ]' },
  square_bubbles: { label: 'Square Bubbles [ ]', prefix: '[ ]:', sample: '[ ]' },
  thought: { label: 'Thought ()', prefix: '():', sample: '()' },
  thought_bubbles: { label: 'Thought Bubbles ()', prefix: '():', sample: '()' },
  outside_text: { label: 'Outside Text OT', prefix: 'OT:', sample: 'OT' },
  small_text: { label: 'Small Text ST', prefix: 'ST:', sample: 'ST' },
  system_messages: { label: 'System Messages $', prefix: '$:', sample: '$' },
  translator_notes: { label: 'Translator Notes T/N', prefix: 'T/N:', sample: 'T/N' },
  in_art: { label: 'In-Art OT', prefix: 'OT:', sample: 'OT' },
  sfx: { label: 'SFX', prefix: 'SFX:', sample: 'SFX' },
  none: { label: 'None', prefix: '', sample: 'None' },
};

export const REVIEW_CATEGORY_LABELS: Record<ReviewFlagCategory, string> = {
  missed_bubble: '[? MISSED BUBBLE]',
  reading_order: '[? READING ORDER]',
  remove_bubble: '[? REMOVE BUBBLE]',
  ocr_error: '[? OCR ERROR]',
  typer_tag: '[? TYPER TAG]',
  name_inconsistency: '[? NAME INCONSISTENCY]',
  grammar_gender: '[? GRAMMAR & GENDER]',
  ambiguous_flow: '[? AMBIGUOUS FLOW]',
  overflow_warning: '[? OVERFLOW WARNING]',
};

// Lore Provenance & Conflict Tracking
export interface LoreProvenance {
  sourceType: 'ai_detected' | 'user_defined' | 'review_derived' | 'project_preset';
  pageId?: string;
  bubbleId?: string;
  timestamp: number;
}

export interface LoreConflict {
  id: string;
  field: 'gender' | 'nameArabic' | 'termArabic' | 'relationship';
  existingValue: string;
  conflictingValue: string;
  detectedAtPageId: string;
  status: 'unresolved' | 'resolved_existing' | 'resolved_conflicting' | 'resolved_custom';
  resolvedValue?: string;
}

// Structured Character Knowledge
export interface CharacterLore {
  id: string;
  nameOriginal: string;
  nameArabic: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  title?: string;
  aliases?: string[];
  personalityNotes?: string;
  speakingCadence?: string;
  confidence?: number;
  provenance?: LoreProvenance;
  conflicts?: LoreConflict[];
}

// Structured Terminology Lore
export interface TermLore {
  id: string;
  termOriginal: string;
  termArabic: string;
  category: 'character' | 'cultivation' | 'fantasy' | 'title' | 'term' | 'technique' | 'place' | string;
  definition?: string;
  confidence?: number;
  provenance?: LoreProvenance;
  conflicts?: LoreConflict[];
}

// Speaker Relationship Lore
export interface SpeakerRelationshipLore {
  id?: string;
  speaker: string;
  addressee: string;
  tone: string;
  pronouns?: string; // e.g. "أنتَ" vs "أنتِ" or formal "حضرتك"
  hierarchy?: 'superior' | 'equal' | 'subordinate';
  confidence?: number;
  provenance?: LoreProvenance;
}

// Project Lore Ledger
export interface ProjectLoreLedger {
  projectId: string;
  characters: CharacterLore[];
  terms: TermLore[];
  speakerRelationships: SpeakerRelationshipLore[];
  lastUpdated: number;
}

// Chapter Intelligence Lifecycle Model
export interface ChapterIntelligence {
  chapterId: string;
  projectId?: string;
  summary: string;
  sceneFlow: string[];
  activeCharacters: string[];
  characterRoster: CharacterLore[];
  termsHarvested: TermLore[];
  speakerPairs: SpeakerRelationshipLore[];
  lastScannedPageIndex: number;
  lastUpdated: number;
}

// Verified Gemini Model Keys & Profile Specifications
export type GeminiModelKey =
  | 'gemini-3.8-flash'
  | 'gemini-3.1-flash-lite'
  | 'gemini-3.5-flash-lite'
  | 'gemini-3.5-flash'
  | 'gemini-3.5-pro'
  | 'gemini-3.6-flash'
  | 'gemini-3.1-pro'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'custom';

export interface ModelQuotaConfig {
  name: string;
  modelId: string;
  rpm: number;
  tpm: number;
  rpd: number;
  contextWindow: number;
  costTier: 'ultra_low' | 'low' | 'standard' | 'premium';
  description: string;
  isMultimodalVision: boolean;
}

/**
 * Gemini model catalog configuration.
 * NOTE: RPM, TPM, and RPD represent estimated provider baseline guidelines (F-24).
 * Actual rate limits and quotas are dynamic and project/tier-dependent as per official
 * Google AI documentation (https://ai.google.dev/gemini-api/docs/rate-limits).
 */
export const GEMINI_MODEL_PROFILES: Record<GeminiModelKey, ModelQuotaConfig> = {
  'gemini-3.8-flash': {
    name: 'Gemini 3.8 Flash',
    modelId: 'gemini-3.8-flash',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    contextWindow: 1_000_000,
    costTier: 'low',
    description: 'Premier vision-reasoning workhorse for manga layout and Arabic localization',
    isMultimodalVision: true,
  },
  'gemini-3.1-flash-lite': {
    name: 'Gemini 3.1 Flash-Lite',
    modelId: 'gemini-3.1-flash-lite',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    contextWindow: 1_000_000,
    costTier: 'ultra_low',
    description: 'High-speed batch scanning with low latency and high quota',
    isMultimodalVision: true,
  },
  'gemini-3.5-flash-lite': {
    name: 'Gemini 3.5 Flash-Lite',
    modelId: 'gemini-3.5-flash-lite',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    contextWindow: 1_000_000,
    costTier: 'ultra_low',
    description: 'Lightweight fast OCR and bubble extraction',
    isMultimodalVision: true,
  },
  'gemini-3.5-flash': {
    name: 'Gemini 3.5 Flash',
    modelId: 'gemini-3.5-flash',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    contextWindow: 1_000_000,
    costTier: 'low',
    description: 'Standard multimodal flash localization',
    isMultimodalVision: true,
  },
  'gemini-3.6-flash': {
    name: 'Gemini 3.6 Flash',
    modelId: 'gemini-3.6-flash',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    contextWindow: 1_000_000,
    costTier: 'low',
    description: 'Balanced multimodal workhorse for high-frequency scanlation',
    isMultimodalVision: true,
  },
  'gemini-3.5-pro': {
    name: 'Gemini 3.5 Pro',
    modelId: 'gemini-3.5-pro',
    rpm: 2,
    tpm: 32_000,
    rpd: 50,
    contextWindow: 2_000_000,
    costTier: 'premium',
    description: 'Deep contextual reasoning for complex chapters (Automatically rate-paced to 2 RPM)',
    isMultimodalVision: true,
  },
  'gemini-3.1-pro': {
    name: 'Gemini 3.1 Pro',
    modelId: 'gemini-3.1-pro',
    rpm: 2,
    tpm: 32_000,
    rpd: 50,
    contextWindow: 2_000_000,
    costTier: 'premium',
    description: 'Maximum context depth for overarching chapter continuity (Automatically rate-paced)',
    isMultimodalVision: true,
  },
  'gemini-2.5-flash': {
    name: 'Gemini 2.5 Flash',
    modelId: 'gemini-2.5-flash',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    contextWindow: 1_000_000,
    costTier: 'low',
    description: 'Stable legacy multimodal flash model',
    isMultimodalVision: true,
  },
  'gemini-2.5-pro': {
    name: 'Gemini 2.5 Pro',
    modelId: 'gemini-2.5-pro',
    rpm: 2,
    tpm: 32_000,
    rpd: 50,
    contextWindow: 2_000_000,
    costTier: 'premium',
    description: 'Stable legacy deep reasoning pro model',
    isMultimodalVision: true,
  },
  custom: {
    name: 'Custom Model Endpoint',
    modelId: 'custom',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    contextWindow: 1_000_000,
    costTier: 'standard',
    description: 'Custom preview endpoint or proxy model',
    isMultimodalVision: true,
  },
};

export type EloquenceLevel = 1 | 2 | 3;

export const ELOQUENCE_CONFIG: Record<
  EloquenceLevel,
  { label: string; arabicLabel: string; directive: string }
> = {
  1: {
    label: 'Casual Modern',
    arabicLabel: 'فصحى مبسطة وعفوية',
    directive:
      'Clean, everyday conversational Modern Standard Arabic without regional dialects (عامية) and without archaic vocabulary. Ideal for modern slice-of-life, contemporary urban settings, and fast banter.',
  },
  2: {
    label: 'Standard Scanlation Literary',
    arabicLabel: 'فصحى معيارية أدبية',
    directive:
      'Popular, natural, dramatic Arabic scanlation standard. Smooth, engaging, emotionally resonant, strictly non-literal, and accessible without obscure dictionary words.',
  },
  3: {
    label: 'High Classical / Majestic',
    arabicLabel: 'فصحى جزلة وبليغة',
    directive:
      'Elevated, majestic classical rhetoric suitable for ancient sages, martial masters, nobility, emperors, and cosmic lore. Preserves traditional dignified Arabic eloquence while strictly avoiding robotic AI filler.',
  },
};

export type PageScanStatus = 'unscanned' | 'scanning' | 'scanned' | 'error';

// ==========================================
// SYSTEM #2: AI INSTRUCTION & TRANSLATION ENGINE TYPES
// ==========================================

export type TranslationFidelity = 'faithful' | 'localized' | 'expressive';

export const TRANSLATION_FIDELITY_CONFIG: Record<
  TranslationFidelity,
  { label: string; arabicLabel: string; description: string; directive: string }
> = {
  faithful: {
    label: 'Faithful',
    arabicLabel: 'دقيق ومخلص للأصل',
    description: 'Preserves source meaning and structure as closely as natural Arabic permits.',
    directive:
      'Maintain close structural and semantic fidelity to the original dialogue. Preserve specific phrasings, pauses, and rhetorical cadence without adding unnecessary stylistic flourishes.',
  },
  localized: {
    label: 'Localized',
    arabicLabel: 'توطين درامي طبيعي',
    description: 'Adapts idioms, cultural expressions, and spoken nuances for Arabic scanlation.',
    directive:
      'Prioritize authentic Arabic scanlation localization. Rephrase foreign idioms into natural Arabic equivalents and ensure dialogue flows organically while strictly preserving narrative intent and emotional weight.',
  },
  expressive: {
    label: 'Expressive',
    arabicLabel: 'تعبيري حيوي ومؤثر',
    description: 'Maximizes emotional resonance, dramatic punch, and character personality.',
    directive:
      'Heighten dramatic tension, comedic punch, and character idiosyncrasies. Use evocative Arabic expressions that maximize emotional engagement while remaining faithful to the core scene meaning.',
  },
};

export type HumanizerIntensity = 'light' | 'balanced' | 'strong' | 'maximum';

export const HUMANIZER_INTENSITY_CONFIG: Record<
  HumanizerIntensity,
  { label: string; arabicLabel: string; description: string }
> = {
  light: {
    label: 'Light',
    arabicLabel: 'خفيف',
    description: 'Minimal intervention; fixes only blatant AI sentence templates and corrupt spacing.',
  },
  balanced: {
    label: 'Balanced',
    arabicLabel: 'متوازن (موصى به)',
    description: 'Standard scanlation polish; eliminates synthetic fillers while preserving source cadence and character voice.',
  },
  strong: {
    label: 'Strong',
    arabicLabel: 'قوي',
    description: 'Substantial naturalization of rhythm, connectors, and spoken flow.',
  },
  maximum: {
    label: 'Maximum',
    arabicLabel: 'أقصى تنقيح',
    description: 'Maximum effort to eliminate any trace of machine translation while strictly preserving meaning and terminology.',
  },
};

export type OrthographyMode = 'correct_spelling' | 'relaxed';

export const ORTHOGRAPHY_CONFIG: Record<
  OrthographyMode,
  { label: string; description: string }
> = {
  correct_spelling: {
    label: 'Correct Arabic Orthography',
    description: 'Strictly preserves legitimate hamza distinctions (أ، إ، آ، ؤ، ئ), shadda, and meaningful tanween.',
  },
  relaxed: {
    label: 'Relaxed Comic Typography',
    description: 'Permits informal typographical simplifications standard in fast webtoon typesetting while preventing corruption.',
  },
};

export type HumanizerRuleCategory =
  | 'ai_patterns'
  | 'connectors'
  | 'vocabulary'
  | 'sentence_structure'
  | 'redundancy'
  | 'dialogue_naturalness'
  | 'narration_naturalness'
  | 'emotional_expression'
  | 'grammar_agreement'
  | 'punctuation'
  | 'hamza_orthography'
  | 'diacritics_tanween'
  | 'repetition_rhythm'
  | 'idioms_expressions'
  | 'dialect_preservation'
  | 'character_voice';

export type RestrictionLevel = 'strict' | 'moderate' | 'light' | 'context_dependent';

export interface HumanizerRule {
  id: string;
  category: HumanizerRuleCategory;
  name: string;
  description: string;
  restrictionLevel: RestrictionLevel;
  applicability: 'dialogue' | 'narration' | 'dialect' | 'all';
  detectionConditions?: string;
  preferredBehavior: string;
  exceptions?: string;
  badExample?: string;
  goodExample?: string;
  conflictBehavior?: string;
}

export interface System2Settings {
  eloquenceLevel: EloquenceLevel;
  translationFidelity: TranslationFidelity;
  isHumanizerEnabled: boolean;
  humanizerIntensity: HumanizerIntensity;
  orthographyMode: OrthographyMode;
  masterPromptOverride: string;
  isMasterPromptActive: boolean;
}

export interface CompiledInstructionPackage {
  systemInstruction: string;
  effectiveEloquence: EloquenceLevel;
  effectiveFidelity: TranslationFidelity;
  effectiveIntensity: HumanizerIntensity;
  isMasterPromptApplied: boolean;
  isDialectActive: boolean;
  detectedDialect?: string;
  appliedRuleIds: string[];
  outputContract: string;
}
