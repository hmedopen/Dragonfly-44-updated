import type { ChapterMetadata, ChapterPage } from '../types';
import type { ResolvedSourceInfo } from './sourceResolver';
import { mangaDexAdapter } from '../sources/mangadexAdapter';

export interface MangaDexChapterManifest {
  metadata: ChapterMetadata;
  pages: ChapterPage[];
}

export class MangaDexConnector {
  /**
   * Fetches chapter metadata and image manifest from the official MangaDex API.
   * Delegates to MangaDexAdapter in the Fetch Core.
   */
  public static async fetchChapterManifest(
    info: ResolvedSourceInfo,
    fetchFn: typeof fetch = fetch
  ): Promise<MangaDexChapterManifest> {
    return await mangaDexAdapter.fetchManifest(info, fetchFn);
  }
}
