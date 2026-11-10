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
import type { ModelAssetPayload } from '../../types/localOcr.ts';
import type {
  SerializableLocalOcrResult,
  WorkerOcrRequest,
  WorkerOcrResponse,
} from '../../lib/localOcr/workerProtocol.ts';

function fakeAssets(modelId: string, revisionLabel = 'rev000000001'): ModelAssetPayload {
  return {
    modelId,
    revisionLabel,
    files:
      modelId === 'comic-detector-v4-s-int8'
        ? { 'detector-v4-s_int8.onnx': new Uint8Array([1]) }
        : {
            'det/inference.onnx': new Uint8Array([1]),
            'det/inference.yml': new TextEncoder().encode('Global:\n  model_name: test\n'),
            'rec/inference.onnx': new Uint8Array([1]),
            'rec/inference.yml': new TextEncoder().encode('Global:\n  model_name: test\n'),
          },
  };
}

function makeFakeProvider(onRead?: (modelId: string) => void): LocalModelAssetProvider {
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
      onRead?.(modelId);
      return fakeAssets(modelId);
    },
  };
}

function makeFakeResult(jobId: string, pageId: string): SerializableLocalOcrResult {
  return {
    scanId: `local-${jobId}`,
    pageId,
    status: 'complete',
    sourceDimensions: { width: 500, height: 700 },
    readingConvention: 'manga_rtl',
    languageHint: 'en',
    resolvedRoute: 'en_ppocrv6_small',
    bubbleRegions: [],
    textRegions: [],
    lineSegments: [],
    tiles: [],
    modelsUsed: {
      detectorModelId: 'comic-detector-v4-s-int8',
      detectorRevision: 'rev000000001',
      ocrModelId: 'ppocr-v6-small-en',
      ocrRevision: 'rev000000001',
      routeId: 'en_ppocrv6_small',
      ocrRuntimeUsed: 'ort_web_adapter',
      executionProvider: 'wasm',
      simdEnabled: true,
      threadsUsed: 1,
    },
    timings: {
      initMs: 1,
      decodeMs: 1,
      detectorMs: 1,
      ocrMs: 1,
      postprocessMs: 0,
      totalMs: 4,
      tileCount: 1,
      cropCount: 0,
      measuredMemoryBytes: null,
    },
    partialFailures: [],
    warnings: [],
  };
}

class ControlledMockWorker implements WorkerLike {
  public readonly posted: WorkerOcrRequest[] = [];
  public terminated = false;
  private readonly listeners = new Map<string, Set<(ev: any) => void>>();
  private readonly onPost?: (msg: WorkerOcrRequest, self: ControlledMockWorker) => void;

  constructor(onPost?: (msg: WorkerOcrRequest, self: ControlledMockWorker) => void) {
    this.onPost = onPost;
  }

  postMessage(msg: WorkerOcrRequest): void {
    this.posted.push(msg);
    this.onPost?.(msg, this);
  }

