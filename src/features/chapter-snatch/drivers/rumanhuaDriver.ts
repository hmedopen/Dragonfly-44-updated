import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
  ChapterPage,
} from '../core/types';
import { FetchHttpClient } from '../core/httpClient';

export class RuManhuaDriver implements ChapterSourceAdapter {
  public readonly id = 'rumanhua2';
  public readonly name = 'RuManhua';
  public readonly domain = 'rumanhua2.com';
  public readonly allowedSourceHosts = [
    'rumanhua2.com',
    '*.rumanhua2.com',
    'www.rumanhua2.com',
    'rumanhua.com',
    '*.rumanhua.com',
    'www.rumanhua.com',
  ];
  public readonly allowedImageHosts = [
    'p9-zhuxiaobang-sign.shimolife.com',
    'p3-zhuxiaobang-sign.shimolife.com',
    '*.shimolife.com',
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
      return u.hostname.toLowerCase().includes('rumanhua');
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
      normalizedUrl: `http://${u.hostname}${pathname}`,
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
          Referer: `http://${info.hostname}/`,
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );

    if (!res.ok) throw new Error(`RuManhua responded with HTTP ${res.status}.`);
    const html = await res.text();

    const packed = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?<\/script>/i)?.[0];
    if (!packed) throw new Error('Could not find packed script in RuManhua.');
    const unpackedCall = packed
      .replace('<script>', '')
      .replace('</script>', '')
      .replace(/eval\s*\(/, 'return (');
    const getC0rst = new Function(unpackedCall);
    const unpackedScript = getC0rst();

    const dataId = html.match(/class=["'][^"']*readerContainer[^"']*["'][^>]*data-id=["'](\d+)["']/i)?.[1] || '0';

    const all2Res = await this.httpClient.fetchSafe(
      `http://${info.hostname}/static/js/all2.js?v=2.3`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: info.normalizedUrl,
        },
        signal,
        allowedHosts: [...this.allowedSourceHosts],
      },
      fetchFn
    );
    const all2Js = await all2Res.text();

    // Isolated sandbox execution
    const sandbox: any = {
      console,
      window: {},
      document: {
        getElementById: () => ({ appendChild: () => {} }),
        createElement: () => ({ setAttribute: () => {}, style: {} }),
        querySelectorAll: () => [],
      },
      location: { href: info.normalizedUrl },
    };
    sandbox.$ = function (arg: any) {
      if (typeof arg === 'function') {
        arg();
        return;
      }
      return {
        data: (k: string) => (k === 'id' ? parseInt(dataId, 10) : undefined),
        html: () => {},
        append: () => {},
        on: () => {},
      };
    };
    sandbox.jQuery = sandbox.$;
    sandbox.window = sandbox;

    let pageUrls: string[] = [];
    if (typeof require !== 'undefined') {
      const vm = require('vm');
      vm.createContext(sandbox);
      vm.runInContext(unpackedScript, sandbox);
      const modifiedAll2 = all2Js.replace(
        'var _0x409eb8=JSON',
        'globalThis.PARSED = JSON.parse(_0x2eb701); var _0x409eb8=JSON'
      );
      vm.runInContext(modifiedAll2, sandbox);
      pageUrls = sandbox.PARSED || [];
    } else {
      const fn = new Function('sandbox', `with(sandbox) { ${unpackedScript}; ${all2Js.replace('var _0x409eb8=JSON', 'sandbox.PARSED = JSON.parse(_0x2eb701); var _0x409eb8=JSON')} }`);
      fn(sandbox);
      pageUrls = sandbox.PARSED || [];
    }

    if (!Array.isArray(pageUrls) || pageUrls.length === 0) {
      throw new Error('Failed to decrypt RuManhua pages.');
    }

    let seriesTitle = 'RuManhua Series';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) seriesTitle = titleMatch[1].split(/[-–—_|]/)[0].trim() || seriesTitle;

    const pages: ChapterPage[] = pageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'jpeg';
      return {
        id: `ruman-${info.sourceChapterId}-${originalIndex}`,
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
      Referer: referer || 'http://www.rumanhua2.com/',
    };
  }
}

export const ruManhua2Adapter = new RuManhuaDriver();
