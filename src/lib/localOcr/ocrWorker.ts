import * as ort from 'onnxruntime-web';
import type {
  LocalOcrDiagnosticOptions,
  LocalOcrModelUsage,
  LocalOcrPartialFailure,
  ModelAssetPayload,
  OcrLanguageHint,
  OcrRouteId,
  RawComicDetection,
  RawOcrLineDetection,
} from '../../types/localOcr.ts';
import type { ReadingConvention } from '../../types/scanning.ts';
import {
  createComicDetectorSession,
  type ComicDetectorSession,
  type RgbaImageBuffer,
} from './comicDetector.ts';
import {
  associateTextCandidatesToBubbles,
  fuseTiledComicDetections,
} from './geometryFusion.ts';
import { groupLinesToTextRegions, type LineJoinLanguage } from './lineGrouping.ts';
import {
  createOcrPipelineAdapter,
  recognizeTextCandidateFromOriginal,
  type OcrPipelineAdapter,
} from './ocrRunner.ts';
import { assembleLocalOcrScanResult } from './resultAssembler.ts';
import { planAdaptivePageTiles } from './tilePlanner.ts';
import type {
  SerializableLocalOcrResult,
  WorkerOcrRequest,
  WorkerOcrResponse,
} from './workerProtocol.ts';

export function detectWasmSimdSupport(): boolean {
  try {
    // Minimal valid WASM SIMD (v128.const) feature-probe module
    const simdProbe = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
      0x03, 0x02, 0x01, 0x00,
      0x0a, 0x16, 0x01, 0x14, 0x00,
      0xfd, 0x0c,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x0b,
    ]);
    return typeof WebAssembly !== 'undefined' && WebAssembly.validate(simdProbe);
  } catch {
    return false;
  }
}

export function resolveWasmThreadCount(): number {
  const g = globalThis as { crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown };
  const canThread =
    g.crossOriginIsolated === true && typeof g.SharedArrayBuffer === 'function';
  if (!canThread) {
    return 1;
  }
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 2;
  return Math.max(1, Math.min(4, cores));
}

function measureRuntimeMemoryBytes(): number | null {
  const perf = globalThis.performance as
    | (Performance & { memory?: { usedJSHeapSize?: number } })
    | undefined;
  const heap = perf?.memory?.usedJSHeapSize;
  return typeof heap === 'number' && Number.isFinite(heap) ? heap : null;
}

async function decodeImageInWorker(
  imageBytes: ArrayBuffer,
  mimeType: string
): Promise<RgbaImageBuffer> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new Error('Image decoding in worker requires createImageBitmap and OffscreenCanvas.');
  }
  const blob = new Blob([imageBytes], { type: mimeType || 'image/png' });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Failed to acquire 2D context on OffscreenCanvas.');
    }
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      width: imageData.width,
      height: imageData.height,
      data: imageData.data,
    };
  } finally {
    bitmap.close();
  }
}

export interface PipelineRuntimeState {
  detectorKey: string | null;
  detectorModelId?: string | null;
  detectorRevision?: string | null;
  detectorSession: ComicDetectorSession | null;
  ocrKey: string | null;
  ocrModelId?: string | null;
  ocrRevision?: string | null;
  ocrAdapter: OcrPipelineAdapter | null;
}

export interface ExecutePipelineDeps {
  decodeImage?: (bytes: ArrayBuffer, mimeType: string) => Promise<RgbaImageBuffer>;
  createDetector?: (assets: ModelAssetPayload) => Promise<ComicDetectorSession>;
  createOcrAdapter?: (
    routeId: OcrRouteId,
    assets: ModelAssetPayload,
    wasmPaths: string,
    numThreads: number,
    simd: boolean
  ) => Promise<OcrPipelineAdapter>;
}

function createWorkerAbortError(message = 'Local OCR job cancelled.'): Error {
  return Object.assign(new Error(message), { name: 'AbortError' });
}

function parseModelKeyParts(key: string): { modelId: string; revisionLabel: string } {
  const atIdx = key.lastIndexOf('@');
  if (atIdx > 0 && atIdx < key.length - 1) {
    return {
      modelId: key.slice(0, atIdx),
      revisionLabel: key.slice(atIdx + 1),
    };
  }
  return { modelId: key, revisionLabel: 'unknown' };
}

