/**
 * Folio Script: System #6 — Settings, Workspace & Quality Benchmark Engine
 * Shipped Engine Presets & Validation
 * 
 * Presets are versioned, coordinated value collections applied through
 * the standard validation and propagation pipeline.
 */

import type { SettingsPreset } from '../../types/settings';

export const ENGINE_PRESETS: Record<string, SettingsPreset> = {
  balanced: {
    preset_id: 'balanced',
    name: 'Balanced (Standard Scanlation)',
    description: 'Recommended default: Gemini 3.8 Flash, literary eloquence, balanced humanizer, and standard QC.',
    version: '1.0',
    target_systems: ['system_2', 'system_3', 'system_4', 'system_5', 'workspace'],
    values: {
      'translation.model': 'gemini-3.8-flash',
      'translation.eloquence': 2,
      'translation.fidelity': 'localized',
      'translation.humanizer_enabled': true,
      'translation.humanizer_intensity': 'balanced',
      'translation.orthography_mode': 'correct_spelling',
      'scanning.profile': 'balanced',
      'scanning.reading_convention': 'auto',
      'scanning.include_sfx': true,
      'scanning.enable_crop_retries': true,
      'scanning.max_crop_retries': 3,
      'review.profile': 'balanced',
      'review.auto_correction_eligibility': false,
      'review.severity_threshold': 'moderate',
      'memory.learning_mode': 'candidate_only',
      'memory.approval_strictness': 'model_inferred_and_conflicts',
      'memory.cross_chapter_learning': true,
      'workspace.overlay_boxes_visible': true,
      'workspace.overlay_review_markers_visible': true,
    },
  },

  fast_batch: {
    preset_id: 'fast_batch',
    name: 'Fast Scan & Batch OCR',
    description: 'Optimized for high throughput: Flash-Lite model, casual modern Arabic, single-pass scanning without crop retries.',
    version: '1.0',
    target_systems: ['system_2', 'system_3', 'system_4', 'system_5'],
    values: {
      'translation.model': 'gemini-3.1-flash-lite',
      'translation.eloquence': 1,
      'translation.fidelity': 'localized',
      'translation.humanizer_enabled': true,
      'translation.humanizer_intensity': 'light',
      'translation.orthography_mode': 'relaxed',
      'scanning.profile': 'fast',
      'scanning.reading_convention': 'auto',
      'scanning.include_sfx': false,
      'scanning.enable_crop_retries': false,
      'scanning.max_crop_retries': 1,
      'review.profile': 'conservative',
      'review.severity_threshold': 'major',
      'memory.learning_mode': 'candidate_only',
      'memory.auto_merge_policy': 'permissive',
    },
  },

  high_accuracy: {
    preset_id: 'high_accuracy',
    name: 'High Accuracy & Deep QC',
    description: 'Maximum precision: Gemini Pro model, exhaustive crop retries, thorough review scrutiny, and strict lore governance.',
    version: '1.0',
    target_systems: ['system_2', 'system_3', 'system_4', 'system_5'],
    values: {
      'translation.model': 'gemini-3.5-pro',
      'translation.eloquence': 3,
      'translation.fidelity': 'faithful',
      'translation.humanizer_enabled': true,
      'translation.humanizer_intensity': 'strong',
      'translation.orthography_mode': 'correct_spelling',
      'scanning.profile': 'high_accuracy',
      'scanning.reading_convention': 'manga_rtl',
      'scanning.include_sfx': true,
      'scanning.enable_crop_retries': true,
      'scanning.max_crop_retries': 5,
      'review.profile': 'thorough',
      'review.ambiguous_ocr_abstention': true,
      'review.severity_threshold': 'minor',
      'memory.learning_mode': 'candidate_only',
      'memory.approval_strictness': 'all_ai',
      'memory.auto_merge_policy': 'strict',
    },
  },
};
