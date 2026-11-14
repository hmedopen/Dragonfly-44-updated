import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

export class ComicWorldDriver implements ChapterSourceAdapter {
  public readonly id = 'rinkocomics';
  public readonly name = 'Rinko Comics';
  public readonly domain = 'rinkocomics.com';
  public readonly allowedSourceHosts = ['rinkocomics.com', '*.rinkocomics.com'];
  public readonly allowedImageHosts = ['cdn.rinkocomics.com', 'rinkocomics.com', '*.rinkocomics.com'];

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
      return u.hostname.toLowerCase().includes('rinkocomics.com');
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
          Referer: 'https://rinkocomics.com/',
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

    if (!res.ok) throw new Error(`Rinko Comics responded with HTTP ${res.status}.`);
    const html = await res.text();
    const cwMatch = html.match(/<script[^>]+id=["']cwPages["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!cwMatch || !cwMatch[1]) throw new Error('Could not find encrypted cwPages in Rinko Comics.');

    // Decrypt XOR payload
    const rawBase64 = cwMatch[1].trim();
    let pageUrls: string[];
    if (typeof Buffer !== 'undefined') {
      const raw = Buffer.from(rawBase64, 'base64');
      const key = raw.subarray(0, 16);
      const decrypted = Buffer.alloc(raw.length - 16);
      for (let i = 0; i < decrypted.length; i++) {
        decrypted[i] = raw[16 + i] ^ key[i % 16];
      }
      pageUrls = JSON.parse(decrypted.toString('utf8'));
    } else {
      const binary = atob(rawBase64);
      const raw = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i);
      const key = raw.slice(0, 16);
      const decrypted = new Uint8Array(raw.length - 16);
      for (let i = 0; i < decrypted.length; i++) {
        decrypted[i] = raw[16 + i] ^ key[i % 16];
      }
      const decoder = new TextDecoder('utf8');
      pageUrls = JSON.parse(decoder.decode(decrypted));
    }

    if (!Array.isArray(pageUrls) || pageUrls.length === 0) {
      throw new Error('Decrypted zero pages from Rinko Comics.');
    }

    let seriesTitle = 'Rinko Comics';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) seriesTitle = titleMatch[1].split(/Chapter|Ch\./i)[0].replace(/[-–—|]/g, '').trim();

    const pages: ChapterPage[] = pageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'webp';
      return {
        id: `rinko-${info.sourceChapterId}-${originalIndex}`,
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

export const rinkoComicsAdapter = new ComicWorldDriver();
