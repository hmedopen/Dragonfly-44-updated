import type {
  LocalOcrEngineOptions,
  LocalOcrImageInput,
  LocalOcrScanResult,
} from '../../types/localOcr.ts';
import { LanguageRouteError, resolveOcrLanguageRoute } from './languageRouter.ts';
import {
  createDefaultModelAssetProvider,
  type LocalModelAssetProvider,
} from './modelClient.ts';
import { getRequiredModelIdsForRoute } from './modelManifest.ts';
import { assembleLocalOcrScanResult } from './resultAssembler.ts';
import type {
  SerializableLocalOcrResult,
  WorkerOcrRequest,
  WorkerOcrResponse,
} from './workerProtocol.ts';

export interface WorkerLike {
  postMessage: {
    (message: WorkerOcrRequest): void;
    (message: WorkerOcrRequest, transfer: Transferable[]): void;
  };
  addEventListener: (
    type: 'message' | 'error',
    listener: (ev: any) => void
  ) => void;
  removeEventListener: (
    type: 'message' | 'error',
    listener: (ev: any) => void
  ) => void;
  terminate: () => void;
}

export interface LocalOcrEngineDeps {
  modelProvider?: LocalModelAssetProvider | null;
  createWorker?: () => WorkerLike;
  wasmPaths?: string;
  cancellationTimeoutMs?: number;
  restoreWorkerRuntime?: (worker: WorkerLike) => Promise<void> | void;
}

const DEFAULT_CANCELLATION_TIMEOUT_MS = 5000;

function defaultCreateWorker(): WorkerLike {
  if (typeof Worker !== 'function') {
    throw new Error(
      'Web Worker runtime is unavailable; local OCR inference cannot run on the UI thread.'
    );
  }
  return new Worker(new URL('./ocrWorker.ts', import.meta.url), {
    type: 'module',
  });
}

function defaultWasmPaths(): string {
  if (typeof globalThis.location !== 'undefined' && globalThis.location?.href) {
    return new URL('./ort/', globalThis.location.href).href;
  }
  return './ort/';
}

function createAbortError(message = 'Local OCR job was cancelled.'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

async function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    void promise.catch(() => {});
    throw createAbortError();
  }
  if (!signal) {
    return promise;
  }
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      void promise.catch(() => {});
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

async function inputImageToBuffer(
  image: LocalOcrEngineOptions['image']
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  if (typeof Blob !== 'undefined' && image instanceof Blob) {
    const buffer = await image.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new Error('Empty image Blob passed to local OCR engine.');
    }
    return { buffer, mimeType: image.type || 'image/png' };
  }
  if (image && typeof image === 'object' && 'bytes' in image && image.bytes instanceof Uint8Array) {
    const imgInput = image as LocalOcrImageInput;
    if (imgInput.bytes.byteLength === 0) {
      throw new Error('Empty image bytes passed to local OCR engine.');
    }
    const copy = new Uint8Array(imgInput.bytes.byteLength);
    copy.set(imgInput.bytes);
    return { buffer: copy.buffer, mimeType: imgInput.mimeType || 'image/png' };
  }
  throw new Error('Unsupported image input for local OCR engine (expected Blob or { bytes, mimeType }).');
}

function attachCanonicalProjection(serializable: SerializableLocalOcrResult): LocalOcrScanResult {
  const full = assembleLocalOcrScanResult({
    scanId: serializable.scanId,
    pageId: serializable.pageId,
    sourceWidth: serializable.sourceDimensions.width,
    sourceHeight: serializable.sourceDimensions.height,
    readingConvention: serializable.readingConvention,
    languageHint: serializable.languageHint,
    resolvedRoute: serializable.resolvedRoute,
    fusedBubbles: serializable.bubbleRegions.map((b) => ({
      id: b.bubbleId,
      classLabel: 'bubble',
      pixelBox: [0, 0, 0, 0],
      normalizedBox: b.geometry.box_2d,
      rawScore: b.detectionConfidence,
      sourceTileIds: b.tileOriginIds || [],
      boundaryUncertain: Boolean(b.boundaryUncertain),
      flags: b.flags || [],
    })),
    textRegions: serializable.textRegions,
    lineSegments: serializable.lineSegments,
    tiles: serializable.tiles,
    rawDetections: serializable.rawDetections,
    modelsUsed: serializable.modelsUsed,
    timings: serializable.timings,
    partialFailures: serializable.partialFailures,
    warnings: serializable.warnings,
    status: serializable.status,
    error: serializable.error,
  });

  return {
    ...serializable,
    toCanonicalPageScanResult: full.toCanonicalPageScanResult,
  };
}

