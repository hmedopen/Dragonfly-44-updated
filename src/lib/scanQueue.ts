import { scanPageWithGemini, type ScanPageOptions } from './geminiScan';
import { savePageBubbles } from '../services/db';
import { getRollingContextForPage } from '../services/intelligence';
import type { PageScanStatus, GeminiModelKey } from '../types/workbench';
import { GEMINI_MODEL_PROFILES } from '../types/workbench';

export interface QueueItem {
  pageId: string;
  chapterId?: string;
  pageIndex: number;
  options: Omit<ScanPageOptions, 'pageId' | 'chapterId' | 'pageIndex'>;
}

export type QueueProgressCallback = (progress: {
  activeCount: number;
  completedCount: number;
  totalCount: number;
  pageStatuses: Record<string, PageScanStatus>;
  isScanning: boolean;
  currentPageIndex?: number;
}) => void;

class ScanQueueManager {
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private isCancelled = false;
  private completedCount = 0;
  private totalCount = 0;
  private pageStatuses: Record<string, PageScanStatus> = {};
  private listeners: Set<QueueProgressCallback> = new Set();
  private abortController: AbortController | null = null;

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
      isScanning: this.isProcessing || this.queue.length > 0,
      currentPageIndex,
    };
    this.listeners.forEach((listener) => listener(payload));
  }

  public setPageStatus(pageId: string, status: PageScanStatus) {
    this.pageStatuses[pageId] = status;
    this.notify();
  }

  public getPageStatus(pageId: string): PageScanStatus {
    return this.pageStatuses[pageId] || 'unscanned';
  }

  /**
   * Enqueues pages for processing.
   * Resolves the parallel vs sequential conflict: Chapter pages are sorted by natural page index
   * and executed in sequential context order so that Page i feeds its resolved context to Page i+1.
   */
  public enqueue(
    items: QueueItem[],
    onPageSuccess?: (pageId: string, bubbles: any[]) => void
  ) {
    this.isCancelled = false;

    // Natural sort incoming items by page index to guarantee chronological narrative flow
    const sortedItems = [...items].sort((a, b) => a.pageIndex - b.pageIndex);

    sortedItems.forEach((item) => {
      if (!this.pageStatuses[item.pageId] || this.pageStatuses[item.pageId] === 'error') {
        this.pageStatuses[item.pageId] = 'unscanned';
      }
      this.queue.push(item);
    });

    this.totalCount = this.queue.length + this.completedCount;
    this.notify();

    if (!this.isProcessing) {
      this.processQueueSequentially(onPageSuccess);
    }
  }

  /**
   * Aborts pending queue items cleanly and cancels in-flight network requests.
   */
  public cancel() {
    this.isCancelled = true;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.queue = [];
    this.isProcessing = false;
    this.notify();
  }

  /**
   * Sequential execution pipeline preserving chapter context causality.
   */
  private async processQueueSequentially(onPageSuccess?: (pageId: string, bubbles: any[]) => void) {
    if (this.isProcessing || this.isCancelled) return;
    this.isProcessing = true;

    while (this.queue.length > 0 && !this.isCancelled) {
      const currentItem = this.queue.shift();
      if (!currentItem) break;

      this.pageStatuses[currentItem.pageId] = 'scanning';
      this.notify(currentItem.pageIndex);

      this.abortController = new AbortController();

      // Dynamic model rate-limit calculation
      const modelKey = (currentItem.options.selectedModel || 'gemini-3.8-flash') as GeminiModelKey;
      const modelProfile = GEMINI_MODEL_PROFILES[modelKey] || GEMINI_MODEL_PROFILES['gemini-3.8-flash'];
      const targetRpm = modelProfile.rpm || 15;
      // Pro models (RPM=2) require at least 30s delay; Flash models (RPM=15) need ~1s cooldown
      const interRequestCooldownMs = targetRpm <= 2 ? 30000 : 1000;

      try {
        await this.executeItemWithRetry(currentItem, 0, onPageSuccess);
      } catch (err) {
        console.error(`[ScanQueue] Unrecoverable failure for page ${currentItem.pageId}:`, err);
        this.pageStatuses[currentItem.pageId] = 'error';
        this.notify();
      }

      // Inter-request pacing to eliminate 429 quota exhaustion
      if (this.queue.length > 0 && !this.isCancelled) {
        await new Promise((resolve) => setTimeout(resolve, interRequestCooldownMs));
      }
    }

    this.isProcessing = false;
    this.abortController = null;
    this.notify();
  }

  private async executeItemWithRetry(
    item: QueueItem,
    attempt: number,
    onPageSuccess?: (pageId: string, bubbles: any[]) => void
  ): Promise<void> {
    if (this.isCancelled) return;

    try {
      // 1. Fetch sequential rolling context from preceding page if index > 1
      let precedingSnippet: string | undefined;
      if (item.pageIndex > 1 && item.chapterId) {
        try {
          // Preceding page bubbles
          const rollingContext = await getRollingContextForPage(item.chapterId, item.pageIndex);
          precedingSnippet = [
            rollingContext.summary ? `Chapter Scene: ${rollingContext.summary}` : '',
            rollingContext.activeCharactersPrompt ? `Active Roster:\n${rollingContext.activeCharactersPrompt}` : '',
            rollingContext.terminologyPrompt ? `Terms:\n${rollingContext.terminologyPrompt}` : '',
            rollingContext.relationshipPrompt ? `Relationships:\n${rollingContext.relationshipPrompt}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');
        } catch (e) {
          console.warn('[ScanQueue] Could not build preceding rolling context:', e);
        }
      }

      // 2. Multimodal Scan
      const result = await scanPageWithGemini({
        pageId: item.pageId,
        chapterId: item.chapterId,
        pageIndex: item.pageIndex,
        ...item.options,
        precedingDialogueSnippet: precedingSnippet,
      });

      // 3. Persist bubbles to IndexedDB
      await savePageBubbles(item.pageId, result.bubbles);
      this.pageStatuses[item.pageId] = 'scanned';
      this.completedCount++;
      onPageSuccess?.(item.pageId, result.bubbles);
      this.notify(item.pageIndex);
    } catch (err: any) {
      console.warn(`[ScanQueue] Scan failed for page ${item.pageId} (Attempt ${attempt + 1}):`, err);

      const isRateLimitOrOverloaded =
        err?.message?.includes('429') ||
        err?.message?.includes('503') ||
        err?.message?.toLowerCase().includes('quota') ||
        err?.message?.toLowerCase().includes('rate limit');

      if (isRateLimitOrOverloaded && attempt < 4 && !this.isCancelled) {
        // Exponential backoff: delay = 2000 * 2^attempt + random(1000)
        const delay = 2000 * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`[ScanQueue] Rate limit reached. Backing off for ${(delay / 1000).toFixed(1)}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.executeItemWithRetry(item, attempt + 1, onPageSuccess);
      }

      this.pageStatuses[item.pageId] = 'error';
      this.notify(item.pageIndex);
      throw err;
    }
  }
}

export const scanQueue = new ScanQueueManager();
