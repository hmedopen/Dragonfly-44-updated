import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

export type NextSpaFlavor = 'flame' | 'elfkayn' | 'nuvia' | 'genz';

export interface NextSpaConfig {
  id: string;
  name: string;
  domain: string;
  flavor: NextSpaFlavor;
  extraDomains?: string[];
  imageDomains?: string[];
}

export class NextSpaDriver implements ChapterSourceAdapter {
  public readonly id: string;
  public readonly name: string;
  public readonly domain: string;
  public readonly flavor: NextSpaFlavor;
  public readonly allowedSourceHosts: readonly string[];
  public readonly allowedImageHosts: readonly string[];

  private httpClient: FetchHttpClient;
  private supportedDomains: Set<string>;

  constructor(config: NextSpaConfig) {
    this.id = config.id;
    this.name = config.name;
    this.domain = config.domain.toLowerCase();
    this.flavor = config.flavor;

    const allDomains = [this.domain, ...(config.extraDomains || []).map((d) => d.toLowerCase())];
    this.supportedDomains = new Set(allDomains);

    const sourceHosts: string[] = [];
    for (const d of allDomains) {
      sourceHosts.push(d, `*.${d}`);
    }
    this.allowedSourceHosts = sourceHosts;

    const imgHosts: string[] = [
      this.domain,
      `*.${this.domain}`,
      ...(config.imageDomains || []),
    ];
    this.allowedImageHosts = imgHosts;

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
      for (const d of this.supportedDomains) {
        if (host === d || host === `www.${d}` || host.endsWith(`.${d}`)) return true;
      }
      return false;
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
      normalizedUrl: `https://${u.hostname}${pathname}/`,
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

    if (!res.ok) throw new Error(`${this.name} responded with HTTP ${res.status}.`);
    const html = await res.text();

    let pageUrls: string[] = [];
    let seriesTitle = this.name;
    let chapterTitle: string | undefined;
    let chapterNumber: string | undefined;

    if (this.flavor === 'flame') {
      const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (!nextMatch) throw new Error('Could not find Next.js data in Flame Comics.');
      const nextData = JSON.parse(nextMatch[1]);
      const ch = nextData?.props?.pageProps?.chapter;
      const series = nextData?.props?.pageProps?.series;
      pageUrls = ch?.images || [];
      seriesTitle = series?.title || seriesTitle;
      chapterTitle = ch?.title || undefined;
      chapterNumber = ch?.chapter ? String(ch.chapter) : undefined;
    } else if (this.flavor === 'elfkayn') {
      const uploadMatches = [
        ...new Set([...html.matchAll(/(\/uploads\/series\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|avif))/gi)].map((m) => m[1])),
      ];
      pageUrls = uploadMatches
        .filter((p) => /\/p\d+/i.test(p) || /page-\d+/i.test(p))
        .sort((a, b) => {
          const numA = parseInt(a.match(/p(\d+)/i)?.[1] || '0', 10);
          const numB = parseInt(b.match(/p(\d+)/i)?.[1] || '0', 10);
          return numA - numB;
        })
        .map((p) => new URL(p, info.normalizedUrl).toString());
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      if (titleMatch) seriesTitle = titleMatch[1].split(/Chapter|Ch\./i)[0].replace(/[-–—|]/g, '').trim() || this.name;
    } else if (this.flavor === 'nuvia') {
      const idMatch =
        html.match(/"meta"\s*:\s*\{\s*"id"\s*:\s*"([a-f0-9-]+)"/i) ||
        html.match(/\\"meta\\"\s*:\s*\{\s*\\"id\\"\s*:\s*\\"([a-f0-9-]+)\\"/i) ||
        html.match(/"chapterId"\s*:\s*"([a-f0-9-]+)"/i);
      if (!idMatch) throw new Error('Could not resolve NuviaToon chapter ID.');
      const chapterId = idMatch[1];
      const contentApiUrl = `https://nuviatoon.org/api/comic-chapters/${chapterId}/content`;
      const apiRes = await this.httpClient.fetchSafe(
        contentApiUrl,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            Accept: 'application/json',
            Referer: info.normalizedUrl,
          },
          signal,
          allowedHosts: [...this.allowedSourceHosts],
        },
        fetchFn
      );
      if (!apiRes.ok) throw new Error(`NuviaToon API responded with HTTP ${apiRes.status}.`);
      const apiJson = await apiRes.json();
      pageUrls = (apiJson?.data?.pages || []).map((p: any) => p.url);
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      if (titleMatch) seriesTitle = titleMatch[1].split(/—|Chapter/i)[0].trim() || this.name;
    } else if (this.flavor === 'genz') {
      const uidMatches = [...html.matchAll(/<img[^>]+uid=["']([^"']+\.[a-z0-9]+)["'][^>]*>/gi)].map((m) => m[1]);
      pageUrls = uidMatches.map((uid) => `https://cdn.meowing.org/uploads/${uid}`);
      const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (h1Match) seriesTitle = h1Match[1].trim();
    }

    if (pageUrls.length === 0) throw new Error(`No pages discovered in ${this.name} chapter.`);

    const pages: ChapterPage[] = pageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'webp';
      return {
        id: `${this.id}-${info.sourceChapterId}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : ext === 'avif' ? 'image/avif' : 'image/webp',
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
        chapterTitle,
        chapterNumber,
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
      Referer: referer || `https://${this.domain}/`,
    };
  }
}
