import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

export class MangaDexAdapter implements ChapterSourceAdapter {
  public readonly id = 'mangadex';
  public readonly name = 'MangaDex';

  public readonly allowedSourceHosts = ['mangadex.org', '*.mangadex.org'] as const;
  public readonly allowedImageHosts = ['*.mangadex.network', '*.mangadex.org'] as const;

  public static readonly USER_AGENT = 'FolioScript/1.0.0 (contact@folioscript.app)';
  private static readonly API_BASE = 'https://api.mangadex.org';

  private httpClient = new FetchHttpClient({
    defaultTimeoutMs: 15000,
    defaultMaxRetries: 3,
    defaultAllowedHosts: [...this.allowedSourceHosts],
  });

  public canHandle(url: URL | string): boolean {
    try {
      const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;
      const host = u.hostname.toLowerCase();
      return host === 'mangadex.org' || host === 'www.mangadex.org' || host === 'api.mangadex.org';
    } catch {
      return false;
    }
  }

  public resolve(url: URL | string): ResolvedSourceInfo {
    const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;
    const segments = u.pathname.split('/').filter(Boolean);
    const chapterIdx = segments.indexOf('chapter');

    if (chapterIdx === -1 || !segments[chapterIdx + 1]) {
      throw new Error('Invalid MangaDex chapter URL. Expected format: https://mangadex.org/chapter/{chapterId}');
    }

    const uuidCandidate = segments[chapterIdx + 1].toLowerCase();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(uuidCandidate)) {
      throw new Error(`Invalid MangaDex chapter UUID: "${uuidCandidate}".`);
    }

    return {
      source: 'mangadex',
      normalizedUrl: `https://mangadex.org/chapter/${uuidCandidate}`,
      sourceChapterId: uuidCandidate,
      hostname: u.hostname,
    };
  }

  public async fetchManifest(
    info: ResolvedSourceInfo,
    fetchFn: typeof fetch = fetch,
    signal?: AbortSignal
  ): Promise<ChapterManifest> {
    const chapterId = info.sourceChapterId;

    // 1. Fetch Chapter Metadata & Relationships
    const metaUrl = `${MangaDexAdapter.API_BASE}/chapter/${chapterId}?includes[]=manga`;
    const metaRes = await this.httpClient.fetchSafe(
      metaUrl,
      {
        headers: {
          'User-Agent': MangaDexAdapter.USER_AGENT,
          Accept: 'application/json',
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

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

    // Extract series title
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
    const atHomeUrl = `${MangaDexAdapter.API_BASE}/at-home/server/${chapterId}`;
    const atHomeRes = await this.httpClient.fetchSafe(
      atHomeUrl,
      {
        headers: {
          'User-Agent': MangaDexAdapter.USER_AGENT,
          Accept: 'application/json',
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

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

    return {
      metadata: {
        source: 'mangadex',
        sourceChapterId: chapterId,
        seriesTitle,
        chapterTitle,
        chapterNumber,
        sourceUrl: info.normalizedUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  public getImageHeaders(_imageUrl: string, _referer?: string): Record<string, string> {
    return {
      'User-Agent': MangaDexAdapter.USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
  }
}

export const mangaDexAdapter = new MangaDexAdapter();
