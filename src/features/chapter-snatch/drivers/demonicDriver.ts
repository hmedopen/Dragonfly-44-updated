import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

export class DemonicDriver implements ChapterSourceAdapter {
  public readonly id = 'demonicscans';
  public readonly name = 'Demonic Scans';
  public readonly domain = 'demonicscans.org';
  public readonly allowedSourceHosts = ['demonicscans.org', '*.demonicscans.org'];
  public readonly allowedImageHosts = [
    'cdn2.demoniclibs.com',
    'cdn.demoniclibs.com',
    'librarydm.com',
    'demonicscans.org',
    '*.demonicscans.org',
  ];

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
      return u.hostname.toLowerCase().includes('demonicscans.org');
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
          Referer: 'https://demonicscans.org/',
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

    if (!res.ok) throw new Error(`Demonic Scans responded with HTTP ${res.status}.`);
    const html = await res.text();
    const imgMatches = [
      ...html.matchAll(
        /<img[^>]+(?:class=["'][^"']*imgholder[^"']*["']|src=["'][^"']*(?:demoniclibs|librarydm)[^"']*["'])[^>]*>/gi
      ),
    ];
    const pageUrls: string[] = [];
    for (const m of imgMatches) {
      const src = m[0].match(/src=["']([^"']+)["']/i)?.[1];
      if (src && (src.includes('demoniclibs.com') || src.includes('librarydm.com')) && !src.includes('free_ads')) {
        pageUrls.push(encodeURI(src));
      }
    }
    if (pageUrls.length === 0) throw new Error('Could not find chapter images in Demonic Scans.');

    let seriesTitle = 'Demonic Scans Manga';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) seriesTitle = titleMatch[1].split(/Chapter|Ch\./i)[0].trim() || seriesTitle;

    const pages: ChapterPage[] = pageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        id: `demonic-${info.sourceChapterId}-${originalIndex}`,
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
      Referer: referer || 'https://demonicscans.org/',
    };
  }
}

export const demonicScansAdapter = new DemonicDriver();
