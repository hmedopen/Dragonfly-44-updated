import type { ChapterMetadata, ChapterPage } from '../types';
import type { ResolvedSourceInfo } from './sourceResolver';

export interface MangaDexChapterManifest {
  metadata: ChapterMetadata;
  pages: ChapterPage[];
}

export class MangaDexConnector {
  private static readonly API_BASE = 'https://api.mangadex.org';

  /**
   * Fetches chapter metadata and image manifest from the official MangaDex API.
   * Uses original-quality `data` images only.
   */
  public static async fetchChapterManifest(
    info: ResolvedSourceInfo,
    fetchFn: typeof fetch = fetch
  ): Promise<MangaDexChapterManifest> {
    const chapterId = info.sourceChapterId;

    // 1. Fetch Chapter Metadata & Relationships
    const metaUrl = `${this.API_BASE}/chapter/${chapterId}?includes[]=manga`;
    const metaRes = await this.fetchWithRetry(metaUrl, fetchFn);

    if (!metaRes.ok) {
      if (metaRes.status === 404) {
        throw new Error(`MangaDex chapter "${chapterId}" was not found (404).`);
      }
      throw new Error(`MangaDex API error (HTTP ${metaRes.status}) while retrieving chapter details.`);
    }

    const metaJson = await metaRes.json();
    if (metaJson.result === 'error') {
      const msg = metaJson.errors?.[0]?.detail || 'Unknown MangaDex error';
      throw new Error(`MangaDex API: ${msg}`);
    }

    const attrs = metaJson.data?.attributes || {};
    const relationships = metaJson.data?.relationships || [];

    // Extract manga title
    const mangaRel = relationships.find((r: any) => r.type === 'manga');
    let seriesTitle = 'Unknown Manga';
    if (mangaRel?.attributes?.title) {
      const titles = mangaRel.attributes.title;
      seriesTitle =
        titles.en ||
        titles['ja-ro'] ||
        titles.ja ||
        Object.values(titles)[0] ||
        'Unknown Manga';
    }

    const chapterNumber = attrs.chapter ? String(attrs.chapter) : undefined;
    const chapterTitle = attrs.title ? String(attrs.title) : undefined;

    // 2. Fetch At-Home Server details
    const atHomeUrl = `${this.API_BASE}/at-home/server/${chapterId}`;
    const atHomeRes = await this.fetchWithRetry(atHomeUrl, fetchFn);

    if (!atHomeRes.ok) {
      throw new Error(`MangaDex At-Home server error (HTTP ${atHomeRes.status}).`);
    }

    const atHomeJson = await atHomeRes.json();
    if (atHomeJson.result === 'error' || !atHomeJson.chapter) {
      throw new Error('MangaDex At-Home server failed to provide image endpoints.');
    }

    const baseUrl = atHomeJson.baseUrl;
    const hash = atHomeJson.chapter.hash;
    // Section 6: Use original-quality data images by default. Do not silently substitute data-saver.
    const fileList: string[] = atHomeJson.chapter.data || [];

    if (fileList.length === 0) {
      throw new Error('MangaDex chapter contains no pages.');
    }

    // 3. Construct ChapterPage contracts
    const pages: ChapterPage[] = fileList.map((filename, idx) => {
      const originalIndex = idx + 1;
      const id = `md-${chapterId}-${originalIndex}`;
      const ext = filename.split('.').pop()?.toLowerCase() || 'png';
      let mimeType = 'image/png';
      if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
      else if (ext === 'webp') mimeType = 'image/webp';
      else if (ext === 'avif') mimeType = 'image/avif';

      const imageUrl = `${baseUrl}/data/${hash}/${filename}`;

      return {
        id,
        originalIndex,
        filename,
        mimeType,
        extension: ext,
        sizeBytes: 0,
        imageUrl,
        downloadStatus: 'pending',
      };
    });

    const metadata: ChapterMetadata = {
      source: 'mangadex',
      sourceChapterId: chapterId,
      seriesTitle,
      chapterTitle,
      chapterNumber,
      sourceUrl: info.normalizedUrl,
      pageCount: pages.length,
    };

    return {
      metadata,
      pages,
    };
  }

  /**
   * Performs fetch with exponential backoff on HTTP 429 rate limit.
   */
  private static async fetchWithRetry(
    url: string,
    fetchFn: typeof fetch,
    maxRetries: number = 3
  ): Promise<Response> {
    let delay = 1000;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetchFn(url, {
        headers: {
          'User-Agent': 'FolioScript-ChapterSnatch/1.0',
          'Accept': 'application/json',
        },
      });

      if (res.status === 429 && attempt < maxRetries) {
        const retryAfterHeader = res.headers.get('retry-after');
        const retrySec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
        const waitMs = retrySec > 0 ? retrySec * 1000 : delay;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        delay *= 2;
        continue;
      }

      return res;
    }

    throw new Error('MangaDex request exceeded retry attempts.');
  }
}
