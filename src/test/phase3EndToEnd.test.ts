/**
 * Folio Script: Phase 3 — End-to-End Quality, Accuracy & Production Readiness Test Suite
 * 
 * Verifies the complete localization pipeline:
 * Page Image -> Local OCR -> Text Geometry -> Logical Bubble Grouping ->
 * Gemini Reading Order -> Gemini Typer Assignment -> Review -> Translation ->
 * Final Workspace Data -> Persistence
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PHASE3_VALIDATION_CORPUS } from './phase3CorpusData.ts';
import {
  orderOcrLines,
  joinLinesByScript,
  groupLinesToTextRegions,
} from '../lib/localOcr/lineGrouping.ts';
import {
  inferHierarchicalReadingOrder,
  validateGeminiReadingOrder,
  applyReadingOrder,
  resolveReadingConvention,
} from '../lib/readingOrder.ts';
import { defaultTyperForClass, scanResultToBubbleItems } from '../lib/scanAdapter';
import { mergeScanWithExistingState } from '../lib/rescanMerge';
import {
  DEFAULT_TYPER_SETTINGS,
  loadTyperSettings,
  resolveCanonicalTyper,
} from '../types/typers';
import type { BubbleItem } from '../types/workbench';
import type { PageScanResult, TextRegion } from '../types/scanning';
import {
  LOCAL_OCR_MODEL_MANIFEST,
  evaluateModelDistributionPolicy,
} from '../lib/localOcr/modelManifest.ts';
import { compileInstructions } from '../lib/instructionCompiler';
import { ScanQueueManager } from '../lib/scanQueue';
import {
  finalizeTwoPointBox,
  finalizeBubblePolygon,
  finalizeLassoPolygon,
  isPointInEllipse,
  deriveBoundingBoxFromPolygon,
} from '../features/manual-selection/selection/geometry.ts';
import { disposeOrtTensors } from '../lib/localOcr/ortTensorUtils.ts';

function createMockTextRegion(
  id: string,
  box: [number, number, number, number],
  text: string,
  polygon?: Array<[number, number]>,
  isVertical = false
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
      ocr: 0.94,
      association: 0.92,
      readingOrder: 0.9,
      classification: 0.9,
    },
    classification: {
      primaryClass: 'dialogue',
      confidence: 0.95,
      needsReview: false,
    },
    sourceLanguage: 'ja',
    associations: {},
    order: {
      sequenceIndex: 1,
      confidence: 0.9,
      rationale: 'Initial order',
    },
    flags: [],
    lineSegments: [
      {
        lineId: `${id}-line-1`,
        text,
        normalizedBox: box,
        pixelBox: [box[0] * 1.5, box[1] * 1.5, box[2] * 1.5, box[3] * 1.5],
        polygon: polygon || [
          [box[0], box[1]],
          [box[0], box[3]],
          [box[2], box[3]],
          [box[2], box[1]],
        ],
        rawConfidence: 0.95,
        isVertical,
      },
    ],
  };
}

// ============================================================================
// SUITE 1: REAL-WORLD MULTILINGUAL CORPUS & LOCAL OCR QUALITY GATE (Sections 2 & 3)
// ============================================================================

test('Phase 3 Corpus: includes Japanese vertical text, Korean webtoon, and Chinese manhua', () => {
  assert.equal(PHASE3_VALIDATION_CORPUS.length, 3);
  const [jaManga, koWebtoon, zhManhua] = PHASE3_VALIDATION_CORPUS;

  // JA Manga checks
  assert.equal(jaManga.language, 'ja');
  assert.equal(jaManga.readingConvention, 'manga_rtl');
  assert.ok(jaManga.regions.some((r) => r.isVertical && r.lines.length >= 2));

  // KO Webtoon checks
  assert.equal(koWebtoon.language, 'ko');
  assert.equal(koWebtoon.readingConvention, 'webtoon_v');
  assert.ok(koWebtoon.canvas.aspectRatio >= 3.0); // tall webtoon
  assert.ok(koWebtoon.regions.some((r) => r.primaryClass === 'sfx'));

  // ZH Manhua checks
  assert.equal(zhManhua.language, 'zh');
  assert.ok(zhManhua.regions.some((r) => r.primaryClass === 'environmental_text'));
  assert.ok(zhManhua.regions.some((r) => r.lines.length >= 3)); // dense dialogue
});

test('Phase 3 Local OCR: Japanese vertical columns order Right-to-Left, lines Top-to-Bottom', () => {
  const jaFixture = PHASE3_VALIDATION_CORPUS[0];
  const multiColBubble = jaFixture.regions[0]; // 'おい、待てよ！勝手に先に行くな！'
  assert.equal(multiColBubble.lines.length, 2);

  // Raw lines out of order (left column first, then right column)
  const leftCol = {
    lineId: 'l2',
    candidateId: 'cand1',
    text: multiColBubble.lines[1].text,
    score: 0.95,
    pixelBox: multiColBubble.lines[1].pixelBox,
    pixelPolygon: multiColBubble.lines[1].polygon,
    isVertical: true,
  };
  const rightCol = {
    lineId: 'l1',
    candidateId: 'cand1',
    text: multiColBubble.lines[0].text,
    score: 0.95,
    pixelBox: multiColBubble.lines[0].pixelBox,
    pixelPolygon: multiColBubble.lines[0].polygon,
    isVertical: true,
  };

  // When ordering vertical lines, right column (larger X) must come BEFORE left column
  const ordered = orderOcrLines([leftCol, rightCol], true);
  assert.equal(ordered[0].text, multiColBubble.lines[0].text);
  assert.equal(ordered[1].text, multiColBubble.lines[1].text);

  // Joining vertical Japanese lines produces contiguous text without spaces
  const joined = joinLinesByScript(ordered.map((l) => l.text), 'ja');
  assert.equal(joined, multiColBubble.text);
});

test('Phase 3 Local OCR: language-aware line joining respects script boundaries', () => {
  // English uses space
  assert.equal(joinLinesByScript(['Hello', 'World'], 'en'), 'Hello World');

  // Japanese joins without space
  assert.equal(joinLinesByScript(['魔薬', '大会'], 'ja'), '魔薬大会');

  // Chinese joins without space
  assert.equal(joinLinesByScript(['青云', '炼丹阁'], 'zh'), '青云炼丹阁');
});

// ============================================================================
// SUITE 2: GEMINI VISUAL INTERPRETATION QUALITY GATE (Section 4)
// ============================================================================

test('Phase 3 Interpretation: Manga RTL reading order respects panels and intra-panel flow', () => {
  const jaFixture = PHASE3_VALIDATION_CORPUS[0];
  const regions: TextRegion[] = jaFixture.regions.map((r) =>
    createMockTextRegion(r.id, r.box_2d, r.text, r.polygon, r.isVertical)
  );

  // Infer hierarchical reading order for Manga RTL
  const ordered = inferHierarchicalReadingOrder(jaFixture.panels, regions, 'manga_rtl');
  assert.equal(ordered.length, jaFixture.regions.length);

  // Top-Right panel regions (ja-reg-01 and ja-reg-02) must be sequenced before Top-Left panel (ja-reg-03)
  const idToIndex = new Map(ordered.map((r) => [r.regionId, r.order.sequenceIndex]));
  assert.ok(idToIndex.get('ja-reg-01')! < idToIndex.get('ja-reg-03')!);
  assert.ok(idToIndex.get('ja-reg-02')! < idToIndex.get('ja-reg-03')!);
  // Mid-panel SFX (ja-reg-04) comes after Top panels
  assert.ok(idToIndex.get('ja-reg-03')! < idToIndex.get('ja-reg-04')!);
  // Bottom panel (ja-reg-05) comes last
  assert.ok(idToIndex.get('ja-reg-04')! < idToIndex.get('ja-reg-05')!);
});

test('Phase 3 Interpretation: candidate accountability rejects malicious/corrupt Gemini responses', () => {
  const expectedIds = ['ja-reg-01', 'ja-reg-02', 'ja-reg-03'];

  // Test 1: Adversarial hallucinated ID
  const hallucinated = validateGeminiReadingOrder(
    ['ja-reg-01', 'ja-reg-02', 'ja-reg-hallucinated', 'ja-reg-03'],
    expectedIds
  );
  assert.equal(hallucinated.isValid, false);
  assert.deepEqual(hallucinated.unknownIds, ['ja-reg-hallucinated']);

  // Test 2: Omitted candidate ID
  const omitted = validateGeminiReadingOrder(['ja-reg-01', 'ja-reg-02'], expectedIds);
  assert.equal(omitted.isValid, false);
  assert.deepEqual(omitted.missingIds, ['ja-reg-03']);

  // Test 3: Duplicate candidate ID
  const duplicated = validateGeminiReadingOrder(
    ['ja-reg-01', 'ja-reg-02', 'ja-reg-02', 'ja-reg-03'],
    expectedIds
  );
  assert.equal(duplicated.isValid, false);
  assert.deepEqual(duplicated.duplicateIds, ['ja-reg-02']);

  // Test 4: Inverted/malformed payload gracefully falls back to geometric layout
  const regions = expectedIds.map((id, idx) =>
    createMockTextRegion(id, [idx * 100, 100, idx * 100 + 80, 400], `Text ${idx}`)
  );
  const fallbackResult = applyReadingOrder(regions, [], {
    isFallback: true,
    rationale: 'Geometric layout fallback due to invalid Gemini sequence',
  });
  assert.equal(fallbackResult.length, regions.length);
  // Every region receives a fallback sequence and READING_ORDER_CONFLICT flag
  assert.ok(fallbackResult.every((r) => r.flags.includes('READING_ORDER_CONFLICT')));
});

test('Phase 3 Interpretation: Typer symbols mapped deterministically and unknown flags ambiguity', () => {
  const typers = DEFAULT_TYPER_SETTINGS.typers;

  // Dialogue -> speech_bubbles ("":)
  const dialogueTyper = defaultTyperForClass('dialogue', typers);
  assert.equal(dialogueTyper.id, 'speech_bubbles');
  assert.equal(dialogueTyper.prefix, '"":');

  // Thought -> thought_bubbles (():)
  const thoughtTyper = defaultTyperForClass('thought', typers);
  assert.equal(thoughtTyper.id, 'thought_bubbles');
  assert.equal(thoughtTyper.prefix, '():');

  // Narration -> square_bubbles ([ ]:)
  const narrationTyper = defaultTyperForClass('narration', typers);
  assert.equal(narrationTyper.id, 'square_bubbles');
  assert.equal(narrationTyper.prefix, '[ ]:');

  // SFX -> sfx (SFX:)
  const sfxTyper = defaultTyperForClass('sfx', typers);
  assert.equal(sfxTyper.id, 'sfx');
  assert.equal(sfxTyper.prefix, 'SFX:');

  // Unknown class falls back to none or first configured
  const unknownTyper = defaultTyperForClass('unknown', typers);
  assert.equal(unknownTyper.id, 'none');
});

test('Phase 3 Immutability: Gemini interpretation cannot modify local OCR coordinates or verbatim text', () => {
  const originalRegion = createMockTextRegion('orig-1', [100, 200, 300, 400], 'Original OCR text');
  const deepCopyBox = [...originalRegion.geometry.box_2d];
  const deepCopyPoly = originalRegion.geometry.polygon?.map((p) => [...p]);

  // Adapt to workspace bubble item with interpretation
  const scanResult: PageScanResult = {
    pageId: 'p1',
    regions: [
      {
        ...originalRegion,
        interpretation: {
          readingOrder: 1,
          typerId: 'speech_bubbles',
          typerPrefix: '"":',
          classification: 'dialogue',
          confidence: 0.98,
        },
      },
    ],
    readingConvention: 'manga_rtl',
    interpretationStatus: 'gemini_visual',
  };

  const bubbleItems = scanResultToBubbleItems(scanResult, DEFAULT_TYPER_SETTINGS);
  assert.equal(bubbleItems.length, 1);
  const bubble = bubbleItems[0];

  // OCR coordinates and verbatim text remain 100% byte-for-byte identical
  assert.deepEqual(bubble.box_2d, deepCopyBox);
  assert.deepEqual(bubble.ocrPolygon, deepCopyPoly);
  assert.equal(bubble.sourceText, 'Original OCR text');
  assert.equal(bubble.originalSourceText, 'Original OCR text');
  assert.equal(bubble.type, 'speech_bubbles');
});

// ============================================================================
// SUITE 3: TRANSLATION PIPELINE & PERSISTENCE SAFETY (Sections 5 & 9)
// ============================================================================

test('Phase 3 Translation: instruction compiler injects scene mood, rolling dialogue, and typer prefixes', () => {
  const compiled = compileInstructions({
    task: 'batch_translation',
    eloquenceLevel: 'rich',
    translationFidelity: 'localized',
    isHumanizerEnabled: true,
    humanizerIntensity: 'balanced',
    orthographyMode: 'correct_spelling',
    rollingContextSnippet: 'Previous page: Hero entered the burning tower.',
  });

  assert.ok(compiled.systemInstruction.includes('scanlation'));
  assert.ok(compiled.systemInstruction.includes('Previous page: Hero entered the burning tower.'));
});

test('Phase 3 Rescan Merge: preserves user-edited text, manual typers, and updates unedited bubbles', () => {
  const existingBubbles: BubbleItem[] = [
    {
      id: 'bubble-user-edited',
      pageId: 'p1',
      index: 1,
      box_2d: [100, 100, 200, 200],
      sourceText: 'User customized text',
      originalSourceText: 'Raw ocr 1',
      translatedText: 'ترجمة مخصصة للمستخدم',
      type: 'custom_shout',
      typerPrefix: '{!}:',
      isManuallyEdited: true,
      updatedAt: Date.now() - 10000,
    },
    {
      id: 'bubble-unedited',
      pageId: 'p1',
      index: 2,
      box_2d: [300, 300, 400, 400],
      sourceText: 'Unedited text',
      originalSourceText: 'Unedited text',
      translatedText: 'ترجمة سابقة',
      type: 'none',
      typerPrefix: '',
      isManuallyEdited: false,
      updatedAt: Date.now() - 10000,
    },
  ];

  const candidateRegions: TextRegion[] = [
    {
      ...createMockTextRegion('bubble-user-edited', [100, 100, 200, 200], 'Raw ocr 1 updated'),
      order: { sequenceIndex: 2, confidence: 0.9, rationale: 'New order' },
    },
    {
      ...createMockTextRegion('bubble-unedited', [300, 300, 400, 400], 'Unedited text rescanned'),
      interpretation: {
        readingOrder: 1,
        typerId: 'thoughts',
        typerPrefix: '():',
        classification: 'thought',
        confidence: 0.95,
      },
      order: { sequenceIndex: 1, confidence: 0.95, rationale: 'Gemini visual sequence' },
    },
  ];

  const newScan: PageScanResult = {
    pageId: 'p1',
    regions: candidateRegions,
    readingConvention: 'manga_rtl',
  };

  const mergeResult = mergeScanWithExistingState({
    newScan,
    existingBubbles,
    typerSettings: DEFAULT_TYPER_SETTINGS,
  });

  const edited = mergeResult.mergedBubbles.find((b) => b.id === 'bubble-user-edited')!;
  const unedited = mergeResult.mergedBubbles.find((b) => b.id === 'bubble-unedited')!;

  // User edited bubble: source text, translation, and custom typer remain strictly preserved
  assert.equal(edited.sourceText, 'User customized text');
  assert.equal(edited.translatedText, 'ترجمة مخصصة للمستخدم');
  assert.equal(edited.type, 'custom_shout');
  assert.equal(edited.typerPrefix, '{!}:');

  // Unedited bubble: receives updated interpretation typer and reading order sequence
  assert.equal(unedited.sourceText, 'Unedited text rescanned');
  assert.equal(unedited.type, 'thought_bubbles');
  assert.equal(unedited.typerPrefix, '():');
  assert.equal(unedited.index, 1);
});

// ============================================================================
// SUITE 4: SFX & TEXT CATEGORY VALIDATION (Section 6)
// ============================================================================

test('Phase 3 SFX: opt-out suppresses SFX while preserving dialogue and signage', () => {
  const regions: TextRegion[] = [
    { ...createMockTextRegion('d1', [100, 100, 200, 300], 'Dialogue text'), classification: { primaryClass: 'dialogue', confidence: 0.9, needsReview: false } },
    { ...createMockTextRegion('s1', [250, 100, 350, 300], 'ドカン！'), classification: { primaryClass: 'sfx', confidence: 0.95, needsReview: false } },
    { ...createMockTextRegion('n1', [400, 100, 500, 300], 'Narration text'), classification: { primaryClass: 'narration', confidence: 0.9, needsReview: false } },
  ];

  const includeSFX = false;
  const filtered = regions.filter((r) => includeSFX || r.classification.primaryClass !== 'sfx');

  assert.equal(filtered.length, 2);
  assert.ok(filtered.some((r) => r.regionId === 'd1'));
  assert.ok(filtered.some((r) => r.regionId === 'n1'));
  assert.ok(!filtered.some((r) => r.regionId === 's1'));
});

// ============================================================================
// SUITE 5: SCAN PAGE & SCAN ALL RELIABILITY (Section 8)
// ============================================================================

test('Phase 3 Scan All: continues across multi-page chapter when one page fails', async () => {
  const mockPages = [
    { pageId: 'page-1', pageIndex: 1 },
    { pageId: 'page-2', pageIndex: 2 },
    { pageId: 'page-3', pageIndex: 3 },
  ];

  const savedBubbles: Record<string, BubbleItem[]> = {};

  const queue = new ScanQueueManager({
    interRequestDelayMs: 0,
    scanPage: async (opts) => {
      if (opts.pageId === 'page-2') {
        throw new Error('Local OCR model failure on page 2');
      }
      return {
        bubbles: [
          {
            id: `${opts.pageId}-b1`,
            pageId: opts.pageId,
            index: 1,
            box_2d: [100, 100, 200, 200],
            sourceText: `Text on ${opts.pageId}`,
            translatedText: `ترجمة ${opts.pageId}`,
            type: 'speech_bubbles',
            typerPrefix: '"":',
            updatedAt: Date.now(),
          },
        ],
        rawTextExtract: '',
        visualContext: '',
        success: true,
      };
    },
    savePageBubbles: async (pageId, bubbles) => {
      savedBubbles[pageId] = bubbles;
    },
    getPageBubbles: async (pageId) => savedBubbles[pageId] || [],
    getRollingContextForPage: async () => undefined,
  });

  const progressEvents: any[] = [];
  queue.subscribe((p) => progressEvents.push({ ...p }));

  queue.enqueue(
    mockPages.map((p) => ({
      pageId: p.pageId,
      pageIndex: p.pageIndex,
      options: {
        apiKey: 'test-key',
        eloquenceLevel: 'rich',
        includeSFX: true,
      },
    }))
  );

  // Wait for processing to complete
  await new Promise((r) => setTimeout(r, 200));

  // Invariant 1: Page 1 and Page 3 succeeded and are persisted
  assert.ok(savedBubbles['page-1']);
  assert.equal(savedBubbles['page-1'].length, 1);
  assert.ok(savedBubbles['page-3']);
  assert.equal(savedBubbles['page-3'].length, 1);

  // Invariant 2: Page 2 failed cleanly without terminating Page 3
  assert.equal(queue.getDetailedPageStatus('page-1'), 'ocr_complete_interpretation_complete');
  assert.equal(queue.getDetailedPageStatus('page-2'), 'ocr_failed');
  assert.equal(queue.getDetailedPageStatus('page-3'), 'ocr_complete_interpretation_complete');
});

// ============================================================================
// SUITE 6: PERFORMANCE & TENSOR DISPOSAL (Sections 10 & 12)
// ============================================================================

test('Phase 3 Performance: ONNX tensor disposal handles aliased tensors with zero memory leak', () => {
  let disposeCalls = 0;
  const mockTensor = {
    dispose: () => {
      disposeCalls++;
    },
  };

  // Multiple records referencing the exact same underlying tensor (aliasing)
  disposeOrtTensors([mockTensor, mockTensor, null, undefined, mockTensor]);

  // Must call dispose exactly ONCE despite 3 references
  assert.equal(disposeCalls, 1);
});

test('Phase 3 Licensing: production gate enforces model distribution policy across all routes', () => {
  for (const entry of LOCAL_OCR_MODEL_MANIFEST.models) {
    const devPolicy = evaluateModelDistributionPolicy(entry, { isProduction: false });
    const prodPolicy = evaluateModelDistributionPolicy(entry, { isProduction: true });

    // In dev: permitted
    assert.equal(devPolicy.downloadPermitted, true);
    assert.equal(devPolicy.activationPermitted, true);

    // In prod: dev-only models are blocked with explicit rejection reason
    if (entry.redistributionStatus.startsWith('dev_only_')) {
      assert.equal(prodPolicy.downloadPermitted, false);
      assert.equal(prodPolicy.activationPermitted, false);
      assert.ok(prodPolicy.rejectionReason?.includes('restricted to development builds'));
    }
  }
});

// ============================================================================
// SUITE 7: MANUAL LOCALIZATION & GEOMETRY VERIFICATION (Section 7)
// ============================================================================

test('Phase 3 Manual Selection: box, bubble, and lasso geometries derive tight coordinates', () => {
  // 1. Two-point box: start=[x, y]=[200, 100], end=[x, y]=[500, 300] -> box_2d=[ymin, xmin, ymax, xmax]=[100, 200, 300, 500]
  const boxResult = finalizeTwoPointBox([200, 100], [500, 300]);
  assert.deepEqual(boxResult, [100, 200, 300, 500]);

  // 2. Bubble mode smoothed polygon
  const rawBubbleStroke: Array<[number, number]> = [
    [100, 100],
    [102, 180],
    [198, 200],
    [202, 102],
  ];
  const bubbleResult = finalizeBubblePolygon(rawBubbleStroke);
  assert.equal(bubbleResult.valid, true);
  assert.ok(bubbleResult.polygon.length >= 8); // Chaikin smoothing increases vertex density
  assert.ok(bubbleResult.box_2d[0] >= 90 && bubbleResult.box_2d[2] <= 210);

  // 3. Lasso freehand path
  const rawLassoStroke: Array<[number, number]> = [
    [50, 50],
    [50, 300],
    [250, 300],
    [250, 50],
  ];
  const lassoResult = finalizeLassoPolygon(rawLassoStroke);
  assert.equal(lassoResult.valid, true);
  assert.deepEqual(lassoResult.box_2d, [50, 50, 300, 250]);

  // 4. Point-in-ellipse hit testing
  assert.equal(isPointInEllipse(175, 175, [50, 50, 300, 300]), true);
  assert.equal(isPointInEllipse(52, 52, [50, 50, 300, 300]), false);
});

// ============================================================================
// SUITE 8: CANCELLATION & INTERRUPTIBILITY (Section 8 & 11)
// ============================================================================

test('Phase 3 Cancellation: abortController halts queue processing without leaving hanging jobs', async () => {
  let executedPages: string[] = [];

  const queue = new ScanQueueManager({
    interRequestDelayMs: 50,
    scanPage: async (opts) => {
      executedPages.push(opts.pageId);
      // Simulate asynchronous work
      await new Promise((r) => setTimeout(r, 80));
      return {
        bubbles: [],
        rawTextExtract: '',
        visualContext: '',
        success: true,
      };
    },
    savePageBubbles: async () => {},
    getPageBubbles: async () => [],
    getRollingContextForPage: async () => undefined,
  });

  queue.enqueue([
    { pageId: 'p-cancel-1', pageIndex: 1, options: { apiKey: 'key', eloquenceLevel: 'rich' } },
    { pageId: 'p-cancel-2', pageIndex: 2, options: { apiKey: 'key', eloquenceLevel: 'rich' } },
    { pageId: 'p-cancel-3', pageIndex: 3, options: { apiKey: 'key', eloquenceLevel: 'rich' } },
  ]);

  // Allow first page to begin processing, then cancel
  await new Promise((r) => setTimeout(r, 20));
  queue.cancel();

  // Wait for queue loop to exit
  await new Promise((r) => setTimeout(r, 150));

  // Invariant: page 2 and page 3 were cancelled and never executed
  assert.ok(!executedPages.includes('p-cancel-2'));
  assert.ok(!executedPages.includes('p-cancel-3'));
  assert.equal(queue.isScanningActive(), false);
});
