import type { ChapterMetadata, ChapterPage } from '../types';
import type { ResolvedSourceInfo } from './sourceResolver';
import { asuraAdapter } from '../sources/asuraAdapter';

export interface AsuraChapterManifest {
  metadata: ChapterMetadata;
  pages: ChapterPage[];
}

export class AsuraConnector {
  /**
   * Fetches chapter manifest from Asura Scans.
   * Delegates to AsuraAdapter in the Fetch Core.
   */
  public static async fetchChapterManifest(
    info: ResolvedSourceInfo,
    fetchFn: typeof fetch = fetch
  ): Promise<AsuraChapterManifest> {
    return await asuraAdapter.fetchManifest(info, fetchFn);
  }

  /**
   * Parses Asura Scans HTML (both modern Astro islands and classic reader structures).
   */
  public static parseHtml(html: string, info: ResolvedSourceInfo): AsuraChapterManifest {
    return asuraAdapter.parseHtml(html, info);
  }
}
