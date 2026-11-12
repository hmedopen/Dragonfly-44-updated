import type { ChapterSource } from '../types';

export interface ResolvedSourceInfo {
  source: ChapterSource;
  normalizedUrl: string;
  sourceChapterId: string;
  seriesSlug?: string;
  chapterSlug?: string;
  hostname: string;
}

export class ChapterSourceResolver {
  private static readonly MANGADEX_HOSTS = new Set([
    'mangadex.org',
    'www.mangadex.org',
    'api.mangadex.org',
  ]);

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

  /**
   * Identifies the source from a user-supplied URL.
   * Throws an Error with concise user-facing message if unsupported or invalid.
   */
  public static resolve(rawUrl: string): ResolvedSourceInfo {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) {
      throw new Error('Please enter a chapter URL.');
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
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

    // Check MangaDex
    if (this.MANGADEX_HOSTS.has(host)) {
      return this.resolveMangaDex(parsed);
    }

    // Check Asura
    if (this.ASURA_HOSTS.has(host)) {
      return this.resolveAsura(parsed);
    }

    throw new Error(
      `Unsupported source "${host}". Chapter Snatch currently supports MangaDex (mangadex.org) and Asura Scans (asurascans.com).`
    );
  }

  /**
   * Fast detection of source type without throwing.
   */
  public static detectSource(rawUrl: string): ChapterSource | null {
    try {
      const res = this.resolve(rawUrl);
      return res.source;
    } catch {
      return null;
    }
  }

  private static resolveMangaDex(url: URL): ResolvedSourceInfo {
    // Expected patterns:
    // /chapter/{chapterUuid}
    // /chapter/{chapterUuid}/1
    // /title/...
    const segments = url.pathname.split('/').filter(Boolean);
    const chapterIdx = segments.indexOf('chapter');

    if (chapterIdx === -1 || !segments[chapterIdx + 1]) {
      throw new Error('Invalid MangaDex chapter URL. Expected format: https://mangadex.org/chapter/{chapterId}');
    }

    const uuidCandidate = segments[chapterIdx + 1].toLowerCase();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(uuidCandidate)) {
      throw new Error(`Invalid MangaDex chapter UUID: "${uuidCandidate}".`);
    }

    return {
      source: 'mangadex',
      normalizedUrl: `https://mangadex.org/chapter/${uuidCandidate}`,
      sourceChapterId: uuidCandidate,
      hostname: url.hostname,
    };
  }

  private static resolveAsura(url: URL): ResolvedSourceInfo {
    // Expected patterns:
    // /comics/{seriesSlug}/chapter/{chapterNumber}
    // /series/{seriesSlug}/chapter/{chapterNumber}
    // /{seriesSlug}-chapter-{chapterNumber}/
    const pathname = url.pathname.replace(/\/+$/, '');
    const segments = pathname.split('/').filter(Boolean);

    let seriesSlug: string | undefined;
    let chapterSlug: string | undefined;

    const chapterIdx = segments.indexOf('chapter');
    if (chapterIdx !== -1 && chapterIdx > 0 && segments[chapterIdx + 1]) {
      seriesSlug = segments[chapterIdx - 1];
      chapterSlug = segments[chapterIdx + 1];
    } else {
      // Check pattern: /series-name-chapter-123
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
      hostname: url.hostname,
    };
  }
}
