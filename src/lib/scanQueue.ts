import { scanPageWithGemini, type ScanPageOptions } from './geminiScan';
import { savePageBubbles, getPageBubbles } from '../services/db';
import { getRollingContextForPage } from '../services/intelligence';
import type { PageScanStatus, GeminiModelKey } from '../types/workbench';
import { GEMINI_MODEL_PROFILES } from '../types/workbench';
import { emitDiagnosticBoundary } from './diagnosticTap';

export interface QueueItem {
  pageId: string;
  chapterId?: string;
  pageIndex: number;
  previousPageId?: string;
  options: Omit<ScanPageOptions, 'pageId' | 'chapterId' | 'pageIndex'>;
}

export interface ScanQueueDependencies {
  scanPage?: typeof scanPageWithGemini;
  savePageBubbles?: typeof savePageBubbles;
  getPageBubbles?: typeof getPageBubbles;
  getRollingContextForPage?: typeof getRollingContextForPage;
  interRequestDelayMs?: number;
}

export type QueueProgressCallback = (progress: {
  activeCount: number;
  completedCount: number;
  totalCount: number;
  pageStatuses: Record<string, PageScanStatus>;
  detailedPageStatuses?: Record<string, PageScanStatus>;
  pageErrors: Record<string, string>;
  pageWarnings: Record<string, string[]>;
  partialPageIds: string[];
  isScanning: boolean;
  currentPageIndex?: number;
  operationId?: string;
}) => void;

export class ScanQueueManager {
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private isCancelled = false;
  private completedCount = 0;
  private totalCount = 0;
  private pageStatuses: Record<string, PageScanStatus> = {};
  private detailedPageStatuses: Record<string, PageScanStatus> = {};
  private pageErrors: Record<string, string> = {};
  private pageWarnings: Record<string, string[]> = {};
  private partialPageIds: Set<string> = new Set();
  private listeners: Set<QueueProgressCallback> = new Set();
  private abortController: AbortController | null = null;
  private activeOperationId: string | null = null;
  private operationSequence = 0;
  private lastCompletedBubbles: { pageIndex: number; bubbles: any[] } | null = null;
  private readonly deps: ScanQueueDependencies;

  constructor(deps: ScanQueueDependencies = {}) {
    this.deps = deps;
  }