  addEventListener(type: 'message' | 'error', listener: (ev: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: 'message' | 'error', listener: (ev: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emitMessage(data: WorkerOcrResponse): void {
    for (const fn of [...(this.listeners.get('message') || [])]) {
      fn({ data });
    }
  }

  emitError(message: string): void {
    for (const fn of [...(this.listeners.get('error') || [])]) {
      fn({ message });
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

test('P0.1: queued job cancelled before start never runs on worker and does not disturb active job', async () => {
  const startedPages: string[] = [];
  let activeWorker!: ControlledMockWorker;

  const engine = new LocalOcrEngineService({
    modelProvider: makeFakeProvider(),
    createWorker: () => {
      activeWorker = new ControlledMockWorker((msg, w) => {
        if (msg.type === 'run_page_ocr') {
          startedPages.push(msg.pageId);
          // Finish page 1 after 35ms
          setTimeout(() => {
            w.emitMessage({
              type: 'job_result',
              jobId: msg.jobId,
              result: makeFakeResult(msg.jobId, msg.pageId),
              loadedModelKeys: {
                detectorKey: msg.detectorModelKey ?? null,
                ocrKey: msg.ocrModelKey ?? null,
              },
            });
          }, 35);
        }
      });
      return activeWorker;
    },
  });

  const job1 = engine.runPageOcr({
    image: { bytes: new Uint8Array([1, 2]), mimeType: 'image/png' },
    pageId: 'page-1',
    languageHint: 'en',
  });

  const ctrl2 = new AbortController();
  const job2 = engine.runPageOcr({
    image: { bytes: new Uint8Array([3, 4]), mimeType: 'image/png' },
    pageId: 'page-2-queued-cancel',
    languageHint: 'en',
    signal: ctrl2.signal,
  });

  const job3 = engine.runPageOcr({
    image: { bytes: new Uint8Array([5, 6]), mimeType: 'image/png' },
    pageId: 'page-3',
    languageHint: 'en',
  });

  // Cancel job2 immediately while job1 is running
  ctrl2.abort();
  await assert.rejects(() => job2, (err: Error) => err.name === 'AbortError');

  const [r1, r3] = await Promise.all([job1, job3]);
  assert.equal(r1.pageId, 'page-1');
  assert.equal(r3.pageId, 'page-3');
  assert.deepEqual(startedPages, ['page-1', 'page-3']);
  assert.equal(activeWorker.posted.some((m) => m.type === 'run_page_ocr' && m.pageId === 'page-2-queued-cancel'), false);
});

test('P0.1: active job cancellation waits for worker job_cancelled ack before starting next job (no overlap)', async () => {
  const timeline: string[] = [];
  let inFlightInWorker = 0;
  let maxConcurrentInWorker = 0;

  const engine = new LocalOcrEngineService({
    modelProvider: makeFakeProvider(),
    cancellationTimeoutMs: 500,
    createWorker: () =>
      new ControlledMockWorker((msg, w) => {
        if (msg.type === 'run_page_ocr') {
          inFlightInWorker++;
          maxConcurrentInWorker = Math.max(maxConcurrentInWorker, inFlightInWorker);
          timeline.push(`start:${msg.pageId}`);
          if (msg.pageId === 'page-2') {
            setTimeout(() => {
              inFlightInWorker--;
              timeline.push('finish:page-2');
              w.emitMessage({
                type: 'job_result',
                jobId: msg.jobId,
                result: makeFakeResult(msg.jobId, msg.pageId),
              });
            }, 10);
          }
        } else if (msg.type === 'cancel_job') {
          timeline.push(`cancel_req:${msg.jobId}`);
          // Simulate worker finishing current synchronous tile then acknowledging cancellation 40ms later
          setTimeout(() => {
            inFlightInWorker--;
            timeline.push(`cancel_ack:${msg.jobId}`);
            w.emitMessage({ type: 'job_cancelled', jobId: msg.jobId });
          }, 40);
        }
      }),
  });

  const ctrl1 = new AbortController();
  const job1 = engine.runPageOcr({
    image: { bytes: new Uint8Array([1]), mimeType: 'image/png' },
    pageId: 'page-1',
    languageHint: 'en',
    signal: ctrl1.signal,
  });

  // Wait until job1 is active inside worker
  await new Promise((r) => setTimeout(r, 15));
  const job2 = engine.runPageOcr({
    image: { bytes: new Uint8Array([2]), mimeType: 'image/png' },
    pageId: 'page-2',
    languageHint: 'en',
  });

  let job1Rejected = false;
  const job1Wait = job1.catch((err) => {
    job1Rejected = true;
    assert.equal(err.name, 'AbortError');
  });

  ctrl1.abort();
  // Immediately after abort(), job1 MUST still be waiting for worker ack, and page-2 MUST NOT have started!
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(job1Rejected, false, 'Job 1 must not resolve/reject before worker ack');
  assert.equal(timeline.includes('start:page-2'), false, 'Job 2 must not overlap cancelled Job 1');

  await job1Wait;
  const r2 = await job2;
  assert.equal(r2.pageId, 'page-2');
  assert.equal(maxConcurrentInWorker, 1, 'Worker must never execute overlapping jobs');

  const ackIdx = timeline.findIndex((e) => e.startsWith('cancel_ack:'));
  const start2Idx = timeline.indexOf('start:page-2');
  assert.ok(ackIdx >= 0 && start2Idx > ackIdx, `Expected page-2 to start only after cancel_ack: ${timeline.join(' -> ')}`);
});

test('P0.1: stale messages from cancelled or prior job cannot affect subsequent job', async () => {
  let mockWorker!: ControlledMockWorker;
  let firstJobId = '';

  const engine = new LocalOcrEngineService({
    modelProvider: makeFakeProvider(),
    cancellationTimeoutMs: 500,
    createWorker: () => {
      mockWorker = new ControlledMockWorker((msg, w) => {
        if (msg.type === 'run_page_ocr' && msg.pageId === 'page-1') {
          firstJobId = msg.jobId;
        } else if (msg.type === 'cancel_job') {
          setTimeout(() => {
            w.emitMessage({ type: 'job_cancelled', jobId: msg.jobId });
          }, 10);
        } else if (msg.type === 'run_page_ocr' && msg.pageId === 'page-2') {
          // Inject stale messages from job 1 BEFORE job 2 completes
          w.emitMessage({
            type: 'job_error',
            jobId: firstJobId,
            error: 'STALE ERROR FROM JOB 1',
          });
          w.emitMessage({
            type: 'job_result',
            jobId: firstJobId,
            result: makeFakeResult(firstJobId, 'WRONG-STALE-PAGE'),
          });
          setTimeout(() => {
            w.emitMessage({
              type: 'job_result',
              jobId: msg.jobId,
              result: makeFakeResult(msg.jobId, 'page-2'),
            });
          }, 10);
        }
      });
      return mockWorker;
    },
  });

  const ctrl1 = new AbortController();
  const p1 = engine.runPageOcr({
    image: { bytes: new Uint8Array([1]), mimeType: 'image/png' },
    pageId: 'page-1',
    languageHint: 'en',
    signal: ctrl1.signal,
  });

  await new Promise((r) => setTimeout(r, 10));
  ctrl1.abort();
  await assert.rejects(() => p1, (err: Error) => err.name === 'AbortError');

  const r2 = await engine.runPageOcr({
    image: { bytes: new Uint8Array([2]), mimeType: 'image/png' },
    pageId: 'page-2',
    languageHint: 'en',
  });
  assert.equal(r2.pageId, 'page-2');
});

test('P0.1: unresponsive worker is terminated, recreated, restored, and runs subsequent job safely', async () => {
  const workers: ControlledMockWorker[] = [];
  const events: string[] = [];

  const engine = new LocalOcrEngineService({
    modelProvider: makeFakeProvider(),
    cancellationTimeoutMs: 40,
    createWorker: () => {
      const idx = workers.length + 1;
      const w = new ControlledMockWorker((msg, self) => {
        if (msg.type === 'run_page_ocr') {
          events.push(`w${idx}:run:${msg.pageId}`);
          if (idx === 1) {
            // Worker 1 hangs completely (never responds to run or cancel_job)
            return;
          }
          setTimeout(() => {
            events.push(`w${idx}:done:${msg.pageId}`);
            self.emitMessage({
              type: 'job_result',
              jobId: msg.jobId,
              result: makeFakeResult(msg.jobId, msg.pageId),
            });
          }, 10);
        } else if (msg.type === 'cancel_job') {
          events.push(`w${idx}:cancel_ignored`);
        }
      });
      workers.push(w);
      return w;
    },
    restoreWorkerRuntime: async () => {
      await new Promise((r) => setTimeout(r, 15));
      events.push('replacement_ready');
    },
  });

  const ctrl1 = new AbortController();
  const job1 = engine.runPageOcr({
    image: { bytes: new Uint8Array([1]), mimeType: 'image/png' },
    pageId: 'hung-page',
    languageHint: 'en',
    signal: ctrl1.signal,
  });

  await new Promise((r) => setTimeout(r, 10));
  const job2 = engine.runPageOcr({
    image: { bytes: new Uint8Array([2]), mimeType: 'image/png' },
    pageId: 'recovered-page',
    languageHint: 'en',
  });

  ctrl1.abort();
  await assert.rejects(() => job1, (err: Error) => err.name === 'AbortError');
  const res2 = await job2;

  assert.equal(workers.length, 2, 'Should have created a replacement worker');
  assert.equal(workers[0].terminated, true, 'Unresponsive worker must be terminated');
  assert.equal(workers[1].terminated, false);
  assert.equal(res2.pageId, 'recovered-page');

  const readyIdx = events.indexOf('replacement_ready');
  const run2Idx = events.indexOf('w2:run:recovered-page');
  assert.ok(
    readyIdx >= 0 && run2Idx > readyIdx,
    `Subsequent job must run only after replacement worker is ready: ${events.join(' -> ')}`
  );
});

test('P0.1: worker runtime errors do not permanently poison the processing queue', async () => {
  let workerIdx = 0;

  const engine = new LocalOcrEngineService({
    modelProvider: makeFakeProvider(),
    createWorker: () => {
      workerIdx++;
      const current = workerIdx;
      return new ControlledMockWorker((msg, w) => {
        if (msg.type === 'run_page_ocr') {
          if (current === 1) {
            w.emitError('Simulated WASM OOM crash');
            return;
          }
          if (current === 2 && msg.pageId === 'bad-job') {
            w.emitMessage({ type: 'job_error', jobId: msg.jobId, error: 'Corrupt image header' });
            return;
          }
          w.emitMessage({
            type: 'job_result',
            jobId: msg.jobId,
            result: makeFakeResult(msg.jobId, msg.pageId),
          });
        }
      });
    },
  });

  await assert.rejects(
    () =>
      engine.runPageOcr({
        image: { bytes: new Uint8Array([1]), mimeType: 'image/png' },
        pageId: 'crash-page',
        languageHint: 'en',
      }),
    /WASM OOM crash/i
  );

  await assert.rejects(
    () =>
      engine.runPageOcr({
        image: { bytes: new Uint8Array([2]), mimeType: 'image/png' },
        pageId: 'bad-job',
        languageHint: 'en',
      }),
    /Corrupt image header/i
  );

  const ok = await engine.runPageOcr({
    image: { bytes: new Uint8Array([3]), mimeType: 'image/png' },
    pageId: 'healthy-page',
    languageHint: 'en',
  });
  assert.equal(ok.pageId, 'healthy-page');
  assert.equal(ok.status, 'complete');
});

test('P0.1: ocrWorker createWorkerRuntime strictly serializes concurrent messages and targets cancel by jobId', async () => {
  const responses: WorkerOcrResponse[] = [];
  let concurrentRuns = 0;
  let maxConcurrentRuns = 0;
  const execOrder: string[] = [];

  const deps: ExecutePipelineDeps = {
    decodeImage: async () => ({
      width: 100,
      height: 100,
      data: new Uint8ClampedArray(100 * 100 * 4),
    }),
    createDetector: async () => ({
      async runTile() {
        concurrentRuns++;
        maxConcurrentRuns = Math.max(maxConcurrentRuns, concurrentRuns);
        await new Promise((r) => setTimeout(r, 25));
        concurrentRuns--;
        return [];
      },
      async dispose() {},
    }),
    createOcrAdapter: async () => ({
      runtimeUsed: 'ort_web_adapter',
      async predictCrop() {
        return [];
      },
      async dispose() {},
    }),
  };

  const runtime = createWorkerRuntime((msg) => {
    responses.push(msg);
    if ('jobId' in msg) execOrder.push(`${msg.type}:${msg.jobId}`);
  }, deps);

  const reqBase = {
    type: 'run_page_ocr' as const,
    imageBytes: new ArrayBuffer(8),
    mimeType: 'image/png',
    languageHint: 'en' as const,
    resolvedRoute: 'en_ppocrv6_small' as const,
    readingConvention: 'ltr' as const,
    detectorAssets: fakeAssets('comic-detector-v4-s-int8'),
    ocrAssets: fakeAssets('ppocr-v6-small-en'),
    wasmPaths: './ort/',
  };

  // Dispatch 3 jobs simultaneously without awaiting between posts
  const p1 = runtime.handleMessage({ ...reqBase, jobId: 'j1', pageId: 'p1' });
  const p2 = runtime.handleMessage({ ...reqBase, jobId: 'j2', pageId: 'p2' });
  const p3 = runtime.handleMessage({ ...reqBase, jobId: 'j3', pageId: 'p3' });

  // Cancel j2 specifically while j1 is executing (j1 and j3 must complete!)
  await runtime.handleMessage({ type: 'cancel_job', jobId: 'j2' });

  await Promise.all([p1, p2, p3]);

  assert.equal(maxConcurrentRuns, 1, 'Worker runtime must serialize pipeline execution');
  assert.equal(runtime.getActiveJobId(), null);
  assert.deepEqual(execOrder, ['job_result:j1', 'job_cancelled:j2', 'job_result:j3']);
});
