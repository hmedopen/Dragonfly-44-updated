import * as ort from 'onnxruntime-web';
import type {
  ModelAssetPayload,
  OcrRouteId,
  RawOcrLineDetection,
} from '../../../types/localOcr.ts';
import type { RgbaImageBuffer } from '../../../lib/localOcr/comicDetector.ts';
import {
  cropPolygonToOriginalPixels,
  originalPixelsToNormalized1000,
  pixelPolygonToPixelBox,
} from '../../../lib/localOcr/coordinateMapping.ts';
import { joinLinesByScript, orderOcrLines } from '../../../lib/localOcr/lineGrouping.ts';
import {
  createOcrPipelineAdapter,
  extractRgbaCrop,
  type OcrPipelineAdapter,
} from '../../../lib/localOcr/ocrRunner.ts';
import { detectWasmSimdSupport, resolveWasmThreadCount } from '../../../lib/localOcr/ocrWorker.ts';
import {
  maskCropOutsideEllipse,
  maskCropOutsidePolygon,
  normalizedBoxToCropRect,
} from './lassoMask.ts';
import type {
  ManualOcrCropTarget,
  ManualOcrRegionOutcome,
  WorkerManualOcrRequest,
  WorkerManualOcrResponse,
} from './manualOcrProtocol.ts';
import type { OcrSupportedLanguage } from '../types/selection.ts';

export interface ManualWorkerRuntimeState {
  ocrKey: string | null;
  ocrAdapter: OcrPipelineAdapter | null;
}

export interface ExecuteManualCropDeps {
  decodeImage?: (bytes: ArrayBuffer, mimeType: string) => Promise<RgbaImageBuffer>;
  createOcrAdapter?: (
    routeId: OcrRouteId,
    assets: ModelAssetPayload,
    wasmPaths: string,
    numThreads: number,
    simd: boolean
  ) => Promise<OcrPipelineAdapter>;
  onRegionProgress?: (regionId: string, completed: number, total: number) => void;
}

