import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

export class BaozimhDriver implements ChapterSourceAdapter {
  public readonly id = 'twmanga';
  public readonly name = 'TW Manga';
  public readonly domain = 'twmanga.com';
  public readonly allowedSourceHosts = [
    'twmanga.com',
    '*.twmanga.com',
    'www.twmanga.com',
    'twbzmg.com',
    '*.twbzmg.com',
    'www.twbzmg.com',
    'baozimh.com',
    '*.baozimh.com',
  ];
  public readonly allowedImageHosts = ['s1.bzcdn.net', '*.bzcdn.net'];

  private httpClient: FetchHttpClient;

  constructor() {
    this.httpClient = new FetchHttpClient({
      defaultTimeoutMs: 15000,
      defaultMaxRetries: 3,
      defaultAllowedHosts: [...this.allowedSourceHosts],
    });
  }

  public canHandle(url: URL | string): boolean {
    try {
      const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;
      const host = u.hostname.toLowerCase();
      return (
        host.includes('twmanga.') ||
        host.includes('twbzmg.') ||
        host.includes('baozimh.')
      );
    } catch {
      return false;
    }
  }

  public resolve(url: URL | string): ResolvedSourceInfo {
    const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;
    const pathname = u.pathname.replace(/\/+$/, '');
    const chapterSlug = pathname.split('/').filter(Boolean).pop() || 'chapter';
    return {
      source: this.id,
      normalizedUrl: `https://${u.hostname}${pathname}${u.search}`,
      sourceChapterId: chapterSlug,
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: `https://${info.hostname}/`,
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

    if (!res.ok) throw new Error(`Baozimh responded with HTTP ${res.status}.`);
    const html = await res.text();
    const matches = [
      ...new Set([...html.matchAll(/https?:\/\/[a-z0-9.]*bzcdn\.net\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/gi)].map((m) => m[0])),
    ];
    if (matches.length === 0) throw new Error('Could not find chapter pages in Baozimh/TW Manga.');

    let seriesTitle = 'Baozi Manga';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) seriesTitle = titleMatch[1].split(/[-–—|]/)[0].trim() || seriesTitle;

    const pages: ChapterPage[] = matches.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        id: `twmanga-${info.sourceChapterId}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: this.id,
        sourceChapterId: info.sourceChapterId,
        seriesTitle,
        sourceUrl: info.normalizedUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  public getImageHeaders(_imageUrl: string, referer?: string): Record<string, string> {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: referer || 'https://www.twbzmg.com/',
    };
  }
}

export const twMangaAdapter = new BaozimhDriver();
