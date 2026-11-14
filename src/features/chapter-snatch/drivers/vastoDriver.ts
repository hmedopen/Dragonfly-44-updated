import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

export interface VastoConfig {
  id: string;
  name: string;
  domain: string;
  extraDomains?: string[];
  imageDomains?: string[];
  imageRegex?: RegExp;
}

export class VastoDriver implements ChapterSourceAdapter {
  public readonly id: string;
  public readonly name: string;
  public readonly domain: string;
  public readonly allowedSourceHosts: readonly string[];
  public readonly allowedImageHosts: readonly string[];

  private httpClient: FetchHttpClient;
  private supportedDomains: Set<string>;
  private imageRegex?: RegExp;

  public static readonly DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  constructor(config: VastoConfig) {
    this.id = config.id;
    this.name = config.name;
    this.domain = config.domain.toLowerCase();
    this.imageRegex = config.imageRegex;

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
    const segments = pathname.split('/').filter(Boolean);

    if (segments.length === 0) {
      throw new Error(`Invalid ${this.name} URL. Expected a chapter page.`);
    }

    const chapterSlug = segments[segments.length - 1];
    let seriesSlug: string | undefined;

    if (segments.length >= 2) {
      seriesSlug = segments[segments.length - 2] === 'chapter' ? segments[segments.length - 3] : segments[segments.length - 2];
    }

    return {
      source: this.id,
      normalizedUrl: `https://${u.hostname}${pathname}/`,
      sourceChapterId: chapterSlug,
      seriesSlug,
      chapterSlug,
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
          'User-Agent': VastoDriver.DEFAULT_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: `https://${info.hostname}/`,
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

    if (!res.ok) {
      if (res.status === 404) throw new Error(`${this.name} chapter was not found (404).`);
      throw new Error(`${this.name} responded with HTTP ${res.status}.`);
    }

    const html = await res.text();
    let matches: string[] = [];

    if (this.imageRegex) {
      matches = [...new Set([...html.matchAll(this.imageRegex)].map((m) => m[1] || m[0]))];
    }

    if (matches.length === 0) {
      const genericRegex =
        /(https?:\/\/(?:storage\.(?:vortexscans\.org|en-hijala\.com|nyxscans\.(?:com|org)|hivetoon\.com)|media\.qimanga\.com)\/[^\s"'<>]+\.(?:webp|jpg|jpeg|png))/gi;
      matches = [...new Set([...html.matchAll(genericRegex)].map((m) => m[1]))];
    }

    if (matches.length === 0) {
      const fallbackImgs = [...html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi)]
        .map((m) => m[1])
        .filter((u) => !u.includes('logo') && !u.includes('avatar') && !u.endsWith('.svg'));
      matches = [...new Set(fallbackImgs)];
    }

    if (matches.length === 0) {
      throw new Error(`Could not find chapter pages in ${this.name}.`);
    }

    let seriesTitle = this.name;
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) {
      seriesTitle = titleMatch[1].split(/Chapter|Ch\./i)[0].replace(/[-–—|]/g, '').trim() || this.name;
    }

    let chapterTitle: string | undefined;
    let chapterNumber: string | undefined;
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      chapterTitle = h1Match[1].replace(/<[^>]+>/g, '').trim();
      const numMatch = chapterTitle.match(/(?:Chapter|Ch\.?)\s*(\d+(?:\.\d+)?)/i);
      if (numMatch) chapterNumber = numMatch[1];
    }

    const pages: ChapterPage[] = matches.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'webp';
      return {
        id: `${this.id}-${info.sourceChapterId}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp',
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
      'User-Agent': VastoDriver.DEFAULT_USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: referer || `https://${this.domain}/`,
    };
  }
}
