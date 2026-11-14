import type {
  ChapterSourceAdapter,
  ResolvedSourceInfo,
  ChapterManifest,
} from '../core/types';

export interface RestrictedSourceConfig {
  id: string;
  name: string;
  domains: string[];
  restrictionReason: string;
}

export class RestrictedSourceAdapter implements ChapterSourceAdapter {
  public readonly id: string;
  public readonly name: string;
  public readonly allowedSourceHosts: readonly string[];
  public readonly allowedImageHosts: readonly string[];
  public readonly restrictionReason: string;

  private supportedDomains: Set<string>;

  constructor(config: RestrictedSourceConfig) {
    this.id = config.id;
    this.name = config.name;
    this.restrictionReason = config.restrictionReason;

    this.supportedDomains = new Set(config.domains.map((d) => d.toLowerCase()));
    const hosts: string[] = [];
    for (const d of this.supportedDomains) {
      hosts.push(d, `*.${d}`);
    }
    this.allowedSourceHosts = hosts;
    this.allowedImageHosts = hosts;
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

    return {
      source: this.id,
      normalizedUrl: u.toString(),
      sourceChapterId: segments[segments.length - 1] || 'chapter',
      hostname: u.hostname,
    };
  }

  public async fetchManifest(_info: ResolvedSourceInfo): Promise<ChapterManifest> {
    throw new Error(`Access Restricted: ${this.name} (${this.restrictionReason}). Folio Script does not bypass DRM, paywalls, or account authentication gates.`);
  }

  public getImageHeaders(_imageUrl: string, _referer?: string): Record<string, string> {
    return {};
  }
}

export const naverWebtoonAdapter = new RestrictedSourceAdapter({
  id: 'naver-webtoon',
  name: 'Naver Webtoon (Korea)',
  domains: ['comic.naver.com'],
  restrictionReason: 'Requires Naver account session and Korean telecom/carrier identity age verification',
});

export const kakaoPageAdapter = new RestrictedSourceAdapter({
  id: 'kakaopage',
  name: 'KakaoPage',
  domains: ['page.kakao.com'],
  restrictionReason: 'Single-page app requiring Kakao OAuth authorization tokens and client API encryption',
});

export const tencentComicAdapter = new RestrictedSourceAdapter({
  id: 'tencent-comic',
  name: 'Tencent Comic (ac.qq.com)',
  domains: ['ac.qq.com'],
  restrictionReason: 'Requires QQ user authentication and encrypted canvas payload execution',
});

export const kuaikanManhuaAdapter = new RestrictedSourceAdapter({
  id: 'kuaikan',
  name: 'Kuaikan Manhua',
  domains: ['kuaikanmanhua.com'],
  restrictionReason: 'Requires mobile app API tokens and encrypted reader endpoints',
});

export const tappytoonAdapter = new RestrictedSourceAdapter({
  id: 'tappytoon',
  name: 'Tappytoon',
  domains: ['tappytoon.com'],
  restrictionReason: 'Commercial service with tokenized DRM image encryption and paywalled content',
});

export const comicWalkerAdapter = new RestrictedSourceAdapter({
  id: 'comic-walker',
  name: 'ComicWalker (KadoComi)',
  domains: ['comic-walker.com', 'comic-walker.jp'],
  restrictionReason: 'SpeedBinb / Kadokawa proprietary canvas viewer with scrambled image slices requiring client WebGL/canvas unscrambling',
});
