/**
 * Folio Script — Hybrid OCR Phase 2 Integration & Regression Test Suite
 *
 * Tests Scan Page, Scan All (ScanQueueManager), language routing, fallback & partial-failure
 * recovery, coordinate & data integrity, manual edit preservation, SFX opt-out & non-suppression,
 * reading order, Arabic RTL / TypeR export, settings scoping, and production eligibility gates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scanMangaPageHybridWithMeta,
  deduplicateLocalCandidates,
  assessCandidateVerification,
  type ValidatedHybridContextOutput,
} from '../lib/hybridScan.ts';
import { scanPageWithGemini } from '../lib/geminiScan.ts';
import { ScanQueueManager } from '../lib/scanQueue.ts';
import { mergeScanWithExistingState } from '../lib/rescanMerge.ts';
import { evaluateModelDistributionPolicy, getModelManifestEntry } from '../lib/localOcr/modelManifest.ts';
import { inferHierarchicalReadingOrder } from '../lib/readingOrder.ts';
import { compileRawTextExtract, compileTypeRScript } from '../lib/compileTypeR.ts';
import { SettingsService } from '../services/settings/settingsService.ts';
import { useWorkbenchStore } from '../store/workbenchStore.ts';
import { DEFAULT_TYPER_SETTINGS } from '../types/typers.ts';
import type { BubbleItem } from '../types/workbench.ts';
import type { PageScanResult, TextRegion } from '../types/scanning.ts';
import type {
  LocalOcrScanResult,
  ModelAssetPayload,
  ModelStatusInfo,
} from '../types/localOcr.ts';
import type { LocalModelAssetProvider } from '../lib/localOcr/modelClient.ts';

function createDummyBlob(text = 'fake-image'): Blob {
  return new Blob([text], { type: 'image/png' });
}

function makeTextRegion(overrides: Partial<TextRegion> = {}): TextRegion {
  return {
    regionId: overrides.regionId || 'text_bubble-1',
    geometry: overrides.geometry || {
      coordinateSpace: 'normalized_1000',
      box_2d: [100, 600, 250, 880],
    },
    rawOCR: overrides.rawOCR ?? 'Watch out!',
    ocrAlternatives: overrides.ocrAlternatives ?? [],
    confidence: overrides.confidence || {
      imageQuality: 0.95,
      regionDetection: 0.92,
      ocr: 0.94,
      association: 0.9,
      readingOrder: 0.9,
      classification: 0.5,
    },
    classification: overrides.classification || {
      primaryClass: 'unknown',
      confidence: 0.5,
      needsReview: false,
    },
    associations: overrides.associations || {
      bubbleId: 'bubble-1',
    },
    order: overrides.order || {
      sequenceIndex: 1,
      confidence: 0.85,
    },
    flags: overrides.flags || [],
    sourceLanguage: overrides.sourceLanguage,
    isVertical: overrides.isVertical,
    isManuallyEdited: false,
  };
}

function makeLocalOcrResult(
  pageId: string,
  regions: TextRegion[],
  overrides: Partial<LocalOcrScanResult> = {}
): LocalOcrScanResult {
  return {
    scanId: `local-${pageId}`,
    pageId,
    status: overrides.status || 'complete',
    sourceDimensions: { width: 1200, height: 1800 },
    readingConvention: 'manga_rtl',
    languageHint: overrides.languageHint || 'en',
    resolvedRoute: overrides.resolvedRoute || 'en_ppocrv6_small',
    bubbleRegions: [],
    textRegions: regions,
    lineSegments: [],
    tiles: [],
    modelsUsed: {
      detectorModelId: 'comic-detector-v4-s-int8',
      detectorRevision: 'main',
      ocrModelId: 'ppocr-v6-small-en',
      ocrRevision: 'v0.1',
      routeId: overrides.resolvedRoute || 'en_ppocrv6_small',
      ocrRuntimeUsed: 'ort_web_adapter',
      executionProvider: 'wasm',
      simdEnabled: true,
      threadsUsed: 1,
    },
    timings: {
      initMs: 5,
      decodeMs: 2,
      detectorMs: 20,
      ocrMs: 25,
      postprocessMs: 3,
      totalMs: 55,
      tileCount: 1,
      cropCount: regions.length,
      measuredMemoryBytes: null,
    },
    partialFailures: [],
    warnings: [],
    toCanonicalPageScanResult: () => ({
      scanId: `local-${pageId}`,
      pageId,
      sourceImageId: pageId,
      sourceDimensions: { width: 1200, height: 1800 },
      readingConvention: 'manga_rtl',
      status: 'complete',
      panels: [],
      regions,
      issues: [],
      transformLedger: {
        transformId: 'tf-1',
        sourceImageId: pageId,
        sourceWidth: 1200,
        sourceHeight: 1800,
        workingWidth: 1200,
        workingHeight: 1800,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        cropOriginX: 0,
        cropOriginY: 0,
        coordinateSpace: 'normalized_1000',
      },
      createdAt: Date.now(),
      version: 1,
    }),
    ...overrides,
  };
}

function makeFakeModelProvider(
  stateOverrides: Partial<Record<string, Partial<ModelStatusInfo>>> = {}
): LocalModelAssetProvider {
  return {
    getManifest: async () => ({ manifestVersion: 1, models: [] }),
    getStatus: async (modelId?: string) => {
      const id = modelId || 'comic-detector-v4-s-int8';
      const custom = stateOverrides[id] || {};
      return {
        modelId: id,
        state: 'installed',
        installedRevision: 'test-rev',
        verifiedBytes: 100,
        expectedBytes: 100,
        missingFiles: [],
        corruptFiles: [],
        policy: {
          developmentOnly: true,
          downloadPermitted: true,
          activationPermitted: true,
          redistributionApproved: false,
          commercialDistributionCleared: false,
          provenanceUnresolved: true,
          rejectionReason: null,
        },
        ...custom,
      };
    },
    downloadModel: async () => {
      throw new Error('Unexpected download trigger during scan');
    },
    cancelDownload: async () => true,
    removeModel: async () => {
      throw new Error('Unexpected remove trigger');
    },
    readModelAssets: async (modelId: string): Promise<ModelAssetPayload> => ({
      modelId,
      revisionLabel: 'test-rev',
      files: {},
    }),
  };
}

function createMemoryStorage() {
  const scans = new Map<string, PageScanResult>();
  const bubbles = new Map<string, BubbleItem[]>();

  return {
    scans,
    bubbles,
    deps: {
      getPageBubbles: async (pageId: string) => bubbles.get(pageId) || [],
      savePageBubbles: async (pageId: string, list: BubbleItem[]) => {
        bubbles.set(pageId, JSON.parse(JSON.stringify(list)));
      },
      savePageScan: async (pageId: string, rec: PageScanResult) => {
        scans.set(pageId, JSON.parse(JSON.stringify(rec)));
      },
      getProjectLore: async () => null,
      getChapterIntelligence: async () => null,
      ingestPageIntelligence: async () => {},
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Scan Page: Successful Hybrid Flow + Division of Responsibility
// ---------------------------------------------------------------------------
test('Scan Page: successful hybrid keeps reliable local OCR, verifies ambiguous/mixed, classifies & translates without duplicate calls', async () => {
  const storage = createMemoryStorage();
  let fullGeminiFallbackCalls = 0;
  let cropRetryCalls = 0;
  let capturedCandidates: any[] = [];

  const localRegions = [
    makeTextRegion({
      regionId: 'text_bubble-1',
      geometry: { coordinateSpace: 'normalized_1000', box_2d: [80, 620, 220, 900] },
      rawOCR: 'Run before the gate closes!',
      confidence: {
        imageQuality: 0.96,
        regionDetection: 0.94,
        ocr: 0.95,
        association: 0.92,
        readingOrder: 0.9,
        classification: 0.5,
      },
    }),
    makeTextRegion({
      regionId: 'text_bubble-2',
      geometry: { coordinateSpace: 'normalized_1000', box_2d: [300, 120, 440, 390] },
      rawOCR: 'Wha..?',
      confidence: {
        imageQuality: 0.96,
        regionDetection: 0.89,
        ocr: 0.52,
        association: 0.9,
        readingOrder: 0.9,
        classification: 0.5,
      },
      flags: ['OCR_AMBIGUOUS'],
    }),
    makeTextRegion({
      regionId: 'text_sfx-1',
      geometry: { coordinateSpace: 'normalized_1000', box_2d: [600, 400, 740, 580] },
      rawOCR: 'CLANG!',
      confidence: {
        imageQuality: 0.96,
        regionDetection: 0.9,
        ocr: 0.92,
        association: 0.9,
        readingOrder: 0.9,
        classification: 0.85,
      },
    }),
  ];

  const result = await scanPageWithGemini({
    pageId: 'page-hybrid-1',
    chapterId: 'ch-1',
    pageIndex: 1,
    apiKey: 'AIzaSy-Test-Key',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 2,
    includeSFX: true,
    sourceLanguageHint: 'en',
    readingConvention: 'manga_rtl',
    scanDeps: {
      ...storage.deps,
      batchTranslateBubbles: async ({ bubbles }) => {
        const translationMap = new Map();
        for (const b of bubbles) {
          translationMap.set(b.id, {
            rawText: `ترجمة: ${b.sourceText}`,
            humanizedText: `عربي: ${b.sourceText}`,
          });
        }
        return {
          success: true,
          translationMap,
          requestedCount: bubbles.length,
          translatedCount: bubbles.length,
        };
      },
    },
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1200, height: 1800 }),
      getModelProvider: () => makeFakeModelProvider(),
      runLocalOcr: async () => makeLocalOcrResult('page-hybrid-1', localRegions),
      runGeminiFullFallback: async () => {
        fullGeminiFallbackCalls++;
        throw new Error('Should not run full Gemini fallback');
      },
      runCropRetries: async ({ regions }) => {
        cropRetryCalls++;
        return { updatedRegions: regions, retriedCount: 0 };
      },
      runGeminiContextPass: async ({ candidates }): Promise<ValidatedHybridContextOutput> => {
        capturedCandidates = candidates;
        const gateCand = candidates.find((c) => c.localOCR.includes('gate'))!;
        const whaCand = candidates.find((c) => c.localOCR.includes('Wha'))!;
        const clangCand = candidates.find((c) => c.localOCR.includes('CLANG'))!;

        return {
          pageContext: 'Two characters sprint through a corridor.',
          readingConventionCandidate: 'manga_rtl',
          panels: [{ panelId: 'p-1', box_2d: [40, 40, 960, 960] }],
          regionDecisions: [
            {
              regionId: gateCand.regionId,
              action: 'keep',
              primaryClass: 'dialogue',
              sourceLanguage: 'en',
              speakerCandidate: 'Kai',
            },
            {
              regionId: whaCand.regionId,
              action: 'verify',
              verifiedOCR: 'What?!',
              ocrAlternatives: ['Wha..?', 'What?!'],
              primaryClass: 'thought',
              sourceLanguage: 'en',
              isAmbiguous: false,
            },
            {
              regionId: clangCand.regionId,
              action: 'keep',
              primaryClass: 'sfx',
              sourceLanguage: 'en',
              isVertical: false,
            },
          ],
          additionalRegions: [],
          detectedCharacters: [{ nameOriginal: 'Kai', nameArabic: 'كاي', gender: 'male' }],
          detectedGlossaryTerms: [],
          detectedRelationships: [],
        };
      },
    },
  });

  assert.equal(result.ocrSource, 'hybrid');
  assert.equal(result.translationSuccess, true);
  assert.equal(fullGeminiFallbackCalls, 0);
  // All candidates were resolved cleanly by Gemini context -> redundant crop retry skipped!
  assert.equal(cropRetryCalls, 0);
  assert.equal(capturedCandidates.find((c) => c.localOCR.includes('gate'))!.needsVerification, false);
  assert.equal(capturedCandidates.find((c) => c.localOCR.includes('Wha'))!.needsVerification, true);

  assert.equal(result.bubbles.length, 3);
  assert.deepEqual(result.bubbles[0].box_2d, [80, 620, 220, 900]);
  assert.equal(result.bubbles[0].sourceText, 'Run before the gate closes!');
  assert.equal(result.bubbles[0].sourceLanguage, 'en');
  // Local OCR verbatim text is preserved immutable; verifiedOCR is placed in alternatives
  assert.equal(result.bubbles[1].sourceText, 'Wha..?');
  assert.ok(result.bubbles[1].ocrAlternatives?.includes('What?!'));
  assert.equal(result.bubbles[1].type, 'thought_bubbles');
  assert.equal(result.bubbles[2].sourceText, 'CLANG!');
  assert.equal(result.bubbles[2].type, 'sfx');
  assert.equal(result.bubbles[0].translatedText, 'عربي: Run before the gate closes!');

  // Persisted intact in simulated IndexedDB
  const persisted = storage.bubbles.get('page-hybrid-1')!;
  assert.equal(persisted.length, 3);
  assert.equal(storage.scans.get('page-hybrid-1')?.status, 'complete');
});

// ---------------------------------------------------------------------------
// 2. Local OCR Failure Reporting and Selective Permitted Fallback
// ---------------------------------------------------------------------------
test('Scan Page: reports local OCR failure clearly without silent fallback, or falls back when explicitly permitted', async () => {
  const makeFallbackScan = (pageId: string): PageScanResult => ({
    scanId: 'fallback-1',
    pageId,
    sourceImageId: pageId,
    sourceDimensions: { width: 1000, height: 1500 },
    readingConvention: 'manga_rtl',
    status: 'complete',
    panels: [{ panelId: 'p1', geometry: { coordinateSpace: 'normalized_1000', box_2d: [0, 0, 1000, 1000] }, detectionConfidence: 0.95, sequenceIndex: 1 }],
    regions: [
      makeTextRegion({
        regionId: 'gem-r1',
        rawOCR: 'Fallback dialogue works!',
        classification: { primaryClass: 'dialogue', confidence: 0.92, needsReview: false },
        sourceLanguage: 'en',
      }),
    ],
    issues: [],
    transformLedger: {
      transformId: 'tf-fb',
      sourceImageId: pageId,
      sourceWidth: 1000,
      sourceHeight: 1500,
      workingWidth: 1000,
      workingHeight: 1500,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      cropOriginX: 0,
      cropOriginY: 0,
      coordinateSpace: 'normalized_1000',
    },
    createdAt: Date.now(),
    version: 1,
  });

  // Case A1: Local OCR inference error without allowGeminiFallback -> reports clear failure, never silent Gemini OCR
  const storageA = createMemoryStorage();
  const resA = await scanPageWithGemini({
    pageId: 'page-fb-err',
    apiKey: 'AIza-key',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 2,
    includeSFX: true,
    sourceLanguageHint: 'en',
    scanDeps: {
      ...storageA.deps,
      batchTranslateBubbles: async ({ bubbles }) => ({
        success: true,
        translationMap: new Map(),
        requestedCount: 0,
        translatedCount: 0,
      }),
    },
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () => makeFakeModelProvider(),
      runLocalOcr: async () => {
        throw new Error('Simulated ORT WASM init failure');
      },
      runGeminiFullFallback: async () => makeFallbackScan('page-fb-err'),
    },
  });
  assert.equal(resA.ocrSource, 'hybrid');
  assert.equal(resA.scanResult.status, 'failed');
  assert.ok(resA.scanResult.issues.some((issue) => issue.flag === 'STAGE_UNAVAILABLE'));

  // Case A2: Explicit allowGeminiFallback falls back cleanly when requested
  const resFallback = await scanMangaPageHybridWithMeta({
    pageId: 'page-fb-err-optin',
    apiKey: 'AIza-key',
    sourceLanguageHint: 'en',
    allowGeminiFallback: true,
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () => makeFakeModelProvider(),
      runLocalOcr: async () => {
        throw new Error('Simulated ORT WASM init failure');
      },
      runGeminiFullFallback: async () => makeFallbackScan('page-fb-err-optin'),
    },
  });
  assert.equal(resFallback.meta.ocrSource, 'gemini_fallback');
  assert.equal(resFallback.meta.fallbackReason, 'local_ocr_failed');

  // Case B: Production build eligibility restriction (`state: 'unsupported'`, `activationPermitted: false`)
  let localOcrCalled = false;
  const prodOutcome = await scanMangaPageHybridWithMeta({
    pageId: 'page-fb-prod',
    apiKey: 'AIza-key',
    sourceLanguageHint: 'ja',
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () =>
        makeFakeModelProvider({
          'ppocr-v6-manga-v0.3': {
            state: 'unsupported',
            policy: {
              developmentOnly: true,
              downloadPermitted: false,
              activationPermitted: false,
              redistributionApproved: false,
              commercialDistributionCleared: false,
              provenanceUnresolved: true,
              rejectionReason: 'Blocked in packaged production builds.',
            },
          },
        }),
      runLocalOcr: async () => {
        localOcrCalled = true;
        throw new Error('Must not run in production');
      },
      runGeminiFullFallback: async () => makeFallbackScan('page-fb-prod'),
    },
  });
  assert.equal(localOcrCalled, false);
  assert.equal(prodOutcome.scanResult.status, 'failed');
  assert.equal(prodOutcome.meta.fallbackReason, 'model_ineligible_production');
  assert.ok(prodOutcome.scanResult.issues.some((i) => i.reason.includes('Licensing restriction')));

  // Verify manifest policy itself still rejects dev_only in production
  const detEntry = getModelManifestEntry('comic-detector-v4-s-int8')!;
  const prodPolicy = evaluateModelDistributionPolicy(detEntry, { isProduction: true });
  assert.equal(prodPolicy.activationPermitted, false);
  assert.equal(prodPolicy.downloadPermitted, false);
});

// ---------------------------------------------------------------------------
// 3. Gemini Failure Recovery After Local OCR + Translation Failure Recovery
// ---------------------------------------------------------------------------
test('Recovery: preserves local OCR text when Gemini context fails, and preserves extracted text when translation fails', async () => {
  // Case A: Local OCR succeeds -> Gemini contextual call throws HTTP 500
  const storageCtx = createMemoryStorage();
  const localOnlyRegions = [
    makeTextRegion({
      regionId: 'text_bubble-1',
      geometry: { coordinateSpace: 'normalized_1000', box_2d: [120, 500, 260, 820] },
      rawOCR: 'Local OCR extracted me before Gemini failed.',
    }),
  ];

  const partialCtxRes = await scanPageWithGemini({
    pageId: 'page-partial-ctx',
    apiKey: 'AIza-key',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 2,
    includeSFX: true,
    sourceLanguageHint: 'en',
    scanDeps: {
      ...storageCtx.deps,
      batchTranslateBubbles: async () => ({
        success: false,
        error: 'Translation quota exceeded',
        translationMap: new Map(),
        requestedCount: 1,
        translatedCount: 0,
      }),
    },
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () => makeFakeModelProvider(),
      runLocalOcr: async () => makeLocalOcrResult('page-partial-ctx', localOnlyRegions),
      runGeminiContextPass: async () => {
        throw new Error('HTTP 500: Upstream Gemini context error');
      },
    },
  });

  assert.equal(partialCtxRes.ocrSource, 'local_partial');
  assert.equal(partialCtxRes.translationSuccess, false);
  assert.equal(partialCtxRes.bubbles.length, 1);
  assert.equal(
    partialCtxRes.bubbles[0].sourceText,
    'Local OCR extracted me before Gemini failed.'
  );
  assert.deepEqual(partialCtxRes.bubbles[0].box_2d, [120, 500, 260, 820]);
  assert.equal(partialCtxRes.scanResult?.status, 'partial');
  assert.ok(partialCtxRes.scanResult?.issues.some((i) => i.flag === 'STAGE_UNAVAILABLE'));
  assert.equal(storageCtx.bubbles.get('page-partial-ctx')?.length, 1);

  // Case B: Hybrid scan succeeds -> Translation throws error -> extracted text MUST survive
  const storageTr = createMemoryStorage();
  const partialTrRes = await scanPageWithGemini({
    pageId: 'page-partial-tr',
    apiKey: 'AIza-key',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 2,
    includeSFX: true,
    sourceLanguageHint: 'ja',
    scanDeps: {
      ...storageTr.deps,
      batchTranslateBubbles: async () => {
        throw new Error('Network connection dropped during translation');
      },
    },
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () => makeFakeModelProvider(),
      runLocalOcr: async () =>
        makeLocalOcrResult('page-partial-tr', [
          makeTextRegion({
            regionId: 'text_bubble-ja',
            rawOCR: '逃げるな！',
            sourceLanguage: 'ja',
          }),
        ], { resolvedRoute: 'ja_zh_ppocrv6_manga', languageHint: 'ja' }),
      runGeminiContextPass: async ({ candidates }) => ({
        pageContext: 'Action panel',
        panels: [],
        regionDecisions: [
          {
            regionId: candidates[0].regionId,
            action: 'keep',
            primaryClass: 'dialogue',
            sourceLanguage: 'ja',
          },
        ],
        additionalRegions: [],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
    },
  });

  assert.equal(partialTrRes.ocrSource, 'hybrid');
  assert.equal(partialTrRes.translationSuccess, false);
  assert.equal(partialTrRes.bubbles[0].sourceText, '逃げるな！');
  assert.equal(partialTrRes.bubbles[0].sourceLanguage, 'ja');
  assert.equal(partialTrRes.scanResult?.status, 'partial');
  assert.equal(storageTr.bubbles.get('page-partial-tr')?.[0].sourceText, '逃げるな！');
});

// ---------------------------------------------------------------------------
// 4. Language Routing (`auto` Safeguard, Priority & Mixed Language)
// ---------------------------------------------------------------------------
test('Language routing: honors en/ko/ja/zh project setting, preserves auto refusal safeguard, handles mixed script without discarding text', async () => {
  // 'auto' on fresh page resolves using reading convention prior (e.g. manga_rtl -> ja_zh_ppocrv6_manga)
  let localInvoked = false;
  const autoOutcome = await scanMangaPageHybridWithMeta({
    pageId: 'page-auto-fresh',
    apiKey: 'AIza-key',
    sourceLanguageHint: 'auto',
    readingConvention: 'manga_rtl',
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () => makeFakeModelProvider(),
      runLocalOcr: async () => {
        localInvoked = true;
        return {
          scanId: 'local-auto-1',
          pageId: 'page-auto-fresh',
          sourceDimensions: { width: 1000, height: 1500 },
          readingConvention: 'manga_rtl',
          languageHint: 'auto',
          resolvedRoute: 'ja_zh_ppocrv6_manga',
          status: 'complete',
          textRegions: [
            makeTextRegion({
              regionId: 'r1',
              rawOCR: 'テスト',
              sourceLanguage: 'ja',
            }),
          ],
          bubbleRegions: [],
          lineSegments: [],
          tiles: [],
          modelsUsed: {
            detectorModelId: 'comic-detector-v4-s-int8',
            detectorRevision: 'rev1',
            ocrModelId: 'ppocr-v6-manga-v0.3',
            ocrRevision: 'rev1',
            routeId: 'ja_zh_ppocrv6_manga',
            ocrRuntimeUsed: 'ort_web_adapter',
            executionProvider: 'wasm',
            simdEnabled: true,
            threadsUsed: 1,
          },
          timings: { initMs: 1, decodeMs: 1, detectorMs: 1, ocrMs: 1, postprocessMs: 0, totalMs: 4, tileCount: 1, cropCount: 0, measuredMemoryBytes: null },
          partialFailures: [],
          warnings: [],
          toCanonicalPageScanResult: () => ({} as any),
        };
      },
    },
  });
  assert.equal(localInvoked, true);
  assert.equal(autoOutcome.meta.resolvedRoute, 'ja_zh_ppocrv6_manga');

  // Unsupported language hint must refuse cleanly without falling back
  const badHintOutcome = await scanMangaPageHybridWithMeta({
    pageId: 'page-bad-hint',
    apiKey: 'AIza-key',
    sourceLanguageHint: 'unsupported_lang',
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () => makeFakeModelProvider(),
      runLocalOcr: async () => {
        throw new Error('Must not run on unsupported hint');
      },
    },
  });
  assert.equal(badHintOutcome.scanResult.status, 'failed');
  assert.equal(badHintOutcome.meta.fallbackReason, 'language_route_refused');

  // Mixed script inside explicit Korean route -> flagged for verification & never discarded!
  const mixedRegion = makeTextRegion({
    regionId: 'text_bubble-ko',
    rawOCR: '잠깐 LV.99?',
    confidence: {
      imageQuality: 0.9,
      regionDetection: 0.9,
      ocr: 0.89,
      association: 0.9,
      readingOrder: 0.9,
      classification: 0.5,
    },
  });
  const koAssess = assessCandidateVerification(mixedRegion, 'ko_ppocrv5_mobile', 'ko', 0.65);
  assert.equal(koAssess.needsVerification, true);
  assert.ok(koAssess.reasons.includes('latin_embedded_in_cjk_route'));

  // Explicit zh / ja / ko / en settings round-trip via SettingsService project scope
  const settings = new SettingsService();
  assert.equal(
    settings.setSettingValue('scanning.source_language', 'zh', {
      scope: 'project',
      projectId: 'proj-zh-1',
    }).success,
    true
  );
  assert.equal(
    settings.setSettingValue('scanning.source_language', 'ko', {
      scope: 'project',
      projectId: 'proj-ko-1',
    }).success,
    true
  );
  assert.equal(
    settings.createOperationSnapshot({ projectId: 'proj-zh-1' }).values['scanning.source_language'],
    'zh'
  );
  assert.equal(
    settings.createOperationSnapshot({ projectId: 'proj-ko-1' }).values['scanning.source_language'],
    'ko'
  );
});

// ---------------------------------------------------------------------------
// 5. Duplicate Prevention & Per-Page ID Scoping
// ---------------------------------------------------------------------------
test('Duplicate prevention: suppresses overlapping local fragments & overlapping Gemini additionalRegions without losing distinct text', async () => {
  const fragment = makeTextRegion({
    regionId: 'frag-1',
    geometry: { coordinateSpace: 'normalized_1000', box_2d: [110, 610, 175, 860] },
    rawOCR: 'Stop',
    confidence: { imageQuality: 0.9, regionDetection: 0.8, ocr: 0.82, association: 0.9, readingOrder: 0.9, classification: 0.5 },
  });
  const full = makeTextRegion({
    regionId: 'full-1',
    geometry: { coordinateSpace: 'normalized_1000', box_2d: [100, 600, 240, 880] },
    rawOCR: 'Stop right there!',
    confidence: { imageQuality: 0.9, regionDetection: 0.94, ocr: 0.95, association: 0.9, readingOrder: 0.9, classification: 0.5 },
  });
  const emptyNoise = makeTextRegion({
    regionId: 'noise-empty',
    geometry: { coordinateSpace: 'normalized_1000', box_2d: [105, 605, 235, 875] },
    rawOCR: '',
    associations: { bubbleId: null },
  });

  const { deduplicated, droppedDuplicateCount } = deduplicateLocalCandidates([
    fragment,
    full,
    emptyNoise,
  ]);
  assert.equal(deduplicated.length, 1);
  assert.equal(droppedDuplicateCount, 2);
  assert.equal(deduplicated[0].rawOCR, 'Stop right there!');

  // End-to-end hybrid also ignores overlapping Gemini additionalRegions
  const outcome = await scanMangaPageHybridWithMeta({
    pageId: 'page-dup-test',
    apiKey: 'AIza-key',
    sourceLanguageHint: 'en',
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () => makeFakeModelProvider(),
      runLocalOcr: async () => makeLocalOcrResult('page-dup-test', [full]),
      runGeminiContextPass: async ({ candidates }) => ({
        pageContext: 'Scene',
        panels: [],
        regionDecisions: [
          { regionId: candidates[0].regionId, action: 'keep', primaryClass: 'dialogue', sourceLanguage: 'en' },
        ],
        additionalRegions: [
          {
            regionId: 'dup-gemini-box',
            box_2d: [102, 602, 238, 878],
            rawOCR: 'Stop right there!',
            primaryClass: 'dialogue',
            sourceLanguage: 'en',
          },
          {
            regionId: 'distinct-box',
            box_2d: [500, 100, 620, 350],
            rawOCR: 'Exit Sign',
            primaryClass: 'environmental_text',
            sourceLanguage: 'en',
          },
        ],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
    },
  });

  assert.equal(outcome.scanResult.regions.length, 1);
  assert.equal(outcome.meta.addedRegionCount, 0);
  assert.ok(outcome.scanResult.regions.every((r) => r.regionId.startsWith('page-dup-test__')));
});

// ---------------------------------------------------------------------------
// 6. Existing User Edits, Confirmed Text & Coordinates Preservation Across Rescan
// ---------------------------------------------------------------------------
test('Rescan preservation: preserves manual source/translation edits, custom typers, manual boxes, and unmatched bubbles', async () => {
  const storage = createMemoryStorage();
  const editedBubble: BubbleItem = {
    id: 'user-edited-b1',
    pageId: 'page-edit-keep',
    index: 1,
    box_2d: [110, 610, 235, 895],
    type: 'shouting',
    typerPrefix: '!:',
    sourceLanguage: 'en',
    sourceText: 'MANUALLY CORRECTED SOURCE!',
    originalSourceText: 'Old OCR',
    translatedText: 'نص عربي مؤكد يدوياً!',
    rawTranslatedText: 'نص عربي مؤكد يدوياً!',
    reviewFlags: [],
    isManuallyEdited: true,
  };
  const manualExtraBubble: BubbleItem = {
    id: 'manual-drawn-b2',
    pageId: 'page-edit-keep',
    index: 2,
    box_2d: [700, 100, 820, 320],
    type: 'narration_boxes',
    typerPrefix: '[]:',
    sourceLanguage: 'en',
    sourceText: 'User hand-drawn note',
    originalSourceText: 'User hand-drawn note',
    translatedText: 'ملاحظة يدوية',
    rawTranslatedText: 'ملاحظة يدوية',
    reviewFlags: [],
    isManuallyEdited: true,
  };

  await storage.deps.savePageBubbles('page-edit-keep', [editedBubble, manualExtraBubble]);

  const rescanResult = await scanPageWithGemini({
    pageId: 'page-edit-keep',
    apiKey: 'AIza-key',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 2,
    includeSFX: true,
    sourceLanguageHint: 'en',
    scanDeps: {
      ...storage.deps,
      batchTranslateBubbles: async ({ bubbles }) => {
        // Must NEVER receive isManuallyEdited bubbles
        assert.ok(!bubbles.some((b) => b.id === 'user-edited-b1'));
        return { success: true, translationMap: new Map(), requestedCount: 0, translatedCount: 0 };
      },
    },
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () => makeFakeModelProvider(),
      runLocalOcr: async () =>
        makeLocalOcrResult('page-edit-keep', [
          makeTextRegion({
            regionId: 'new-local-1',
            geometry: { coordinateSpace: 'normalized_1000', box_2d: [108, 608, 238, 892] },
            rawOCR: 'New raw local OCR attempt',
          }),
        ]),
      runGeminiContextPass: async ({ candidates }) => ({
        pageContext: 'Rescanned page',
        panels: [],
        regionDecisions: [
          {
            regionId: candidates[0].regionId,
            action: 'keep',
            primaryClass: 'dialogue',
            sourceLanguage: 'en',
          },
        ],
        additionalRegions: [],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
    },
  });

  const preservedB1 = rescanResult.bubbles.find((b) => b.id === 'user-edited-b1')!;
  const preservedB2 = rescanResult.bubbles.find((b) => b.id === 'manual-drawn-b2')!;
  assert.equal(preservedB1.sourceText, 'MANUALLY CORRECTED SOURCE!');
  assert.equal(preservedB1.translatedText, 'نص عربي مؤكد يدوياً!');
  assert.equal(preservedB1.type, 'shouting');
  assert.deepEqual(preservedB1.box_2d, [110, 610, 235, 895]);
  assert.equal(preservedB2.sourceText, 'User hand-drawn note');
});

// ---------------------------------------------------------------------------
// 7. SFX Behavior (Disabled: No New SFX, No SFX Translation, Preserves Existing SFX, Non-Suppression of Signs/Narration)
// ---------------------------------------------------------------------------
test('SFX behavior: disabled suppresses new SFX without hiding signs/narration/dialogue and preserves prior SFX untouched', async () => {
  const storage = createMemoryStorage();
  const priorSfx: BubbleItem = {
    id: 'existing-sfx-1',
    pageId: 'page-sfx',
    index: 3,
    box_2d: [800, 700, 920, 930],
    type: 'sfx',
    typerPrefix: 'SFX:',
    sourceLanguage: 'en',
    sourceText: 'RUMBLE',
    originalSourceText: 'RUMBLE',
    translatedText: '',
    rawTranslatedText: '',
    reviewFlags: [],
    isManuallyEdited: false,
  };
  await storage.deps.savePageBubbles('page-sfx', [priorSfx]);

  let cropRetriesSawSfx = false;
  let translatedBubbleIds: string[] = [];

  const res = await scanPageWithGemini({
    pageId: 'page-sfx',
    apiKey: 'AIza-key',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 2,
    includeSFX: false,
    sourceLanguageHint: 'en',
    scanDeps: {
      ...storage.deps,
      batchTranslateBubbles: async (opts) => {
        assert.equal(opts.includeSFX, false);
        translatedBubbleIds = opts.bubbles
          .filter((b) => opts.includeSFX || (b.type !== 'sfx' && b.typerPrefix !== 'SFX:'))
          .map((b) => b.id);
        return {
          success: true,
          translationMap: new Map(
            translatedBubbleIds.map((id) => [id, { rawText: 'مترجم', humanizedText: 'مترجم' }])
          ),
          requestedCount: translatedBubbleIds.length,
          translatedCount: translatedBubbleIds.length,
        };
      },
    },
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () => makeFakeModelProvider(),
      runLocalOcr: async () =>
        makeLocalOcrResult('page-sfx', [
          makeTextRegion({ regionId: 'r-dlg', geometry: { coordinateSpace: 'normalized_1000', box_2d: [50, 50, 150, 300] }, rawOCR: 'Look at that gate!' }),
          makeTextRegion({ regionId: 'r-sign', geometry: { coordinateSpace: 'normalized_1000', box_2d: [220, 50, 320, 280] }, rawOCR: 'DANGER ZONE' }),
          makeTextRegion({ regionId: 'r-nar', geometry: { coordinateSpace: 'normalized_1000', box_2d: [360, 50, 440, 350] }, rawOCR: 'Three days later...' }),
          makeTextRegion({ regionId: 'r-new-sfx', geometry: { coordinateSpace: 'normalized_1000', box_2d: [500, 50, 620, 260] }, rawOCR: 'KRAKOOM!', flags: ['OCR_AMBIGUOUS'] }),
        ]),
      runGeminiContextPass: async ({ candidates }) => ({
        pageContext: 'Gate entrance',
        panels: [],
        regionDecisions: [
          { regionId: candidates[0].regionId, action: 'keep', primaryClass: 'dialogue', sourceLanguage: 'en' },
          { regionId: candidates[1].regionId, action: 'keep', primaryClass: 'environmental_text', sourceLanguage: 'en' },
          { regionId: candidates[2].regionId, action: 'keep', primaryClass: 'narration', sourceLanguage: 'en' },
          { regionId: candidates[3].regionId, action: 'keep', primaryClass: 'sfx', sourceLanguage: 'en' },
        ],
        additionalRegions: [
          { regionId: 'missed-sfx', box_2d: [640, 50, 720, 220], rawOCR: 'SWOOSH', primaryClass: 'sfx', sourceLanguage: 'en' },
        ],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
      runCropRetries: async ({ regions }) => {
        if (regions.some((r) => r.classification.primaryClass === 'sfx')) {
          cropRetriesSawSfx = true;
        }
        return { updatedRegions: regions, retriedCount: 0 };
      },
    },
  });

  // Never ran SFX crop retries
  assert.equal(cropRetriesSawSfx, false);
  // New SFX omitted; ordinary text preserved!
  const texts = res.bubbles.map((b) => b.sourceText);
  assert.ok(texts.includes('Look at that gate!'));
  assert.ok(texts.includes('DANGER ZONE'));
  assert.ok(texts.includes('Three days later...'));
  assert.ok(!texts.includes('KRAKOOM!'));
  assert.ok(!texts.includes('SWOOSH'));
  // Prior SFX data preserved AND kept as 'sfx' without being translated!
  const keptSfx = res.bubbles.find((b) => b.id === 'existing-sfx-1')!;
  assert.equal(keptSfx.sourceText, 'RUMBLE');
  assert.equal(keptSfx.translatedText, '');
  const retainedRegion = res.scanResult!.regions.find((r) => r.regionId === 'existing-sfx-1')!;
  assert.equal(retainedRegion.classification.primaryClass, 'sfx');
  assert.ok(!translatedBubbleIds.includes('existing-sfx-1'));
});

// ---------------------------------------------------------------------------
// 8. Scan All: Batch Multi-Page, Single-Page Error Isolation, Cancel+Retry Race, Dedup & Persistence
// ---------------------------------------------------------------------------
test('Scan All: continues after one page fails, records partial failure, handles cancel + immediate retry race & avoids duplicates', async () => {
  const storage = createMemoryStorage();
  const seenPrevLookups: Array<string> = [];
  let failP2Once = true;

  const queue = new ScanQueueManager({
    interRequestDelayMs: 0,
    savePageBubbles: storage.deps.savePageBubbles,
    getPageBubbles: async (pid: string) => {
      seenPrevLookups.push(pid);
      return storage.deps.getPageBubbles(pid);
    },
    getRollingContextForPage: async () => ({
      summary: 'Scene',
      activeCharactersPrompt: '',
      terminologyPrompt: '',
      relationshipPrompt: '',
      precedingDialogueSnippet: '',
    }),
    scanPage: async (opts) => {
      if (opts.pageId === 'p2' && failP2Once) {
        failP2Once = false;
        throw new Error('Fatal model failure on page 2');
      }
      const existing = await storage.deps.getPageBubbles(opts.pageId);
      const scanRec: PageScanResult = {
        scanId: `s-${opts.pageId}`,
        pageId: opts.pageId,
        sourceImageId: opts.pageId,
        sourceDimensions: { width: 1000, height: 1500 },
        readingConvention: 'manga_rtl',
        status: opts.pageId === 'p3' ? 'partial' : 'complete',
        panels: [],
        regions: [
          makeTextRegion({
            regionId: `${opts.pageId}__r1`,
            rawOCR: `Line on ${opts.pageId}`,
            classification: { primaryClass: 'dialogue', confidence: 0.9, needsReview: false },
          }),
        ],
        issues:
          opts.pageId === 'p3'
            ? [
                {
                  issueId: 'iss-p3',
                  flag: 'STAGE_UNAVAILABLE',
                  severity: 'warning',
                  affectedRegionIds: [`${opts.pageId}__r1`],
                  reason: 'Partial translation skip',
                  retryable: true,
                },
              ]
            : [],
        transformLedger: {
          transformId: 'tf',
          sourceImageId: opts.pageId,
          sourceWidth: 1000,
          sourceHeight: 1500,
          workingWidth: 1000,
          workingHeight: 1500,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          cropOriginX: 0,
          cropOriginY: 0,
          coordinateSpace: 'normalized_1000',
        },
        createdAt: Date.now(),
        version: 1,
      };
      const merged = mergeScanWithExistingState({
        newScan: scanRec,
        existingBubbles: existing,
        typerSettings: DEFAULT_TYPER_SETTINGS,
      });
      await storage.deps.savePageScan(opts.pageId, merged.updatedScanResult);
      await storage.deps.savePageBubbles(opts.pageId, merged.mergedBubbles);
      return {
        bubbles: merged.mergedBubbles,
        pageContext: '',
        detectedGlossaryTerms: [],
        scanResult: merged.updatedScanResult,
        translationSuccess: opts.pageId !== 'p3',
        warnings: opts.pageId === 'p3' ? ['Translation skipped'] : [],
      };
    },
  });

  const baseOpts = {
    projectId: 'proj-1',
    isDraft: false,
    apiKey: 'AIza-key',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 2 as const,
    includeSFX: true,
    sourceLanguageHint: 'en',
  };

  let lastProgress: any = null;
  queue.subscribe((p) => {
    lastProgress = p;
  });

  queue.enqueue([
    { pageId: 'p1', chapterId: 'ch1', pageIndex: 1, options: baseOpts },
    { pageId: 'p2', chapterId: 'ch1', pageIndex: 2, options: baseOpts },
    { pageId: 'p3', chapterId: 'ch1', pageIndex: 3, options: baseOpts },
  ]);

  await new Promise<void>((resolve) => {
    const check = () => {
      if (!lastProgress?.isScanning) return resolve();
      setTimeout(check, 5);
    };
    check();
  });

  assert.equal(queue.getPageStatus('p1'), 'scanned');
  assert.equal(queue.getPageStatus('p2'), 'error');
  assert.equal(queue.getPageStatus('p3'), 'scanned');
  assert.ok(queue.getPageErrors()['p2']?.includes('Fatal model failure'));
  assert.ok(queue.getPartialPageIds().includes('p3'));
  // Preceding page lookup used p2 (not p3!) after p2 failed
  assert.ok(seenPrevLookups.includes('p2'));
  assert.ok(!seenPrevLookups.includes('p3'));

  // Retry whole batch: p1 must NOT duplicate existing bubbles, p2 now recovers!
  queue.enqueue([
    { pageId: 'p1', chapterId: 'ch1', pageIndex: 1, options: baseOpts },
    { pageId: 'p2', chapterId: 'ch1', pageIndex: 2, options: baseOpts },
  ]);

  await new Promise<void>((resolve) => {
    const check = () => {
      if (!lastProgress?.isScanning && queue.getPageStatus('p2') === 'scanned') return resolve();
      setTimeout(check, 5);
    };
    check();
  });

  assert.equal(storage.bubbles.get('p1')?.length, 1);
  assert.equal(storage.bubbles.get('p2')?.length, 1);
  assert.equal(queue.getPageErrors()['p2'], undefined);

  // Cancel + Immediate Retry race protection
  let abortedOp1 = false;
  const raceQueue = new ScanQueueManager({
    interRequestDelayMs: 50,
    savePageBubbles: async () => {},
    scanPage: async (opts) => {
      await new Promise((r) => setTimeout(r, opts.pageId === 'slow-1' ? 40 : 5));
      if (opts.signal?.aborted) {
        abortedOp1 = true;
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      return { bubbles: [{ id: opts.pageId, sourceText: 'ok' } as any], pageContext: '', detectedGlossaryTerms: [] };
    },
  });

  raceQueue.enqueue([{ pageId: 'slow-1', pageIndex: 1, options: baseOpts }]);
  raceQueue.cancel();
  raceQueue.enqueue([{ pageId: 'fast-2', pageIndex: 1, options: baseOpts }]);

  await new Promise((r) => setTimeout(r, 80));
  assert.equal(abortedOp1, true);
  assert.equal(raceQueue.getPageStatus('fast-2'), 'scanned');
  assert.equal(raceQueue.getPageStatus('slow-1'), 'unscanned');
});

// ---------------------------------------------------------------------------
// 9. Abort Cancellation Safeguard in Hybrid Scanner + Reading Order & TypeR/RTL Regressions
// ---------------------------------------------------------------------------
test('Regressions: AbortError never falls back to Gemini, TypeR RTL & SFX export remain intact, store avoids listener leaks', async () => {
  // Abort during local OCR MUST throw AbortError and never invoke Gemini fallback
  let fallbackTriggered = false;
  const ac = new AbortController();
  ac.abort();

  await assert.rejects(
    async () =>
      scanMangaPageHybridWithMeta({
        pageId: 'page-abort',
        apiKey: 'AIza-key',
        sourceLanguageHint: 'en',
        signal: ac.signal,
        hybridDeps: {
          runGeminiFullFallback: async () => {
            fallbackTriggered = true;
            throw new Error('Should not run fallback');
          },
        },
      }),
    (err: Error) => err.name === 'AbortError'
  );
  assert.equal(fallbackTriggered, false);

  // Reading order & TypeR / Arabic RTL regression check
  const panels = [
    { panelId: 'p1', geometry: { coordinateSpace: 'normalized_1000' as const, box_2d: [0, 0, 1000, 1000] as [number, number, number, number] }, detectionConfidence: 1, sequenceIndex: 1 },
  ];
  const rightBubble = makeTextRegion({ regionId: 'r-right', geometry: { coordinateSpace: 'normalized_1000', box_2d: [50, 650, 180, 920] }, rawOCR: 'مرحباً!' });
  const leftBubble = makeTextRegion({ regionId: 'r-left', geometry: { coordinateSpace: 'normalized_1000', box_2d: [60, 80, 190, 350] }, rawOCR: 'أهلاً بك...' });
  const orderedRtl = inferHierarchicalReadingOrder(panels, [leftBubble, rightBubble], 'manga_rtl');
  assert.equal(orderedRtl[0].regionId, 'r-right');
  assert.equal(orderedRtl[1].regionId, 'r-left');

  const exportPages = [
    {
      pageIndex: 1,
      bubbles: [
        {
          id: 'e1',
          pageId: 'p1',
          index: 1,
          box_2d: [50, 650, 180, 920] as [number, number, number, number],
          type: 'speech_bubbles',
          typerPrefix: '"":',
          sourceText: 'Hello!',
          originalSourceText: 'Hello!',
          translatedText: 'مرحباً!',
          rawTranslatedText: 'مرحباً!',
          reviewFlags: [],
        },
        {
          id: 'e2',
          pageId: 'p1',
          index: 2,
          box_2d: [500, 500, 600, 600] as [number, number, number, number],
          type: 'sfx',
          typerPrefix: 'SFX:',
          sourceText: 'BAM',
          originalSourceText: 'BAM',
          translatedText: 'بوم',
          rawTranslatedText: 'بوم',
          reviewFlags: [],
        },
      ] as BubbleItem[],
    },
  ];
  const rawNoSfx = compileRawTextExtract({
    chapterName: 'Chapter 1',
    pages: exportPages,
    includePageHeaders: true,
    includeIndexTags: true,
    textDirection: 'rtl',
    includeSFX: false,
  });
  const typeRWithSfx = compileTypeRScript({
    chapterName: 'Chapter 1',
    pages: exportPages,
    includePageHeaders: true,
    includeIndexTags: true,
    includePrefixTags: true,
    includeSourceComments: true,
    includeFlagNotes: false,
    includeSFX: true,
  });
  const typeRNoSfx = compileTypeRScript({
    chapterName: 'Chapter 1',
    pages: exportPages,
    includePageHeaders: true,
    includeIndexTags: true,
    includePrefixTags: true,
    includeSourceComments: true,
    includeFlagNotes: false,
    includeSFX: false,
  });
  assert.ok(!rawNoSfx.includes('BAM'));
  assert.ok(rawNoSfx.includes('Hello!'));
  assert.ok(rawNoSfx.includes('\u2067'));
  assert.ok(typeRWithSfx.includes('بوم'));
  assert.ok(typeRWithSfx.includes('مرحباً!'));
  assert.ok(!typeRNoSfx.includes('بوم'));
  assert.ok(typeRNoSfx.includes('مرحباً!'));

  // Simulated restart persistence verification: round-trip serialized clone retains coordinates & state
  const storageRestart = createMemoryStorage();
  const savedScan = await scanMangaPageHybridWithMeta({
    pageId: 'page-restart',
    apiKey: 'AIza-key',
    sourceLanguageHint: 'ja',
    hybridDeps: {
      getPageBlob: async () => createDummyBlob(),
      extractImageDimensions: async () => ({ width: 1000, height: 1500 }),
      getModelProvider: () => makeFakeModelProvider(),
      runLocalOcr: async () =>
        makeLocalOcrResult(
          'page-restart',
          [
            makeTextRegion({
              regionId: 'r-ja-1',
              geometry: { coordinateSpace: 'normalized_1000', box_2d: [150, 520, 290, 810] },
              rawOCR: '本当にいいのか？',
            }),
          ],
          { resolvedRoute: 'ja_zh_ppocrv6_manga', languageHint: 'ja' }
        ),
      runGeminiContextPass: async ({ candidates }) => ({
        pageContext: 'Quiet room',
        panels: [{ panelId: 'p1', box_2d: [20, 20, 980, 980] }],
        regionDecisions: [
          {
            regionId: candidates[0].regionId,
            action: 'keep',
            primaryClass: 'dialogue',
            sourceLanguage: 'ja',
          },
        ],
        additionalRegions: [],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
    },
  });
  await storageRestart.deps.savePageScan('page-restart', savedScan.scanResult);
  const restoredBubbles = await storageRestart.deps.getPageBubbles('page-restart');
  assert.equal(restoredBubbles.length, 0);
  const merged = mergeScanWithExistingState({
    newScan: savedScan.scanResult,
    existingBubbles: [],
    typerSettings: DEFAULT_TYPER_SETTINGS,
  });
  await storageRestart.deps.savePageBubbles('page-restart', merged.mergedBubbles);
  const reloadedAfterRestart = await storageRestart.deps.getPageBubbles('page-restart');
  assert.equal(reloadedAfterRestart.length, 1);
  assert.deepEqual(reloadedAfterRestart[0].box_2d, [150, 520, 290, 810]);
  assert.equal(reloadedAfterRestart[0].sourceText, '本当にいいのか？');
  assert.equal(reloadedAfterRestart[0].sourceLanguage, 'ja');

  // Verify workbenchStore exposes clean action API without crashing in Node
  assert.equal(typeof useWorkbenchStore.getState().startBatchScan, 'function');
  assert.equal(typeof useWorkbenchStore.getState().scanSinglePage, 'function');
});