  public subscribe(cb: QueueProgressCallback): () => void {
    this.listeners.add(cb);
    this.notify();
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(currentPageIndex?: number) {
    const payload = {
      activeCount: this.isProcessing ? 1 : 0,
      completedCount: this.completedCount,
      totalCount: this.totalCount,
      pageStatuses: { ...this.pageStatuses },
      detailedPageStatuses: { ...this.detailedPageStatuses },
      pageErrors: { ...this.pageErrors },
      pageWarnings: { ...this.pageWarnings },
      partialPageIds: Array.from(this.partialPageIds),
      isScanning: this.isProcessing || this.queue.length > 0,
      currentPageIndex,
      operationId: this.activeOperationId || undefined,
    };
    this.listeners.forEach((listener) => listener(payload));
  }

  public setPageStatus(pageId: string, status: PageScanStatus) {
    this.pageStatuses[pageId] = status;
    this.detailedPageStatuses[pageId] = status;
    this.notify();
  }

  public getPageStatus(pageId: string): PageScanStatus {
    return this.pageStatuses[pageId] || 'unscanned';
  }

  public getDetailedPageStatus(pageId: string): PageScanStatus {
    return this.detailedPageStatuses[pageId] || this.pageStatuses[pageId] || 'unscanned';
  }

  public getPageErrors(): Record<string, string> {
    return { ...this.pageErrors };
  }

  public getPageWarnings(): Record<string, string[]> {
    return { ...this.pageWarnings };
  }

  public getPartialPageIds(): string[] {
    return Array.from(this.partialPageIds);
  }

  public isScanningActive(): boolean {
    return this.isProcessing || this.queue.length > 0;
  }

  /**
   * Enqueues pages for processing.
   * Resolves the parallel vs sequential conflict: Chapter pages are sorted by natural page index
   * and executed in sequential context order so that Page i feeds its resolved context to Page i+1.
   * Resets per-job counters for fresh operations (F-08).
   */
  public enqueue(
    items: QueueItem[],
    onPageSuccess?: (pageId: string, bubbles: any[]) => void
  ) {
    // Cancel any previous in-flight queue operation cleanly before starting the new operation
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.isCancelled = false;
    this.operationSequence += 1;
    const operationId = `scan-op-${Date.now()}-${this.operationSequence}`;
    this.activeOperationId = operationId;

    // Reset per-job counters to ensure current job progress is completely accurate and fresh
    this.completedCount = 0;
    this.totalCount = items.length;
    this.queue = [];
    this.lastCompletedBubbles = null;
    this.isProcessing = items.length > 0;

    // Natural sort incoming items by page index to guarantee chronological narrative flow
    const sortedItems = [...items].sort((a, b) => a.pageIndex - b.pageIndex);

    sortedItems.forEach((item, idx) => {
      if (!this.pageStatuses[item.pageId] || this.pageStatuses[item.pageId] === 'error' || this.pageStatuses[item.pageId] === 'scanning') {
        this.pageStatuses[item.pageId] = 'unscanned';
      }
      delete this.pageErrors[item.pageId];
      delete this.pageWarnings[item.pageId];
      this.partialPageIds.delete(item.pageId);

      const resolvedPrevId =
        item.previousPageId ?? (idx > 0 ? sortedItems[idx - 1].pageId : undefined);
      this.queue.push({
        ...item,
        previousPageId: resolvedPrevId,
      });
    });

    this.notify();

    emitDiagnosticBoundary({
      subsystem: 'scanning-ocr',
      component: 'ScanQueueManager',
      operation: items.length > 1 ? 'scanAllEnqueue' : 'scanPageEnqueue',
      eventType: 'lifecycle',
      severity: 'info',
      status: items.length > 0 ? 'running' : 'skipped',
      correlationId: operationId,
      identifiers: {
        chapterId: items[0]?.chapterId,
        pageId: items.length === 1 ? items[0]?.pageId : undefined,
      },
      payload: {
        totalPages: items.length,
        pageIds: sortedItems.map((i) => i.pageId),
      },
      explanation:
        items.length > 1
          ? `Enqueued batch scan across ${items.length} page(s).`
          : items.length === 1
          ? `Enqueued single-page scan for page ${items[0].pageIndex} (${items[0].pageId}).`
          : 'Enqueued empty scan list.',
    });

    if (items.length > 0) {
      void this.processQueueSequentially(operationId, onPageSuccess);
    }
  }

  /**
   * Aborts pending queue items cleanly and cancels in-flight network requests.
   * Propagates signal cancellation to active HTTP requests and local OCR worker (F-07).
   */
  public cancel() {
    const cancelledOpId = this.activeOperationId || undefined;
    this.isCancelled = true;
    this.operationSequence += 1;
    this.activeOperationId = null;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.queue = [];
    this.isProcessing = false;
    for (const [pageId, status] of Object.entries(this.pageStatuses)) {
      if (status === 'scanning') {
        this.pageStatuses[pageId] = 'unscanned';
      }
    }
    emitDiagnosticBoundary({
      subsystem: 'scanning-ocr',
      component: 'ScanQueueManager',
      operation: 'scanQueueCancel',
      eventType: 'lifecycle',
      severity: 'warning',
      status: 'cancelled',
      correlationId: cancelledOpId,
      explanation: 'Scan queue operation was cancelled by user or superseded.',
    });
    this.notify();
  }

  private waitInterruptibly(ms: number, operationId: string, signal?: AbortSignal): Promise<void> {
    if (ms <= 0 || this.isCancelled || this.activeOperationId !== operationId || signal?.aborted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      signal?.addEventListener('abort', done, { once: true });
      timer = setTimeout(done, ms);
    });
  }

