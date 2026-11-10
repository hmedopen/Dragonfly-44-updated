import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOcrLanguageRoute } from '../../lib/localOcr/languageRouter.ts';
import {
  LocalOcrEngineService,
  type WorkerLike,
} from '../../lib/localOcr/localOcrEngine.ts';
import {
  executeLocalPageOcrPipeline,
  type PipelineRuntimeState,
} from '../../lib/localOcr/ocrWorker.ts';
import type { LocalModelAssetProvider } from '../../lib/localOcr/modelClient.ts';
import type { ModelAssetPayload } from '../../types/localOcr.ts';
import type { WorkerOcrRequest } from '../../lib/localOcr/workerProtocol.ts';

function fakeAssets(modelId: string, files: Record<string, Uint8Array>): ModelAssetPayload {
  return { modelId, revisionLabel: 'pinned123456', files };
}

function makeProvider(missingModelIds: Set<string> = new Set()): LocalModelAssetProvider {
  return {
    getManifest: async () => ({ manifestVersion: 1, models: [] }),
    getStatus: async () => [],
    downloadModel: async () => {
      throw new Error('not needed');
    },
    cancelDownload: async () => false,
    removeModel: async () => {
      throw new Error('not needed');
    },
    readModelAssets: async (modelId) => {
      if (missingModelIds.has(modelId)) {
        throw new Error(`Model "${modelId}" is missing.`);
      }
      if (modelId === 'comic-detector-v4-s-int8') {
        return fakeAssets(modelId, { 'detector-v4-s_int8.onnx': new Uint8Array([1]) });
      }
      return fakeAssets(modelId, {
        'det/inference.onnx': new Uint8Array([1]),
        'det/inference.yml': new TextEncoder().encode('Global:\n  model_name: test\n'),
        'rec/inference.onnx': new Uint8Array([1]),
        'rec/inference.yml': new TextEncoder().encode('Global:\n  model_name: test\n'),
      });
    },
  };
}

test('language routing enforces explicit routes and never routes Korean through Manga model', () => {
  assert.equal(resolveOcrLanguageRoute('en').ocrModelId, 'ppocr-v6-small-en');
  assert.equal(resolveOcrLanguageRoute('ko').ocrModelId, 'ppocr-v5-mobile-ko');
  assert.equal(resolveOcrLanguageRoute('ja').ocrModelId, 'ppocr-v6-manga-v0.3');
  assert.equal(resolveOcrLanguageRoute('zh').ocrModelId, 'ppocr-v6-manga-v0.3');

  // Auto-detection with Hangul sample routes to Korean, never Manga
  assert.equal(resolveOcrLanguageRoute('auto', '안녕하세요').ocrModelId, 'ppocr-v5-mobile-ko');

  // Ambiguous Han-only text respects explicit project language hint (zh stays zh, ja stays ja)
  const zhExplicit = resolveOcrLanguageRoute('zh', '漢字');
  const jaExplicit = resolveOcrLanguageRoute('ja', '漢字');
  assert.equal(zhExplicit.effectiveLanguage, 'zh');
  assert.equal(jaExplicit.effectiveLanguage, 'ja');
  assert.equal(resolveOcrLanguageRoute('auto', '漢字').isAmbiguousAutoRoute, true);
});

test('missing Korean model fails clearly without silently substituting Japanese/Chinese model', async () => {
  const loadedModels: string[] = [];
  const provider: LocalModelAssetProvider = {
    ...makeProvider(new Set(['ppocr-v5-mobile-ko'])),
    readModelAssets: async (modelId) => {
      loadedModels.push(modelId);
      return makeProvider(new Set(['ppocr-v5-mobile-ko'])).readModelAssets(modelId);
    },
  };

  const engine = new LocalOcrEngineService({
    modelProvider: provider,
    createWorker: () => {
      throw new Error('Should not launch worker if model asset loading failed');
    },
  });

  await assert.rejects(
    () =>
      engine.runPageOcr({
        image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
        pageId: 'p1',
        languageHint: 'ko',
      }),
    /ppocr-v5-mobile-ko.*missing/i
  );
  assert.equal(loadedModels.includes('ppocr-v6-manga-v0.3'), false);
});