/**
 * Worker-backed local OCR service.
 * Enforces 1 active page job at a time (sequential queue), strict cancellation
 * with worker acknowledgement or terminate-and-recreate recovery,
 * stale result immunity, and zero UI-thread ONNX execution.
 */
export class LocalOcrEngineService {
  private readonly deps: LocalOcrEngineDeps;
  private worker: WorkerLike | null = null;
  private queueTail: Promise<void> = Promise.resolve();
  private activeJobId: string | null = null;
  private activeForceCancel: ((err: Error) => void) | null = null;
  private workerDetectorKey: string | null = null;
  private workerOcrKey: string | null = null;

  constructor(deps: LocalOcrEngineDeps = {}) {
    this.deps = deps;
  }

  private getCancellationTimeoutMs(): number {
    const raw = this.deps.cancellationTimeoutMs;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
    return DEFAULT_CANCELLATION_TIMEOUT_MS;
  }

  private getOrCreateWorker(): WorkerLike {
    if (!this.worker) {
      const factory = this.deps.createWorker || defaultCreateWorker;
      this.worker = factory();
      this.workerDetectorKey = null;
      this.workerOcrKey = null;
    }
    return this.worker;
  }

  private clearWorkerSessionState(targetWorker?: WorkerLike): void {
    if (!targetWorker || this.worker === targetWorker) {
      this.worker = null;
      this.workerDetectorKey = null;
      this.workerOcrKey = null;
    }
  }

  private async terminateAndRecreateWorker(unresponsiveWorker: WorkerLike): Promise<void> {
    try {
      unresponsiveWorker.terminate();
    } catch {
      // Ignore termination error
    }
    this.clearWorkerSessionState(unresponsiveWorker);

    const factory = this.deps.createWorker || defaultCreateWorker;
    let replacement: WorkerLike | null = null;
    try {
      replacement = factory();
      this.worker = replacement;
      if (this.deps.restoreWorkerRuntime) {
        await this.deps.restoreWorkerRuntime(replacement);
      }
    } catch {
      if (replacement) {
        try {
          replacement.terminate();
        } catch {
          // Ignore cleanup error
        }
      }
      this.clearWorkerSessionState(replacement ?? undefined);
    }
  }

  public getActiveJobId(): string | null {
    return this.activeJobId;
  }

  public getWorkerCachedModelKeys(): { detectorKey: string | null; ocrKey: string | null } {
    return {
      detectorKey: this.workerDetectorKey,
      ocrKey: this.workerOcrKey,
    };
  }

  private async resolveExpectedModelKey(
    provider: LocalModelAssetProvider,
    modelId: string,
    currentlyLoadedKey: string | null
  ): Promise<string | null> {
    try {
      const manifest = await provider.getManifest();
      const entry = manifest?.models?.find((m) => m.modelId === modelId);
      if (entry && entry.pinnedRevisions) {
        const revs = Object.values(entry.pinnedRevisions);
        if (revs.length > 0) {
          const revKey = revs.map((r) => String(r).slice(0, 12)).join('_');
          return `${modelId}@${revKey}`;
        }
      }
    } catch {
      // Fall through to status check
    }

    try {
      const status = await provider.getStatus(modelId);
      if (
        status &&
        !Array.isArray(status) &&
        status.modelId === modelId &&
        typeof status.installedRevision === 'string' &&
        status.installedRevision
      ) {
        return `${modelId}@${status.installedRevision}`;
      }
    } catch {
      // Fall through to active worker key check
    }

    if (this.worker && currentlyLoadedKey && currentlyLoadedKey.startsWith(`${modelId}@`)) {
      return currentlyLoadedKey;
    }
    return null;
  }

