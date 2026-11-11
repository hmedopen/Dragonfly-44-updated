import { getPageBlob, getPageBubbles } from '../../../services/db.ts';
import { resolveOcrLanguageRoute } from '../../../lib/localOcr/languageRouter.ts';
import {
  createDefaultModelAssetProvider,
  type LocalModelAssetProvider,
} from '../../../lib/localOcr/modelClient.ts';
import { ROUTE_TO_MODEL_ID } from '../../../lib/localOcr/modelManifest.ts';
import type { ModelAssetPayload, ModelStatusInfo } from '../../../types/localOcr.ts';
import type { BubbleItem } from '../../../types/workbench.ts';
import { computeGeometrySignature } from '../selection/geometry.ts';
import type { OcrSupportedLanguage } from '../types/selection.ts';
import type {
  ManualOcrCropTarget,
  ManualOcrRegionOutcome,
  WorkerManualOcrRequest,
  WorkerManualOcrResponse,
} from './manualOcrProtocol.ts';

export interface ManualWorkerLike {
  postMessage: {
    (message: WorkerManualOcrRequest): void;
    (message: WorkerManualOcrRequest, transfer: Transferable[]): void;
  };
  addEventListener: (type: 'message' | 'error', listener: (ev: any) => void) => void;
  removeEventListener: (type: 'message' | 'error', listener: (ev: any) => void) => void;
  terminate: () => void;
}

export interface ManualOcrServiceDeps {
  modelProvider?: LocalModelAssetProvider | null;
  createWorker?: () => ManualWorkerLike;
  getPageBlob?: (pageId: string) => Promise<Blob | null>;
  getPageBubbles?: (pageId: string) => Promise<BubbleItem[]>;
  wasmPaths?: string;
  cancellationTimeoutMs?: number;
}

function defaultCreateManualWorker(): ManualWorkerLike {
  if (typeof Worker !== 'function') {
    throw new Error('Web Worker runtime is unavailable; offline OCR cannot run on the UI thread.');
  }
  return new Worker(new URL('./manualOcrWorker.ts', import.meta.url), {
    type: 'module',
  });
}

function defaultWasmPaths(): string {
  if (typeof globalThis.location !== 'undefined' && globalThis.location?.href) {
    return new URL('./ort/', globalThis.location.href).href;
  }
  return './ort/';
}

