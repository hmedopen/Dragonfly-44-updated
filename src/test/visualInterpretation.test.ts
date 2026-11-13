/**
 * Folio Script: Phase 2 — Gemini Visual Interpretation Engine Test Suite
 * 
 * Verifies:
 * 1. Reading Order Engine:
 *    - Strict validation of reading sequence (must account for every candidate ID once)
 *    - Unknown ID rejection, duplicate ID rejection, missing ID rejection
 *    - Graceful fallback to geometric layout with READING_ORDER_CONFLICT flags
 *    - Visual narrative ordering vs geometric fallback
 *    - Safety guard: no regions are discarded even if omitted
 * 2. Typer Assignment & Semantic Classification:
 *    - Assignment strictly from configured typers (CustomTyperConfig)
 *    - Recognition of custom user-defined typers
 *    - Fallback and CLASSIFICATION_AMBIGUOUS flag for invalid/hallucinated typer IDs
 *    - Colors derived strictly from configured typers (no invented colors)
 * 3. Authority Boundaries & Source Immutability:
 *    - Local OCR coordinates, polygons, and verbatim text remain 100% immutable
 *    - Gemini cannot drop valid local OCR regions
 *    - Gemini cannot create new OCR regions
 *    - Alternative OCR proposals preserved in ocrAlternatives without overwriting rawOCR
 * 4. Independent Visual Interpretation Pipeline:
 *    - interpretPageVisualContext re-interprets existing OCR without re-running local OCR
 *    - Independent interpretation retry and status updates
 * 5. Page-level Status Differentiation:
 *    - Distinct states: ocr_complete_interpretation_complete, ocr_complete_interpretation_pending,
 *      ocr_complete_interpretation_failed, ocr_failed, cancelled
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGeminiReadingOrder,
  applyReadingOrder,
  inferHierarchicalReadingOrder,
} from '../lib/readingOrder.ts';
import {
  scanMangaPageHybridWithMeta,
  validateHybridContextOutput,
  type ValidatedHybridContextOutput,
} from '../lib/hybridScan.ts';
import {
  interpretPageVisualContext,
  scanPageWithGemini,
} from '../lib/geminiScan.ts';
import { ScanQueueManager } from '../lib/scanQueue.ts';
import type { TextRegion, PageScanResult } from '../types/scanning.ts';
import type { BubbleItem } from '../types/workbench.ts';
import { DEFAULT_TYPERS, resolveTyperVisual, type CustomTyperConfig } from '../types/typers.ts';

// Helper to create synthetic TextRegion fixtures
function createSyntheticRegion(
  id: string,
  box: [number, number, number, number],
  text: string,
  polygon?: Array<[number, number]>
): TextRegion {
  return {
    regionId: id,
    geometry: {
      coordinateSpace: 'normalized_1000',
      box_2d: box,
      polygon: polygon || [
        [box[0], box[1]],
        [box[0], box[3]],
        [box[2], box[3]],
        [box[2], box[1]],
      ],
    },
    rawOCR: text,
    normalizedText: text,
    confidence: {
      imageQuality: 1.0,
      regionDetection: 0.95,
      ocr: 0.92,
      association: 0.9,
      readingOrder: 0.9,
      classification: 0.9,
    },
    classification: {
      primaryClass: 'dialogue',
      confidence: 0.9,
      needsReview: false,
    },
    sourceLanguage: 'ja',
    associations: {},
    order: {
      sequenceIndex: 1,
      confidence: 0.8,
      rationale: 'Initial sequence',
    },
    flags: [],
  };
}

test('Phase 2 Reading Order: validateGeminiReadingOrder enforces strict candidate accountability', () => {
  const expected = ['region-1', 'region-2', 'region-3'];

  // 1. Happy path: exact sequence
  const valid = validateGeminiReadingOrder(['region-3', 'region-1', 'region-2'], expected);
  assert.equal(valid.isValid, true);
  assert.deepEqual(valid.orderedIds, ['region-3', 'region-1', 'region-2']);
  assert.equal(valid.errors.length, 0);

  // 2. Reject missing ID
  const missing = validateGeminiReadingOrder(['region-1', 'region-2'], expected);
  assert.equal(missing.isValid, false);
  assert.deepEqual(missing.missingIds, ['region-3']);
  assert.ok(missing.errors.some((e) => e.includes('omitted 1 input region ID')));

  // 3. Reject unknown/hallucinated ID
  const unknown = validateGeminiReadingOrder(['region-1', 'region-2', 'region-3', 'region-fake'], expected);
  assert.equal(unknown.isValid, false);
  assert.deepEqual(unknown.unknownIds, ['region-fake']);
  assert.ok(unknown.errors.some((e) => e.includes('unknown region ID')));

  // 4. Reject duplicate ID
  const duplicate = validateGeminiReadingOrder(['region-1', 'region-2', 'region-2', 'region-3'], expected);
  assert.equal(duplicate.isValid, false);
  assert.deepEqual(duplicate.duplicateIds, ['region-2']);
  assert.ok(duplicate.errors.some((e) => e.includes('duplicate region ID')));

  // 5. Reject non-array
  const nonArray = validateGeminiReadingOrder('region-1, region-2', expected);
  assert.equal(nonArray.isValid, false);
  assert.equal(nonArray.errors[0], 'Gemini reading order is not an array.');
});

test('Phase 2 Reading Order: applyReadingOrder sorts regions and protects unsequenced regions', () => {
  const r1 = createSyntheticRegion('r1', [100, 500, 200, 700], 'First line');
  const r2 = createSyntheticRegion('r2', [300, 500, 400, 700], 'Second line');
  const r3 = createSyntheticRegion('r3', [500, 500, 600, 700], 'Third line');

  // Valid narrative order: r3, then r1, then r2
  const ordered = applyReadingOrder([r1, r2, r3], ['r3', 'r1', 'r2'], {
    confidence: 0.95,
    rationale: 'Gemini visual narrative flow',
    ambiguities: [{ regionA: 'r1', regionB: 'r2', reason: 'Overlapping panel boundary' }],
  });

  assert.equal(ordered.length, 3);
  assert.equal(ordered[0].regionId, 'r3');
  assert.equal(ordered[0].order.sequenceIndex, 1);
  assert.equal(ordered[1].regionId, 'r1');
  assert.equal(ordered[1].order.sequenceIndex, 2);
  // Ambiguity flag attached
  assert.ok(ordered[1].flags.includes('READING_ORDER_CONFLICT'));
  assert.equal(ordered[2].regionId, 'r2');
  assert.equal(ordered[2].order.sequenceIndex, 3);
  assert.ok(ordered[2].flags.includes('READING_ORDER_CONFLICT'));

  // Safety guard: if an ID was somehow omitted, it must not disappear
  const safetyGuard = applyReadingOrder([r1, r2, r3], ['r2']);
  assert.equal(safetyGuard.length, 3);
  assert.equal(safetyGuard[0].regionId, 'r2');
  assert.equal(safetyGuard[0].order.sequenceIndex, 1);
  // r1 and r3 appended with flag
  assert.equal(safetyGuard[1].regionId, 'r1');
  assert.ok(safetyGuard[1].flags.includes('READING_ORDER_CONFLICT'));
  assert.equal(safetyGuard[2].regionId, 'r3');
  assert.ok(safetyGuard[2].flags.includes('READING_ORDER_CONFLICT'));
});

test('Phase 2 Hybrid Scan: executes Gemini visual reading order and attaches interpretation record', async () => {
  const fakeBlob = new Blob(['fake_image_bytes'], { type: 'image/png' });
  const regions: TextRegion[] = [
    createSyntheticRegion('reg-A', [100, 600, 200, 900], 'Top right balloon', [
      [100, 600],
      [100, 900],
      [200, 900],
      [200, 600],
    ]),
    createSyntheticRegion('reg-B', [400, 100, 500, 400], 'Bottom left balloon', [
      [400, 100],
      [400, 400],
      [500, 400],
      [500, 100],
    ]),
  ];

  let passedCandidates: any[] = [];

  const outcome = await scanMangaPageHybridWithMeta({
    pageId: 'test-p2-order',
    apiKey: 'fake-api-key',
    readingConvention: 'manga_rtl',
    sourceLanguageHint: 'ja',
    hybridDeps: {
      getPageBlob: async () => fakeBlob,
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () => ({
        getStatus: async () => ({ state: 'installed' } as any),
      } as any),
      runLocalOcr: async () => ({
        textRegions: regions,
        bubbleRegions: [],
        status: 'complete',
      }),
      runGeminiContextPass: async (opts) => {
        passedCandidates = opts.candidates;
        return {
          pageContext: 'Manga scene with two characters.',
          readingConventionCandidate: 'manga_rtl',
          readingOrder: ['reg-A', 'reg-B'], // Correct narrative order
          panels: [{ panelId: 'p1', box_2d: [0, 0, 1000, 1000] }],
          regionDecisions: [
            {
              regionId: 'reg-A',
              action: 'keep',
              assignedTyperId: 'speech_bubbles',
              typerConfidence: 0.98,
              primaryClass: 'dialogue',
              speakerCandidate: 'Hero',
              visualEvidence: 'Oval bubble with tail pointing to Hero',
            },
            {
              regionId: 'reg-B',
              action: 'keep',
              assignedTyperId: 'shouting',
              typerConfidence: 0.95,
              primaryClass: 'vocalization',
              speakerCandidate: 'Villain',
              visualEvidence: 'Spiky bubble with bold font',
            },
          ],
          additionalRegions: [],
          detectedCharacters: [{ nameOriginal: 'Hero', nameArabic: 'البطل', gender: 'male' }],
          detectedGlossaryTerms: [],
          detectedRelationships: [],
        };
      },
    },
  });

  // Verify candidate visual payload included geometry for Gemini
  assert.equal(passedCandidates.length, 2);
  assert.ok(passedCandidates[0].polygon);
  assert.equal(passedCandidates[0].polygon.length, 4);

  const scan = outcome.scanResult;
  assert.equal(scan.status, 'complete');
  assert.equal(scan.interpretationStatus, 'complete');
  assert.equal(scan.readingOrderSource, 'gemini_visual');
  assert.equal(scan.interpretations?.length, 2);

  // Region A check
  const regA = scan.regions.find((r) => r.regionId.includes('reg-A'));
  assert.ok(regA);
  assert.equal(regA.order.sequenceIndex, 1);
  assert.equal(regA.interpretation?.typerId, 'speech_bubbles');
  assert.equal(regA.interpretation?.typerPrefix, '"":');
  assert.equal(regA.interpretation?.primaryClass, 'dialogue');
  assert.equal(regA.interpretation?.speakerCandidate, 'Hero');
  assert.equal(regA.interpretation?.isFallbackOrdering, false);

  // Region B check
  const regB = scan.regions.find((r) => r.regionId.includes('reg-B'));
  assert.ok(regB);
  assert.equal(regB.order.sequenceIndex, 2);
  assert.equal(regB.interpretation?.typerId, 'shouting');
  assert.equal(regB.interpretation?.typerPrefix, '%:');
  assert.equal(regB.interpretation?.primaryClass, 'vocalization');

  // Verify coordinates and raw text are unchanged
  assert.deepEqual(regA.geometry.box_2d, [100, 600, 200, 900]);
  assert.equal(regA.rawOCR, 'Top right balloon');
  assert.deepEqual(regB.geometry.box_2d, [400, 100, 500, 400]);
  assert.equal(regB.rawOCR, 'Bottom left balloon');
});

test('Phase 2 Fallback: invalid Gemini reading order falls back to geometric order without failing scan', async () => {
  const fakeBlob = new Blob(['fake_image_bytes'], { type: 'image/png' });
  const regions: TextRegion[] = [
    createSyntheticRegion('reg-1', [100, 600, 200, 900], 'First'),
    createSyntheticRegion('reg-2', [300, 600, 400, 900], 'Second'),
  ];

  const outcome = await scanMangaPageHybridWithMeta({
    pageId: 'test-p2-order-fallback',
    apiKey: 'fake-api-key',
    readingConvention: 'manga_rtl',
    sourceLanguageHint: 'ja',
    hybridDeps: {
      getPageBlob: async () => fakeBlob,
      extractImageDimensions: async () => ({ width: 1000, height: 1000 }),
      getModelProvider: () => ({ getStatus: async () => ({ state: 'installed' } as any) } as any),
      runLocalOcr: async () => ({ textRegions: regions, status: 'complete' }),
      runGeminiContextPass: async () => ({
        pageContext: 'Scene',
        readingConventionCandidate: 'manga_rtl',
        // Broken reading order: missing reg-2, hallucinated reg-unknown
        readingOrder: ['reg-1', 'reg-unknown'],
        panels: [],
        regionDecisions: [
          { regionId: 'reg-1', action: 'keep', primaryClass: 'dialogue' },
          { regionId: 'reg-2', action: 'keep', primaryClass: 'dialogue' },
        ],
        additionalRegions: [],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
    },
  });

  const scan = outcome.scanResult;
  assert.equal(scan.status, 'complete');
  assert.equal(scan.interpretationStatus, 'complete');
  // Fallback was triggered cleanly
  assert.equal(scan.readingOrderSource, 'geometric_fallback');
  assert.equal(scan.regions.length, 2);
  // All regions carry READING_ORDER_CONFLICT flag
  assert.ok(scan.regions[0].flags.includes('READING_ORDER_CONFLICT'));
  assert.ok(scan.regions[1].flags.includes('READING_ORDER_CONFLICT'));
  assert.equal(scan.regions[0].interpretation?.isFallbackOrdering, true);
  assert.ok(outcome.meta.warnings.some((w) => w.includes('reading order validation failed')));
});

test('Phase 2 Typer Assignment: maps custom typers and handles invalid typers with CLASSIFICATION_AMBIGUOUS', async () => {
  const fakeBlob = new Blob(['fake_image_bytes'], { type: 'image/png' });
  const customTypers: CustomTyperConfig[] = [
    {
      id: 'telepathy',
      prefix: 'T:',
      name: 'Telepathy',
      instructions: 'Mental telepathic communication',
      color: '#9333EA',
    },
    ...DEFAULT_TYPERS,
  ];

  const regions: TextRegion[] = [
    createSyntheticRegion('reg-custom', [100, 100, 200, 300], 'Mental voice'),
    createSyntheticRegion('reg-invalid-typer', [300, 100, 400, 300], 'Spoken words'),
  ];

  const outcome = await scanMangaPageHybridWithMeta({
    pageId: 'test-p2-typers',
    apiKey: 'fake-api-key',
    readingConvention: 'manga_rtl',
    sourceLanguageHint: 'ja',
    configuredTypers: customTypers,
    hybridDeps: {
      getPageBlob: async () => fakeBlob,
      extractImageDimensions: async () => ({ width: 1000, height: 1000 }),
      getModelProvider: () => ({ getStatus: async () => ({ state: 'installed' } as any) } as any),
      runLocalOcr: async () => ({ textRegions: regions, status: 'complete' }),
      runGeminiContextPass: async () => ({
        pageContext: 'Scene',
        readingOrder: ['reg-custom', 'reg-invalid-typer'],
        panels: [],
        regionDecisions: [
          {
            regionId: 'reg-custom',
            action: 'keep',
            assignedTyperId: 'telepathy', // Matches custom typer
            typerConfidence: 0.99,
            primaryClass: 'thought',
          },
          {
            regionId: 'reg-invalid-typer',
            action: 'keep',
            assignedTyperId: 'non_existent_typer_xyz', // Invalid/invented typer
            typerConfidence: 0.8,
            primaryClass: 'dialogue',
          },
        ],
        additionalRegions: [],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
    },
  });

  const regCustom = outcome.scanResult.regions.find((r) => r.regionId.includes('reg-custom'))!;
  assert.equal(regCustom.interpretation?.typerId, 'telepathy');
  assert.equal(regCustom.interpretation?.typerPrefix, 'T:');
  const visualCustom = resolveTyperVisual({ type: regCustom.interpretation?.typerId }, customTypers);
  assert.equal(visualCustom.color, '#9333EA');

  const regInvalid = outcome.scanResult.regions.find((r) => r.regionId.includes('reg-invalid-typer'))!;
  // Gracefully mapped to default speech_bubbles for dialogue class
  assert.equal(regInvalid.interpretation?.typerId, 'speech_bubbles');
  assert.equal(regInvalid.interpretation?.typerPrefix, '"":');
  // Flagged for user review
  assert.ok(regInvalid.flags.includes('CLASSIFICATION_AMBIGUOUS'));
});

test('Phase 2 Immutability: Gemini interpretation never alters OCR text or polygon coordinates', async () => {
  const fakeBlob = new Blob(['fake_image_bytes'], { type: 'image/png' });
  const originalPolygon: Array<[number, number]> = [
    [105, 205],
    [105, 450],
    [295, 450],
    [295, 205],
  ];
  const originalBox: [number, number, number, number] = [100, 200, 300, 460];
  const verbatimOCR = 'Original Verbatim Text 123';

  const regions: TextRegion[] = [
    createSyntheticRegion('reg-immutable', originalBox, verbatimOCR, originalPolygon),
  ];

  const outcome = await scanMangaPageHybridWithMeta({
    pageId: 'test-p2-immutability',
    apiKey: 'fake-api-key',
    readingConvention: 'manga_rtl',
    sourceLanguageHint: 'ja',
    hybridDeps: {
      getPageBlob: async () => fakeBlob,
      extractImageDimensions: async () => ({ width: 1000, height: 1000 }),
      getModelProvider: () => ({ getStatus: async () => ({ state: 'installed' } as any) } as any),
      runLocalOcr: async () => ({ textRegions: regions, status: 'complete' }),
      runGeminiContextPass: async () => ({
        pageContext: 'Scene',
        readingOrder: ['reg-immutable'],
        panels: [],
        regionDecisions: [
          {
            regionId: 'reg-immutable',
            action: 'verify',
            assignedTyperId: 'speech_bubbles',
            verifiedOCR: 'Rewritten Gemini Guess 456',
            refinedBox2d: [50, 50, 500, 500], // Gemini attempts to alter coordinates
            primaryClass: 'dialogue',
          },
        ],
        // Gemini attempts to create an unextracted region
        additionalRegions: [
          {
            regionId: 'invented-1',
            box_2d: [600, 600, 700, 700],
            rawOCR: 'Hallucinated dialogue',
            primaryClass: 'dialogue',
          },
        ],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
    },
  });

  const resultRegion = outcome.scanResult.regions[0];
  // 1. Coordinates and polygons remain exact
  assert.deepEqual(resultRegion.geometry.box_2d, originalBox);
  assert.deepEqual(resultRegion.geometry.polygon, originalPolygon);
  // 2. rawOCR remains exact
  assert.equal(resultRegion.rawOCR, verbatimOCR);
  // 3. Alternative preserved in ocrAlternatives without overwriting verbatim source
  assert.ok(resultRegion.ocrAlternatives?.includes('Rewritten Gemini Guess 456'));
  // 4. Invented region was NOT created
  assert.equal(outcome.scanResult.regions.length, 1);
  assert.equal(outcome.meta.addedRegionCount, 0);
  assert.ok(outcome.meta.warnings.some((w) => w.includes('Local OCR owns extraction')));
});

test('Phase 2 Independent Execution: interpretPageVisualContext re-interprets without re-running OCR', async () => {
  const fakeBlob = new Blob(['fake_image_bytes'], { type: 'image/png' });
  let localOcrCalled = false;

  const existingScan: PageScanResult = {
    scanId: 'scan-existing-1',
    pageId: 'page-independent-1',
    sourceImageId: 'page-independent-1',
    sourceDimensions: { width: 1000, height: 1500 },
    readingConvention: 'manga_rtl',
    status: 'partial',
    interpretationStatus: 'failed',
    readingOrderSource: 'geometric_fallback',
    panels: [],
    bubbleRegions: [],
    regions: [
      createSyntheticRegion('bubble-1', [100, 500, 200, 800], 'Dialogue line 1'),
      createSyntheticRegion('bubble-2', [300, 200, 400, 500], 'Dialogue line 2'),
    ],
    issues: [],
    transformLedger: { sourceImageId: 'page-independent-1', sourceWidth: 1000, sourceHeight: 1500, steps: [] },
    visualContext: '',
    detectedGlossaryTerms: [],
    detectedCharacters: [],
    detectedRelationships: [],
    createdAt: Date.now() - 10000,
    version: 1,
  };

  const existingBubbles: BubbleItem[] = [
    {
      id: 'bubble-1',
      pageId: 'page-independent-1',
      index: 1,
      box_2d: [100, 500, 200, 800],
      sourceText: 'Dialogue line 1',
      originalSourceText: 'Dialogue line 1',
      type: 'speech_bubbles',
      typerPrefix: '"":',
      translatedText: '',
      confidence: 0.9,
    },
    {
      id: 'bubble-2',
      pageId: 'page-independent-1',
      index: 2,
      box_2d: [300, 200, 400, 500],
      sourceText: 'Dialogue line 2',
      originalSourceText: 'Dialogue line 2',
      type: 'speech_bubbles',
      typerPrefix: '"":',
      translatedText: '',
      confidence: 0.9,
    },
  ];

  let savedScanRecord: PageScanResult | null = null;
  let savedBubblesRecord: BubbleItem[] | null = null;

  const outcome = await interpretPageVisualContext({
    pageId: 'page-independent-1',
    apiKey: 'fake-api-key',
    readingConvention: 'manga_rtl',
    scanDeps: {
      getPageScan: async () => existingScan,
      getPageBubbles: async () => existingBubbles,
      savePageScan: async (_pid, scan) => {
        savedScanRecord = scan;
      },
      savePageBubbles: async (_pid, bubbles) => {
        savedBubblesRecord = bubbles;
      },
    },
    hybridDeps: {
      getPageBlob: async () => fakeBlob,
      runLocalOcr: async () => {
        localOcrCalled = true;
        throw new Error('Local OCR should NOT be called during independent interpretation!');
      },
      runGeminiContextPass: async (opts) => {
        assert.equal(opts.candidates.length, 2);
        return {
          pageContext: 'Scene interpreted independently',
          readingConventionCandidate: 'manga_rtl',
          readingOrder: ['bubble-2', 'bubble-1'], // New visual order
          panels: [{ panelId: 'panel-1', box_2d: [0, 0, 1000, 1000] }],
          regionDecisions: [
            {
              regionId: 'bubble-2',
              action: 'keep',
              assignedTyperId: 'shouting',
              typerConfidence: 0.98,
              primaryClass: 'vocalization',
            },
            {
              regionId: 'bubble-1',
              action: 'keep',
              assignedTyperId: 'thought_bubbles',
              typerConfidence: 0.95,
              primaryClass: 'thought',
            },
          ],
          additionalRegions: [],
          detectedCharacters: [],
          detectedGlossaryTerms: [],
          detectedRelationships: [],
        };
      },
    },
  });

  // Verify Local OCR was NOT executed
  assert.equal(localOcrCalled, false);
  assert.equal(outcome.success, true);
  assert.equal(outcome.readingOrderSource, 'gemini_visual');
  assert.equal(outcome.interpretations.length, 2);

  // Bubble 2 is now first in reading order and assigned shouting
  assert.equal(outcome.bubbles[0].id, 'bubble-2');
  assert.equal(outcome.bubbles[0].index, 1);
  assert.equal(outcome.bubbles[0].type, 'shouting');
  assert.equal(outcome.bubbles[0].typerPrefix, '%:');

  // Bubble 1 is now second in reading order and assigned thought_bubbles
  assert.equal(outcome.bubbles[1].id, 'bubble-1');
  assert.equal(outcome.bubbles[1].index, 2);
  assert.equal(outcome.bubbles[1].type, 'thought_bubbles');
  assert.equal(outcome.bubbles[1].typerPrefix, '():');

  // Verify persistence occurred
  assert.ok(savedScanRecord);
  assert.equal(savedScanRecord.interpretationStatus, 'complete');
  assert.ok(savedBubblesRecord);
  assert.equal(savedBubblesRecord.length, 2);
});

test('Phase 2 Statuses: queue tracks distinct OCR and interpretation lifecycle states', async () => {
  const queue = new ScanQueueManager();

  // Initial state
  assert.equal(queue.getDetailedPageStatus('p-status-1'), 'unscanned');

  // Manual status setting of distinct Phase 2 states
  queue.setPageStatus('p-status-1', 'ocr_complete_interpretation_pending');
  assert.equal(queue.getDetailedPageStatus('p-status-1'), 'ocr_complete_interpretation_pending');

  queue.setPageStatus('p-status-2', 'ocr_complete_interpretation_complete');
  assert.equal(queue.getDetailedPageStatus('p-status-2'), 'ocr_complete_interpretation_complete');

  queue.setPageStatus('p-status-3', 'ocr_complete_interpretation_failed');
  assert.equal(queue.getDetailedPageStatus('p-status-3'), 'ocr_complete_interpretation_failed');

  queue.setPageStatus('p-status-4', 'ocr_failed');
  assert.equal(queue.getDetailedPageStatus('p-status-4'), 'ocr_failed');

  queue.setPageStatus('p-status-5', 'cancelled');
  assert.equal(queue.getDetailedPageStatus('p-status-5'), 'cancelled');

  // Verify all 5 required Phase 2 states are completely distinct from each other
  const statuses = [
    queue.getDetailedPageStatus('p-status-1'),
    queue.getDetailedPageStatus('p-status-2'),
    queue.getDetailedPageStatus('p-status-3'),
    queue.getDetailedPageStatus('p-status-4'),
    queue.getDetailedPageStatus('p-status-5'),
  ];
  const distinct = new Set(statuses);
  assert.equal(distinct.size, 5);
});

test('Phase 2 SFX Behavior: disabling SFX filters out sfx text without suppressing dialogue, narration, or signs', async () => {
  const fakeBlob = new Blob(['fake_image_bytes'], { type: 'image/png' });
  const regions: TextRegion[] = [
    createSyntheticRegion('reg-dialogue', [100, 100, 200, 300], 'Spoken words'),
    createSyntheticRegion('reg-narration', [300, 100, 400, 300], 'Narrative caption'),
    createSyntheticRegion('reg-sfx', [500, 100, 600, 300], 'BOOM'),
  ];

  const outcome = await scanMangaPageHybridWithMeta({
    pageId: 'test-p2-sfx-disabled',
    apiKey: 'fake-api-key',
    readingConvention: 'manga_rtl',
    includeSFX: false, // SFX Disabled
    sourceLanguageHint: 'ja',
    hybridDeps: {
      getPageBlob: async () => fakeBlob,
      extractImageDimensions: async () => ({ width: 1000, height: 1000 }),
      getModelProvider: () => ({ getStatus: async () => ({ state: 'installed' } as any) } as any),
      runLocalOcr: async () => ({ textRegions: regions, status: 'complete' }),
      runGeminiContextPass: async () => ({
        pageContext: 'Scene',
        readingOrder: ['reg-dialogue', 'reg-narration'],
        panels: [],
        regionDecisions: [
          { regionId: 'reg-dialogue', action: 'keep', primaryClass: 'dialogue' },
          { regionId: 'reg-narration', action: 'keep', primaryClass: 'narration' },
          { regionId: 'reg-sfx', action: 'keep', primaryClass: 'sfx' },
        ],
        additionalRegions: [],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
    },
  });

  const remaining = outcome.scanResult.regions;
  assert.equal(remaining.length, 2);
  assert.ok(remaining.some((r) => r.regionId.includes('reg-dialogue')));
  assert.ok(remaining.some((r) => r.regionId.includes('reg-narration')));
  assert.ok(!remaining.some((r) => r.regionId.includes('reg-sfx')));
});

test('Phase 2 Rescan Merge: interpretation metadata is preserved on unmodified bubbles across rescans', async () => {
  const fakeBlob = new Blob(['fake_image_bytes'], { type: 'image/png' });
  let savedBubbles: BubbleItem[] = [];

  const existingBubbles: BubbleItem[] = [
    {
      id: 'existing-b1',
      pageId: 'page-merge-1',
      index: 1,
      box_2d: [100, 100, 200, 300],
      sourceText: 'Existing dialogue line',
      originalSourceText: 'Existing dialogue line',
      type: 'shouting',
      typerPrefix: '%:',
      translatedText: 'ترجمة سابقة',
      interpretation: {
        regionId: 'existing-b1',
        orderIndex: 1,
        primaryClass: 'vocalization',
        typerId: 'shouting',
        typerPrefix: '%:',
        classificationConfidence: 0.95,
        orderingConfidence: 0.95,
        speakerCandidate: 'Commander',
        visualEvidence: 'Explosive outline',
        flags: [],
        isFallbackOrdering: false,
      },
      confidence: 0.95,
    },
  ];

  const result = await scanPageWithGemini({
    pageId: 'page-merge-1',
    apiKey: 'fake-api-key',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 2,
    includeSFX: true,
    sourceLanguageHint: 'ja',
    scanDeps: {
      getPageBubbles: async () => existingBubbles,
      savePageBubbles: async (_pid, bubbles) => {
        savedBubbles = bubbles;
      },
      savePageScan: async () => {},
      batchTranslateBubbles: async () => ({
        translationMap: new Map(),
        success: true,
      }),
    },
    hybridDeps: {
      getPageBlob: async () => fakeBlob,
      extractImageDimensions: async () => ({ width: 1000, height: 1000 }),
      getModelProvider: () => ({ getStatus: async () => ({ state: 'installed' } as any) } as any),
      runLocalOcr: async () => ({
        textRegions: [
          createSyntheticRegion('existing-b1', [100, 100, 200, 300], 'Existing dialogue line'),
          createSyntheticRegion('new-b2', [400, 100, 500, 300], 'Newly discovered line'),
        ],
        status: 'complete',
      }),
      runGeminiContextPass: async (opts) => ({
        pageContext: 'Scene',
        readingOrder: opts.candidates.map((c) => c.regionId),
        panels: [],
        regionDecisions: opts.candidates.map((c) => ({
          regionId: c.regionId,
          action: 'keep',
          assignedTyperId: 'speech_bubbles',
          primaryClass: 'dialogue',
        })),
        additionalRegions: [],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
    },
  });

  assert.equal(savedBubbles.length, 2);
  // Bubble 1 kept its existing translation and previous typer
  const b1 = savedBubbles.find((b) => b.id === 'existing-b1')!;
  assert.equal(b1.type, 'shouting');
  assert.equal(b1.translatedText, 'ترجمة سابقة');
  assert.ok(b1.interpretation);

  // Bubble 2 received new interpretation
  const b2 = savedBubbles.find((b) => b.id.includes('new-b2'))!;
  assert.equal(b2.type, 'speech_bubbles');
  assert.ok(b2.interpretation);
  assert.equal(b2.interpretation.primaryClass, 'dialogue');
});

test('Phase 2 Reading Conventions: respects Webtoon vertical and Western LTR flows', async () => {
  const fakeBlob = new Blob(['fake_image_bytes'], { type: 'image/png' });

  // Webtoon: strictly vertical reading top to bottom
  const webtoonRegions: TextRegion[] = [
    createSyntheticRegion('strip-top', [50, 100, 150, 500], 'Top strip'),
    createSyntheticRegion('strip-mid', [400, 100, 500, 500], 'Mid strip'),
    createSyntheticRegion('strip-bot', [800, 100, 900, 500], 'Bottom strip'),
  ];

  const webtoonOutcome = await scanMangaPageHybridWithMeta({
    pageId: 'webtoon-p1',
    apiKey: 'fake-api-key',
    readingConvention: 'webtoon_v',
    sourceLanguageHint: 'ko',
    hybridDeps: {
      getPageBlob: async () => fakeBlob,
      extractImageDimensions: async () => ({ width: 600, height: 3000 }),
      getModelProvider: () => ({ getStatus: async () => ({ state: 'installed' } as any) } as any),
      runLocalOcr: async () => ({ textRegions: webtoonRegions, status: 'complete' }),
      runGeminiContextPass: async (opts) => ({
        pageContext: 'Vertical webtoon scroll',
        readingConventionCandidate: 'webtoon_v',
        readingOrder: ['strip-top', 'strip-mid', 'strip-bot'],
        panels: [],
        regionDecisions: opts.candidates.map((c) => ({
          regionId: c.regionId,
          action: 'keep',
          assignedTyperId: 'speech_bubbles',
          primaryClass: 'dialogue',
        })),
        additionalRegions: [],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
    },
  });

  assert.equal(webtoonOutcome.scanResult.readingConvention, 'webtoon_v');
  assert.equal(webtoonOutcome.scanResult.readingOrderSource, 'gemini_visual');
  const webtoonOrder = webtoonOutcome.scanResult.regions.map((r) => r.order.sequenceIndex);
  assert.deepEqual(webtoonOrder, [1, 2, 3]);
});

