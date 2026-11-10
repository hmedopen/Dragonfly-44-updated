import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalOcrEngineService,
  type WorkerLike,
} from '../../lib/localOcr/localOcrEngine.ts';
import {
  createWorkerRuntime,
  type ExecutePipelineDeps,
} from '../../lib/localOcr/ocrWorker.ts';
import type { LocalModelAssetProvider } from '../../lib/localOcr/modelClient.ts';
import type { LocalModelManifest } from '../../lib/localOcr/modelManifest.ts';
import type { ModelAssetPayload } from '../../types/localOcr.ts';
import type { WorkerOcrRequest, WorkerOcrResponse } from '../../lib/localOcr/workerProtocol.ts';

function makeManifestForRevs(detRev: string, enRev: string, koRev: string): LocalModelManifest {
  const mkEntry = (modelId: string, rev: string) => ({
    modelId,
    displayName: modelId,
    role: modelId === 'comic-detector-v4-s-int8' ? ('comic_detector' as const) : ('ocr_pipeline' as const),
    languagesOrTask: ['test'],
    upstreamRepositories: ['org/repo'],
    pinnedRevisions: { 'org/repo': rev },
    files: [],
    modelCardUrl: 'https://example.invalid/card',
    declaredLicense: 'Apache-2.0',
    trainingDataProvenanceNotes: 'test',
    redistributionStatus: 'dev_only_unverified_provenance' as const,
    runtimeCompatibility: {
      sdkSupported: true,
      requiresCustomUstarArchive: false,
      requiresOrtAdapterFallback: false,
      executionProviders: ['wasm' as const],
      notes: 'test',
    },
  });
  return {
    manifestVersion: 1,
    models: [
      mkEntry('comic-detector-v4-s-int8', detRev),
      mkEntry('ppocr-v6-small-en', enRev),
      mkEntry('ppocr-v5-mobile-ko', koRev),
    ],
  };
}

function makeFakeAssets(modelId: string, revisionLabel: string): ModelAssetPayload {
  return {
    modelId,
    revisionLabel,
    files:
      modelId === 'comic-detector-v4-s-int8'
        ? { 'detector-v4-s_int8.onnx': new Uint8Array([1, 2, 3]) }
        : {
            'det/inference.onnx': new Uint8Array([1]),
            'det/inference.yml': new TextEncoder().encode('Global:\n  model_name: test\n'),
            'rec/inference.onnx': new Uint8Array([1]),
            'rec/inference.yml': new TextEncoder().encode('Global:\n  model_name: test\n'),
          },
  };
}