function createAbortError(message = 'Manual OCR job cancelled.'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

export interface ModelReadinessResult {
  ready: boolean;
  ocrModelId: string;
  routeId: ReturnType<typeof resolveOcrLanguageRoute>['routeId'];
  status?: ModelStatusInfo;
  error?: string;
  canDownload?: boolean;
}

/**
 * Checks whether the required local OCR model for the selected language is installed and permitted.
 * Never silently substitutes another language model or Gemini.
 */
export async function checkManualOcrModelReadiness(
  language: OcrSupportedLanguage,
  providerInput?: LocalModelAssetProvider | null
): Promise<ModelReadinessResult> {
  const route = resolveOcrLanguageRoute(language);
  if (!route.routeId) {
    return {
      ready: false,
      ocrModelId: '',
      routeId: null,
      error: route.routingReason,
    };
  }

  const ocrModelId = ROUTE_TO_MODEL_ID[route.routeId];
  const provider = providerInput !== undefined ? providerInput : createDefaultModelAssetProvider();
  if (!provider) {
    return {
      ready: false,
      ocrModelId,
      routeId: route.routeId,
      error: `Local OCR model bridge is unavailable outside Folio Script desktop; cannot load "${ocrModelId}" offline.`,
      canDownload: false,
    };
  }

  const rawStatus = await provider.getStatus(ocrModelId);
  const status = Array.isArray(rawStatus)
    ? rawStatus.find((s) => s.modelId === ocrModelId)
    : rawStatus;

  if (!status) {
    return {
      ready: false,
      ocrModelId,
      routeId: route.routeId,
      error: `Unable to determine installation status for local OCR model "${ocrModelId}".`,
    };
  }

  if (status.state === 'unsupported' || status.policy?.activationPermitted === false) {
    return {
      ready: false,
      ocrModelId,
      routeId: route.routeId,
      status,
      canDownload: false,
      error:
        status.policy?.rejectionReason ||
        status.error ||
        `Local OCR model "${ocrModelId}" is blocked in this build.`,
    };
  }

  if (status.state !== 'installed') {
    return {
      ready: false,
      ocrModelId,
      routeId: route.routeId,
      status,
      canDownload: Boolean(status.policy?.downloadPermitted),
      error: `Required local OCR model "${ocrModelId}" for "${language}" is ${status.state}. Download or verify it in Settings/desktop cache before offline extraction.`,
    };
  }

  return {
    ready: true,
    ocrModelId,
    routeId: route.routeId,
    status,
  };
}

export class ManualOcrService {
  private readonly deps: ManualOcrServiceDeps;
  private worker: ManualWorkerLike | null = null;
  private cachedOcrKey: string | null = null;
  private queueTail: Promise<void> = Promise.resolve();

  constructor(deps: ManualOcrServiceDeps = {}) {
    this.deps = deps;
  }

  private getWorker(): ManualWorkerLike {
    if (!this.worker) {
      const factory = this.deps.createWorker ?? defaultCreateManualWorker;
      this.worker = factory();
      this.cachedOcrKey = null;
    }
    return this.worker;
  }

  private async resolveModelKey(
    provider: LocalModelAssetProvider,
    modelId: string
  ): Promise<string> {
    try {
      const status = await provider.getStatus(modelId);
      const info = Array.isArray(status) ? status.find((s) => s.modelId === modelId) : status;
      if (info?.installedRevision) {
        return `${modelId}@${info.installedRevision}`;
      }
    } catch {
      // Fallback below
    }
    return `${modelId}@local`;
  }

  /**
   * Runs offline local OCR for specific manual selection bubbles on one page.
   * Zero Gemini calls, zero auto-scanning of unselected regions.
   */
  public async extractPageRegions(options: {
    pageId: string;
    bubbles: BubbleItem[];
    language: OcrSupportedLanguage;
    signal?: AbortSignal;
    onProgress?: (regionId: string, completed: number, total: number) => void;
  }): Promise<{
    outcomes: ManualOcrRegionOutcome[];
    sourceDimensions: { width: number; height: number };
  }> {
    const targets: ManualOcrCropTarget[] = options.bubbles
      .filter((b) => b.provenance === 'manual_selection')
      .map((b) => {
        const shape =
          b.manualSelectionShape ??
          (b.manualPolygon && b.manualPolygon.length >= 3 ? 'lasso' : 'box');
        return {
          regionId: b.id,
          kind: shape,
          box_2d: b.box_2d,
          polygon: b.manualPolygon,
        };
      });

    if (targets.length === 0) {
      return { outcomes: [], sourceDimensions: { width: 0, height: 0 } };
    }

    if (options.signal?.aborted) {
      throw createAbortError();
    }

    const executeTask = async () => {
      const provider =
        this.deps.modelProvider !== undefined
          ? this.deps.modelProvider
          : createDefaultModelAssetProvider();

      const readiness = await checkManualOcrModelReadiness(options.language, provider);
      if (!readiness.ready || !readiness.routeId || !provider) {
        throw new Error(readiness.error || 'Local OCR model is unavailable.');
      }

      const ocrModelKey = await this.resolveModelKey(provider, readiness.ocrModelId);
      const cacheHit = this.worker !== null && this.cachedOcrKey === ocrModelKey;
      const ocrAssets: ModelAssetPayload | undefined = cacheHit
        ? undefined
        : await provider.readModelAssets(readiness.ocrModelId);

      if (options.signal?.aborted) throw createAbortError();

      const loadBlob = this.deps.getPageBlob ?? getPageBlob;
      const blob = await loadBlob(options.pageId);
      if (!blob) {
        throw new Error(`Page image data not found in storage for page "${options.pageId}".`);
      }

      const imageBytes = await blob.arrayBuffer();
      if (imageBytes.byteLength === 0) {
        throw new Error(`Page image "${options.pageId}" is empty.`);
      }
      if (options.signal?.aborted) throw createAbortError();

      const worker = this.getWorker();
      const jobId = `manual-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      return await new Promise<{
        outcomes: ManualOcrRegionOutcome[];
        sourceDimensions: { width: number; height: number };
      }>((resolve, reject) => {
        let settled = false;
        let abortRequested = false;
        let cancelTimer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (cancelTimer !== null) {
            clearTimeout(cancelTimer);
            cancelTimer = null;
          }
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          options.signal?.removeEventListener('abort', onAbort);
        };

        const terminateOnTimeout = () => {
          if (settled) return;
          settled = true;
          cleanup();
          try {
            worker.terminate();
          } catch {
            // Ignore
          }
          if (this.worker === worker) {
            this.worker = null;
            this.cachedOcrKey = null;
          }
          reject(createAbortError('Manual OCR worker cancelled after timeout.'));
        };

        const onAbort = () => {
          if (settled || abortRequested) return;
          abortRequested = true;
          try {
            worker.postMessage({ type: 'cancel_job', jobId });
          } catch {
            terminateOnTimeout();
            return;
          }
          cancelTimer = setTimeout(
            terminateOnTimeout,
            this.deps.cancellationTimeoutMs ?? 4000
          );
        };

        const onMessage = (ev: MessageEvent<WorkerManualOcrResponse> | { data: WorkerManualOcrResponse }) => {
          const msg = ev.data;
          if (!msg || !('jobId' in msg) || msg.jobId !== jobId) return;

          if (msg.type === 'region_progress') {
            options.onProgress?.(msg.regionId, msg.completed, msg.total);
            return;
          }

          if (settled) return;
          settled = true;
          cleanup();

          if ('loadedOcrKey' in msg) {
            this.cachedOcrKey = msg.loadedOcrKey ?? null;
          }

          if (abortRequested || msg.type === 'job_cancelled') {
            reject(createAbortError());
            return;
          }

          if (msg.type === 'job_error') {
            reject(new Error(msg.error || 'Local OCR failed.'));
            return;
          }

          if (msg.type === 'job_result') {
            resolve({
              outcomes: msg.outcomes,
              sourceDimensions: msg.sourceDimensions,
            });
          }
        };

        const onError = (errEv: ErrorEvent | { message?: string }) => {
          if (settled) return;
          settled = true;
          cleanup();
          try {
            worker.terminate();
          } catch {
            // Ignore
          }
          if (this.worker === worker) {
            this.worker = null;
            this.cachedOcrKey = null;
          }
          if (abortRequested) {
            reject(createAbortError());
            return;
          }
          reject(new Error(errEv?.message || 'Manual OCR worker crashed.'));
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        options.signal?.addEventListener('abort', onAbort, { once: true });

        const req: WorkerManualOcrRequest = {
          type: 'run_manual_crops',
          jobId,
          pageId: options.pageId,
          imageBytes,
          mimeType: blob.type || 'image/png',
          language: options.language,
          routeId: readiness.routeId!,
          ocrModelKey,
          ...(ocrAssets ? { ocrAssets } : {}),
          wasmPaths: this.deps.wasmPaths ?? defaultWasmPaths(),
          targets,
        };

        try {
          worker.postMessage(req, [imageBytes]);
        } catch (err) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }
      });
    };

    const runPromise = this.queueTail.then(executeTask, executeTask);
    this.queueTail = runPromise.then(
      () => undefined,
      () => undefined
    );
    return runPromise;
  }

  /**
   * Sequentially extracts ONLY pages that contain manual selection records,
   * persisting each result incrementally and continuing across pages on non-fatal page errors.
   */
  public async extractChapterSelections(options: {
    pages: Array<{ id: string; index: number }>;
    language: OcrSupportedLanguage;
    bubblesByPage?: Record<string, BubbleItem[]>;
    signal?: AbortSignal;
    onlyBubbleIds?: Set<string>;
    onRegionRunning?: (pageId: string, bubbleId: string) => Promise<void> | void;
    onPageComplete?: (
      pageId: string,
      updatedBubbles: BubbleItem[],
      outcomes: ManualOcrRegionOutcome[]
    ) => Promise<void> | void;
    onPageProgress?: (completedPages: number, totalPages: number, pageIndex: number) => void;
    onRegionProgress?: (completedRegions: number, totalRegions: number) => void;
  }): Promise<{
    processedPages: number;
    succeededRegions: number;
    partialRegions: number;
    failedRegions: number;
    cancelled: boolean;
    fatalError: string | null;
  }> {
    const provider =
      this.deps.modelProvider !== undefined
        ? this.deps.modelProvider
        : createDefaultModelAssetProvider();
    const readiness = await checkManualOcrModelReadiness(options.language, provider);
    if (!readiness.ready) {
      return {
        processedPages: 0,
        succeededRegions: 0,
        partialRegions: 0,
        failedRegions: 0,
        cancelled: false,
        fatalError: readiness.error || 'Required local OCR model is unavailable.',
      };
    }

    const loadPageBubbles = this.deps.getPageBubbles ?? getPageBubbles;
    const sortedPages = [...options.pages].sort((a, b) => a.index - b.index);
    const targetPages: Array<{
      id: string;
      index: number;
      allBubbles: BubbleItem[];
      targets: BubbleItem[];
    }> = [];

    for (const p of sortedPages) {
      const mem = options.bubblesByPage?.[p.id];
      const allBubbles = mem && mem.length > 0 ? mem : await loadPageBubbles(p.id);
      const targets = allBubbles.filter((b) => {
        if (b.provenance !== 'manual_selection') return false;
        if (options.onlyBubbleIds) return options.onlyBubbleIds.has(b.id);
        return b.manualExtractionStatus !== 'manual_text';
      });
      if (targets.length > 0) {
        targetPages.push({ id: p.id, index: p.index, allBubbles, targets });
      }
    }

    const totalRegions = targetPages.reduce((sum, p) => sum + p.targets.length, 0);
    let completedRegions = 0;
    let succeededRegions = 0;
    let partialRegions = 0;
    let failedRegions = 0;
    let processedPages = 0;
    let lastPageError: string | null = null;

    for (let pIdx = 0; pIdx < targetPages.length; pIdx++) {
      if (options.signal?.aborted) {
        return {
          processedPages,
          succeededRegions,
          partialRegions,
          failedRegions,
          cancelled: true,
          fatalError: null,
        };
      }

      const pageTarget = targetPages[pIdx];
      options.onPageProgress?.(pIdx, targetPages.length, pageTarget.index);

      for (const b of pageTarget.targets) {
        await options.onRegionRunning?.(pageTarget.id, b.id);
      }

      try {
        const res = await this.extractPageRegions({
          pageId: pageTarget.id,
          bubbles: pageTarget.targets,
          language: options.language,
          signal: options.signal,
          onProgress: (_regionId, completedOnPage) => {
            options.onRegionProgress?.(completedRegions + completedOnPage, totalRegions);
          },
        });

        const outcomeById = new Map(res.outcomes.map((o) => [o.regionId, o]));
        const targetIdSet = new Set(pageTarget.targets.map((t) => t.id));
        const now = Date.now();

        const updatedBubbles = pageTarget.allBubbles.map((b) => {
          if (!targetIdSet.has(b.id)) return b;
          const outcome = outcomeById.get(b.id) ?? {
            regionId: b.id,
            status: 'ocr_failed' as const,
            text: '',
            confidence: 0,
            lineCount: 0,
            error: 'No OCR outcome returned for selection.',
          };

          if (outcome.status === 'ocr_success') succeededRegions++;
          else if (outcome.status === 'ocr_partial') partialRegions++;
          else failedRegions++;

          const sig = computeGeometrySignature(b.box_2d, b.manualPolygon);
          const nextSource =
            outcome.status === 'ocr_failed' && b.sourceText ? b.sourceText : outcome.text;

          return {
            ...b,
            sourceText: nextSource,
            originalSourceText:
              outcome.status === 'ocr_failed' && b.originalSourceText
                ? b.originalSourceText
                : nextSource,
            sourceLanguage: options.language,
            confidence: outcome.confidence,
            manualExtractionStatus: outcome.status,
            manualExtractionError: outcome.error ?? null,
            manualExtractedGeometrySignature: sig,
            updatedAt: now,
          };
        });

        await options.onPageComplete?.(pageTarget.id, updatedBubbles, res.outcomes);
        completedRegions += pageTarget.targets.length;
        processedPages++;
      } catch (err: any) {
        if (options.signal?.aborted || err?.name === 'AbortError') {
          return {
            processedPages,
            succeededRegions,
            partialRegions,
            failedRegions,
            cancelled: true,
            fatalError: null,
          };
        }

        const msg = err instanceof Error ? err.message : String(err);
        lastPageError = msg;
        const targetIdSet = new Set(pageTarget.targets.map((t) => t.id));
        const failOutcomes: ManualOcrRegionOutcome[] = [];
        const updatedBubbles = pageTarget.allBubbles.map((b) => {
          if (!targetIdSet.has(b.id)) return b;
          failedRegions++;
          failOutcomes.push({
            regionId: b.id,
            status: 'ocr_failed',
            text: '',
            confidence: 0,
            lineCount: 0,
            error: msg,
          });
          return {
            ...b,
            manualExtractionStatus: 'ocr_failed' as const,
            manualExtractionError: msg,
            updatedAt: Date.now(),
          };
        });

        await options.onPageComplete?.(pageTarget.id, updatedBubbles, failOutcomes);
        completedRegions += pageTarget.targets.length;
      }
    }

    return {
      processedPages,
      succeededRegions,
      partialRegions,
      failedRegions,
      cancelled: false,
      fatalError: succeededRegions === 0 && partialRegions === 0 ? lastPageError : null,
    };
  }

  public async dispose(): Promise<void> {
    if (!this.worker) return;
    try {
      this.worker.postMessage({ type: 'dispose' });
    } catch {
      // Ignore
    }
    try {
      this.worker.terminate();
    } catch {
      // Ignore
    }
    this.worker = null;
    this.cachedOcrKey = null;
  }
}

export const manualOcrService = new ManualOcrService();
