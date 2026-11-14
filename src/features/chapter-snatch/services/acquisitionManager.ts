import type {
  ChapterAcquisition,
  ChapterMetadata,
  ChapterPage,
  DownloadedImageData,
} from '../types';
import { sourceRegistry } from '../core/sourceRegistry';
import { ChapterImageValidator } from './imageValidator';
import { ChapterZipExporter } from './zipExporter';

export type AcquisitionSubscriber = (acquisition: ChapterAcquisition) => void;

export class ChapterAcquisitionManager {
  private currentAcquisition: ChapterAcquisition;
  private imageStore = new Map<string, DownloadedImageData>();
  private abortController: AbortController | null = null;
  private subscribers = new Set<AcquisitionSubscriber>();
  private activeAcquisitionId = 0;

  constructor() {
    this.currentAcquisition = this.createInitialState();
  }

  private createInitialState(): ChapterAcquisition {
    return {
      acquisitionId: '',
      metadata: null,
      pages: [],
      status: 'idle',
      completedCount: 0,
      failedCount: 0,
      totalCount: 0,
    };
  }

  public subscribe(fn: AcquisitionSubscriber): () => void {
    this.subscribers.add(fn);
    fn(this.getSnapshot());
    return () => this.subscribers.delete(fn);
  }

  public getSnapshot(): ChapterAcquisition {
    return { ...this.currentAcquisition };
  }

  public getImageData(pageId: string): DownloadedImageData | undefined {
    return this.imageStore.get(pageId);
  }

  public getAllImages(): Map<string, DownloadedImageData> {
    return this.imageStore;
  }

  private notify(): void {
    const snap = this.getSnapshot();
    for (const sub of this.subscribers) {
      try {
        sub(snap);
      } catch (err) {
        console.error('[AcquisitionManager] Subscriber error:', err);
      }
    }
  }

  /**
   * Resets and cleans up any existing acquisition, temp files, and blob URLs.
   */
  public reset(): void {
    const oldAcqId = this.currentAcquisition.acquisitionId;
    this.cancel();
    this.cleanupThumbnails();
    this.imageStore.clear();

    if (oldAcqId) {
      this.cleanupBackendAcquisition(oldAcqId);
    }

    this.currentAcquisition = this.createInitialState();
    this.notify();
  }