function resolveLineJoinLanguage(
  languageHint: OcrLanguageHint,
  routeId: OcrRouteId,
  effectiveLanguage?: 'en' | 'ko' | 'ja' | 'zh'
): LineJoinLanguage {
  if (effectiveLanguage) {
    return effectiveLanguage;
  }
  if (languageHint === 'en' || languageHint === 'ko' || languageHint === 'ja' || languageHint === 'zh') {
    return languageHint;
  }
  if (routeId === 'en_ppocrv6_small') return 'en';
  if (routeId === 'ko_ppocrv5_mobile') return 'ko';
  return 'ja';
}

/**
 * Core local page OCR pipeline. Runs inside the dedicated Web Worker in production,
 * and can also be invoked directly in unit tests with injected sessions.
 */
export async function executeLocalPageOcrPipeline(
  input: {
    jobId: string;
    pageId: string;
    imageBytes: ArrayBuffer;
    mimeType: string;
    languageHint: OcrLanguageHint;
    resolvedRoute: OcrRouteId;
    effectiveLanguage?: 'en' | 'ko' | 'ja' | 'zh';
    readingConvention: ReadingConvention;
    detectorModelKey?: string;
    ocrModelKey?: string;
    detectorAssets?: ModelAssetPayload;
    ocrAssets?: ModelAssetPayload;
    wasmPaths: string;
    diagnostics?: LocalOcrDiagnosticOptions;
  },
  state: PipelineRuntimeState,
  isCancelled: () => boolean,
  deps: ExecutePipelineDeps = {}
): Promise<SerializableLocalOcrResult> {
  if (isCancelled()) {
    throw createWorkerAbortError();
  }

  const totalStart = performance.now();
  const simdEnabled = detectWasmSimdSupport();
  const threadsUsed = resolveWasmThreadCount();

  if (typeof ort !== 'undefined' && ort.env?.wasm) {
    ort.env.wasm.wasmPaths = input.wasmPaths;
    ort.env.wasm.simd = simdEnabled;
    ort.env.wasm.numThreads = threadsUsed;
    ort.env.wasm.proxy = false;
  }

  // 1. Initialize models (reusing active cached sessions when model+revision match)
  const initStart = performance.now();
  const detKey =
    input.detectorModelKey ??
    (input.detectorAssets
      ? `${input.detectorAssets.modelId}@${input.detectorAssets.revisionLabel}`
      : null);
  const ocrKey =
    input.ocrModelKey ??
    (input.ocrAssets ? `${input.ocrAssets.modelId}@${input.ocrAssets.revisionLabel}` : null);

  if (!detKey) {
    throw new Error('Detector model key or assets must be provided.');
  }
  if (!ocrKey) {
    throw new Error('OCR model key or assets must be provided.');
  }

  if (state.detectorKey !== detKey || !state.detectorSession) {
    if (state.detectorSession) {
      await state.detectorSession.dispose();
      state.detectorSession = null;
      state.detectorKey = null;
      state.detectorModelId = null;
      state.detectorRevision = null;
    }
    if (!input.detectorAssets) {
      throw new Error(`Comic detector model assets for "${detKey}" are missing (worker cache miss).`);
    }
    const detOnnx = input.detectorAssets.files['detector-v4-s_int8.onnx'];
    if (!detOnnx) {
      throw new Error('Comic detector model asset "detector-v4-s_int8.onnx" is missing.');
    }
    state.detectorSession = deps.createDetector
      ? await deps.createDetector(input.detectorAssets)
      : await createComicDetectorSession(detOnnx);
    state.detectorKey = detKey;
    state.detectorModelId = input.detectorAssets.modelId;
    state.detectorRevision = input.detectorAssets.revisionLabel;
  }

  if (isCancelled()) {
    throw createWorkerAbortError();
  }

  if (state.ocrKey !== ocrKey || !state.ocrAdapter) {
    if (state.ocrAdapter) {
      await state.ocrAdapter.dispose();
      state.ocrAdapter = null;
      state.ocrKey = null;
      state.ocrModelId = null;
      state.ocrRevision = null;
    }
    if (!input.ocrAssets) {
      throw new Error(`OCR model assets for "${ocrKey}" are missing (worker cache miss).`);
    }
    state.ocrAdapter = deps.createOcrAdapter
      ? await deps.createOcrAdapter(
          input.resolvedRoute,
          input.ocrAssets,
          input.wasmPaths,
          threadsUsed,
          simdEnabled
        )
      : await createOcrPipelineAdapter({
          routeId: input.resolvedRoute,
          assets: input.ocrAssets,
          wasmPaths: input.wasmPaths,
          numThreads: threadsUsed,
          simd: simdEnabled,
        });
    state.ocrKey = ocrKey;
    state.ocrModelId = input.ocrAssets.modelId;
    state.ocrRevision = input.ocrAssets.revisionLabel;
  }
  const initMs = Math.round(performance.now() - initStart);

  if (isCancelled()) {
    throw createWorkerAbortError();
  }

  // 2. Decode original page image once
  const decodeStart = performance.now();
  let pageRgba: RgbaImageBuffer | null = deps.decodeImage
    ? await deps.decodeImage(input.imageBytes, input.mimeType)
    : await decodeImageInWorker(input.imageBytes, input.mimeType);
  const decodeMs = Math.round(performance.now() - decodeStart);

  try {
    if (isCancelled()) {
      throw createWorkerAbortError();
    }

    // 3. Plan adaptive 640x640 overlapping tiles
    const tiles = planAdaptivePageTiles(pageRgba.width, pageRgba.height);
    const detectorThreshold = input.diagnostics?.detectorScoreThreshold ?? 0.35;
    const ocrScoreThreshold = input.diagnostics?.ocrLineScoreThreshold ?? 0.65;

    const partialFailures: LocalOcrPartialFailure[] = [];
    const warnings: string[] = [];
    const rawDetections: RawComicDetection[] = [];

    // 4. Run comic geometry detection tile by tile (preserving partial tile results)
    const detStart = performance.now();
    let succeededTiles = 0;

    for (const tile of tiles) {
      if (isCancelled()) {
        throw createWorkerAbortError();
      }
      try {
        const tileDets = await state.detectorSession.runTile(pageRgba, tile, detectorThreshold);
        rawDetections.push(...tileDets);
        succeededTiles++;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError' || isCancelled()) {
          throw createWorkerAbortError();
        }
        const reason = err instanceof Error ? err.message : String(err);
        partialFailures.push({
          stage: 'tile_detection',
          targetId: tile.tileId,
          reason,
          recoverable: true,
        });
      }
    }
    const detectorMs = Math.round(performance.now() - detStart);

    if (isCancelled()) {
      throw createWorkerAbortError();
    }

    const detMeta =
      state.detectorModelId && state.detectorRevision
        ? { modelId: state.detectorModelId, revisionLabel: state.detectorRevision }
        : parseModelKeyParts(detKey);
    const ocrMeta =
      state.ocrModelId && state.ocrRevision
        ? { modelId: state.ocrModelId, revisionLabel: state.ocrRevision }
        : parseModelKeyParts(ocrKey);

    const modelsUsed: LocalOcrModelUsage = {
      detectorModelId: input.detectorAssets?.modelId ?? detMeta.modelId,
      detectorRevision: input.detectorAssets?.revisionLabel ?? detMeta.revisionLabel,
      ocrModelId: input.ocrAssets?.modelId ?? ocrMeta.modelId,
      ocrRevision: input.ocrAssets?.revisionLabel ?? ocrMeta.revisionLabel,
      routeId: input.resolvedRoute,
      ocrRuntimeUsed: state.ocrAdapter.runtimeUsed,
      executionProvider: 'wasm',
      simdEnabled,
      threadsUsed,
    };

    if (succeededTiles === 0) {
      const totalMs = Math.round(performance.now() - totalStart);
      const failedResult = assembleLocalOcrScanResult({
        scanId: `local-${input.jobId}`,
        pageId: input.pageId,
        sourceWidth: pageRgba.width,
        sourceHeight: pageRgba.height,
        readingConvention: input.readingConvention,
        languageHint: input.languageHint,
        resolvedRoute: input.resolvedRoute,
        fusedBubbles: [],
        textRegions: [],
        lineSegments: [],
        tiles: input.diagnostics?.includeTileDetails !== false ? tiles : [],
        modelsUsed,
        timings: {
          initMs,
          decodeMs,
          detectorMs,
          ocrMs: 0,
          postprocessMs: 0,
          totalMs,
          tileCount: tiles.length,
          cropCount: 0,
          measuredMemoryBytes: measureRuntimeMemoryBytes(),
        },
        partialFailures,
        warnings: ['All detector tiles failed for this page.'],
        status: 'failed',
        error: `All ${tiles.length} detector tiles failed.`,
      });
      const { toCanonicalPageScanResult: _omit, ...serializable } = failedResult;
      void _omit;
      return serializable;
    }

    // 5. Cross-tile duplicate suppression & text-to-bubble association
    const postStart = performance.now();
    const fused = fuseTiledComicDetections(
      rawDetections,
      tiles,
      pageRgba.width,
      pageRgba.height
    );
    const { bubbles: fusedBubbles, textCandidates } = associateTextCandidatesToBubbles(fused);

    // 6. Crop each text candidate from original decoded image and run language OCR
    const ocrStart = performance.now();
    const linesByCandidate = new Map<string, RawOcrLineDetection[]>();
    let succeededCrops = 0;

    for (const candidate of textCandidates) {
      if (isCancelled()) {
        throw createWorkerAbortError();
      }
      try {
        const lines = await recognizeTextCandidateFromOriginal({
          adapter: state.ocrAdapter,
          pageRgba,
          candidate,
          paddingPixels: 14,
        });
        linesByCandidate.set(candidate.candidateId, lines);
        succeededCrops++;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError' || isCancelled()) {
          throw createWorkerAbortError();
        }
        const reason = err instanceof Error ? err.message : String(err);
        partialFailures.push({
          stage: 'ocr_crop',
          targetId: candidate.candidateId,
          reason,
          recoverable: true,
        });
        linesByCandidate.set(candidate.candidateId, []);
      }
    }
    const ocrMs = Math.round(performance.now() - ocrStart);

    if (isCancelled()) {
      throw createWorkerAbortError();
    }

    // 7. Script-aware line grouping into logical TextRegions
    const lineJoinLanguage = resolveLineJoinLanguage(
      input.languageHint,
      input.resolvedRoute,
      input.effectiveLanguage
    );
    const grouped = groupLinesToTextRegions(textCandidates, linesByCandidate, {
      language: lineJoinLanguage,
      sourceWidth: pageRgba.width,
      sourceHeight: pageRgba.height,
      lowConfidenceThreshold: ocrScoreThreshold,
    });

    const postprocessMs = Math.round(performance.now() - postStart - ocrMs);
    const totalMs = Math.round(performance.now() - totalStart);

    const hasCropFailures = textCandidates.length > 0 && succeededCrops < textCandidates.length;
    const hasTileFailures = succeededTiles < tiles.length;
    const status: 'complete' | 'partial' | 'failed' =
      textCandidates.length > 0 && succeededCrops === 0 && partialFailures.length > 0
        ? 'partial'
        : hasTileFailures || hasCropFailures
        ? 'partial'
        : 'complete';

    if (partialFailures.length > 0) {
      warnings.push(
        `Completed with ${partialFailures.length} partial failure(s) (${succeededTiles}/${tiles.length} tiles, ${succeededCrops}/${textCandidates.length} crops).`
      );
    }

    const assembled = assembleLocalOcrScanResult({
      scanId: `local-${input.jobId}`,
      pageId: input.pageId,
      sourceWidth: pageRgba.width,
      sourceHeight: pageRgba.height,
      readingConvention: input.readingConvention,
      languageHint: input.languageHint,
      resolvedRoute: input.resolvedRoute,
      fusedBubbles,
      textRegions: grouped.textRegions,
      lineSegments: grouped.allLineSegments,
      tiles: input.diagnostics?.includeTileDetails !== false ? tiles : [],
      rawDetections: input.diagnostics?.includeRawDetections ? rawDetections : undefined,
      modelsUsed,
      timings: {
        initMs,
        decodeMs,
        detectorMs,
        ocrMs,
        postprocessMs: Math.max(0, postprocessMs),
        totalMs,
        tileCount: tiles.length,
        cropCount: textCandidates.length,
        measuredMemoryBytes: measureRuntimeMemoryBytes(),
      },
      partialFailures,
      warnings,
      status,
    });

    const { toCanonicalPageScanResult: _omit, ...serializable } = assembled;
    void _omit;
    return serializable;
  } finally {
    // Release reference to large decoded RGBA image buffer on completion, error, or cancellation
    pageRgba = null;
  }
}

