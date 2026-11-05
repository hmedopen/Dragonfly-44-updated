import { scanPageWithGemini, type ScanPageOptions } from './geminiScan';
import { savePageBubbles } from '../services/db';
import type { PageScanStatus } from '../types/workbench';

export interface QueueItem {
  pageId: string;
  pageIndex: number;
  options: Omit<ScanPageOptions, 'pageId'>;
}

export type QueueProgressCallback = (progress: {
  activeCount: number;
  completedCount: number;
  totalCount: number;
  pageStatuses: Record<string, PageScanStatus>;
  isScanning: boolean;
}) => void;

class ScanQueueManager {
  private queue: QueueItem[] = [];
  private activeWorkers = 0;
  private readonly maxConcurrency = 2;
  private readonly cooldownMs = 1000;
  private isCancelled = false;
  private completedCount = 0;
  private totalCount = 0;
  private pageStatuses: Record<string, PageScanStatus> = {};
  private listeners: Set<QueueProgressCallback> = new Set();

  public subscribe(cb: QueueProgressCallback): () => void {
    this.listeners.add(cb);
    this.notify();
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify() {
    const payload = {
      activeCount: this.activeWorkers,
      completedCount: this.completedCount,
      totalCount: this.totalCount,
      pageStatuses: { ...this.pageStatuses },
      isScanning: this.activeWorkers > 0 || this.queue.length > 0,
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
   * Adds pages to the FIFO queue and begins processing
   */
  public enqueue(
    items: QueueItem[],
    onPageSuccess?: (pageId: string, bubbles: any[]) => void
  ) {
    this.isCancelled = false;
    items.forEach((item) => {
      if (!this.pageStatuses[item.pageId]) {
        this.pageStatuses[item.pageId] = 'unscanned';
      }
      this.queue.push(item);
    });
    this.totalCount = this.queue.length + this.completedCount;
    this.notify();
    this.processQueue(onPageSuccess);
  }

  /**
   * Aborts pending queue items cleanly
   */
  public cancel() {
    this.isCancelled = true;
    this.queue = [];
    this.notify();
  }

  private async processQueue(onPageSuccess?: (pageId: string, bubbles: any[]) => void) {
    if (this.isCancelled) return;

    while (this.activeWorkers < this.maxConcurrency && this.queue.length > 0) {
      if (this.isCancelled) break;
      const item = this.queue.shift();
      if (!item) break;

      this.activeWorkers++;
      this.pageStatuses[item.pageId] = 'scanning';
      this.notify();

      this.executeItemWithRetry(item, 0, onPageSuccess)
        .finally(() => {
          this.activeWorkers--;
          if (this.queue.length > 0 && !this.isCancelled) {
            setTimeout(() => {
              this.processQueue(onPageSuccess);
            }, this.cooldownMs);
          } else {
            this.notify();
          }
        });
    }
  }

  private async executeItemWithRetry(
    item: QueueItem,
    attempt: number,
    onPageSuccess?: (pageId: string, bubbles: any[]) => void
  ): Promise<void> {
    if (this.isCancelled) return;

    try {
      const result = await scanPageWithGemini({
        pageId: item.pageId,
        ...item.options,
      });

      // Persist bubbles to IndexedDB
      await savePageBubbles(item.pageId, result.bubbles);
      this.pageStatuses[item.pageId] = 'scanned';
      this.completedCount++;
      onPageSuccess?.(item.pageId, result.bubbles);
      this.notify();
    } catch (err: any) {
      console.warn(`Scan failed for page ${item.pageId} (Attempt ${attempt + 1}):`, err);

      const isRateLimitOrOverloaded =
        err?.message?.includes('429') ||
        err?.message?.includes('503') ||
        err?.message?.toLowerCase().includes('quota') ||
        err?.message?.toLowerCase().includes('rate limit');

      if (isRateLimitOrOverloaded && attempt < 3 && !this.isCancelled) {
        // Exponential backoff: delay = 1500 * 2^attempt + random(500)
        const delay = 1500 * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.executeItemWithRetry(item, attempt + 1, onPageSuccess);
      }

      this.pageStatuses[item.pageId] = 'error';
      this.notify();
    }
  }
}

export const scanQueue = new ScanQueueManager();
