import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

export interface GigaViewerConfig {
  id: string;
  name: string;
  domain: string;
  extraDomains?: string[];
  imageDomains?: string[];
}

export class GigaViewerDriver implements ChapterSourceAdapter {
  public readonly id: string;
  public readonly name: string;
  public readonly domain: string;
  public readonly allowedSourceHosts: readonly string[];
  public readonly allowedImageHosts: readonly string[];

  private httpClient: FetchHttpClient;
  private supportedDomains: Set<string>;

  public static readonly DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  constructor(config: GigaViewerConfig) {
    this.id = config.id;
    this.name = config.name;
    this.domain = config.domain.toLowerCase();

    const allDomains = [this.domain, ...(config.extraDomains || []).map((d) => d.toLowerCase())];
    this.supportedDomains = new Set(allDomains);

    const sourceHosts: string[] = [];
    for (const d of allDomains) {
      sourceHosts.push(d, `*.${d}`);
    }
    this.allowedSourceHosts = sourceHosts;

    const imgHosts: string[] = [
      `cdn-img.${this.domain}`,
      `cdn-ak-img.${this.domain}`,
      `*.${this.domain}`,
      '*.gigaviewer.com',
      'cdn-scissors.gigaviewer.com',
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
        if (host === d || host === `www.${d}`) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public resolve(url: URL | string): ResolvedSourceInfo {
    const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;
    const pathname = u.pathname.replace(/\/+$/, '');
    const segments = pathname.split('/').filter(Boolean);

    const episodeIdx = segments.indexOf('episode');
    if (episodeIdx === -1 || !segments[episodeIdx + 1]) {
      throw new Error(`Invalid ${this.name} URL. Expected format: https://${this.domain}/episode/{episodeId}`);
    }

    const episodeId = segments[episodeIdx + 1].replace(/\.json$/, '');
    if (!/^\d+$/.test(episodeId)) {
      throw new Error(`Invalid ${this.name} episode ID: "${episodeId}". Expected numeric ID.`);
    }

    return {
      source: this.id,
      normalizedUrl: `https://${u.hostname}/episode/${episodeId}`,
      sourceChapterId: episodeId,
      hostname: u.hostname,
    };
  }

  public async fetchManifest(
    info: ResolvedSourceInfo,
    fetchFn: typeof fetch = fetch,
    signal?: AbortSignal
  ): Promise<ChapterManifest> {
    const episodeId = info.sourceChapterId;

    // 1. First fetch HTML to extract embedded script#episode-json data-value (avoids 400 error on Hatena sites)
    try {
      const htmlRes = await this.httpClient.fetchSafe(
        info.normalizedUrl,
        {
          headers: {
            'User-Agent': GigaViewerDriver.DEFAULT_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: `https://${info.hostname}/`,
          },
          signal,
          allowedHosts: [...this.allowedSourceHosts],
        },
        fetchFn
      );
      if (htmlRes.ok) {
        const pageHtml = await htmlRes.text();
        const dataValMatch =
          pageHtml.match(/<script[^>]+id=["']episode-json["'][^>]*data-value=(["'])([\s\S]*?)\1/i) ||
          pageHtml.match(/<script[^>]+data-value=(["'])([\s\S]*?)\1[^>]*id=["']episode-json["']/i);
        if (dataValMatch && dataValMatch[2]) {
          const decoded = dataValMatch[2]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          const parsedJson = JSON.parse(decoded);
          if (parsedJson?.readableProduct) {
            return this.parseGigaViewerJson(parsedJson, info);
          }
        }
      }
    } catch {
      // Fallback to .json below
    }

    // 2. Fallback to /episode/{id}.json
    const jsonUrl = `https://${info.hostname}/episode/${episodeId}.json`;
    const res = await this.httpClient.fetchSafe(
      jsonUrl,
      {
        headers: {
          'User-Agent': GigaViewerDriver.DEFAULT_USER_AGENT,
          Accept: 'application/json, text/plain, */*',
          Referer: info.normalizedUrl,
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

    if (!res.ok) {
      if (res.status === 400) {
        const errorBody = await res.json().catch(() => ({}));
        const msg = errorBody?.error?.message || 'Access Restricted';
        throw new Error(
          `GigaViewer: Episode "${episodeId}" is restricted on ${this.name} (${msg}). Free web reading may not be enabled for this chapter.`
        );
      }
      if (res.status === 404) {
        throw new Error(`${this.name} episode "${episodeId}" was not found (404).`);
      }
      throw new Error(`${this.name} responded with HTTP ${res.status}.`);
    }

    const data = await res.json();
    return this.parseGigaViewerJson(data, info);
  }

  public parseGigaViewerJson(data: any, info: ResolvedSourceInfo): ChapterManifest {
    const product = data?.readableProduct;
    if (!product) {
      throw new Error(`Invalid GigaViewer response from ${this.name}: Missing readableProduct structure.`);
    }

    const rawPages = product.pageStructure?.pages || [];
    const mainPages = rawPages.filter((p: any) => p.type === 'main' && p.src);

    if (mainPages.length === 0) {
      throw new Error(`Episode "${info.sourceChapterId}" contains no accessible main pages.`);
    }

    const pages: ChapterPage[] = mainPages.map((p: any, idx: number) => {
      const originalIndex = idx + 1;
      const srcUrl = p.src;
      const cleanUrl = srcUrl.split('?')[0];
      const ext = cleanUrl.split('.').pop()?.toLowerCase() || 'jpg';
      let mimeType = 'image/jpeg';
      if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'webp') mimeType = 'image/webp';

      return {
        id: `${this.id}-${info.sourceChapterId}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType,
        extension: ext,
        sizeBytes: 0,
        imageUrl: srcUrl,
        downloadStatus: 'pending',
      };
    });

    const seriesTitle = product.series?.title || this.name;
    const chapterTitle = product.title || undefined;
    const chapterNumber = product.number !== undefined ? String(product.number) : undefined;

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
      'User-Agent': GigaViewerDriver.DEFAULT_USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: referer || `https://${this.domain}/`,
    };
  }
}
