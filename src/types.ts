import type { PageScanStatus } from './types/workbench';

export interface PageMetadata {
  id: string; // pageId
  fileName: string;
  index: number; // 1-based index (1, 2, 3...)
  scanStatus?: PageScanStatus;
}

export interface Chapter {
  id: string;
  name: string;
  pages: number;
  createdAt: number;
  status?: 'draft' | 'in_progress' | 'completed';
  isDraft?: boolean;
  pageList?: PageMetadata[];
}

export interface Folder {
  id: string;
  name: string;
  badgeCount: number;
  chapters: Chapter[];
  createdAt: number;
  isSystem?: boolean;
  isDraft?: boolean;
}

export type SortMode = 'alphabetical-asc' | 'alphabetical-desc' | 'newest' | 'oldest' | 'pages-desc' | 'pages-asc';

export * from './types/workbench';
export * from './types/typers';
