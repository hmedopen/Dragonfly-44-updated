import type { ChapterMetadata, ChapterPage } from '../types';
import type { ResolvedSourceInfo } from './sourceResolver';

export interface AsuraChapterManifest {
  metadata: ChapterMetadata;
  pages: ChapterPage[];
}

export class AsuraConnector {
  private static readonly DEFAULT_HEADERS = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };

  /**
   * Fetches chapter manifest from Asura Scans.
   */
  public static async fetchChapterManifest(
    info: ResolvedSourceInfo,
    fetchFn: typeof fetch = fetch
  ): Promise<AsuraChapterManifest> {
    const targetUrl = info.normalizedUrl;

    const res = await fetchFn(targetUrl, {
      headers: this.DEFAULT_HEADERS,
      redirect: 'follow',
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Asura chapter was not found at "${targetUrl}" (404).`);
      }
      if (res.status === 403) {
        throw new Error('Access denied (403) when reaching Asura Scans. Cloudflare anti-bot check may be active.');
      }
      throw new Error(`Asura Scans responded with HTTP ${res.status}.`);
    }

    const html = await res.text();
    return this.parseHtml(html, info);
  }

  /**
   * Parses Asura Scans HTML (both modern Astro islands and classic reader structures).
   */
  public static parseHtml(html: string, info: ResolvedSourceInfo): AsuraChapterManifest {
    // Strategy 1: Astro Island ChapterReader props (modern Asura architecture)
    const astroResult = this.parseAstroReader(html, info);
    if (astroResult) {
      return astroResult;
    }

    // Strategy 2: Classic HTML Reader structure fallback (#readerarea, etc.)
    const domResult = this.parseClassicDomReader(html, info);
    if (domResult) {
      return domResult;
    }

    throw new Error(
      'Could not detect chapter reader pages in the Asura Scans response. The layout may have changed or the chapter is unavailable.'
    );
  }

  /**
   * Strategy 1: Modern Astro island component extraction.
   */
  private static parseAstroReader(html: string, info: ResolvedSourceInfo): AsuraChapterManifest | null {
    // Look for <astro-island ... opts='{"name":"ChapterReader"...}' props="..."> (supports both single and double quotes)
    const islandMatch =
      html.match(/<astro-island[^>]+opts=["'][^"']*ChapterReader[^"']*["'][^>]*props=(["'])([\s\S]*?)\1/i) ||
      html.match(/<astro-island[^>]+props=(["'])([\s\S]*?)\1[^>]*opts=["'][^"']*ChapterReader[^"']*["']/i) ||
      html.match(/<astro-island[^>]+component-url=["'][^"']*ChapterReader[^"']*["'][^>]*props=(["'])([\s\S]*?)\1/i) ||
      html.match(/<astro-island[^>]+props=(["'])([\s\S]*?)\1/i);

    if (!islandMatch || !islandMatch[2]) {
      return null;
    }

    let parsedRaw: any;
    try {
      const decodedJson = islandMatch[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      parsedRaw = JSON.parse(decodedJson);
    } catch (e) {
      console.warn('[AsuraConnector] Failed parsing astro props JSON', e);
      return null;
    }

    const unwrapped: Record<string, any> = {};
    for (const [k, v] of Object.entries(parsedRaw)) {
      unwrapped[k] = this.unwrapAstroProp(v);
    }

    if (unwrapped.isLocked === true || unwrapped.isPremium === true) {
      throw new Error('This chapter is locked or premium on Asura Scans and cannot be retrieved without authentication.');
    }

    const pagesList: any[] = Array.isArray(unwrapped.pages) ? unwrapped.pages : [];
    if (pagesList.length === 0) {
      return null;
    }

    const seriesTitle = unwrapped.seriesName || this.slugToTitle(info.seriesSlug || '');
    const chapterNumber = unwrapped.chapterNumber !== undefined ? String(unwrapped.chapterNumber) : info.chapterSlug;
    const chapterTitle = unwrapped.chapterTitle || undefined;

    const seenUrls = new Set<string>();
    const pages: ChapterPage[] = [];

    for (let i = 0; i < pagesList.length; i++) {
      const p = pagesList[i];
      const rawUrl = typeof p === 'string' ? p : p?.url;
      if (!rawUrl || typeof rawUrl !== 'string') continue;

      const fullUrl = this.resolveUrl(rawUrl, info.normalizedUrl);
      if (seenUrls.has(fullUrl)) continue;
      seenUrls.add(fullUrl);

      const originalIndex = pages.length + 1;
      const id = `asura-${info.sourceChapterId}-${originalIndex}`;
      const ext = this.extractExtension(fullUrl);
      let mimeType = 'image/webp';
      if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
      else if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'avif') mimeType = 'image/avif';

      pages.push({
        id,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType,
        extension: ext,
        sizeBytes: 0,
        imageUrl: fullUrl,
        downloadStatus: 'pending',
      });
    }

    if (pages.length === 0) {
      return null;
    }

    const metadata: ChapterMetadata = {
      source: 'asura',
      sourceChapterId: info.sourceChapterId,
      seriesTitle,
      chapterTitle,
      chapterNumber,
      sourceUrl: info.normalizedUrl,
      pageCount: pages.length,
    };

    return { metadata, pages };
  }

  /**
   * Strategy 2: Traditional HTML / readerarea parsing with ad/cover exclusion.
   */
  private static parseClassicDomReader(html: string, info: ResolvedSourceInfo): AsuraChapterManifest | null {
    // Extract series and chapter title from <title> or <h1>
    let seriesTitle = this.slugToTitle(info.seriesSlug || '');
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) {
      const titleText = titleMatch[1];
      const split = titleText.split(/Chapter|Ch\./i);
      if (split[0] && split[0].trim()) {
        seriesTitle = split[0].replace(/[|-].*$/, '').trim();
      }
    }

    // Look for reader container
    let container = '';
    const readerAreaMatch = html.match(/<div[^>]+id=["']readerarea["'][^>]*>([\s\S]*?)<\/div>/i);
    if (readerAreaMatch) {
      container = readerAreaMatch[1];
    } else {
      const readingContentMatch = html.match(/<div[^>]+class=["'][^"']*reading-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      if (readingContentMatch) {
        container = readingContentMatch[1];
      } else {
        container = html;
      }
    }

    // Find all img tags
    const imgMatches = [...container.matchAll(/<img([^>]+)>/gi)];
    const seenUrls = new Set<string>();
    const pages: ChapterPage[] = [];

    for (const match of imgMatches) {
      const attrs = match[1];
      // Check lazy-load attributes first
      const srcMatch =
        attrs.match(/(?:data-src|data-lazy-src|data-original)=["']([^"']+)["']/i) ||
        attrs.match(/src=["']([^"']+)["']/i);

      if (!srcMatch) continue;
      const rawUrl = srcMatch[1].trim();

      // Exclude ads, icons, banners, avatars, tracking pixels
      if (
        rawUrl.includes('/ads/') ||
        rawUrl.includes('/banners/') ||
        rawUrl.includes('logo') ||
        rawUrl.includes('avatar') ||
        rawUrl.includes('placeholder') ||
        rawUrl.endsWith('.svg') ||
        rawUrl.includes('facebook') ||
        rawUrl.includes('discord')
      ) {
        continue;
      }

      const fullUrl = this.resolveUrl(rawUrl, info.normalizedUrl);
      if (seenUrls.has(fullUrl)) continue;
      seenUrls.add(fullUrl);

      const originalIndex = pages.length + 1;
      const id = `asura-${info.sourceChapterId}-${originalIndex}`;
      const ext = this.extractExtension(fullUrl);
      let mimeType = 'image/jpeg';
      if (ext === 'webp') mimeType = 'image/webp';
      else if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'avif') mimeType = 'image/avif';

      pages.push({
        id,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType,
        extension: ext,
        sizeBytes: 0,
        imageUrl: fullUrl,
        downloadStatus: 'pending',
      });
    }

    if (pages.length === 0) {
      return null;
    }

    const metadata: ChapterMetadata = {
      source: 'asura',
      sourceChapterId: info.sourceChapterId,
      seriesTitle,
      chapterNumber: info.chapterSlug,
      sourceUrl: info.normalizedUrl,
      pageCount: pages.length,
    };

    return { metadata, pages };
  }

  /**
   * Unwraps Astro serialized props tuples [0, val] and [1, [items...]].
   */
  private static unwrapAstroProp(val: any): any {
    if (!Array.isArray(val)) return val;
    const [type, data] = val;
    if (type === 0) {
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const res: Record<string, any> = {};
        for (const [k, v] of Object.entries(data)) {
          res[k] = this.unwrapAstroProp(v);
        }
        return res;
      }
      return data;
    }
    if (type === 1 && Array.isArray(data)) {
      return data.map((item) => this.unwrapAstroProp(item));
    }
    return data;
  }

  private static resolveUrl(relativeOrAbsolute: string, base: string): string {
    try {
      return new URL(relativeOrAbsolute, base).toString();
    } catch {
      return relativeOrAbsolute;
    }
  }

  private static extractExtension(urlStr: string): string {
    try {
      const u = new URL(urlStr);
      const pathname = u.pathname;
      const ext = pathname.split('.').pop()?.toLowerCase();
      if (ext && ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'].includes(ext)) {
        return ext === 'jpeg' ? 'jpg' : ext;
      }
    } catch {
      // fallback
    }
    return 'webp';
  }

  private static slugToTitle(slug: string): string {
    return slug
      .replace(/-[a-f0-9]{8}$/i, '') // strip hash suffix like -f212c582
      .split(/[-_]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .trim();
  }
}