// ==========================================
// DEDICATED WEB WORKER MESSAGE LOOP
// ==========================================

const MAX_RECENT_CANCEL_IDS = 256;

export interface WorkerRuntimeController {
  handleMessage: (req: WorkerOcrRequest) => Promise<void>;
  getActiveJobId: () => string | null;
  getState: () => PipelineRuntimeState;
}

async function disposeWorkerState(state: PipelineRuntimeState): Promise<void> {
  const errors: unknown[] = [];
  if (state.detectorSession) {
    try {
      await state.detectorSession.dispose();
    } catch (err) {
      errors.push(err);
    } finally {
      state.detectorSession = null;
      state.detectorKey = null;
      state.detectorModelId = null;
      state.detectorRevision = null;
    }
  }
  if (state.ocrAdapter) {
    try {
      await state.ocrAdapter.dispose();
    } catch (err) {
      errors.push(err);
    } finally {
      state.ocrAdapter = null;
      state.ocrKey = null;
      state.ocrModelId = null;
      state.ocrRevision = null;
    }
  }
  if (errors.length > 0) {
    throw errors[0];
  }
}

/**
 * Serialized worker message runtime.
 * Guarantees at most one active page job executes against shared inference sessions at a time,
 * safely defers concurrent page requests until the active job finishes or cancels,
 * and ensures cancellation messages identify and clean up their target job.
 */
