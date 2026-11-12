/**
 * Chapter Snatch - Shared Data Contracts & Types
 */

export type ChapterSource = 'mangadex' | 'asura';

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
  /** Blob object URL for UI thumbnail preview (temporary) */
  thumbnailUrl?: string;
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
