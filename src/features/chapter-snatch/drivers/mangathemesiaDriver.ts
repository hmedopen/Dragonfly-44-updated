import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

export interface MangaThemesiaConfig {
  id: string;
  name: string;
  domain: string;
  extraDomains?: string[];
  imageDomains?: string[];
}

/**
 * Driver for MangaThemesia-based manga websites.
 * Recognizes ts_reader.run({...}) JSON source blocks or #readerarea HTML containers.
 */
export class MangaThemesiaDriver implements ChapterSourceAdapter {
  public readonly id: string;
  public readonly name: string;
  public readonly domain: string;
  public readonly allowedSourceHosts: readonly string[];
  public readonly allowedImageHosts: readonly string[];

  private httpClient: FetchHttpClient;
  private supportedDomains: Set<string>;

  public static readonly DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  constructor(config: MangaThemesiaConfig) {
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
      this.domain,
      `*.${this.domain}`,
      '*.wp.com',
      '*.googleusercontent.com',
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

    if (segments.length === 0) {
      throw new Error(`Invalid ${this.name} URL. Expected a chapter page.`);
    }

    // Typical paths:
    // 1. /{series-slug}-chapter-{num}/
    // 2. /manga/{series-slug}/{chapter-slug}/
    // 3. /{series-slug}/{chapter-slug}/
    let chapterSlug = segments[segments.length - 1];
    let seriesSlug: string | undefined;

    if (segments.length >= 2) {
      if (segments[0] === 'manga' || segments[0] === 'series') {
        seriesSlug = segments[1];
      } else {
        seriesSlug = segments[segments.length - 2];
      }
    } else {
      // Derive series slug from "{series}-chapter-{num}"
      const chMatch = chapterSlug.match(/^(.*?)[-_](?:chapter|ch)[-_](\d+(?:[-.]\d+)?)$/i);
      if (chMatch) {
        seriesSlug = chMatch[1];
      }
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
          'User-Agent': MangaThemesiaDriver.DEFAULT_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: `https://${info.hostname}/`,
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`${this.name} chapter "${info.sourceChapterId}" was not found (404).`);
      }
      throw new Error(`${this.name} responded with HTTP ${res.status}.`);
    }

    const html = await res.text();
    return this.parseHtml(html, info);
  }

  public parseHtml(html: string, info: ResolvedSourceInfo): ChapterManifest {
    let imageUrls: string[] = [];

    // 1. Try ts_reader.run({...}) JSON source extraction
    const tsMatch = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/i);
    if (tsMatch && tsMatch[1]) {
      try {
        const readerData = JSON.parse(tsMatch[1]);
        const sources = readerData.sources || [];
        for (const src of sources) {
          if (Array.isArray(src.images) && src.images.length > 0) {
            imageUrls = src.images;
            break;
          }
        }
      } catch {
        // Fall back to HTML extraction
      }
    }

    // 2. Fallback: Parse #readerarea images
    if (imageUrls.length === 0) {
      const readerAreaMatch =
        html.match(/<div[^>]+id=["']readerarea["'][^>]*>([\s\S]*?)<\/div>/i) ||
        html.match(/<div[^>]+class=["'][^"']*reading-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      const container = readerAreaMatch ? readerAreaMatch[1] : html;

      const imgMatches = [...container.matchAll(/<img([^>]+)>/gi)];
      const seen = new Set<string>();

      for (const match of imgMatches) {
        const attrs = match[1];
        const srcMatch =
          attrs.match(/(?:data-src|data-lazy-src|data-original)=["']([^"']+)["']/i) ||
          attrs.match(/src=["']([^"']+)["']/i);
        if (!srcMatch) continue;
        const rawUrl = srcMatch[1].trim();

        if (
          rawUrl.includes('/ads/') ||
          rawUrl.includes('/banners/') ||
          rawUrl.includes('logo') ||
          rawUrl.includes('avatar') ||
          rawUrl.includes('placeholder') ||
          rawUrl.endsWith('.svg')
        ) {
          continue;
        }

        let fullUrl = rawUrl;
        try {
          fullUrl = new URL(rawUrl, info.normalizedUrl).toString();
        } catch {
          continue;
        }

        if (!seen.has(fullUrl)) {
          seen.add(fullUrl);
          imageUrls.push(fullUrl);
        }
      }
    }

    if (imageUrls.length === 0) {
      throw new Error(`Could not find chapter pages in ${this.name} response.`);
    }

    // Extract title & chapter number
    let seriesTitle = info.seriesSlug
      ? info.seriesSlug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : this.name;
    const titleTagMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleTagMatch) {
      const parts = titleTagMatch[1].split(/[-–—|]/);
      if (parts.length > 0 && parts[0].trim()) {
        const potential = parts[0].split(/Chapter|Ch\./i)[0].trim();
        if (potential) seriesTitle = potential;
      }
    }

    const chHeadingMatch = html.match(/<h1[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
    let chapterTitle: string | undefined;
    let chapterNumber: string | undefined;

    if (chHeadingMatch) {
      const headingText = chHeadingMatch[1].replace(/<[^>]+>/g, '').trim();
      chapterTitle = headingText;
      const numMatch = headingText.match(/(?:Chapter|Ch\.?)\s*(\d+(?:\.\d+)?)/i);
      if (numMatch) {
        chapterNumber = numMatch[1];
      }
    }

    if (!chapterNumber) {
      const slugMatch = info.sourceChapterId.match(/(?:chapter|ch)[-_](\d+(?:[-.]\d+)?)/i);
      if (slugMatch) {
        chapterNumber = slugMatch[1].replace('-', '.');
      }
    }

    const pages: ChapterPage[] = imageUrls.map((imgUrl, idx) => {
      const originalIndex = idx + 1;
      const ext = imgUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

      return {
        id: `${this.id}-${info.sourceChapterId}-${originalIndex}`,
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
      'User-Agent': MangaThemesiaDriver.DEFAULT_USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: `https://${this.domain}/`,
    };
  }
}
