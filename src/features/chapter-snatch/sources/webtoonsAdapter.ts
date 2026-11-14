import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

/**
 * Dedicated adapter for LINE Webtoon (webtoons.com).
 * Extracts high-res images from div#_imageList img[data-url].
 * Mandates Referer: https://www.webtoons.com/ for image downloads to avoid HTTP 403.
 */
export class WebtoonsAdapter implements ChapterSourceAdapter {
  public readonly id = 'webtoons';
  public readonly name = 'LINE Webtoon';

  public readonly allowedSourceHosts = ['webtoons.com', '*.webtoons.com'] as const;
  public readonly allowedImageHosts = [
    'webtoons.com',
    '*.webtoons.com',
    '*.webtoon-phinf.pstatic.net',
    'webtoon-phinf.pstatic.net',
  ] as const;

  public static readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  private httpClient = new FetchHttpClient({
    defaultTimeoutMs: 15000,
    defaultMaxRetries: 3,
    defaultAllowedHosts: [...this.allowedSourceHosts],
  });

  public canHandle(url: URL | string): boolean {
    try {
      const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;
      const host = u.hostname.toLowerCase();
      return host === 'webtoons.com' || host === 'www.webtoons.com' || host.endsWith('.webtoons.com');
    } catch {
      return false;
    }
  }

  public resolve(url: URL | string): ResolvedSourceInfo {
    const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;

    // Pattern 1: /en/fantasy/tower-of-god/viewer?title_no=95&episode_no=1
    // Pattern 2: /en/fantasy/tower-of-god/episode-1/viewer?title_no=95
    const titleNo = u.searchParams.get('title_no');
    let episodeNo = u.searchParams.get('episode_no');

    const segments = u.pathname.split('/').filter(Boolean);
    let seriesSlug: string | undefined;

    // Look for episode in pathname if not in searchParams
    for (const seg of segments) {
      const match = seg.match(/^episode-(\d+)$/i);
      if (match && !episodeNo) {
        episodeNo = match[1];
      }
    }

    if (segments.length >= 2) {
      // Typically: [lang, genre, seriesSlug, ...]
      const viewerIdx = segments.indexOf('viewer');
      if (viewerIdx > 0) {
        seriesSlug = segments[viewerIdx - 1];
        if (seriesSlug.startsWith('episode-') && viewerIdx >= 2) {
          seriesSlug = segments[viewerIdx - 2];
        }
      } else {
        seriesSlug = segments[segments.length - 1];
      }
    }

    if (!titleNo || !episodeNo) {
      // Must have title_no and episode_no or recognizable path
      if (!titleNo) {
        throw new Error('Invalid Webtoons URL: Missing title_no query parameter.');
      }
      if (!episodeNo) {
        throw new Error('Invalid Webtoons URL: Missing episode_no parameter.');
      }
    }

    const sourceChapterId = `${titleNo}-${episodeNo}`;

    return {
      source: this.id,
      normalizedUrl: `https://${u.hostname}${u.pathname}?title_no=${titleNo}&episode_no=${episodeNo}`,
      sourceChapterId,
      seriesSlug,
      chapterSlug: episodeNo,
      hostname: u.hostname,
    };
  }

  public async fetchManifest(
    info: ResolvedSourceInfo,
    fetchFn: typeof fetch = fetch,
    signal?: AbortSignal
  ): Promise<ChapterManifest> {
    const res = await this.httpClient.fetchSafe(
      info.normalizedUrl,
      {
        headers: {
          'User-Agent': WebtoonsAdapter.USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: 'https://www.webtoons.com/',
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Webtoons episode "${info.sourceChapterId}" was not found (404).`);
      }
      throw new Error(`Webtoons responded with HTTP ${res.status}.`);
    }

    const html = await res.text();
    return this.parseHtml(html, info);
  }

  public parseHtml(html: string, info: ResolvedSourceInfo): ChapterManifest {
    // 1. Locate #_imageList
    const listMatch = html.match(/<div[^>]+id=["']_imageList["'][^>]*>([\s\S]*?)<\/div>/i);
    const container = listMatch ? listMatch[1] : html;

    const imgMatches = [...container.matchAll(/<img([^>]+)>/gi)];
    const imageUrls: string[] = [];

    for (const match of imgMatches) {
      const attrs = match[1];
      // Webtoons puts the real high-res image URL in data-url attribute!
      const dataUrlMatch = attrs.match(/data-url=["']([^"']+)["']/i);
      const srcMatch = attrs.match(/src=["']([^"']+)["']/i);

      const targetUrl = dataUrlMatch ? dataUrlMatch[1].trim() : srcMatch ? srcMatch[1].trim() : null;
      if (!targetUrl) continue;

      if (targetUrl.includes('placeholder') || targetUrl.includes('logo') || targetUrl.endsWith('.svg')) {
        continue;
      }

      imageUrls.push(targetUrl);
    }

    if (imageUrls.length === 0) {
      throw new Error('Could not find chapter pages in the Webtoons response.');
    }

    // Series title: <a ... class="subj">Series Title</a> or <title>
    let seriesTitle = info.seriesSlug
      ? info.seriesSlug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : 'LINE Webtoon';

    const seriesTitleMatch = html.match(/<a[^>]+class=["'][^"']*subj[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (seriesTitleMatch) {
      seriesTitle = seriesTitleMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    // Chapter title: <h1 class="subj_episode" ...>Episode Name</h1>
    let chapterTitle: string | undefined;
    const epTitleMatch = html.match(/<h1[^>]+class=["'][^"']*subj_episode[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
    if (epTitleMatch) {
      chapterTitle = epTitleMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    const chapterNumber = info.chapterSlug || undefined;

    const pages: ChapterPage[] = imageUrls.map((imgUrl, idx) => {
      const originalIndex = idx + 1;
      const cleanUrl = imgUrl.split('?')[0];
      const ext = cleanUrl.split('.').pop()?.toLowerCase() || 'jpg';
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

      return {
        id: `webtoons-${info.sourceChapterId}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType,
        extension: ext,
        sizeBytes: 0,
        imageUrl: imgUrl,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: this.id,
        sourceChapterId: info.sourceChapterId,
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
      'User-Agent': WebtoonsAdapter.USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: 'https://www.webtoons.com/',
    };
  }
}

export const webtoonsAdapter = new WebtoonsAdapter();
