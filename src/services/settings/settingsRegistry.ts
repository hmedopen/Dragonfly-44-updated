/**
 * Folio Script: System #6 — Settings, Workspace & Quality Benchmark Engine
 * Authoritative Settings Registry
 * 
 * Central catalog of every typed setting across Systems #2–#6,
 * with validation, scopes, apply modes, defaults, and runtime bindings.
 */

import type { SettingDefinition } from '../../types/settings';
import { GEMINI_MODEL_PROFILES } from '../../types/workbench';

export const SETTINGS_REGISTRY: Record<string, SettingDefinition> = {
  // ==========================================
  // GENERAL / SECRETS
  // ==========================================
  'general.gemini_api_key': {
    setting_id: 'general.gemini_api_key',
    owner_system: 'general',
    type: 'string',
    default_value: '',
    apply_mode: 'immediate',
    scope: ['global'],
    visibility: 'basic',
    runtime_binding: 'GeminiClient.ApiKey',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Gemini API Key',
    description: 'API key for Google Gemini vision and translation requests.',
    category: 'general',
    validation: (val: string) => {
      const sanitized = typeof val === 'string' ? val.trim() : '';
      return { valid: true, sanitizedValue: sanitized };
    },
  },

  // ==========================================
  // SYSTEM #2: TRANSLATION & HUMANIZER
  // ==========================================
  'translation.model': {
    setting_id: 'translation.model',
    owner_system: 'system_2',
    type: 'enum',
    default_value: 'gemini-3.8-flash',
    allowed_values: Object.keys(GEMINI_MODEL_PROFILES),
    apply_mode: 'next_operation',
    scope: ['global', 'project'],
    visibility: 'basic',
    runtime_binding: 'System2.TranslationModel',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Vision & Translation Model',
    description: 'Multimodal model used for OCR, spatial comprehension, and localization.',
    category: 'translation',
    validation: (val: string) => {
      const keys = Object.keys(GEMINI_MODEL_PROFILES);
      if (keys.includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: `Invalid model: ${val}`, sanitizedValue: 'gemini-3.8-flash' };
    },
  },
  'translation.custom_model': {
    setting_id: 'translation.custom_model',
    owner_system: 'system_2',
    type: 'string',
    default_value: '',
    apply_mode: 'next_operation',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'System2.CustomModelEndpoint',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Custom Model Endpoint',
    description: 'Preview endpoint or custom model identifier when Custom Model is selected.',
    category: 'translation',
    validation: (val: string) => ({
      valid: true,
      sanitizedValue: typeof val === 'string' ? val.trim() : '',
    }),
  },
  'translation.eloquence': {
    setting_id: 'translation.eloquence',
    owner_system: 'system_2',
    type: 'integer',
    default_value: 2,
    range: { min: 1, max: 3, step: 1 },
    allowed_values: [1, 2, 3],
    apply_mode: 'next_operation',
    scope: ['global', 'project', 'chapter'],
    visibility: 'basic',
    runtime_binding: 'System2.EloquenceLevel',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Arabic Eloquence Level',
    description: '1 = Casual Modern, 2 = Standard Scanlation Literary, 3 = High Classical/Majestic.',
    category: 'translation',
    validation: (val: number) => {
      const n = Number(val);
      if (n === 1 || n === 2 || n === 3) {
        return { valid: true, sanitizedValue: n };
      }
      return { valid: false, error: 'Eloquence must be 1, 2, or 3', sanitizedValue: 2 };
    },
  },
  'translation.fidelity': {
    setting_id: 'translation.fidelity',
    owner_system: 'system_2',
    type: 'enum',
    default_value: 'localized',
    allowed_values: ['faithful', 'localized', 'expressive'],
    apply_mode: 'next_operation',
    scope: ['global', 'project', 'chapter'],
    visibility: 'basic',
    runtime_binding: 'System2.TranslationFidelity',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Translation Fidelity',
    description: 'Faithful (literal-leaning), Localized (smooth scanlation), Expressive (dramatic punch).',
    category: 'translation',
    validation: (val: string) => {
      if (['faithful', 'localized', 'expressive'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid fidelity mode', sanitizedValue: 'localized' };
    },
  },
  'translation.humanizer_enabled': {
    setting_id: 'translation.humanizer_enabled',
    owner_system: 'system_2',
    type: 'boolean',
    default_value: true,
    apply_mode: 'next_operation',
    scope: ['global', 'project', 'chapter'],
    visibility: 'basic',
    runtime_binding: 'System2.HumanizerEnabled',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Enable Arabic Humanizer',
    description: 'Eliminates AI translation templates and synthesizes natural scanlator cadence.',
    category: 'translation',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'translation.humanizer_intensity': {
    setting_id: 'translation.humanizer_intensity',
    owner_system: 'system_2',
    type: 'enum',
    default_value: 'balanced',
    allowed_values: ['light', 'balanced', 'strong', 'maximum'],
    apply_mode: 'next_operation',
    scope: ['global', 'project', 'chapter'],
    visibility: 'advanced',
    runtime_binding: 'System2.HumanizerIntensity',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Humanizer Intensity Profile',
    description: 'Controls the strength of connector naturalization and spoken rhythm adjustments.',
    category: 'translation',
    validation: (val: string) => {
      if (['light', 'balanced', 'strong', 'maximum'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid intensity', sanitizedValue: 'balanced' };
    },
  },
  'translation.orthography_mode': {
    setting_id: 'translation.orthography_mode',
    owner_system: 'system_2',
    type: 'enum',
    default_value: 'correct_spelling',
    allowed_values: ['correct_spelling', 'relaxed'],
    apply_mode: 'next_operation',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'System2.OrthographyMode',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Arabic Orthography Mode',
    description: 'Strictly preserve hamzas and tanween vs. permit informal comic typesetting.',
    category: 'translation',
    validation: (val: string) => {
      if (['correct_spelling', 'relaxed'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid orthography mode', sanitizedValue: 'correct_spelling' };
    },
  },
  'translation.master_prompt_override': {
    setting_id: 'translation.master_prompt_override',
    owner_system: 'system_2',
    type: 'string',
    default_value: '',
    apply_mode: 'next_operation',
    scope: ['global', 'project', 'chapter'],
    visibility: 'advanced',
    runtime_binding: 'System2.MasterPromptOverride',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Master Prompt Directive',
    description: 'Highest-priority prompt block injected into model instructions.',
    category: 'translation',
    validation: (val: string) => ({
      valid: true,
      sanitizedValue: typeof val === 'string' ? val : '',
    }),
  },
  'translation.master_prompt_active': {
    setting_id: 'translation.master_prompt_active',
    owner_system: 'system_2',
    type: 'boolean',
    default_value: true,
    apply_mode: 'next_operation',
    scope: ['global', 'project', 'chapter'],
    visibility: 'advanced',
    runtime_binding: 'System2.MasterPromptActive',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Arm Master Prompt Override',
    description: 'When disarmed, master prompt directives are temporarily bypassed.',
    category: 'translation',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },

  // ==========================================
  // SYSTEM #3: SCANNING & CLASSIFICATION
  // ==========================================
  'scanning.profile': {
    setting_id: 'scanning.profile',
    owner_system: 'system_3',
    type: 'enum',
    default_value: 'balanced',
    allowed_values: ['fast', 'balanced', 'high_accuracy'],
    apply_mode: 'next_operation',
    scope: ['global', 'project'],
    visibility: 'basic',
    runtime_binding: 'System3.ScanProfile',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Scanning Profile',
    description: 'Fast (single-pass), Balanced (standard + targeted retries), High Accuracy (exhaustive verification).',
    category: 'scanning',
    validation: (val: string) => {
      if (['fast', 'balanced', 'high_accuracy'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid scan profile', sanitizedValue: 'balanced' };
    },
  },
  'scanning.reading_convention': {
    setting_id: 'scanning.reading_convention',
    owner_system: 'system_3',
    type: 'enum',
    default_value: 'auto',
    allowed_values: ['auto', 'manga_rtl', 'webtoon_v', 'ltr'],
    apply_mode: 'next_operation',
    scope: ['global', 'project', 'chapter'],
    visibility: 'basic',
    runtime_binding: 'System3.ReadingConvention',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Reading Order Convention',
    description: 'Auto-detect layout vs. enforce Manga Right-to-Left, Webtoon Vertical Strip, or LTR.',
    category: 'scanning',
    validation: (val: string) => {
      if (['auto', 'manga_rtl', 'webtoon_v', 'ltr'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid reading convention', sanitizedValue: 'auto' };
    },
  },
  'scanning.include_sfx': {
    setting_id: 'scanning.include_sfx',
    owner_system: 'system_3',
    type: 'boolean',
    default_value: true,
    apply_mode: 'next_operation',
    scope: ['global', 'project', 'chapter'],
    visibility: 'basic',
    runtime_binding: 'System3.IncludeSFX',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Extract SFX and Sound Elements',
    description: 'Include sound effects and in-art vocalizations in scanning and dialogue list.',
    category: 'scanning',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'scanning.ocr_confidence_threshold': {
    setting_id: 'scanning.ocr_confidence_threshold',
    owner_system: 'system_3',
    type: 'decimal',
    default_value: 0.70,
    range: { min: 0.10, max: 0.99, step: 0.05 },
    apply_mode: 'next_operation',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'System3.OcrConfidenceThreshold',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'OCR Confidence Threshold',
    description: 'Confidence below this threshold flags the region for crop retry or review inspection.',
    unit: 'ratio',
    category: 'scanning',
    validation: (val: number) => {
      const n = Number(val);
      if (!isNaN(n) && n >= 0.1 && n <= 1.0) {
        return { valid: true, sanitizedValue: Math.round(n * 100) / 100 };
      }
      return { valid: false, error: 'Must be between 0.10 and 1.00', sanitizedValue: 0.70 };
    },
  },
  'scanning.enable_crop_retries': {
    setting_id: 'scanning.enable_crop_retries',
    owner_system: 'system_3',
    type: 'boolean',
    default_value: true,
    apply_mode: 'next_operation',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'System3.EnableCropRetries',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Targeted High-Res Crop Retries',
    description: 'Automatically re-crops low-confidence or tiny dialogue bubbles at native resolution.',
    category: 'scanning',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'scanning.max_crop_retries': {
    setting_id: 'scanning.max_crop_retries',
    owner_system: 'system_3',
    type: 'integer',
    default_value: 3,
    range: { min: 1, max: 5, step: 1 },
    apply_mode: 'next_operation',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'System3.MaxCropRetries',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Max Crop Retries Per Page',
    description: 'Upper bound on targeted high-resolution crops per scanned page to prevent quota spikes.',
    unit: 'retries',
    category: 'scanning',
    validation: (val: number) => {
      const n = Math.round(Number(val));
      if (!isNaN(n) && n >= 1 && n <= 10) {
        return { valid: true, sanitizedValue: n };
      }
      return { valid: false, error: 'Must be between 1 and 10', sanitizedValue: 3 };
    },
  },
  'scanning.source_language': {
    setting_id: 'scanning.source_language',
    owner_system: 'system_3',
    type: 'enum',
    default_value: 'auto',
    allowed_values: ['en', 'ko', 'ja', 'zh', 'auto'],
    apply_mode: 'next_operation',
    scope: ['global', 'project', 'chapter'],
    visibility: 'basic',
    runtime_binding: 'System3.SourceLanguage',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Source Language',
    description: 'Primary language of the source pages used for OCR routing and extraction.',
    category: 'scanning',
    validation: (val: string) => {
      if (['en', 'ko', 'ja', 'zh', 'auto'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid source language', sanitizedValue: 'auto' };
    },
  },

  // ==========================================
  // SYSTEM #4: REVIEW & QUALITY CONTROL
  // ==========================================
  'review.profile': {
    setting_id: 'review.profile',
    owner_system: 'system_4',
    type: 'enum',
    default_value: 'balanced',
    allowed_values: ['conservative', 'balanced', 'thorough'],
    apply_mode: 'next_operation',
    scope: ['global', 'project'],
    visibility: 'basic',
    runtime_binding: 'System4.ReviewProfile',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Review Strictness Profile',
    description: 'Conservative (blockers only), Balanced (standard scanlation QC), Thorough (all stylistic nuances).',
    category: 'review',
    validation: (val: string) => {
      if (['conservative', 'balanced', 'thorough'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid review profile', sanitizedValue: 'balanced' };
    },
  },
  'review.auto_correction_eligibility': {
    setting_id: 'review.auto_correction_eligibility',
    owner_system: 'system_4',
    type: 'boolean',
    default_value: false,
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'basic',
    runtime_binding: 'System4.AutoCorrectionEligibility',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Permit Automated Correction Batching',
    description: 'Allows verified mechanical corrections (e.g. typos, whitespace) without manual 1-by-1 clicks.',
    category: 'review',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'review.ambiguous_ocr_abstention': {
    setting_id: 'review.ambiguous_ocr_abstention',
    owner_system: 'system_4',
    type: 'boolean',
    default_value: true,
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'System4.AmbiguousOcrAbstention',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Source Reliability Gate (Abstain on Ambiguous OCR)',
    description: 'Reviewer strictly abstains from flagging semantic mistranslations when source OCR is illegible.',
    category: 'review',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'review.severity_threshold': {
    setting_id: 'review.severity_threshold',
    owner_system: 'system_4',
    type: 'enum',
    default_value: 'moderate',
    allowed_values: ['critical', 'major', 'moderate', 'minor', 'informational'],
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'System4.SeverityThreshold',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Review Severity Filter',
    description: 'Minimum severity level displayed in the workspace dialogue feed flags.',
    category: 'review',
    validation: (val: string) => {
      if (['critical', 'major', 'moderate', 'minor', 'informational'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid severity threshold', sanitizedValue: 'moderate' };
    },
  },

  // ==========================================
  // SYSTEM #5: PROJECT MEMORY & INTEGRITY
  // ==========================================
  'memory.learning_mode': {
    setting_id: 'memory.learning_mode',
    owner_system: 'system_5',
    type: 'enum',
    default_value: 'candidate_only',
    allowed_values: ['candidate_only', 'autonomous_observed', 'disabled'],
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'basic',
    runtime_binding: 'System5.LearningMode',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Knowledge Learning Mode',
    description: 'Candidate Only (user must approve lore), Autonomous (system auto-accepts high-confidence lore), Disabled.',
    category: 'memory',
    validation: (val: string) => {
      if (['candidate_only', 'autonomous_observed', 'disabled'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid learning mode', sanitizedValue: 'candidate_only' };
    },
  },
  'memory.approval_strictness': {
    setting_id: 'memory.approval_strictness',
    owner_system: 'system_5',
    type: 'enum',
    default_value: 'model_inferred_and_conflicts',
    allowed_values: ['all_ai', 'model_inferred_and_conflicts', 'conflicts_only'],
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'System5.ApprovalStrictness',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Knowledge Approval Strictness',
    description: 'Which candidate classes require manual operator sign-off before entering prompt context.',
    category: 'memory',
    validation: (val: string) => {
      if (['all_ai', 'model_inferred_and_conflicts', 'conflicts_only'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid approval strictness', sanitizedValue: 'model_inferred_and_conflicts' };
    },
  },
  'memory.cross_chapter_learning': {
    setting_id: 'memory.cross_chapter_learning',
    owner_system: 'system_5',
    type: 'boolean',
    default_value: true,
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'basic',
    runtime_binding: 'System5.CrossChapterLearning',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Cross-Chapter Knowledge Propagation',
    description: 'Propagates approved characters, glossary terms, and relationship honorifics across chapters.',
    category: 'memory',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'memory.context_budget_tokens': {
    setting_id: 'memory.context_budget_tokens',
    owner_system: 'system_5',
    type: 'integer',
    default_value: 2000,
    range: { min: 500, max: 8000, step: 250 },
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'System5.ContextBudgetTokens',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Context Token Budget Cap',
    description: 'Maximum token allowance dedicated to project lore inside the AI system instruction.',
    unit: 'tokens',
    category: 'memory',
    validation: (val: number) => {
      const n = Math.round(Number(val));
      if (!isNaN(n) && n >= 200 && n <= 16000) {
        return { valid: true, sanitizedValue: n };
      }
      return { valid: false, error: 'Token budget must be between 200 and 16000', sanitizedValue: 2000 };
    },
  },
  'memory.auto_merge_policy': {
    setting_id: 'memory.auto_merge_policy',
    owner_system: 'system_5',
    type: 'enum',
    default_value: 'conservative',
    allowed_values: ['strict', 'conservative', 'permissive'],
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'System5.AutoMergePolicy',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Entity Auto-Merge Policy',
    description: 'Strict (exact match required), Conservative (safe aliases only), Permissive (aggressive deduplication).',
    category: 'memory',
    validation: (val: string) => {
      if (['strict', 'conservative', 'permissive'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid merge policy', sanitizedValue: 'conservative' };
    },
  },

  // ==========================================
  // WORKSPACE & PRESENTATION
  // ==========================================
  'workspace.default_zoom': {
    setting_id: 'workspace.default_zoom',
    owner_system: 'workspace',
    type: 'integer',
    default_value: 100,
    range: { min: 25, max: 400, step: 5 },
    apply_mode: 'immediate',
    scope: ['global'],
    visibility: 'basic',
    runtime_binding: 'Workspace.DefaultZoom',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Default Page Zoom',
    description: 'Initial canvas zoom level when opening a chapter page.',
    unit: '%',
    category: 'workspace',
    validation: (val: number) => {
      const n = Math.round(Number(val));
      if (!isNaN(n) && n >= 25 && n <= 1000) {
        return { valid: true, sanitizedValue: n };
      }
      return { valid: false, error: 'Zoom must be between 25 and 1000', sanitizedValue: 100 };
    },
  },
  'workspace.reading_direction': {
    setting_id: 'workspace.reading_direction',
    owner_system: 'workspace',
    type: 'enum',
    default_value: 'rtl',
    allowed_values: ['rtl', 'ltr'],
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'basic',
    runtime_binding: 'Workspace.ReadingDirection',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Workspace Navigation Direction',
    description: 'Right-to-Left (Manga flip default) or Left-to-Right.',
    category: 'workspace',
    validation: (val: string) => {
      if (['rtl', 'ltr'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Direction must be rtl or ltr', sanitizedValue: 'rtl' };
    },
  },
  'workspace.overlay_boxes_visible': {
    setting_id: 'workspace.overlay_boxes_visible',
    owner_system: 'workspace',
    type: 'boolean',
    default_value: true,
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'basic',
    runtime_binding: 'Workspace.OverlayBoxesVisible',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Dialogue Bounding Box Overlay',
    description: 'Show interactive speech bubble bounding boxes and corner chips.',
    category: 'workspace',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'workspace.overlay_reading_order_visible': {
    setting_id: 'workspace.overlay_reading_order_visible',
    owner_system: 'workspace',
    type: 'boolean',
    default_value: false,
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'Workspace.OverlayReadingOrderVisible',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Reading-Order Visual Flow Arrows',
    description: 'Render vector flow connectors illustrating detected reading sequence.',
    category: 'workspace',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'workspace.overlay_panels_visible': {
    setting_id: 'workspace.overlay_panels_visible',
    owner_system: 'workspace',
    type: 'boolean',
    default_value: false,
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'advanced',
    runtime_binding: 'Workspace.OverlayPanelsVisible',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Panel Boundary Detection Overlay',
    description: 'Show detected comic panel boundaries and sequence numbers.',
    category: 'workspace',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'workspace.overlay_review_markers_visible': {
    setting_id: 'workspace.overlay_review_markers_visible',
    owner_system: 'workspace',
    type: 'boolean',
    default_value: true,
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'basic',
    runtime_binding: 'Workspace.OverlayReviewMarkersVisible',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Review Flag Indicators on Artwork',
    description: 'Highlight flagged regions directly on the manga canvas with amber indicators.',
    category: 'workspace',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'workspace.coordinate_diagnostics': {
    setting_id: 'workspace.coordinate_diagnostics',
    owner_system: 'workspace',
    type: 'boolean',
    default_value: false,
    apply_mode: 'immediate',
    scope: ['global'],
    visibility: 'developer-only',
    runtime_binding: 'Workspace.CoordinateDiagnostics',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Coordinate Diagnostics HUD',
    description: 'Displays real-time transform matrices, screen/source round-trip coordinates, and render timings.',
    category: 'workspace',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'workspace.double_click_confirmation': {
    setting_id: 'workspace.double_click_confirmation',
    owner_system: 'workspace',
    type: 'boolean',
    default_value: true,
    apply_mode: 'immediate',
    scope: ['global', 'project'],
    visibility: 'basic',
    runtime_binding: 'Workspace.DoubleClickConfirmation',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Double-Click Confirmation for Critical Actions',
    description: 'Requires a deliberate double-click to confirm actions like Save Order or page deletions.',
    category: 'general_tweaks',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'general.keep_utility_rail_expanded': {
    setting_id: 'general.keep_utility_rail_expanded',
    owner_system: 'general',
    type: 'boolean',
    default_value: false,
    apply_mode: 'immediate',
    scope: ['global'],
    visibility: 'basic',
    runtime_binding: 'Workspace.KeepUtilityRailExpanded',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Keep Utility Rail Expanded',
    description: 'When enabled, the Utility Rail stays expanded until explicitly collapsed. When disabled, the rail automatically collapses when the pointer leaves or you click elsewhere.',
    category: 'general_tweaks',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },

  // ==========================================
  // QUALITY BENCHMARK & DIAGNOSTICS
  // ==========================================
  'quality.benchmark_mode': {
    setting_id: 'quality.benchmark_mode',
    owner_system: 'quality',
    type: 'enum',
    default_value: 'smoke',
    allowed_values: ['smoke', 'focused', 'regression', 'full_qualification'],
    apply_mode: 'immediate',
    scope: ['global'],
    visibility: 'basic',
    runtime_binding: 'Quality.BenchmarkMode',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Default Benchmark Suite Mode',
    description: 'Smoke (fast invariant check), Focused (targeted engine), Regression (locked suite), Full Qualification.',
    category: 'quality',
    validation: (val: string) => {
      if (['smoke', 'focused', 'regression', 'full_qualification'].includes(val)) {
        return { valid: true, sanitizedValue: val };
      }
      return { valid: false, error: 'Invalid benchmark mode', sanitizedValue: 'smoke' };
    },
  },
  'quality.regression_gate_enabled': {
    setting_id: 'quality.regression_gate_enabled',
    owner_system: 'quality',
    type: 'boolean',
    default_value: true,
    apply_mode: 'immediate',
    scope: ['global'],
    visibility: 'basic',
    runtime_binding: 'Quality.RegressionGateEnabled',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Enforce Hard Quality Gates',
    description: 'Block promotions and fail benchmark suite when any non-overridable invariant fails.',
    category: 'quality',
    validation: (val: boolean) => ({ valid: true, sanitizedValue: Boolean(val) }),
  },
  'quality.max_allowed_cer': {
    setting_id: 'quality.max_allowed_cer',
    owner_system: 'quality',
    type: 'decimal',
    default_value: 0.05,
    range: { min: 0.005, max: 0.20, step: 0.005 },
    apply_mode: 'immediate',
    scope: ['global'],
    visibility: 'advanced',
    runtime_binding: 'Quality.MaxAllowedCer',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Maximum Character Error Rate (CER)',
    description: 'Allowable CER ceiling against ground-truth OCR before regression gate triggers.',
    unit: 'ratio',
    category: 'quality',
    validation: (val: number) => {
      const n = Number(val);
      if (!isNaN(n) && n >= 0 && n <= 1) {
        return { valid: true, sanitizedValue: Math.round(n * 1000) / 1000 };
      }
      return { valid: false, error: 'Must be between 0 and 1', sanitizedValue: 0.05 };
    },
  },
  'quality.min_detection_recall': {
    setting_id: 'quality.min_detection_recall',
    owner_system: 'quality',
    type: 'decimal',
    default_value: 0.90,
    range: { min: 0.50, max: 1.00, step: 0.05 },
    apply_mode: 'immediate',
    scope: ['global'],
    visibility: 'advanced',
    runtime_binding: 'Quality.MinDetectionRecall',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Minimum Bubble Detection Recall',
    description: 'Required percentage of ground-truth bubbles correctly detected before gate triggers.',
    unit: 'ratio',
    category: 'quality',
    validation: (val: number) => {
      const n = Number(val);
      if (!isNaN(n) && n >= 0 && n <= 1) {
        return { valid: true, sanitizedValue: Math.round(n * 100) / 100 };
      }
      return { valid: false, error: 'Must be between 0 and 1', sanitizedValue: 0.90 };
    },
  },
  'quality.active_baseline_id': {
    setting_id: 'quality.active_baseline_id',
    owner_system: 'quality',
    type: 'string',
    default_value: 'dragonfly44_baseline_v1',
    apply_mode: 'immediate',
    scope: ['global'],
    visibility: 'advanced',
    runtime_binding: 'Quality.ActiveBaselineId',
    schema_version: '1.0',
    reset_behavior: 'default',
    label: 'Active Baseline Reference',
    description: 'Unique immutable identifier of the promoted baseline used for regression comparisons.',
    category: 'quality',
    validation: (val: string) => ({
      valid: true,
      sanitizedValue: typeof val === 'string' && val.trim().length > 0 ? val.trim() : 'dragonfly44_baseline_v1',
    }),
  },
};