  /**
   * Sequential execution pipeline preserving chapter context causality.
   */
  private async processQueueSequentially(
    operationId: string,
    onPageSuccess?: (pageId: string, bubbles: any[]) => void
  ) {
    this.isProcessing = true;

    while (
      this.queue.length > 0 &&
      !this.isCancelled &&
      this.activeOperationId === operationId
    ) {
      const currentItem = this.queue.shift();
      if (!currentItem) break;

      this.pageStatuses[currentItem.pageId] = 'scanning';
      this.notify(currentItem.pageIndex);

      const controller = new AbortController();
      this.abortController = controller;
      const currentSignal = controller.signal;

      // Dynamic model rate-limit calculation
      const modelKey = (currentItem.options.selectedModel || 'gemini-3.8-flash') as GeminiModelKey;
      const modelProfile = GEMINI_MODEL_PROFILES[modelKey] || GEMINI_MODEL_PROFILES['gemini-3.8-flash'];
      const targetRpm = modelProfile.rpm || 15;
      // Pro models (RPM=2) require at least 30s delay; Flash models (RPM=15) need ~1s cooldown
      const interRequestCooldownMs =
        this.deps.interRequestDelayMs !== undefined
          ? this.deps.interRequestDelayMs
          : targetRpm <= 2
          ? 30000
          : 1000;

      try {
        await this.executeItemWithRetry(currentItem, 0, operationId, currentSignal, onPageSuccess);
      } catch (err: any) {
        if (this.activeOperationId !== operationId) {
          return;
        }
        if (this.isCancelled || currentSignal.aborted || err?.name === 'AbortError') {
          console.log(`[ScanQueue] Page ${currentItem.pageId} cancelled.`);
          this.pageStatuses[currentItem.pageId] = 'unscanned';
          this.detailedPageStatuses[currentItem.pageId] = 'cancelled';
          emitDiagnosticBoundary({
            subsystem: 'scanning-ocr',
            component: 'ScanQueueManager',
            operation: 'scanQueuePage',
            eventType: 'lifecycle',
            severity: 'warning',
            status: 'cancelled',
            correlationId: operationId,
            identifiers: { pageId: currentItem.pageId, pageIndex: currentItem.pageIndex },
            explanation: `Page ${currentItem.pageIndex} scan was cancelled.`,
          });
        } else {
          console.error(`[ScanQueue] Unrecoverable failure for page ${currentItem.pageId}:`, err);
          const isLocalOcrError =
            typeof err?.message === 'string' &&
            /Local OCR|local_ocr|route refused|model bridge|onnx/i.test(err.message);
          this.pageStatuses[currentItem.pageId] = 'error';
          this.detailedPageStatuses[currentItem.pageId] = isLocalOcrError ? 'ocr_failed' : 'ocr_complete_interpretation_failed';
          this.pageErrors[currentItem.pageId] = err?.message || 'Scan failed';
          emitDiagnosticBoundary({
            subsystem: 'scanning-ocr',
            component: 'ScanQueueManager',
            operation: 'scanQueuePage',
            eventType: 'error',
            severity: 'error',
            status: 'failed',
            correlationId: operationId,
            identifiers: { pageId: currentItem.pageId, pageIndex: currentItem.pageIndex },
            explanation: `Page ${currentItem.pageIndex} failed in scan queue: ${err?.message || 'Scan failed'}.`,
            error: err,
          });
        }
        this.notify(currentItem.pageIndex);
      }

      if (this.activeOperationId !== operationId) {
        return;
      }

      // Inter-request pacing to eliminate 429 quota exhaustion
      if (this.queue.length > 0 && !this.isCancelled) {
        await this.waitInterruptibly(interRequestCooldownMs, operationId, currentSignal);
      }
    }

    if (this.activeOperationId !== operationId) {
      return;
    }

    this.isProcessing = false;
    this.abortController = null;
    const errCount = Object.keys(this.pageErrors).length;
    const partialCount = this.partialPageIds.size;
    emitDiagnosticBoundary({
      subsystem: 'scanning-ocr',
      component: 'ScanQueueManager',
      operation: 'scanQueueComplete',
      eventType: 'lifecycle',
      severity: errCount > 0 ? 'error' : partialCount > 0 ? 'warning' : 'healthy',
      status: errCount > 0 ? 'failed' : partialCount > 0 ? 'degraded' : 'succeeded',
      correlationId: operationId,
      payload: {
        completedCount: this.completedCount,
        totalCount: this.totalCount,
        errorCount: errCount,
        partialCount,
      },
      explanation:
        errCount > 0
          ? `Scan queue finished with ${errCount} failed page(s) out of ${this.totalCount}.`
          : partialCount > 0
          ? `Scan queue completed ${this.completedCount}/${this.totalCount} pages with ${partialCount} partial result(s).`
          : `Scan queue completed all ${this.completedCount}/${this.totalCount} page(s) successfully.`,
    });
    this.notify();
  }

