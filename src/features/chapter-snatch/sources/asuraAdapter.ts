import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

export class AsuraAdapter implements ChapterSourceAdapter {
  public readonly id = 'asura';
  public readonly name = 'Asura Scans';

  public readonly allowedSourceHosts = [
    'asurascans.com',
    '*.asurascans.com',
    'asuracomic.net',
    '*.asuracomic.net',
    'asuracomics.com',
    '*.asuracomics.com',
    'asuratoons.com',
    '*.asuratoons.com',
    'asura.gg',
    '*.asura.gg',
  ] as const;

  public readonly allowedImageHosts = [
    'cdn.asurascans.com',
    '*.asurascans.com',
    '*.asuracomic.net',
    '*.asuracomics.com',
  ] as const;

  public static readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  private static readonly ASURA_HOSTS = new Set([
    'asurascans.com',
    'www.asurascans.com',
    'asuracomic.net',
    'www.asuracomic.net',
    'asuracomics.com',
    'www.asuracomics.com',
    'asuratoons.com',
    'www.asuratoons.com',
    'asura.gg',
    'www.asura.gg',
  ]);

  private httpClient = new FetchHttpClient({
    defaultTimeoutMs: 15000,
    defaultMaxRetries: 3,
    defaultAllowedHosts: [...this.allowedSourceHosts],
  });

  public canHandle(url: URL | string): boolean {
    try {
      const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;
      return AsuraAdapter.ASURA_HOSTS.has(u.hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  public resolve(url: URL | string): ResolvedSourceInfo {
    const u = typeof url === 'string' ? new URL(url.startsWith('http') ? url : `https://${url}`) : url;
    const pathname = u.pathname.replace(/\/+$/, '');
    const segments = pathname.split('/').filter(Boolean);

    let seriesSlug: string | undefined;
    let chapterSlug: string | undefined;

    const chapterIdx = segments.indexOf('chapter');
    if (chapterIdx !== -1 && chapterIdx > 0 && segments[chapterIdx + 1]) {
      seriesSlug = segments[chapterIdx - 1];
      chapterSlug = segments[chapterIdx + 1];
    } else {
      const match = pathname.match(/\/([a-z0-9_-]+)-chapter-([a-z0-9_.-]+)/i);
      if (match) {
        seriesSlug = match[1];
        chapterSlug = match[2];
      }
    }

    if (!seriesSlug || !chapterSlug) {
      throw new Error(
        'Invalid Asura Scans chapter URL. Expected format: https://asurascans.com/comics/{series}/chapter/{number}'
      );
    }

    const sourceChapterId = `${seriesSlug}:${chapterSlug}`;
    const normalizedUrl = `https://asurascans.com/comics/${seriesSlug}/chapter/${chapterSlug}`;

    return {
      source: 'asura',
      normalizedUrl,
      sourceChapterId,
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
    const targetUrl = info.normalizedUrl;

    const res = await this.httpClient.fetchSafe(
      targetUrl,
      {
        headers: {
          'User-Agent': AsuraAdapter.USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

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

  public parseHtml(html: string, info: ResolvedSourceInfo): ChapterManifest {
    // Strategy 1: Modern Astro island component extraction
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

  private parseAstroReader(html: string, info: ResolvedSourceInfo): ChapterManifest | null {
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
      console.warn('[AsuraAdapter] Failed parsing astro props JSON', e);
      return null;
    }

    const unwrapped: Record<string, any> = {};
    for (const [k, v] of Object.entries(parsedRaw)) {
      unwrapped[k] = this.unwrapAstroProp(v);
    }

    if (unwrapped.isLocked === true || unwrapped.isPremium === true) {
      throw new Error('This chapter is locked or premium on Asura Scans and cannot be retrieved.');
    }

    const rawPages = Array.isArray(unwrapped.pages) ? unwrapped.pages : [];
    if (rawPages.length === 0) {
      return null;
    }

    const pages: ChapterPage[] = [];
    const seenUrls = new Set<string>();

    for (let i = 0; i < rawPages.length; i++) {
      const p = rawPages[i];
      const pageUrl = typeof p === 'string' ? p : p?.url;
      if (!pageUrl || seenUrls.has(pageUrl)) continue;
      seenUrls.add(pageUrl);

      const originalIndex = pages.length + 1;
      const ext = pageUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'webp';
      const mimeType = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp';

      pages.push({
        id: `asura-${unwrapped.chapterId || Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType,
        extension: ext,
        sizeBytes: 0,
        imageUrl: pageUrl,
        downloadStatus: 'pending',
      });
    }

    if (pages.length === 0) return null;

    return {
      metadata: {
        source: 'asura',
        sourceChapterId: String(unwrapped.chapterId || unwrapped.chapterNumber || info.chapterSlug || 'asura-ch'),
        seriesTitle: unwrapped.seriesName || (info.seriesSlug ? this.formatSlug(info.seriesSlug) : 'Asura Scans Series'),
        chapterTitle: unwrapped.chapterTitle || undefined,
        chapterNumber: unwrapped.chapterNumber !== undefined ? String(unwrapped.chapterNumber) : info.chapterSlug,
        sourceUrl: info.normalizedUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  private parseClassicDomReader(html: string, info: ResolvedSourceInfo): ChapterManifest | null {
    const readerAreaMatch =
      html.match(/<div[^>]+id=["']readerarea["'][^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]+class=["'][^"']*reading-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

    const container = readerAreaMatch ? readerAreaMatch[1] : html;
    const imgMatches = [...container.matchAll(/<img([^>]+)>/gi)];
    const pages: ChapterPage[] = [];
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
      } catch {}

      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);

      const originalIndex = pages.length + 1;
      const ext = fullUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'webp';
      pages.push({
        id: `asura-${Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp',
        extension: ext,
        sizeBytes: 0,
        imageUrl: fullUrl,
        downloadStatus: 'pending',
      });
    }

    if (pages.length === 0) return null;

    let seriesTitle = info.seriesSlug ? this.formatSlug(info.seriesSlug) : 'Asura Scans Series';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) {
      seriesTitle = titleMatch[1].split(/Chapter|Ch\./i)[0].replace(/[|-].*$/, '').trim();
    }

    return {
      metadata: {
        source: 'asura',
        sourceChapterId: info.sourceChapterId,
        seriesTitle,
        sourceUrl: info.normalizedUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  private unwrapAstroProp(val: any): any {
    if (!Array.isArray(val)) return val;
    const [type, data] = val;
    if (type === 0) {
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(data)) {
          out[k] = this.unwrapAstroProp(v);
        }
        return out;
      }
      return data;
    }
    if (type === 1 && Array.isArray(data)) {
      return data.map((item) => this.unwrapAstroProp(item));
    }
    return data;
  }

  private formatSlug(slug: string): string {
    return slug
      .split(/[-_]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  public getImageHeaders(_imageUrl: string, referer?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': AsuraAdapter.USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    if (referer) {
      headers['Referer'] = referer;
    }
    return headers;
  }
}

export const asuraAdapter = new AsuraAdapter();