export function createWorkerRuntime(
  post: (msg: WorkerOcrResponse) => void,
  deps: ExecutePipelineDeps = {},
  options: { rejectConcurrentJobs?: boolean } = {}
): WorkerRuntimeController {
  const state: PipelineRuntimeState = {
    detectorKey: null,
    detectorModelId: null,
    detectorRevision: null,
    detectorSession: null,
    ocrKey: null,
    ocrModelId: null,
    ocrRevision: null,
    ocrAdapter: null,
  };

  let activeJobId: string | null = null;
  let workerQueueTail: Promise<void> = Promise.resolve();
  let disposing = false;
  const queuedJobIds = new Set<string>();
  const cancelledJobIds = new Set<string>();

  const snapshotLoadedKeys = () => ({
    detectorKey: state.detectorSession ? state.detectorKey : null,
    ocrKey: state.ocrAdapter ? state.ocrKey : null,
  });

  const recordCancelledJobId = (jobId: string) => {
    if (!jobId) return;
    if (cancelledJobIds.size >= MAX_RECENT_CANCEL_IDS) {
      const oldest = cancelledJobIds.values().next().value;
      if (oldest !== undefined) {
        cancelledJobIds.delete(oldest);
      }
    }
    cancelledJobIds.add(jobId);
  };

  const runSerializedJob = async (req: Extract<WorkerOcrRequest, { type: 'run_page_ocr' }>) => {
    const { jobId } = req;
    queuedJobIds.delete(jobId);

    if (disposing || cancelledJobIds.has(jobId)) {
      cancelledJobIds.delete(jobId);
      post({
        type: 'job_cancelled',
        jobId,
        loadedModelKeys: snapshotLoadedKeys(),
      });
      return;
    }

    if (activeJobId !== null) {
      post({
        type: 'job_error',
        jobId,
        error: `Worker busy: job "${activeJobId}" is currently executing.`,
        loadedModelKeys: snapshotLoadedKeys(),
      });
      return;
    }

    activeJobId = jobId;
    try {
      const result = await executeLocalPageOcrPipeline(
        req,
        state,
        () => cancelledJobIds.has(jobId) || disposing,
        deps
      );

      if (cancelledJobIds.has(jobId) || disposing) {
        post({
          type: 'job_cancelled',
          jobId,
          loadedModelKeys: snapshotLoadedKeys(),
        });
        return;
      }

      post({
        type: 'job_result',
        jobId,
        result,
        loadedModelKeys: snapshotLoadedKeys(),
      });
    } catch (err: any) {
      if (err?.name === 'AbortError' || cancelledJobIds.has(jobId) || disposing) {
        post({
          type: 'job_cancelled',
          jobId,
          loadedModelKeys: snapshotLoadedKeys(),
        });
        return;
      }
      post({
        type: 'job_error',
        jobId,
        error: err instanceof Error ? err.message : String(err),
        loadedModelKeys: snapshotLoadedKeys(),
      });
    } finally {
      cancelledJobIds.delete(jobId);
      if (activeJobId === jobId) {
        activeJobId = null;
      }
    }
  };

  const handleMessage = async (req: WorkerOcrRequest): Promise<void> => {
    if (!req || typeof req !== 'object') return;

    if (req.type === 'cancel_job') {
      if (typeof req.jobId === 'string' && req.jobId.length > 0) {
        recordCancelledJobId(req.jobId);
      }
      return;
    }

    if (req.type === 'dispose') {
      disposing = true;
      if (activeJobId) {
        recordCancelledJobId(activeJobId);
      }
      for (const qId of queuedJobIds) {
        recordCancelledJobId(qId);
      }
      await workerQueueTail;
      try {
        await disposeWorkerState(state);
      } finally {
        cancelledJobIds.clear();
        queuedJobIds.clear();
        disposing = false;
      }
      post({ type: 'disposed' });
      return;
    }

    if (req.type === 'run_page_ocr') {
      const { jobId } = req;
      if (typeof jobId !== 'string' || jobId.length === 0) {
        post({
          type: 'job_error',
          jobId: String(jobId ?? ''),
          error: 'Invalid run_page_ocr request: missing jobId.',
          loadedModelKeys: snapshotLoadedKeys(),
        });
        return;
      }

      if (activeJobId === jobId || queuedJobIds.has(jobId)) {
        post({
          type: 'job_error',
          jobId,
          error: `Duplicate active/queued jobId "${jobId}" rejected.`,
          loadedModelKeys: snapshotLoadedKeys(),
        });
        return;
      }

      if (disposing) {
        post({
          type: 'job_cancelled',
          jobId,
          loadedModelKeys: snapshotLoadedKeys(),
        });
        return;
      }

      if (options.rejectConcurrentJobs && (activeJobId !== null || queuedJobIds.size > 0)) {
        post({
          type: 'job_error',
          jobId,
          error: `Worker busy: job "${activeJobId ?? 'queued'}" is already executing.`,
          loadedModelKeys: snapshotLoadedKeys(),
        });
        return;
      }

      queuedJobIds.add(jobId);
      const task = workerQueueTail.then(
        () => runSerializedJob(req),
        () => runSerializedJob(req)
      );
      workerQueueTail = task.then(
        () => undefined,
        () => undefined
      );
      await task;
    }
  };

  return {
    handleMessage,
    getActiveJobId: () => activeJobId,
    getState: () => state,
  };
}

const isDedicatedWorkerScope =
  typeof self !== 'undefined' &&
  typeof (self as { document?: unknown }).document === 'undefined' &&
  typeof (self as { postMessage?: unknown }).postMessage === 'function';

if (isDedicatedWorkerScope) {
  const post = (msg: WorkerOcrResponse) => {
    (self as unknown as { postMessage: (m: WorkerOcrResponse) => void }).postMessage(msg);
  };
  const runtime = createWorkerRuntime(post);

  self.addEventListener('message', (event: MessageEvent<WorkerOcrRequest>) => {
    void runtime.handleMessage(event.data);
  });
}
