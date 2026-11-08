/**
 * Folio Script: System #6 — Settings, Workspace & Quality Benchmark Engine
 * Curated Benchmark Dataset Manifest & Ground-Truth Test Cases
 * 
 * Versioned, rights-governed ground truth spanning Systems #2–#6.
 */

import type { BenchmarkDatasetManifest } from '../../types/benchmark';

export const CORE_BENCHMARK_DATASET: BenchmarkDatasetManifest = {
  dataset_id: 'dragonfly_core_regression',
  version: '1.0',
  name: 'Folio Script Core Regression & Quality Suite',
  license: 'Proprietary / Folio Script Internal Test Harness',
  source_provenance: 'Curated canonical fixtures from Systems #2, #3, #4, #5 and System #6 Workspace specifications',
  description: 'Locked regression dataset measuring OCR, translation, review precision, memory invariants, and workspace transforms.',
  createdAt: 1730000000000,
  cases: [
    // ----------------------------------------------------
    // SYSTEM #2: TRANSLATION & HUMANIZER FIXTURES
    // ----------------------------------------------------
    {
      case_id: 'trans_algerian_override_01',
      name: 'Algerian Dialect Override & Immunity',
      system: 'system_2',
      difficulty_tags: ['dialect', 'master_prompt_override', 'lexicon'],
      input_data: {
        masterPrompt: 'ترجم هذا المشهد بالدارجة الجزائرية العاصمية بشكل واقعي وشارعي.',
        dialogue: 'What are you doing here? Get lost before you get hurt!',
      },
      ground_truth: {
        text: 'واش راك دير هنا؟ روح من هنا قبل ما تاكل طريحة!',
        expectedFindings: [],
        forbiddenFindings: ['grammar_gender', 'unrecognized_colloquialism'],
      },
      expected_metrics: {
        min_fidelity: 0.95,
      },
    },
    {
      case_id: 'trans_orthography_hamza_02',
      name: 'Strict Arabic Orthography & Tanween Protection',
      system: 'system_2',
      difficulty_tags: ['orthography', 'hamza', 'tanween'],
      input_data: {
        rawModelOutput: 'حقا لقد اتيت الى هنا املا في لقائه',
      },
      ground_truth: {
        normalizedText: 'حقًا، لقد أتيتُ إلى هنا أملًا في لقائه.',
      },
      expected_metrics: {
        min_orthography_score: 0.98,
      },
    },
    {
      case_id: 'trans_murim_terminology_03',
      name: 'Cultivation / Murim Terminology Fidelity',
      system: 'system_2',
      difficulty_tags: ['cultivation', 'glossary', 'classical'],
      input_data: {
        terms: [
          { source: 'internal energy', expectedArabic: 'طاقة داخلية / تشي' },
          { source: 'dantian', expectedArabic: 'دانتيان' },
          { source: 'Mount Hua Sect', expectedArabic: 'طائفة جبل هوا' },
        ],
      },
      ground_truth: {
        glossaryMatches: [
          { source: 'internal energy', target: 'طاقة داخلية' },
          { source: 'dantian', target: 'دانتيان' },
          { source: 'Mount Hua Sect', target: 'طائفة جبل هوا' },
        ],
      },
      expected_metrics: {
        glossary_match_rate: 1.0,
      },
    },

    // ----------------------------------------------------
    // SYSTEM #3: SCANNING & OCR FIXTURES
    // ----------------------------------------------------
    {
      case_id: 'scan_manga_rtl_reading_order_01',
      name: 'Hierarchical Manga RTL Reading Order',
      system: 'system_3',
      difficulty_tags: ['reading_order', 'manga_rtl', 'panels'],
      input_data: {
        convention: 'manga_rtl',
        regions: [
          { id: 'b_left_bottom', box: [600, 100, 800, 350] },
          { id: 'b_right_top', box: [100, 600, 300, 900] },
          { id: 'b_left_top', box: [120, 150, 320, 450] },
          { id: 'b_right_bottom', box: [650, 550, 850, 850] },
        ],
      },
      ground_truth: {
        readingOrder: ['b_right_top', 'b_left_top', 'b_right_bottom', 'b_left_bottom'],
      },
      expected_metrics: {
        min_order_accuracy: 1.0,
      },
    },
    {
      case_id: 'scan_ocr_verbatim_precision_02',
      name: 'Verbatim OCR Parsing & Bounding Geometry',
      system: 'system_3',
      difficulty_tags: ['ocr', 'dense_layout', 'iou'],
      input_data: {
        sourceText: 'I will never surrender my sect!',
        box: [250, 200, 450, 600],
      },
      ground_truth: {
        text: 'I will never surrender my sect!',
        regions: [
          {
            box_2d: [250, 200, 450, 600],
            classification: 'dialogue',
          },
        ],
      },
      expected_metrics: {
        max_cer: 0.0,
        min_iou: 0.90,
      },
    },

    // ----------------------------------------------------
    // SYSTEM #4: REVIEW & QUALITY CONTROL FIXTURES
    // ----------------------------------------------------
    {
      case_id: 'review_ambiguous_ocr_abstention_01',
      name: 'Source Reliability Gate & Ambiguous OCR Abstention',
      system: 'system_4',
      difficulty_tags: ['review', 'safety', 'abstention'],
      input_data: {
        sourceOCR: 'd???g... ??',
        ocrConfidence: 0.25,
        translation: 'كلب يركض',
      },
      ground_truth: {
        expectedFindings: [],
        forbiddenFindings: ['semantic_mistranslation', 'meaning_negation'],
      },
      expected_metrics: {
        unsafe_corrections_max: 0,
      },
    },
    {
      case_id: 'review_inverted_box_detection_02',
      name: 'Deterministic Inverted Coordinates Blocker',
      system: 'system_4',
      difficulty_tags: ['geometry', 'integrity', 'blocker'],
      input_data: {
        box_2d: [600, 500, 300, 200], // Inverted ymin > ymax, xmin > xmax
      },
      ground_truth: {
        expectedFindings: [
          { category: 'reading_order', severity: 'blocker', issueCode: 'REV-INT-001' },
        ],
      },
      expected_metrics: {
        recall: 1.0,
      },
    },

    // ----------------------------------------------------
    // SYSTEM #5: PROJECT MEMORY & INTEGRITY FIXTURES
    // ----------------------------------------------------
    {
      case_id: 'memory_user_immunity_no_overwrite_01',
      name: 'Zero Silent Overwrite of User Confirmed Knowledge',
      system: 'system_5',
      difficulty_tags: ['memory', 'authority', 'concurrency'],
      input_data: {
        existingEntity: {
          canonicalKey: 'char_tang_san',
          nameArabic: 'تانغ سان',
          trustClass: 'user_confirmed',
        },
        aiCandidate: {
          canonicalKey: 'char_tang_san',
          nameArabic: 'تانغ سان المعلم',
          trustClass: 'model_inferred',
        },
      },
      ground_truth: {
        expectedLoreEntries: [
          { key: 'char_tang_san', status: 'user_confirmed_preserved' },
        ],
      },
      expected_metrics: {
        silent_overwrite_count: 0,
      },
    },
    {
      case_id: 'memory_provenance_enforcement_02',
      name: '100% Provenance Lineage Enforcement',
      system: 'system_5',
      difficulty_tags: ['provenance', 'validation', 'integrity'],
      input_data: {
        proposalWithoutProvenance: {
          key: 'sect_mount_hua',
          arabic: 'طائفة جبل هوا',
        },
      },
      ground_truth: {
        expectedFindings: [
          { category: 'integrity', severity: 'blocker', issueCode: 'MEM-005' },
        ],
      },
      expected_metrics: {
        provenance_completeness: 1.0,
      },
    },

    // ----------------------------------------------------
    // SYSTEM #6: WORKSPACE & GEOMETRY FIXTURES
    // ----------------------------------------------------
    {
      case_id: 'workspace_transform_roundtrip_01',
      name: 'Single Composed Transform Round-Trip Invariant',
      system: 'workspace',
      difficulty_tags: ['transform', 'reversibility', 'math'],
      input_data: {
        sourceDimensions: { width: 1200, height: 1800 },
        viewportDimensions: { width: 600, height: 900 },
        zoom: 175,
        pan: { x: 45, y: -80 },
        testPoints: [
          { x: 0, y: 0 },
          { x: 500, y: 500 },
          { x: 1200, y: 1800 },
          { x: 350, y: 850 },
        ],
      },
      ground_truth: {
        expectedHitObjectIds: {},
      },
      expected_metrics: {
        max_drift_allowed: 0.1,
        aspect_ratio_error_max: 0.0001,
      },
    },
    {
      case_id: 'workspace_overlapping_bubble_hittest_02',
      name: 'Deterministic Overlapping Bubble Hit-Testing',
      system: 'workspace',
      difficulty_tags: ['hittest', 'overlap', 'handles'],
      input_data: {
        viewport: { width: 800, height: 1000 },
        source: { width: 1000, height: 1000 },
        zoom: 100,
        pan: { x: 0, y: 0 },
        bubbles: [
          { id: 'bubble_large', box_2d: [100, 100, 700, 700] },
          { id: 'bubble_small_nested', box_2d: [300, 300, 450, 450] },
        ],
        hitPoint: { x: 350, y: 350 }, // Lies inside both large and small
      },
      ground_truth: {
        expectedHitObjectIds: {
          '350,350': 'bubble_small_nested', // Must select the innermost
        },
      },
      expected_metrics: {
        hit_accuracy: 1.0,
      },
    },
  ],
};