async function decodeImageInManualWorker(
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

function createAbortError(message = 'Manual OCR job cancelled.'): Error {
  return Object.assign(new Error(message), { name: 'AbortError' });
}

/**
 * Prepares an RGBA crop for a Box, Bubble, or Lasso selection.
 * For Bubble and Lasso selections, masks exterior pixels outside the contour.
 */
export function prepareManualCropRgba(
  pageRgba: RgbaImageBuffer,
  target: ManualOcrCropTarget
): {
  cropRgba: RgbaImageBuffer;
  cropX: number;
  cropY: number;
} {
  const hasPolygon = Boolean(target.polygon && target.polygon.length >= 3);
  const isPolygonal = (target.kind === 'lasso' || target.kind === 'bubble') && hasPolygon;
  const isParametricEllipse = target.kind === 'bubble' && !hasPolygon;
  const paddingPx = isPolygonal || isParametricEllipse ? 2 : 8;
  const cropRect = normalizedBoxToCropRect(
    target.box_2d,
    pageRgba.width,
    pageRgba.height,
    paddingPx
  );
  let cropRgba = extractRgbaCrop(
    pageRgba,
    cropRect.x,
    cropRect.y,
    cropRect.width,
    cropRect.height
  );

  if (isPolygonal && target.polygon) {
    const localPoly: Array<[number, number]> = target.polygon.map(([nx, ny]) => [
      (nx / 1000) * pageRgba.width - cropRect.x,
      (ny / 1000) * pageRgba.height - cropRect.y,
    ]);
    cropRgba = maskCropOutsidePolygon(cropRgba, localPoly);
  } else if (isParametricEllipse) {
    const [ymin, xmin, ymax, xmax] = target.box_2d;
    cropRgba = maskCropOutsideEllipse(cropRgba, {
      left: (xmin / 1000) * pageRgba.width - cropRect.x,
      top: (ymin / 1000) * pageRgba.height - cropRect.y,
      right: (xmax / 1000) * pageRgba.width - cropRect.x,
      bottom: (ymax / 1000) * pageRgba.height - cropRect.y,
    });
  }

  return {
    cropRgba,
    cropX: cropRect.x,
    cropY: cropRect.y,
  };
}

/**
 * Executes local offline OCR strictly over user-defined manual crop targets
 * without running full-page bubble detection or contacting any remote service.
 */
export async function executeManualCropOcrBatch(
  input: {
    jobId: string;
    pageId: string;
    imageBytes: ArrayBuffer;
    mimeType: string;
    language: OcrSupportedLanguage;
    routeId: OcrRouteId;
    ocrModelKey: string;
    ocrAssets?: ModelAssetPayload;
    wasmPaths: string;
    targets: ManualOcrCropTarget[];
  },
  state: ManualWorkerRuntimeState,
  isCancelled: () => boolean,
  deps: ExecuteManualCropDeps = {}
): Promise<{
  sourceDimensions: { width: number; height: number };
  outcomes: ManualOcrRegionOutcome[];
}> {
  if (isCancelled()) {
    throw createAbortError();
  }

  const simdEnabled = detectWasmSimdSupport();
  const threadsUsed = resolveWasmThreadCount();

  if (typeof ort !== 'undefined' && ort.env?.wasm) {
    ort.env.wasm.wasmPaths = input.wasmPaths;
    ort.env.wasm.simd = simdEnabled;
    ort.env.wasm.numThreads = threadsUsed;
    ort.env.wasm.proxy = false;
  }

  if (state.ocrKey !== input.ocrModelKey || !state.ocrAdapter) {
    if (state.ocrAdapter) {
      await state.ocrAdapter.dispose();
      state.ocrAdapter = null;
      state.ocrKey = null;
    }
    if (!input.ocrAssets) {
      throw new Error(`Local OCR assets for "${input.ocrModelKey}" are missing.`);
    }
    state.ocrAdapter = deps.createOcrAdapter
      ? await deps.createOcrAdapter(
          input.routeId,
          input.ocrAssets,
          input.wasmPaths,
          threadsUsed,
          simdEnabled
        )
      : await createOcrPipelineAdapter({
          routeId: input.routeId,
          assets: input.ocrAssets,
          wasmPaths: input.wasmPaths,
          numThreads: threadsUsed,
          simd: simdEnabled,
        });
    state.ocrKey = input.ocrModelKey;
  }

  if (isCancelled()) {
    throw createAbortError();
  }

  let pageRgba: RgbaImageBuffer | null = deps.decodeImage
    ? await deps.decodeImage(input.imageBytes, input.mimeType)
    : await decodeImageInManualWorker(input.imageBytes, input.mimeType);

  const sourceDimensions = { width: pageRgba.width, height: pageRgba.height };
  const outcomes: ManualOcrRegionOutcome[] = [];

  try {
    for (let i = 0; i < input.targets.length; i++) {
      if (isCancelled()) {
        throw createAbortError();
      }
      const target = input.targets[i];
      try {
        const { cropRgba, cropX, cropY } = prepareManualCropRgba(pageRgba, target);
        const rawLines = await state.ocrAdapter.predictCrop(cropRgba);

        const mappedLines: RawOcrLineDetection[] = rawLines
          .filter((l) => typeof l.text === 'string' && l.text.trim().length > 0)
          .map((line, lineIdx) => {
            const pixelPolygon = cropPolygonToOriginalPixels(
              line.poly,
              cropX,
              cropY,
              pageRgba!.width,
              pageRgba!.height
            );
            const pixelBox = pixelPolygonToPixelBox(
              pixelPolygon,
              pageRgba!.width,
              pageRgba!.height
            );
            const normalizedBox = originalPixelsToNormalized1000(
              pixelBox,
              pageRgba!.width,
              pageRgba!.height,
              1
            );
            const lineW = Math.max(1, pixelBox[3] - pixelBox[1]);
            const lineH = Math.max(1, pixelBox[2] - pixelBox[0]);
            return {
              lineId: `${target.regionId}_line_${lineIdx + 1}`,
              candidateId: target.regionId,
              text: line.text,
              rawRecognitionScore: line.score,
              pixelPolygon,
              pixelBox,
              normalizedBox,
              isVertical: lineH / lineW >= 1.5,
            };
          });

        if (mappedLines.length === 0) {
          outcomes.push({
            regionId: target.regionId,
            status: 'ocr_failed',
            text: '',
            confidence: 0,
            lineCount: 0,
            error: 'No readable text lines detected inside the selected region.',
          });
        } else {
          const verticalVotes = mappedLines.filter((l) => l.isVertical).length;
          const isVertical =
            verticalVotes > mappedLines.length / 2 ||
            ((cropRgba.height > cropRgba.width * 1.4) &&
              (input.language === 'ja' || input.language === 'zh'));
          const ordered = orderOcrLines(mappedLines, isVertical);
          const joined = joinLinesByScript(
            ordered.map((l) => l.text),
            input.language
          );
          const avgScore =
            ordered.reduce((sum, l) => sum + l.rawRecognitionScore, 0) / ordered.length;

          const trimmed = joined.trim();
          outcomes.push({
            regionId: target.regionId,
            status: trimmed.length === 0 ? 'ocr_failed' : avgScore < 0.55 ? 'ocr_partial' : 'ocr_success',
            text: trimmed,
            confidence: avgScore,
            lineCount: ordered.length,
            ...(trimmed.length === 0
              ? { error: 'OCR output contained only whitespace.' }
              : avgScore < 0.55
              ? { error: 'Low OCR confidence; verify or adjust the selection.' }
              : {}),
          });
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError' || isCancelled()) {
          throw createAbortError();
        }
        outcomes.push({
          regionId: target.regionId,
          status: 'ocr_failed',
          text: '',
          confidence: 0,
          lineCount: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      deps.onRegionProgress?.(target.regionId, i + 1, input.targets.length);
    }

    return {
      sourceDimensions,
      outcomes,
    };
  } finally {
    // Release decoded page bitmap buffer promptly
    pageRgba = null;
  }
}

export function createManualWorkerRuntime(
  post: (msg: WorkerManualOcrResponse) => void,
  deps: ExecuteManualCropDeps = {}
) {
  const state: ManualWorkerRuntimeState = {
    ocrKey: null,
    ocrAdapter: null,
  };

  let activeJobId: string | null = null;
  let disposing = false;
  let queueTail: Promise<void> = Promise.resolve();
  const cancelledJobIds = new Set<string>();

  const runJob = async (req: Extract<WorkerManualOcrRequest, { type: 'run_manual_crops' }>) => {
    const { jobId } = req;
    if (disposing || cancelledJobIds.has(jobId)) {
      cancelledJobIds.delete(jobId);
      post({ type: 'job_cancelled', jobId, loadedOcrKey: state.ocrKey });
      return;
    }

    activeJobId = jobId;
    try {
      const result = await executeManualCropOcrBatch(
        req,
        state,
        () => cancelledJobIds.has(jobId) || disposing,
        {
          ...deps,
          onRegionProgress: (regionId, completed, total) => {
            post({
              type: 'region_progress',
              jobId,
              regionId,
              completed,
              total,
            });
          },
        }
      );

      if (cancelledJobIds.has(jobId) || disposing) {
        post({ type: 'job_cancelled', jobId, loadedOcrKey: state.ocrKey });
        return;
      }

      post({
        type: 'job_result',
        jobId,
        pageId: req.pageId,
        sourceDimensions: result.sourceDimensions,
        outcomes: result.outcomes,
        loadedOcrKey: state.ocrKey,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError' || cancelledJobIds.has(jobId) || disposing) {
        post({ type: 'job_cancelled', jobId, loadedOcrKey: state.ocrKey });
      } else {
        post({
          type: 'job_error',
          jobId,
          error: err instanceof Error ? err.message : String(err),
          loadedOcrKey: state.ocrKey,
        });
      }
    } finally {
      cancelledJobIds.delete(jobId);
      if (activeJobId === jobId) activeJobId = null;
    }
  };

  const handleMessage = async (req: WorkerManualOcrRequest) => {
    if (!req || typeof req !== 'object') return;
    if (req.type === 'cancel_job') {
      if (req.jobId) cancelledJobIds.add(req.jobId);
      return;
    }
    if (req.type === 'dispose') {
      disposing = true;
      if (activeJobId) cancelledJobIds.add(activeJobId);
      await queueTail;
      if (state.ocrAdapter) {
        await state.ocrAdapter.dispose().catch(() => {});
        state.ocrAdapter = null;
        state.ocrKey = null;
      }
      disposing = false;
      post({ type: 'disposed' });
      return;
    }
    if (req.type === 'run_manual_crops') {
      const task = queueTail.then(
        () => runJob(req),
        () => runJob(req)
      );
      queueTail = task.then(
        () => undefined,
        () => undefined
      );
      await task;
    }
  };

  return { handleMessage };
}

const isDedicatedWorkerScope =
  typeof self !== 'undefined' &&
  typeof (self as { document?: unknown }).document === 'undefined' &&
  typeof (self as { postMessage?: unknown }).postMessage === 'function';

if (isDedicatedWorkerScope) {
  const post = (msg: WorkerManualOcrResponse) => {
    (self as unknown as { postMessage: (m: WorkerManualOcrResponse) => void }).postMessage(msg);
  };
  const runtime = createManualWorkerRuntime(post);
  self.addEventListener('message', (ev: MessageEvent<WorkerManualOcrRequest>) => {
    void runtime.handleMessage(ev.data);
  });
}