  private async executeItemWithRetry(
    item: QueueItem,
    attempt: number,
    operationId: string,
    signal: AbortSignal,
    onPageSuccess?: (pageId: string, bubbles: any[]) => void
  ): Promise<void> {
    if (this.isCancelled || signal.aborted || this.activeOperationId !== operationId) return;

    const scanPage = this.deps.scanPage ?? scanPageWithGemini;
    const persistBubbles = this.deps.savePageBubbles ?? savePageBubbles;
    const loadBubbles = this.deps.getPageBubbles ?? getPageBubbles;
    const fetchRollingContext = this.deps.getRollingContextForPage ?? getRollingContextForPage;

    try {
      // 1. Fetch sequential rolling context from preceding page if index > 1 (F-12)
      let precedingSnippet: string | undefined;
      if (item.pageIndex > 1 && item.chapterId) {
        try {
          let precedingBubbles: any[] = [];
          if (this.lastCompletedBubbles && this.lastCompletedBubbles.pageIndex === item.pageIndex - 1) {
            precedingBubbles = this.lastCompletedBubbles.bubbles;
          } else if (item.previousPageId) {
            // Load preceding page bubbles from database if available
            const previousPageBubbles = await loadBubbles(item.previousPageId).catch(() => []);
            if (previousPageBubbles && previousPageBubbles.length > 0) {
              precedingBubbles = previousPageBubbles;
            }
          }

          const rollingContext = await fetchRollingContext(
            item.chapterId,
            item.pageIndex,
            precedingBubbles.map((b) => ({
              index: b.index,
              type: b.type,
              sourceText: b.sourceText || '',
              translatedText: b.translatedText || '',
            }))
          );

          precedingSnippet = [
            rollingContext.summary ? `Chapter Scene: ${rollingContext.summary}` : '',
            rollingContext.activeCharactersPrompt ? `Active Roster:\n${rollingContext.activeCharactersPrompt}` : '',
            rollingContext.terminologyPrompt ? `Terms:\n${rollingContext.terminologyPrompt}` : '',
            rollingContext.relationshipPrompt ? `Relationships:\n${rollingContext.relationshipPrompt}` : '',
            rollingContext.precedingDialogueSnippet || '',
          ]
            .filter(Boolean)
            .join('\n\n');
        } catch (e) {
          console.warn('[ScanQueue] Could not build preceding rolling context:', e);
        }
      }

      if (this.isCancelled || signal.aborted || this.activeOperationId !== operationId) return;

      // 2. Hybrid Scan + Translation with AbortSignal propagation (F-07)
      const result = await scanPage({
        pageId: item.pageId,
        chapterId: item.chapterId,
        pageIndex: item.pageIndex,
        ...item.options,
        precedingDialogueSnippet: precedingSnippet,
        correlationId: operationId,
        signal,
      });

      if (this.isCancelled || signal.aborted || this.activeOperationId !== operationId) return;

      // 3. Persist bubbles to IndexedDB (guarantee consistency even with custom scanPage mocks)
      await persistBubbles(item.pageId, result.bubbles);

      if (this.isCancelled || signal.aborted || this.activeOperationId !== operationId) return;

      const isPartial =
        result.scanResult?.status === 'partial' || result.translationSuccess === false;
      if (isPartial) {
        this.partialPageIds.add(item.pageId);
        this.pageWarnings[item.pageId] =
          result.warnings && result.warnings.length > 0
            ? result.warnings
            : ['Partial scan result saved with recoverable stage unavailability.'];
      } else {
        this.partialPageIds.delete(item.pageId);
        delete this.pageWarnings[item.pageId];
      }

      this.lastCompletedBubbles = { pageIndex: item.pageIndex, bubbles: result.bubbles };
      this.pageStatuses[item.pageId] = 'scanned';
      if (result.scanResult?.interpretationStatus === 'complete') {
        this.detailedPageStatuses[item.pageId] = 'ocr_complete_interpretation_complete';
      } else if (result.scanResult?.interpretationStatus === 'failed') {
        this.detailedPageStatuses[item.pageId] = 'ocr_complete_interpretation_failed';
      } else if (result.scanResult?.interpretationStatus === 'pending') {
        this.detailedPageStatuses[item.pageId] = 'ocr_complete_interpretation_pending';
      } else {
        this.detailedPageStatuses[item.pageId] = 'ocr_complete_interpretation_complete';
      }
      this.completedCount++;
      onPageSuccess?.(item.pageId, result.bubbles);
      this.notify(item.pageIndex);
    } catch (err: any) {
      if (
        this.isCancelled ||
        signal.aborted ||
        err?.name === 'AbortError' ||
        this.activeOperationId !== operationId
      ) {
        throw err;
      }
      console.warn(`[ScanQueue] Scan failed for page ${item.pageId} (Attempt ${attempt + 1}):`, err);

      const isRateLimitOrOverloaded =
        err?.message?.includes('429') ||
        err?.message?.includes('503') ||
        err?.message?.toLowerCase().includes('quota') ||
        err?.message?.toLowerCase().includes('rate limit');

      if (
        isRateLimitOrOverloaded &&
        attempt < 4 &&
        !this.isCancelled &&
        !signal.aborted &&
        this.activeOperationId === operationId
      ) {
        // Exponential backoff: delay = 2000 * 2^attempt + random(1000)
        const delay = 2000 * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`[ScanQueue] Rate limit reached. Backing off for ${(delay / 1000).toFixed(1)}s...`);
        emitDiagnosticBoundary({
          subsystem: 'ai-services',
          component: 'ScanQueueManager',
          operation: 'rateLimitRetry',
          eventType: 'decision',
          severity: 'warning',
          status: 'running',
          correlationId: operationId,
          identifiers: { pageId: item.pageId, pageIndex: item.pageIndex },
          payload: { attempt: attempt + 1, delayMs: Math.round(delay) },
          explanation: `Rate limit or overload detected on page ${item.pageIndex}; backing off ${Math.round(delay)}ms before retry #${attempt + 1}.`,
          error: err,
        });
        await this.waitInterruptibly(delay, operationId, signal);
        if (this.isCancelled || signal.aborted || this.activeOperationId !== operationId) {
          return;
        }
        return this.executeItemWithRetry(item, attempt + 1, operationId, signal, onPageSuccess);
      }

      this.pageStatuses[item.pageId] = 'error';
      this.pageErrors[item.pageId] = err?.message || 'Scan failed';
      this.notify(item.pageIndex);
      throw err;
    }
  }
}

export const scanQueue = new ScanQueueManager();
