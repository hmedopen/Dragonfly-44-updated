import type {
  LocalOcrEngineOptions,
  LocalOcrImageInput,
  LocalOcrScanResult,
} from '../../types/localOcr.ts';
import { resolveOcrLanguageRoute } from './languageRouter.ts';
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
}

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

async function inputImageToBuffer(
  image: LocalOcrEngineOptions['image']
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  if (typeof Blob !== 'undefined' && image instanceof Blob) {
    const buffer = await image.arrayBuffer();
    return { buffer, mimeType: image.type || 'image/png' };
  }
  if (image && typeof image === 'object' && 'bytes' in image && image.bytes instanceof Uint8Array) {
    const imgInput = image as LocalOcrImageInput;
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
 * Enforces 1 active page job at a time (sequential queue), strict cancellation,
 * stale result immunity, and zero UI-thread ONNX execution.
 */
export class LocalOcrEngineService {
  private readonly deps: LocalOcrEngineDeps;
  private worker: WorkerLike | null = null;
  private queueTail: Promise<void> = Promise.resolve();
  private activeJobId: string | null = null;

  constructor(deps: LocalOcrEngineDeps = {}) {
    this.deps = deps;
  }

  private getOrCreateWorker(): WorkerLike {
    if (!this.worker) {
      const factory = this.deps.createWorker || defaultCreateWorker;
      this.worker = factory();
    }
    return this.worker;
  }

  public async runPageOcr(options: LocalOcrEngineOptions): Promise<LocalOcrScanResult> {
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    // Serialize page jobs conservatively: 1 active page at a time on CPU-only hardware
    const runTask = async (): Promise<LocalOcrScanResult> => {
      if (options.signal?.aborted) {
        throw createAbortError();
      }

      const route = resolveOcrLanguageRoute(options.languageHint);
      const [detectorModelId, ocrModelId] = getRequiredModelIdsForRoute(route.routeId);

      const provider =
        this.deps.modelProvider !== undefined
          ? this.deps.modelProvider
          : createDefaultModelAssetProvider();

      if (!provider) {
        throw new Error(
          'Local OCR model asset provider is unavailable. Run inside Folio Script desktop or inject a LocalModelAssetProvider.'
        );
      }

      // Load required models explicitly — never silently substitute another language model
      const [detectorAssets, ocrAssets] = await Promise.all([
        provider.readModelAssets(detectorModelId),
        provider.readModelAssets(ocrModelId),
      ]);

      if (options.signal?.aborted) {
        throw createAbortError();
      }

      const { buffer: imageBytes, mimeType } = await inputImageToBuffer(options.image);
      if (options.signal?.aborted) {
        throw createAbortError();
      }

      const worker = this.getOrCreateWorker();
      const jobId = `ocr-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.activeJobId = jobId;

      return await new Promise<LocalOcrScanResult>((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          options.signal?.removeEventListener('abort', onAbort);
          if (this.activeJobId === jobId) {
            this.activeJobId = null;
          }
        };

        const onAbort = () => {
          if (settled) return;
          settled = true;
          try {
            worker.postMessage({ type: 'cancel_job', jobId });
          } catch {
            // Ignore postMessage failure if worker already terminated
          }
          cleanup();
          reject(createAbortError());
        };

        const onMessage = (ev: MessageEvent<WorkerOcrResponse> | { data: WorkerOcrResponse }) => {
          const msg = ev.data;
          if (!msg || !('jobId' in msg) || msg.jobId !== jobId) {
            // Stale or unrelated job message -> ignore strictly
            return;
          }
          if (settled) {
            // Already cancelled/settled -> never publish stale results
            return;
          }
          settled = true;
          cleanup();

          if (msg.type === 'job_cancelled') {
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
          this.dispose().catch(() => {});
          reject(new Error(errEvent?.message || 'Local OCR worker crashed or failed to initialize.'));
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        options.signal?.addEventListener('abort', onAbort, { once: true });

        const request: WorkerOcrRequest = {
          type: 'run_page_ocr',
          jobId,
          pageId: options.pageId,
          imageBytes,
          mimeType,
          languageHint: options.languageHint,
          resolvedRoute: route.routeId,
          readingConvention: options.readingConvention ?? 'auto',
          detectorAssets,
          ocrAssets,
          wasmPaths: this.deps.wasmPaths ?? defaultWasmPaths(),
          diagnostics: options.diagnostics,
        };

        // Transfer only the image ArrayBuffer; keep model Uint8Arrays reusable across pages
        worker.postMessage(request, [imageBytes]);
      });
    };

    const resultPromise = this.queueTail.then(runTask, runTask);
    this.queueTail = resultPromise.then(
      () => undefined,
      () => undefined
    );
    return resultPromise;
  }

  public async dispose(): Promise<void> {
    if (!this.worker) return;
    const worker = this.worker;
    this.worker = null;
    try {
      worker.postMessage({ type: 'dispose' });
    } catch {
      // Ignore if already dead
    }
    worker.terminate();
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