  public async runPageOcr(options: LocalOcrEngineOptions): Promise<LocalOcrScanResult> {
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    let started = false;
    let cancelledBeforeStart = false;
    let callerSettled = false;
    let resolveCaller!: (res: LocalOcrScanResult) => void;
    let rejectCaller!: (err: Error) => void;

    const callerPromise = new Promise<LocalOcrScanResult>((resolve, reject) => {
      resolveCaller = resolve;
      rejectCaller = reject;
    });

    const onPreStartAbort = () => {
      if (started || cancelledBeforeStart || callerSettled) return;
      cancelledBeforeStart = true;
      callerSettled = true;
      rejectCaller(createAbortError());
    };
    options.signal?.addEventListener('abort', onPreStartAbort, { once: true });

    const executeActiveTask = async (): Promise<LocalOcrScanResult> => {
      const route = resolveOcrLanguageRoute(options.languageHint, options.sampleText);
      if (route.routeId === null || route.effectiveLanguage === null) {
        throw new LanguageRouteError(route);
      }
      const resolvedRoute = route.routeId;
      const effectiveLanguage = route.effectiveLanguage;
      const [detectorModelId, ocrModelId] = getRequiredModelIdsForRoute(resolvedRoute);

      const provider =
        this.deps.modelProvider !== undefined
          ? this.deps.modelProvider
          : createDefaultModelAssetProvider();

      if (!provider) {
        throw new Error(
          'Local OCR model asset provider is unavailable. Run inside Folio Script desktop or inject a LocalModelAssetProvider.'
        );
      }

      // Check whether active worker already caches exact model+revision before reading from disk/IPC
      const [expectedDetKey, expectedOcrKey] = await raceWithAbort(
        Promise.all([
          this.resolveExpectedModelKey(provider, detectorModelId, this.workerDetectorKey),
          this.resolveExpectedModelKey(provider, ocrModelId, this.workerOcrKey),
        ]),
        options.signal
      );

      const detCacheHit =
        this.worker !== null &&
        expectedDetKey !== null &&
        this.workerDetectorKey === expectedDetKey;
      const ocrCacheHit =
        this.worker !== null &&
        expectedOcrKey !== null &&
        this.workerOcrKey === expectedOcrKey;

      // Load only uncached models explicitly — never silently substitute another language model
      const [detectorAssets, ocrAssets] = await raceWithAbort(
        Promise.all([
          detCacheHit ? Promise.resolve(undefined) : provider.readModelAssets(detectorModelId),
          ocrCacheHit ? Promise.resolve(undefined) : provider.readModelAssets(ocrModelId),
        ]),
        options.signal
      );

      if (options.signal?.aborted) {
        throw createAbortError();
      }

      const { buffer: imageBytes, mimeType } = await raceWithAbort(
        inputImageToBuffer(options.image),
        options.signal
      );
      if (options.signal?.aborted) {
        throw createAbortError();
      }

      const worker = this.getOrCreateWorker();
      const jobId = `ocr-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.activeJobId = jobId;

      return await new Promise<LocalOcrScanResult>((resolve, reject) => {
        let settled = false;
        let abortRequested = false;
        let cancelTimer: ReturnType<typeof setTimeout> | null = null;

        const clearCancelTimer = () => {
          if (cancelTimer !== null) {
            clearTimeout(cancelTimer);
            cancelTimer = null;
          }
        };

        const cleanup = () => {
          clearCancelTimer();
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          options.signal?.removeEventListener('abort', onActiveAbort);
          if (this.activeJobId === jobId) {
            this.activeJobId = null;
          }
          if (this.activeForceCancel === forceCancelOnDispose) {
            this.activeForceCancel = null;
          }
        };

        const detKey = detectorAssets
          ? `${detectorAssets.modelId}@${detectorAssets.revisionLabel}`
          : (expectedDetKey ?? `${detectorModelId}@cached`);
        const ocrKey = ocrAssets
          ? `${ocrAssets.modelId}@${ocrAssets.revisionLabel}`
          : (expectedOcrKey ?? `${ocrModelId}@cached`);

        const syncWorkerKeys = (msg: WorkerOcrResponse) => {
          if ('loadedModelKeys' in msg && msg.loadedModelKeys) {
            this.workerDetectorKey = msg.loadedModelKeys.detectorKey;
            this.workerOcrKey = msg.loadedModelKeys.ocrKey;
          } else if (msg.type === 'job_result') {
            this.workerDetectorKey = detKey;
            this.workerOcrKey = ocrKey;
          } else {
            this.workerDetectorKey = null;
            this.workerOcrKey = null;
          }
        };

        const forceCancelOnDispose = (err: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        };
        this.activeForceCancel = forceCancelOnDispose;

        const handleCancelTimeout = async () => {
          if (settled) return;
          settled = true;
          cleanup();
          await this.terminateAndRecreateWorker(worker);
          reject(
            createAbortError(
              'Local OCR job was cancelled; unresponsive worker was terminated and recreated.'
            )
          );
        };

        const onActiveAbort = () => {
          if (settled || abortRequested) return;
          abortRequested = true;
          try {
            worker.postMessage({ type: 'cancel_job', jobId });
          } catch {
            // Worker cannot accept messages -> terminate & recreate before releasing queue
            void handleCancelTimeout();
            return;
          }
          cancelTimer = setTimeout(() => {
            void handleCancelTimeout();
          }, this.getCancellationTimeoutMs());
        };

        const onMessage = (ev: MessageEvent<WorkerOcrResponse> | { data: WorkerOcrResponse }) => {
          const msg = ev.data;
          if (!msg || !('jobId' in msg) || msg.jobId !== jobId) {
            // Stale or unrelated job message -> ignore strictly
            return;
          }
          if (settled) {
            // Already settled -> never publish stale results
            return;
          }
          settled = true;
          cleanup();
          syncWorkerKeys(msg);

          if (abortRequested || msg.type === 'job_cancelled') {
            reject(createAbortError());
            return;
          }
          if (msg.type === 'job_error') {
            reject(new Error(msg.error || 'Local OCR worker inference failed.'));
            return;
          }
          if (msg.type === 'job_result') {
            resolve(attachCanonicalProjection(msg.result));
          }
        };

        const onError = (errEvent: ErrorEvent | { message?: string }) => {
          if (settled) return;
          settled = true;
          cleanup();
          try {
            worker.terminate();
          } catch {
            // Ignore termination error
          }
          this.clearWorkerSessionState(worker);
          if (abortRequested) {
            reject(createAbortError());
            return;
          }
          reject(new Error(errEvent?.message || 'Local OCR worker crashed or failed to initialize.'));
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        options.signal?.addEventListener('abort', onActiveAbort, { once: true });

        if (options.signal?.aborted) {
          onActiveAbort();
          return;
        }

        const request: WorkerOcrRequest = {
          type: 'run_page_ocr',
          jobId,
          pageId: options.pageId,
          imageBytes,
          mimeType,
          languageHint: options.languageHint,
          resolvedRoute: resolvedRoute,
          effectiveLanguage: effectiveLanguage,
          readingConvention: options.readingConvention ?? 'auto',
          detectorModelKey: detKey,
          ocrModelKey: ocrKey,
          ...(detectorAssets ? { detectorAssets } : {}),
          ...(ocrAssets ? { ocrAssets } : {}),
          wasmPaths: this.deps.wasmPaths ?? defaultWasmPaths(),
          diagnostics: options.diagnostics,
        };

        try {
          // Transfer only the per-page image ArrayBuffer
          worker.postMessage(request, [imageBytes]);
        } catch (err) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }
      });
    };

    const queueStep = async (): Promise<void> => {
      options.signal?.removeEventListener('abort', onPreStartAbort);
      if (cancelledBeforeStart || options.signal?.aborted) {
        if (!callerSettled) {
          callerSettled = true;
          rejectCaller(createAbortError());
        }
        return;
      }

      started = true;
      try {
        const res = await executeActiveTask();
        if (!callerSettled) {
          callerSettled = true;
          resolveCaller(res);
        }
      } catch (err) {
        if (!callerSettled) {
          callerSettled = true;
          rejectCaller(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    const queueEntry = this.queueTail.then(queueStep, queueStep);
    this.queueTail = queueEntry.then(
      () => undefined,
      () => undefined
    );

    return callerPromise;
  }

  public async dispose(): Promise<void> {
    const worker = this.worker;
    const forceCancel = this.activeForceCancel;
    this.clearWorkerSessionState();
    this.activeForceCancel = null;
    this.activeJobId = null;

    if (forceCancel) {
      forceCancel(createAbortError('Local OCR engine was disposed.'));
    }

    if (!worker) return;
    try {
      worker.postMessage({ type: 'dispose' });
    } catch {
      // Ignore if already dead
    }
    try {
      worker.terminate();
    } catch {
      // Ignore if already dead
    }
  }
}

const defaultEngine = new LocalOcrEngineService();

/**
 * Primary typed local-engine entry point for Phase 1 & Phase 2 callers.
 * Runs off the React UI thread in a dedicated Web Worker.
 * Never translates text, mutates IndexedDB, or alters production workspace bubbles.
 */
export function runLocalPageOcr(
  options: LocalOcrEngineOptions
): Promise<LocalOcrScanResult> {
  return defaultEngine.runPageOcr(options);
}