function createConnectedWorkerHarness(pipelineDeps: ExecutePipelineDeps) {
  const postedRequests: WorkerOcrRequest[] = [];
  const listeners = new Map<string, Set<(ev: any) => void>>();
  let terminated = false;
  let ignoreCancel = false;

  const runtime = createWorkerRuntime((msg: WorkerOcrResponse) => {
    if (terminated) return;
    for (const fn of [...(listeners.get('message') || [])]) {
      fn({ data: msg });
    }
  }, pipelineDeps);

  const worker: WorkerLike = {
    postMessage(msg) {
      postedRequests.push(msg);
      if (msg.type === 'cancel_job' && ignoreCancel) {
        return;
      }
      void runtime.handleMessage(msg);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    terminate() {
      terminated = true;
    },
  };

  return {
    worker,
    postedRequests,
    isTerminated: () => terminated,
    setIgnoreCancel: (v: boolean) => {
      ignoreCancel = v;
    },
  };
}

test('P2.1: Scan All sequential pages read and transfer models once, reuse cache, and reload only changed routes/revisions', async () => {
  let detRev = 'a'.repeat(40);
  let enRev = 'b'.repeat(40);
  const koRev = 'c'.repeat(40);
  const readCounts = new Map<string, number>();
  let detectorCreates = 0;
  let detectorDisposes = 0;
  let ocrCreates = 0;
  let ocrDisposes = 0;
  const postedAll: WorkerOcrRequest[] = [];

  const provider: LocalModelAssetProvider = {
    getManifest: async () => makeManifestForRevs(detRev, enRev, koRev),
    getStatus: async () => [],
    downloadModel: async () => {
      throw new Error('unused');
    },
    cancelDownload: async () => false,
    removeModel: async () => {
      throw new Error('unused');
    },
    readModelAssets: async (modelId) => {
      readCounts.set(modelId, (readCounts.get(modelId) ?? 0) + 1);
      const fullRev =
        modelId === 'comic-detector-v4-s-int8'
          ? detRev
          : modelId === 'ppocr-v6-small-en'
          ? enRev
          : koRev;
      return makeFakeAssets(modelId, fullRev.slice(0, 12));
    },
  };

  const pipelineDeps: ExecutePipelineDeps = {
    decodeImage: async () => ({
      width: 200,
      height: 200,
      data: new Uint8ClampedArray(200 * 200 * 4),
    }),
    createDetector: async () => {
      detectorCreates++;
      return {
        async runTile() {
          return [];
        },
        async dispose() {
          detectorDisposes++;
        },
      };
    },
    createOcrAdapter: async () => {
      ocrCreates++;
      return {
        runtimeUsed: 'ort_web_adapter',
        async predictCrop() {
          return [];
        },
        async dispose() {
          ocrDisposes++;
        },
      };
    },
  };

  const harness = createConnectedWorkerHarness(pipelineDeps);
  const engine = new LocalOcrEngineService({
    modelProvider: provider,
    createWorker: () => {
      const origPost = harness.worker.postMessage.bind(harness.worker);
      return {
        ...harness.worker,
        postMessage(msg: WorkerOcrRequest, transfer?: Transferable[]) {
          postedAll.push(msg);
          if (transfer) {
            origPost(msg, transfer);
          } else {
            origPost(msg);
          }
        },
      };
    },
  });

  // Page 1 (EN): must load & transfer both detector and EN OCR
  await engine.runPageOcr({
    image: { bytes: new Uint8Array([1]), mimeType: 'image/png' },
    pageId: 'scan-all-p1',
    languageHint: 'en',
  });
  assert.equal(readCounts.get('comic-detector-v4-s-int8'), 1);
  assert.equal(readCounts.get('ppocr-v6-small-en'), 1);
  assert.equal(detectorCreates, 1);
  assert.equal(ocrCreates, 1);

  // Pages 2..4 (EN): must NOT call readModelAssets or transfer model payloads again
  for (const pid of ['scan-all-p2', 'scan-all-p3', 'scan-all-p4']) {
    await engine.runPageOcr({
      image: { bytes: new Uint8Array([2]), mimeType: 'image/png' },
      pageId: pid,
      languageHint: 'en',
    });
  }
  assert.equal(readCounts.get('comic-detector-v4-s-int8'), 1, 'Detector must not be re-read across Scan All');
  assert.equal(readCounts.get('ppocr-v6-small-en'), 1, 'EN OCR must not be re-read across Scan All');
  assert.equal(detectorCreates, 1);
  assert.equal(ocrCreates, 1);

  const p2Req = postedAll.filter((m) => m.type === 'run_page_ocr')[1];
  assert.ok(p2Req && p2Req.type === 'run_page_ocr');
  assert.equal(p2Req.detectorAssets, undefined, 'Page 2 must not re-transfer detectorAssets');
  assert.equal(p2Req.ocrAssets, undefined, 'Page 2 must not re-transfer ocrAssets');

  // Page 5 (KO): detector stays cached, only KO OCR is loaded & previous EN adapter disposed
  await engine.runPageOcr({
    image: { bytes: new Uint8Array([3]), mimeType: 'image/png' },
    pageId: 'scan-all-p5-ko',
    languageHint: 'ko',
  });
  assert.equal(readCounts.get('comic-detector-v4-s-int8'), 1, 'Detector remains cached across OCR route switch');
  assert.equal(readCounts.get('ppocr-v5-mobile-ko'), 1);
  assert.equal(ocrCreates, 2);
  assert.equal(ocrDisposes, 1);

  // Revision change: detector revision updates -> cache invalidated & old detector disposed
  detRev = 'd'.repeat(40);
  await engine.runPageOcr({
    image: { bytes: new Uint8Array([4]), mimeType: 'image/png' },
    pageId: 'scan-all-p6-new-rev',
    languageHint: 'ko',
  });
  assert.equal(readCounts.get('comic-detector-v4-s-int8'), 2, 'Updated revision must trigger reload');
  assert.equal(readCounts.get('ppocr-v5-mobile-ko'), 1, 'Unchanged KO OCR revision remains cached');
  assert.equal(detectorCreates, 2);
  assert.equal(detectorDisposes, 1);
});

test('P2.1: worker restart clears cache and cancellation during loading never leaves invalid cache entries', async () => {
  const detRev = 'a'.repeat(40);
  const enRev = 'b'.repeat(40);
  const koRev = 'c'.repeat(40);
  const readCounts = new Map<string, number>();

  const provider: LocalModelAssetProvider = {
    getManifest: async () => makeManifestForRevs(detRev, enRev, koRev),
    getStatus: async () => [],
    downloadModel: async () => {
      throw new Error('unused');
    },
    cancelDownload: async () => false,
    removeModel: async () => {
      throw new Error('unused');
    },
    readModelAssets: async (modelId) => {
      readCounts.set(modelId, (readCounts.get(modelId) ?? 0) + 1);
      if (modelId === 'ppocr-v6-small-en' && readCounts.get(modelId) === 1) {
        // Slow initial read so we can cancel mid-read
        await new Promise((r) => setTimeout(r, 40));
      }
      const fullRev = modelId === 'comic-detector-v4-s-int8' ? detRev : enRev;
      return makeFakeAssets(modelId, fullRev.slice(0, 12));
    },
  };

  let workerIndex = 0;
  let ctrlCancelMidOcr: AbortController | null = null;
  let cancelAfterDetTriggered = false;
  const harnesses: ReturnType<typeof createConnectedWorkerHarness>[] = [];

  const engine = new LocalOcrEngineService({
    modelProvider: provider,
    cancellationTimeoutMs: 40,
    createWorker: () => {
      const idx = ++workerIndex;
      const h = createConnectedWorkerHarness({
        decodeImage: async () => ({
          width: 100,
          height: 100,
          data: new Uint8ClampedArray(100 * 100 * 4),
        }),
        createDetector: async () => ({
          async runTile() {
            if (idx === 2) {
              // On worker 2, hang tile so cancel timeout triggers worker restart
              await new Promise((r) => setTimeout(r, 200));
            }
            return [];
          },
          async dispose() {},
        }),
        createOcrAdapter: async () => {
          if (!cancelAfterDetTriggered && ctrlCancelMidOcr) {
            cancelAfterDetTriggered = true;
            ctrlCancelMidOcr.abort();
          }
          return {
            runtimeUsed: 'ort_web_adapter',
            async predictCrop() {
              return [];
            },
            async dispose() {},
          };
        },
      });
      if (idx === 2) {
        h.setIgnoreCancel(true);
      }
      harnesses.push(h);
      return h.worker;
    },
  });

  // 1. Cancel during readModelAssets -> neither model may be marked cached
  const ctrl1 = new AbortController();
  const p1 = engine.runPageOcr({
    image: { bytes: new Uint8Array([1]), mimeType: 'image/png' },
    pageId: 'cancel-during-read',
    languageHint: 'en',
    signal: ctrl1.signal,
  });
  setTimeout(() => ctrl1.abort(), 10);
  await assert.rejects(() => p1, (err: Error) => err.name === 'AbortError');
  assert.deepEqual(engine.getWorkerCachedModelKeys(), { detectorKey: null, ocrKey: null });

  // 2. Cancel inside worker after detector loaded & OCR loaded -> engine mirrors worker's actual loaded state
  ctrlCancelMidOcr = new AbortController();
  const p2 = engine.runPageOcr({
    image: { bytes: new Uint8Array([2]), mimeType: 'image/png' },
    pageId: 'cancel-in-worker',
    languageHint: 'en',
    signal: ctrlCancelMidOcr.signal,
  });
  await assert.rejects(() => p2, (err: Error) => err.name === 'AbortError');

  // Next job must succeed cleanly (reusing whatever worker actually cached, reloading anything missing)
  const ok1 = await engine.runPageOcr({
    image: { bytes: new Uint8Array([3]), mimeType: 'image/png' },
    pageId: 'after-cancel',
    languageHint: 'en',
  });
  assert.equal(ok1.status, 'complete');

  // 3. Explicit dispose + recreate -> clears cache and reloads assets safely for new worker
  await engine.dispose();
  assert.deepEqual(engine.getWorkerCachedModelKeys(), { detectorKey: null, ocrKey: null });

  const readsBeforeW2 = readCounts.get('comic-detector-v4-s-int8') ?? 0;
  const ctrlHang = new AbortController();
  const pHang = engine.runPageOcr({
    image: { bytes: new Uint8Array([4]), mimeType: 'image/png' },
    pageId: 'hang-on-w2',
    languageHint: 'en',
    signal: ctrlHang.signal,
  });
  setTimeout(() => ctrlHang.abort(), 15);
  await assert.rejects(() => pHang, (err: Error) => err.name === 'AbortError');
  assert.equal(harnesses[1].isTerminated(), true);
  assert.deepEqual(engine.getWorkerCachedModelKeys(), { detectorKey: null, ocrKey: null });

  // Worker 3 restores assets safely and succeeds
  const ok3 = await engine.runPageOcr({
    image: { bytes: new Uint8Array([5]), mimeType: 'image/png' },
    pageId: 'recovered-w3',
    languageHint: 'en',
  });
  assert.equal(ok3.status, 'complete');
  assert.ok((readCounts.get('comic-detector-v4-s-int8') ?? 0) >= readsBeforeW2 + 2);
});
