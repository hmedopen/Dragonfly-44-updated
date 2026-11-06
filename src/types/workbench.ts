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

export interface ReviewFlagItem {
  id: string;
  category: ReviewFlagCategory;
  reasonAr: string;         // Arabic explanation of why this was flagged
  suggestedTextAr?: string; // Proposed Arabic translation fix
  suggestedType?: BubbleType;
  suggestedOrderIndex?: number;
  status?: 'pending' | 'accepted' | 'dismissed';
}

export interface BubbleItem {
  id: string;
  pageId: string;
  index: number;
  box_2d: [number, number, number, number]; // Normalized [ymin, xmin, ymax, xmax] (0-1000)
  type: BubbleType;
  typerPrefix: TyperPrefix;
  sourceLanguage?: string;
  sourceText: string;
  originalSourceText: string;     // Cached from initial scan for 1-click revert
  translatedText: string;
  rawTranslatedText: string;      // Cached from initial scan for 1-click revert
  reviewFlags: ReviewFlagItem[];  // Supports multiple independent flags per bubble
}

export const BUBBLE_TYPE_CONFIG: Record<
  BubbleType,
  { label: string; prefix: TyperPrefix; sample: string }
> = {
  dialogue: { label: 'Dialogue ()', prefix: '():', sample: '()' },
  scream: { label: 'Scream {}', prefix: '{}:', sample: '{}' },
  box: { label: 'Box []', prefix: '[]:', sample: '[]' },
  thought: { label: 'Thought <>', prefix: '<>:', sample: '<>' },
  in_art: { label: 'In-Art #', prefix: '#:', sample: '#' },
  sfx: { label: 'SFX #', prefix: '#:', sample: '#' },
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

// Project Lore Ledger schemas for cross-chapter continuity
export interface CharacterLore {
  id: string;
  nameOriginal: string;
  nameArabic: string;
  gender?: 'male' | 'female' | 'other';
  title?: string;
  aliases?: string[];
}

export interface TermLore {
  id: string;
  termOriginal: string;
  termArabic: string;
  category: 'character' | 'cultivation' | 'fantasy' | 'title' | 'term' | string;
}

export interface SpeakerRelationshipLore {
  speaker: string;
  addressee: string;
  tone: string;
  pronouns?: string;
}

export interface ProjectLoreLedger {
  projectId: string;
  characters: CharacterLore[];
  terms: TermLore[];
  speakerRelationships: SpeakerRelationshipLore[];
  lastUpdated: number;
}

// Gemini 3+ Model Keys
export type GeminiModelKey =
  | 'gemini-3.1-flash-lite'
  | 'gemini-3.5-flash-lite'
  | 'gemini-3.5-flash'
  | 'gemini-3.5-pro'
  | 'gemini-3.6-flash'
  | 'gemini-3.8-flash'
  | 'gemini-3.1-pro'
  | 'custom';

export interface ModelQuotaConfig {
  name: string;
  rpm: number;
  tpm: number;
  rpd: number;
  description: string;
}

export const GEMINI_MODEL_PROFILES: Record<GeminiModelKey, ModelQuotaConfig> = {
  'gemini-3.1-flash-lite': {
    name: 'Gemini 3.1 Flash-Lite',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    description: 'High speed & high quota (Default)',
  },
  'gemini-3.5-flash-lite': {
    name: 'Gemini 3.5 Flash-Lite',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    description: 'Lightweight fast extraction',
  },
  'gemini-3.5-flash': {
    name: 'Gemini 3.5 Flash',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    description: 'Standard multimodal flash',
  },
  'gemini-3.5-pro': {
    name: 'Gemini 3.5 Pro',
    rpm: 2,
    tpm: 32_000,
    rpd: 50,
    description: 'Pro contextual reasoning',
  },
  'gemini-3.6-flash': {
    name: 'Gemini 3.6 Flash',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    description: 'Balanced localization workhorse',
  },
  'gemini-3.8-flash': {
    name: 'Gemini 3.8 Flash',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    description: 'Advanced reasoning & layout analysis',
  },
  'gemini-3.1-pro': {
    name: 'Gemini 3.1 Pro',
    rpm: 2,
    tpm: 32_000,
    rpd: 50,
    description: 'Maximum chapter-wide deep context',
  },
  custom: {
    name: 'Custom Model Endpoint',
    rpm: 15,
    tpm: 1_000_000,
    rpd: 1_500,
    description: 'Custom preview endpoint',
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
      'Elevated, majestic classical rhetoric suitable for ancient sages, martial masters, nobility, emperors, and cosmic lore.',
  },
};

export type PageScanStatus = 'unscanned' | 'scanning' | 'scanned' | 'error';