  public cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (
      this.currentAcquisition.status === 'fetching' ||
      this.currentAcquisition.status === 'downloading'
    ) {
      this.currentAcquisition.status = 'cancelled';
      this.notify();
    }
  }

  private cleanupBackendAcquisition(acquisitionId: string): void {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    const electronBridge = win?.folioScript?.chapterSnatch;
    if (electronBridge?.cleanupAcquisition) {
      electronBridge.cleanupAcquisition(acquisitionId).catch(() => {});
    }
  }

  /**
   * Screen A -> Fetches chapter manifest and starts downloading pages automatically.
   */
  public async fetchAndAcquire(rawUrl: string): Promise<ChapterAcquisition> {
    this.reset();
    const acquisitionId = `acq-${++this.activeAcquisitionId}-${Date.now()}`;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.currentAcquisition = {
      acquisitionId,
      metadata: null,
      pages: [],
      status: 'fetching',
      completedCount: 0,
      failedCount: 0,
      totalCount: 0,
    };
    this.notify();

    try {
      // 1. Resolve source via Central Registry
      const { adapter, info } = sourceRegistry.resolve(rawUrl);

      const win = typeof window !== 'undefined' ? (window as any) : undefined;
      const electronBridge = win?.folioScript?.chapterSnatch;

      let metadata: ChapterMetadata;
      let pages: ChapterPage[];

      if (electronBridge?.fetchMetadata) {
        // Safe main process fetch via Electron IPC
        const ipcResult = await electronBridge.fetchMetadata(info.normalizedUrl);
        metadata = ipcResult.metadata;
        pages = ipcResult.pages;
      } else if (win?.location) {
        // Safe backend fetch via local server (Chrome --app or web mode)
        const resp = await fetch(`/api/chapter-snatch/metadata?url=${encodeURIComponent(info.normalizedUrl)}`, {
          signal,
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        metadata = data.metadata;
        pages = data.pages;
      } else {
        // Direct adapter fetch (e.g. unit tests or standalone node)
        const res = await adapter.fetchManifest(info, undefined, signal);
        metadata = res.metadata;
        pages = res.pages;
      }

      if (signal.aborted) {
        this.currentAcquisition.status = 'cancelled';
        this.notify();
        return this.getSnapshot();
      }

      this.currentAcquisition.metadata = metadata;
      this.currentAcquisition.pages = pages;
      this.currentAcquisition.totalCount = pages.length;
      this.currentAcquisition.status = 'downloading';
      this.notify();

      // 2. Download Pages in Parallel with controlled concurrency
      await this.downloadPages(pages, signal);

      return this.getSnapshot();
    } catch (err: any) {
      if (signal.aborted) {
        this.currentAcquisition.status = 'cancelled';
      } else {
        this.currentAcquisition.status = 'failed';
        this.currentAcquisition.errorMessage = err?.message || 'Failed to acquire chapter.';
      }
      this.notify();
      throw err;
    }
  }

  /**
   * Downloads a list of pages with controlled concurrency and image validation.
   */
  public async downloadPages(pagesToDownload: ChapterPage[], signal: AbortSignal): Promise<void> {
    if (this.currentAcquisition.pages.length === 0) {
      this.currentAcquisition.pages = pagesToDownload;
      this.currentAcquisition.totalCount = pagesToDownload.length;
    }
    const concurrency = 4;
    let index = 0;

    const worker = async () => {
      while (index < pagesToDownload.length && !signal.aborted) {
        const page = pagesToDownload[index++];
        await this.downloadSinglePage(page, signal);
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, pagesToDownload.length) }, () => worker());
    await Promise.all(workers);

    if (signal.aborted) {
      this.currentAcquisition.status = 'cancelled';
      this.notify();
      return;
    }

    const failedCount = this.currentAcquisition.pages.filter((p) => p.downloadStatus === 'failed').length;
    const completedCount = this.currentAcquisition.pages.filter((p) => p.downloadStatus === 'ready').length;

    this.currentAcquisition.completedCount = completedCount;
    this.currentAcquisition.failedCount = failedCount;

    if (failedCount > 0 && completedCount === 0) {
      this.currentAcquisition.status = 'failed';
      this.currentAcquisition.errorMessage = 'All pages failed to download.';
    } else if (failedCount > 0) {
      this.currentAcquisition.status = 'partial_failure';
    } else {
      this.currentAcquisition.status = 'ready';
    }

    this.notify();
  }

  /**
   * Retries downloading failed pages.
   */
  public async retryFailedPages(): Promise<void> {
    const failedPages = this.currentAcquisition.pages.filter((p) => p.downloadStatus === 'failed');
    if (failedPages.length === 0) return;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    for (const page of failedPages) {
      page.downloadStatus = 'pending';
      page.error = undefined;
    }
    this.currentAcquisition.status = 'downloading';
    this.notify();

    await this.downloadPages(failedPages, signal);
  }

  private async downloadSinglePage(page: ChapterPage, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;

    page.downloadStatus = 'downloading';
    this.notify();

    try {
      const win = typeof window !== 'undefined' ? (window as any) : undefined;
      const electronBridge = win?.folioScript?.chapterSnatch;

      let rawBytes: Uint8Array;
      let declaredMime: string | undefined;
      let tempFilePath: string | undefined = undefined;

      if (electronBridge?.downloadPageImage) {
        // Safe IPC image download with disk-backed acquisition support
        const referer = this.currentAcquisition.metadata?.sourceUrl;
        const res = await electronBridge.downloadPageImage({
          imageUrl: page.imageUrl,
          referer,
          acquisitionId: this.currentAcquisition.acquisitionId,
          filename: page.filename,
        });
        rawBytes = ChapterZipExporter.base64ToUint8Array(res.dataBase64);
        declaredMime = res.mimeType;
        tempFilePath = res.filePath;
      } else if (win?.location) {
        // Safe backend fetch via local server
        const referer = this.currentAcquisition.metadata?.sourceUrl || '';
        const acqId = encodeURIComponent(this.currentAcquisition.acquisitionId);
        const fn = encodeURIComponent(page.filename);
        const resp = await fetch(
          `/api/chapter-snatch/download-page?url=${encodeURIComponent(page.imageUrl)}&referer=${encodeURIComponent(referer)}&acquisitionId=${acqId}&filename=${fn}`,
          { signal }
        );
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        rawBytes = ChapterZipExporter.base64ToUint8Array(data.dataBase64);
        declaredMime = data.mimeType;
        tempFilePath = data.filePath;
      } else {
        // Browser/test fetch
        const res = await fetch(page.imageUrl, {
          signal,
          headers: {
            'User-Agent': 'FolioScript-ChapterSnatch/1.0',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          },
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const buffer = await res.arrayBuffer();
        rawBytes = new Uint8Array(buffer);
        declaredMime = res.headers.get('content-type') || page.mimeType;
      }

      if (signal.aborted) return;

      // Validate image integrity and magic bytes
      const val = ChapterImageValidator.validateImageBytes(rawBytes, declaredMime);
      if (!val.isValid) {
        throw new Error(val.error || 'Corrupted image bytes.');
      }

      const mimeType = val.mimeType || page.mimeType;
      const extension = val.extension || page.extension;
      const sizeBytes = val.sizeBytes;

      // Store in memory cache
      this.imageStore.set(page.id, {
        data: rawBytes,
        mimeType,
        extension,
        sizeBytes,
        tempFilePath,
      });

      // Revoke previous thumbnail if any
      if (page.thumbnailUrl) {
        try {
          URL.revokeObjectURL(page.thumbnailUrl);
        } catch {}
      }

      // Create a light object URL for thumbnail preview
      const blob = new Blob([rawBytes as any], { type: mimeType });
      page.thumbnailUrl = URL.createObjectURL(blob);
      page.downloadStatus = 'ready';
      page.mimeType = mimeType;
      page.extension = extension;
      page.sizeBytes = sizeBytes;
      page.tempFilePath = tempFilePath;
      page.error = undefined;

      this.currentAcquisition.completedCount = this.currentAcquisition.pages.filter(
        (p) => p.downloadStatus === 'ready'
      ).length;
    } catch (err: any) {
      if (signal.aborted) return;
      page.downloadStatus = 'failed';
      page.error = err?.message || 'Download failed';
      this.currentAcquisition.failedCount = this.currentAcquisition.pages.filter(
        (p) => p.downloadStatus === 'failed'
      ).length;
    } finally {
      this.notify();
    }
  }

  private cleanupThumbnails(): void {
    for (const page of this.currentAcquisition.pages) {
      if (page.thumbnailUrl) {
        try {
          URL.revokeObjectURL(page.thumbnailUrl);
        } catch {}
        page.thumbnailUrl = undefined;
      }
    }
  }
}

export const chapterAcquisitionManager = new ChapterAcquisitionManager();