test('worker initialization failure rejects cleanly and refuses UI-thread inference fallback', async () => {
  const originalWorker = (globalThis as { Worker?: unknown }).Worker;
  try {
    delete (globalThis as { Worker?: unknown }).Worker;
    const noWorkerEngine = new LocalOcrEngineService({
      modelProvider: makeProvider(),
    });
    await assert.rejects(
      () =>
        noWorkerEngine.runPageOcr({
          image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
          pageId: 'p1',
          languageHint: 'en',
        }),
      /Web Worker runtime is unavailable/i
    );
  } finally {
    if (originalWorker !== undefined) {
      (globalThis as { Worker?: unknown }).Worker = originalWorker;
    }
  }

  const failingWorkerEngine = new LocalOcrEngineService({
    modelProvider: makeProvider(),
    createWorker: (): WorkerLike => {
      const listeners = new Map<string, Set<(ev: any) => void>>();
      return {
        postMessage() {
          for (const fn of listeners.get('error') || []) {
            fn({ message: 'Simulated worker boot failure' });
          }
        },
        addEventListener(type, fn) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(fn);
        },
        removeEventListener(type, fn) {
          listeners.get(type)?.delete(fn);
        },
        terminate() {},
      };
    },
  });

  await assert.rejects(
    () =>
      failingWorkerEngine.runPageOcr({
        image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
        pageId: 'p1',
        languageHint: 'en',
      }),
    /Simulated worker boot failure/i
  );
});

