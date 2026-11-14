import type { ChapterSourceAdapter, ResolvedSourceInfo } from './types';
import { mangaDexAdapter } from '../sources/mangadexAdapter';
import { asuraAdapter } from '../sources/asuraAdapter';
import { webtoonsAdapter } from '../sources/webtoonsAdapter';
import {
  tonariNoYoungJumpAdapter,
  shonenJumpPlusAdapter,
  kurageBunchAdapter,
} from '../sources/gigaviewerAdapters';
import {
  kingOfShojoAdapter,
  rawkumaAdapter,
  thunderScansAdapter,
  qiScansAdapter,
  vortexScansAdapter,
  rinkoComicsAdapter,
  flameComicsAdapter,
  demonicScansAdapter,
} from '../sources/mangathemesiaAdapters';
import {
  genZToonsAdapter,
  elfToonAdapter,
  hijalaAdapter,
  kyanScansAdapter,
  nuviaToonAdapter,
  nyxScansAdapter,
  rokariComicsAdapter,
  hiveToonsAdapter,
  twMangaAdapter,
  ruManhua2Adapter,
} from '../sources/madaraAdapters';
import {
  naverWebtoonAdapter,
  kakaoPageAdapter,
  tencentComicAdapter,
  kuaikanManhuaAdapter,
  tappytoonAdapter,
  comicWalkerAdapter,
} from '../sources/restrictedSources';

export class SourceRegistry {
  private adapters = new Map<string, ChapterSourceAdapter>();

  constructor() {
    // 1. Existing working sources
    this.register(mangaDexAdapter);
    this.register(asuraAdapter);

    // 2. Dedicated Webtoons adapter
    this.register(webtoonsAdapter);

    // 3. GigaViewer family
    this.register(tonariNoYoungJumpAdapter);
    this.register(shonenJumpPlusAdapter);
    this.register(kurageBunchAdapter);

    // 4. MangaThemesia family
    this.register(kingOfShojoAdapter);
    this.register(rawkumaAdapter);
    this.register(thunderScansAdapter);
    this.register(qiScansAdapter);
    this.register(vortexScansAdapter);
    this.register(rinkoComicsAdapter);
    this.register(flameComicsAdapter);
    this.register(demonicScansAdapter);

    // 5. Madara family
    this.register(genZToonsAdapter);
    this.register(elfToonAdapter);
    this.register(hijalaAdapter);
    this.register(kyanScansAdapter);
    this.register(nuviaToonAdapter);
    this.register(nyxScansAdapter);
    this.register(rokariComicsAdapter);
    this.register(hiveToonsAdapter);
    this.register(twMangaAdapter);
    this.register(ruManhua2Adapter);

    // 6. Restricted / DRM / Auth gated platforms
    this.register(naverWebtoonAdapter);
    this.register(kakaoPageAdapter);
    this.register(tencentComicAdapter);
    this.register(kuaikanManhuaAdapter);
    this.register(tappytoonAdapter);
    this.register(comicWalkerAdapter);
  }

  public register(adapter: ChapterSourceAdapter): void {
    if (!adapter || !adapter.id) {
      throw new Error('Cannot register source adapter without a valid id.');
    }
    this.adapters.set(adapter.id.toLowerCase(), adapter);
  }

  public unregister(id: string): boolean {
    return this.adapters.delete(id.toLowerCase());
  }

  public get(id: string): ChapterSourceAdapter | undefined {
    return this.adapters.get(id.toLowerCase());
  }

  public getAll(): ChapterSourceAdapter[] {
    return Array.from(this.adapters.values());
  }

  public findSourceForUrl(rawUrl: string): ChapterSourceAdapter | null {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) return null;

    let parsed: URL;
    try {
      const urlToParse = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
      parsed = new URL(urlToParse);
    } catch {
      return null;
    }

    for (const adapter of this.adapters.values()) {
      if (adapter.canHandle(parsed)) {
        return adapter;
      }
    }
    return null;
  }

  public detectSource(rawUrl: string): string | null {
    const adapter = this.findSourceForUrl(rawUrl);
    return adapter ? adapter.id : null;
  }

  public resolve(rawUrl: string): { adapter: ChapterSourceAdapter; info: ResolvedSourceInfo } {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) {
      throw new Error('Please enter a chapter URL.');
    }

    let parsed: URL;
    try {
      const urlToParse = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
      parsed = new URL(urlToParse);
    } catch {
      throw new Error('Invalid URL format. Please provide a valid chapter web address.');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only secure HTTP(S) URLs are supported.');
    }

    const host = parsed.hostname.toLowerCase();
    if (!host || !host.includes('.')) {
      throw new Error('Invalid URL format. Please provide a valid chapter web address.');
    }

    const adapter = this.findSourceForUrl(rawUrl);
    if (!adapter) {
      throw new Error(
        `Unsupported source "${host}". Please check the URL or check Folio Script supported catalogue.`
      );
    }

    const info = adapter.resolve(parsed);
    return { adapter, info };
  }
}

export const sourceRegistry = new SourceRegistry();
