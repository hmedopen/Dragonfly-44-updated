/**
 * Fetch Core - Core Contracts & Types
 */

export type ChapterSource = 'mangadex' | 'asura' | string;

export interface ChapterMetadata {
  source: ChapterSource;
  sourceChapterId: string;
  seriesTitle?: string;
  chapterTitle?: string;
  chapterNumber?: string;
  sourceUrl: string;
  pageCount: number;
}

export type PageDownloadStatus = 'pending' | 'downloading' | 'ready' | 'failed';

export interface ChapterPage {
  /** Stable unique page ID */
  id: string;
  /** 1-based original sequential position */
  originalIndex: number;
  filename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  imageUrl: string;
  downloadStatus: PageDownloadStatus;
  error?: string;
  /** Blob object URL or data URL for UI thumbnail preview */
  thumbnailUrl?: string;
  /** Local temporary disk path if disk-backed */
  tempFilePath?: string;
}

export type AcquisitionStatus =
  | 'idle'
  | 'fetching'
  | 'downloading'
  | 'ready'
  | 'exporting'
  | 'importing'
  | 'completed'
  | 'cancelled'
  | 'partial_failure'
  | 'failed';

export interface ChapterAcquisition {
  acquisitionId: string;
  metadata: ChapterMetadata | null;
  pages: ChapterPage[];
  status: AcquisitionStatus;
  completedCount: number;
  failedCount: number;
  totalCount: number;
  errorMessage?: string;
}

export interface ImageValidationResult {
  isValid: boolean;
  mimeType?: string;
  extension?: string;
  sizeBytes: number;
  error?: string;
}

export interface DownloadedImageData {
  data: Uint8Array;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  tempFilePath?: string;
}

export interface ZipExportResult {
  saved: boolean;
  canceled: boolean;
  filePath?: string;
  totalBytes?: number;
  error?: string;
}

export interface WorkspaceImportResult {
  success: boolean;
  chapterId: string;
  chapterName: string;
  folderId: string;
  pageCount: number;
  error?: string;
}

export interface ResolvedSourceInfo {
  source: ChapterSource;
  normalizedUrl: string;
  sourceChapterId: string;
  seriesSlug?: string;
  chapterSlug?: string;
  hostname: string;
}

export interface ChapterManifest {
  metadata: ChapterMetadata;
  pages: ChapterPage[];
}

export interface FetchHttpClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  allowedHosts?: string[];
  maxRedirects?: number;
}

/**
 * Unified contract for all manga source adapters
 */
export interface ChapterSourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly allowedSourceHosts: readonly string[];
  readonly allowedImageHosts: readonly string[];

  canHandle(url: URL | string): boolean;
  resolve(url: URL | string): ResolvedSourceInfo;
  fetchManifest(
    info: ResolvedSourceInfo,
    fetchFn?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
    signal?: AbortSignal
  ): Promise<ChapterManifest>;
  getImageHeaders?(imageUrl: string, referer?: string): Record<string, string>;
}