test('cancellation aborts in-flight job and blocks stale late worker results from publishing', async () => {
  const postedRequests: WorkerOcrRequest[] = [];
  const listeners = new Map<string, Set<(ev: any) => void>>();

  const mockWorker: WorkerLike = {
    postMessage(msg) {
      postedRequests.push(msg);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    terminate() {},
  };

  const engine = new LocalOcrEngineService({
    modelProvider: makeProvider(),
    createWorker: () => mockWorker,
    wasmPaths: './ort/',
  });

  const controller = new AbortController();
  let resolvedAfterAbort = false;

  const jobPromise = engine
    .runPageOcr({
      image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
      pageId: 'p1',
      languageHint: 'en',
      signal: controller.signal,
    })
    .then(() => {
      resolvedAfterAbort = true;
    });

  // Wait for run_page_ocr to reach worker
  await new Promise((r) => setTimeout(r, 15));
  const runReq = postedRequests.find((m) => m.type === 'run_page_ocr');
  assert.ok(runReq && runReq.type === 'run_page_ocr');

  controller.abort();
  await assert.rejects(() => jobPromise, (err: Error) => err.name === 'AbortError');
  assert.ok(postedRequests.some((m) => m.type === 'cancel_job' && m.jobId === runReq.jobId));

  // Even if worker tries to send stale job_result afterward, it must not resolve or publish
  for (const fn of listeners.get('message') || []) {
    fn({ data: { type: 'job_result', jobId: runReq.jobId, result: {} } });
  }
  assert.equal(resolvedAfterAbort, false);
});

test('partial tile failure preserves surviving tiles and partial crop failure preserves other text', async () => {
  const state: PipelineRuntimeState = {
    detectorKey: null,
    detectorSession: null,
    ocrKey: null,
    ocrAdapter: null,
  };

  let cropIndex = 0;
  const result = await executeLocalPageOcrPipeline(
    {
      jobId: 'partial-test',
      pageId: 'page-partial',
      imageBytes: new ArrayBuffer(16),
      mimeType: 'image/png',
      languageHint: 'en',
      resolvedRoute: 'en_ppocrv6_small',
      readingConvention: 'ltr',
      detectorAssets: fakeAssets('comic-detector-v4-s-int8', {
        'detector-v4-s_int8.onnx': new Uint8Array([1]),
      }),
      ocrAssets: fakeAssets('ppocr-v6-small-en', {}),
      wasmPaths: './ort/',
    },
    state,
    () => false,
    {
      decodeImage: async () => ({
        width: 640,
        height: 1100,
        data: new Uint8ClampedArray(640 * 1100 * 4),
      }),
      createDetector: async () => ({
        async runTile(_rgba, tile) {
          if (tile.tileId === 'tile_r0_c0') {
            throw new Error('Simulated tile 0 failure');
          }
          return [
            {
              detectionId: 'b_ok',
              classLabel: 'bubble',
              classId: 0,
              pixelBox: [700, 100, 850, 300],
              normalizedBox: [636, 156, 773, 469],
              rawScore: 0.91,
              tileId: tile.tileId,
              touchesTileInnerLeft: false,
              touchesTileInnerTop: false,
              touchesTileInnerRight: false,
              touchesTileInnerBottom: false,
            },
            {
              detectionId: 'tb_ok_1',
              classLabel: 'text_bubble',
              classId: 1,
              pixelBox: [720, 120, 820, 280],
              normalizedBox: [655, 188, 745, 438],
              rawScore: 0.88,
              tileId: tile.tileId,
              touchesTileInnerLeft: false,
              touchesTileInnerTop: false,
              touchesTileInnerRight: false,
              touchesTileInnerBottom: false,
            },
            {
              detectionId: 'tb_ok_2',
              classLabel: 'text_free',
              classId: 2,
              pixelBox: [900, 100, 960, 260],
              normalizedBox: [818, 156, 873, 406],
              rawScore: 0.82,
              tileId: tile.tileId,
              touchesTileInnerLeft: false,
              touchesTileInnerTop: false,
              touchesTileInnerRight: false,
              touchesTileInnerBottom: false,
            },
          ];
        },
        async dispose() {},
      }),
      createOcrAdapter: async () => ({
        runtimeUsed: 'paddleocr_js',
        async predictCrop() {
          cropIndex++;
          if (cropIndex === 2) {
            throw new Error('Simulated OCR crop 2 error');
          }
          return [
            {
              poly: [[10, 10], [110, 10], [110, 40], [10, 40]],
              text: 'Surviving text',
              score: 0.87,
            },
          ];
        },
        async dispose() {},
      }),
    }
  );

  assert.equal(result.status, 'partial');
  assert.equal(result.partialFailures.length, 2);
  assert.equal(result.bubbleRegions.length, 1);
  assert.equal(result.textRegions.length, 2);
  assert.equal(result.textRegions[0].rawOCR, 'Surviving text');
  assert.equal(result.textRegions[0].confidence.ocr, 0.87);
  assert.ok(result.textRegions[1].flags.includes('OCR_AMBIGUOUS'));
});

test('returns failed status when every tile fails', async () => {
  const state: PipelineRuntimeState = {
    detectorKey: null,
    detectorSession: null,
    ocrKey: null,
    ocrAdapter: null,
  };

  const result = await executeLocalPageOcrPipeline(
    {
      jobId: 'all-fail',
      pageId: 'page-fail',
      imageBytes: new ArrayBuffer(16),
      mimeType: 'image/png',
      languageHint: 'en',
      resolvedRoute: 'en_ppocrv6_small',
      readingConvention: 'ltr',
      detectorAssets: fakeAssets('comic-detector-v4-s-int8', {
        'detector-v4-s_int8.onnx': new Uint8Array([1]),
      }),
      ocrAssets: fakeAssets('ppocr-v6-small-en', {}),
      wasmPaths: './ort/',
    },
    state,
    () => false,
    {
      decodeImage: async () => ({
        width: 500,
        height: 500,
        data: new Uint8ClampedArray(500 * 500 * 4),
      }),
      createDetector: async () => ({
        async runTile() {
          throw new Error('Tile crashed');
        },
        async dispose() {},
      }),
      createOcrAdapter: async () => ({
        runtimeUsed: 'paddleocr_js',
        async predictCrop() {
          return [];
        },
        async dispose() {},
      }),
    }
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.partialFailures.length, 1);
  assert.ok(result.error?.includes('failed'));
});
