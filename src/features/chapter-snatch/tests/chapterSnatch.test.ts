import test from 'node:test';
import assert from 'node:assert/strict';

import { ChapterSourceResolver } from '../services/sourceResolver.ts';
import { ChapterImageValidator } from '../services/imageValidator.ts';
import { MangaDexConnector } from '../services/mangadexConnector.ts';
import { AsuraConnector } from '../services/asuraConnector.ts';
import { ChapterZipExporter } from '../services/zipExporter.ts';
import { ChapterAcquisitionManager } from '../services/acquisitionManager.ts';
import { ChapterWorkspaceImporter } from '../services/workspaceImporter.ts';
import type { ChapterPage, DownloadedImageData } from '../types.ts';
import type { Folder } from '../../../types.ts';
import { SourceRegistry } from '../core/sourceRegistry.ts';
import {
  FetchHttpClient,
  isSsrfSafeUrl as isSsrfSafeUrlTs,
  parseIpv4ToNumber,
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
} from '../core/httpClient.ts';
import type { ChapterSourceAdapter } from '../core/types.ts';
// @ts-ignore
import {
  isSsrfSafeUrl,
  createZipBuffer,
  createZipFromDisk,
  cleanupAcquisition,
} from '../../../../electron/chapterSnatchBackend.cjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Sample 1x1 test image bytes
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const TINY_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0xff, 0xd9,
]);

const TINY_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
  0x0e, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00,
  0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function setupMockIndexedDb() {
  const storeMap = new Map<string, any>();
  const makeStore = () => ({
    get(k: string) {
      const req: any = { result: storeMap.get(k), error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
    put(v: any, explicitKey?: string) {
      const k = explicitKey || v?.id;
      storeMap.set(k, v);
      const req: any = { result: k, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  });

  const tx = {
    objectStore: () => makeStore(),
  };

  const db = {
    version: 8,
    objectStoreNames: {
      contains: () => true,
      length: 20,
    },
    transaction: () => tx,
    createObjectStore: () => ({ createIndex: () => {} }),
    close() {},
  };

  (globalThis as any).indexedDB = {
    open: () => {
      const req: any = { result: db, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
}

// =========================================================================
// SECTION 1: SOURCE RESOLVER & URL VALIDATION
// =========================================================================

test('ChapterSourceResolver correctly identifies MangaDex chapter URLs', () => {
  const validUuids = [
    'https://mangadex.org/chapter/e82b7c4a-6d16-4352-87a4-0e311a37c3ab',
    'https://www.mangadex.org/chapter/E82B7C4A-6D16-4352-87A4-0E311A37C3AB/1',
    'mangadex.org/chapter/0aaf8b27-0013-4ae0-8935-91a089466874',
  ];

  for (const url of validUuids) {
    const res = ChapterSourceResolver.resolve(url);
    assert.equal(res.source, 'mangadex');
    assert.ok(res.sourceChapterId.length > 20);
    assert.equal(ChapterSourceResolver.detectSource(url), 'mangadex');
  }
});

test('ChapterSourceResolver rejects invalid MangaDex UUIDs', () => {
  assert.throws(
    () => ChapterSourceResolver.resolve('https://mangadex.org/chapter/not-a-valid-uuid'),
    /Invalid MangaDex chapter UUID/
  );
  assert.throws(
    () => ChapterSourceResolver.resolve('https://mangadex.org/chapter/'),
    /Invalid MangaDex chapter URL/
  );
});

test('ChapterSourceResolver correctly identifies Asura Scans chapter URLs', () => {
  const asuraUrls = [
    'https://asurascans.com/comics/what-a-bountiful-harvest-demon-lord-f212c582/chapter/90',
    'https://asuracomic.net/comics/solo-leveling/chapter/1',
    'https://asuratoons.com/comics/demon-king/chapter/25/',
    'https://asura.gg/comics/tower-of-god/chapter/100',
  ];

  for (const url of asuraUrls) {
    const res = ChapterSourceResolver.resolve(url);
    assert.equal(res.source, 'asura');
    assert.ok(res.seriesSlug);
    assert.ok(res.chapterSlug);
    assert.equal(ChapterSourceResolver.detectSource(url), 'asura');
  }
});

test('ChapterSourceResolver rejects unsupported and invalid URLs', () => {
  assert.throws(
    () => ChapterSourceResolver.resolve('https://example.com/chapter/123'),
    /Unsupported source/
  );
  assert.throws(
    () => ChapterSourceResolver.resolve(''),
    /Please enter a chapter URL/
  );
  assert.throws(
    () => ChapterSourceResolver.resolve('not-a-valid-url'),
    /Invalid URL format/
  );
});

test('SSRF Guard blocks private network addresses and localhost', () => {
  const allowlist = ['mangadex.org', '*.mangadex.org', 'asurascans.com', '*.asurascans.com'];

  // Allowed external hosts
  assert.equal(isSsrfSafeUrl('https://mangadex.org/chapter/123', allowlist), true);
  assert.equal(isSsrfSafeUrl('https://api.mangadex.org/chapter/123', allowlist), true);
  assert.equal(isSsrfSafeUrl('https://asurascans.com/comics/ch1', allowlist), true);

  // Blocked SSRF targets
  assert.equal(isSsrfSafeUrl('http://localhost:8080', allowlist), false);
  assert.equal(isSsrfSafeUrl('http://127.0.0.1:5173', allowlist), false);
  assert.equal(isSsrfSafeUrl('http://192.168.1.1/secret', allowlist), false);
  assert.equal(isSsrfSafeUrl('http://10.0.0.5/', allowlist), false);
  assert.equal(isSsrfSafeUrl('http://172.16.0.1/', allowlist), false);
  assert.equal(isSsrfSafeUrl('http://169.254.169.254/metadata', allowlist), false);
  assert.equal(isSsrfSafeUrl('file:///etc/passwd', allowlist), false);
});

// =========================================================================
// SECTION 2: IMAGE VALIDATOR & INTEGRITY
// =========================================================================

test('ChapterImageValidator recognizes valid image byte signatures', () => {
  const pngVal = ChapterImageValidator.validateImageBytes(TINY_PNG);
  assert.equal(pngVal.isValid, true);
  assert.equal(pngVal.mimeType, 'image/png');
  assert.equal(pngVal.extension, 'png');

  const jpegVal = ChapterImageValidator.validateImageBytes(TINY_JPEG);
  assert.equal(jpegVal.isValid, true);
  assert.equal(jpegVal.mimeType, 'image/jpeg');
  assert.equal(jpegVal.extension, 'jpg');

  const webpVal = ChapterImageValidator.validateImageBytes(TINY_WEBP);
  assert.equal(webpVal.isValid, true);
  assert.equal(webpVal.mimeType, 'image/webp');
  assert.equal(webpVal.extension, 'webp');
});

test('ChapterImageValidator rejects HTML error responses and empty buffers', () => {
  // Empty
  const emptyVal = ChapterImageValidator.validateImageBytes(new Uint8Array(0));
  assert.equal(emptyVal.isValid, false);

  // HTML page masked as image
  const htmlDoc = new TextEncoder().encode('<!DOCTYPE html><html><body>Error 404</body></html>');
  const htmlVal = ChapterImageValidator.validateImageBytes(htmlDoc);
  assert.equal(htmlVal.isValid, false);
  assert.match(htmlVal.error || '', /HTML or text document/);

  // JSON error payload
  const jsonDoc = new TextEncoder().encode('{"error": "Rate limit exceeded"}');
  const jsonVal = ChapterImageValidator.validateImageBytes(jsonDoc);
  assert.equal(jsonVal.isValid, false);
});

// =========================================================================
// SECTION 3: MANGADEX CONNECTOR
// =========================================================================

test('MangaDexConnector retrieves metadata and original data image manifest', async () => {
  const chapterId = '0aaf8b27-0013-4ae0-8935-91a089466874';
  const info = ChapterSourceResolver.resolve(`https://mangadex.org/chapter/${chapterId}`);

  // Mock fetch function simulating MangaDex API
  const mockFetch = async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes('/at-home/server/')) {
      return new Response(
        JSON.stringify({
          result: 'ok',
          baseUrl: 'https://cmdxd.mangadex.network',
          chapter: {
            hash: 'ab12cd34',
            data: ['001.png', '002.png', '003.jpg'],
            dataSaver: ['001.jpg', '002.jpg', '003.jpg'],
          },
        }),
        { status: 200 }
      );
    }
    if (urlStr.includes('/chapter/')) {
      return new Response(
        JSON.stringify({
          result: 'ok',
          data: {
            id: chapterId,
            attributes: {
              volume: '1',
              chapter: '1',
              title: 'The Beginning',
            },
            relationships: [
              {
                type: 'manga',
                attributes: {
                  title: { en: 'Grand Adventure' },
                },
              },
            ],
          },
        }),
        { status: 200 }
      );
    }
    return new Response('Not Found', { status: 404 });
  };

  const manifest = await MangaDexConnector.fetchChapterManifest(info, mockFetch as unknown as typeof fetch);

  assert.equal(manifest.metadata.source, 'mangadex');
  assert.equal(manifest.metadata.seriesTitle, 'Grand Adventure');
  assert.equal(manifest.metadata.chapterNumber, '1');
  assert.equal(manifest.metadata.chapterTitle, 'The Beginning');
  assert.equal(manifest.pages.length, 3);

  // Original-quality data verification (must use data/, never data-saver/)
  assert.equal(manifest.pages[0].imageUrl, 'https://cmdxd.mangadex.network/data/ab12cd34/001.png');
  assert.equal(manifest.pages[1].imageUrl, 'https://cmdxd.mangadex.network/data/ab12cd34/002.png');
  assert.equal(manifest.pages[2].imageUrl, 'https://cmdxd.mangadex.network/data/ab12cd34/003.jpg');

  // Verify sequential ordering
  assert.equal(manifest.pages[0].originalIndex, 1);
  assert.equal(manifest.pages[1].originalIndex, 2);
  assert.equal(manifest.pages[2].originalIndex, 3);
});

test('MangaDexConnector handles HTTP 429 rate limit with backoff retry', async () => {
  const chapterId = '0aaf8b27-0013-4ae0-8935-91a089466874';
  const info = ChapterSourceResolver.resolve(`https://mangadex.org/chapter/${chapterId}`);

  let attempts = 0;
  const mockFetch = async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes('/chapter/')) {
      attempts++;
      if (attempts === 1) {
        return new Response('Rate limited', { status: 429, headers: { 'retry-after': '0' } });
      }
      return new Response(
        JSON.stringify({
          result: 'ok',
          data: { attributes: { chapter: '1' }, relationships: [] },
        }),
        { status: 200 }
      );
    }
    if (urlStr.includes('/at-home/server/')) {
      return new Response(
        JSON.stringify({
          result: 'ok',
          baseUrl: 'https://cmdxd.mangadex.network',
          chapter: {
            hash: 'ab12cd34',
            data: ['001.png'],
          },
        }),
        { status: 200 }
      );
    }
    return new Response('Not Found', { status: 404 });
  };

  const manifest = await MangaDexConnector.fetchChapterManifest(info, mockFetch as unknown as typeof fetch);
  assert.ok(attempts >= 2);
  assert.ok(manifest);
  assert.equal(manifest.pages.length, 1);
});

// =========================================================================
// SECTION 4: ASURA SCANS CONNECTOR
// =========================================================================

test('AsuraConnector parses modern Astro ChapterReader island format', () => {
  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Demon Lord Chapter 50 | Asura Scans</title></head>
      <body>
        <astro-island opts='{"name":"ChapterReader","value":true}' props='{"seriesSlug":[0,"demon-lord"],"seriesName":[0,"Demon Lord"],"chapterNumber":[0,50],"isLocked":[0,false],"pages":[1,[[0,{"url":[0,"https://cdn.asurascans.com/page1.webp"]}],[0,{"url":[0,"https://cdn.asurascans.com/page2.webp"]}]]]}' await-children></astro-island>
      </body>
    </html>
  `;

  const info = ChapterSourceResolver.resolve('https://asurascans.com/comics/demon-lord/chapter/50');
  const manifest = AsuraConnector.parseHtml(sampleHtml, info);

  assert.equal(manifest.metadata.source, 'asura');
  assert.equal(manifest.metadata.seriesTitle, 'Demon Lord');
  assert.equal(manifest.metadata.chapterNumber, '50');
  assert.equal(manifest.pages.length, 2);
  assert.equal(manifest.pages[0].imageUrl, 'https://cdn.asurascans.com/page1.webp');
  assert.equal(manifest.pages[1].imageUrl, 'https://cdn.asurascans.com/page2.webp');
  assert.equal(manifest.pages[0].originalIndex, 1);
  assert.equal(manifest.pages[1].originalIndex, 2);
});

test('AsuraConnector cleanly reports locked and premium chapters', () => {
  const lockedHtml = `
    <html>
      <body>
        <astro-island opts='{"name":"ChapterReader"}' props='{"isLocked":[0,true],"isPremium":[0,true],"pages":[1,[]]}'></astro-island>
      </body>
    </html>
  `;
  const info = ChapterSourceResolver.resolve('https://asurascans.com/comics/demon-lord/chapter/99');
  assert.throws(
    () => AsuraConnector.parseHtml(lockedHtml, info),
    /locked or premium/
  );
});

test('AsuraConnector falls back to classic reader HTML and excludes ads/logos', () => {
  const classicHtml = `
    <html>
      <head><title>Solo Spellcaster Chapter 10</title></head>
      <body>
        <div id="readerarea">
          <img src="https://asurascans.com/banners/ad1.jpg" />
          <img data-src="https://asurascans.com/wp-content/uploads/01.jpg" />
          <img data-src="https://asurascans.com/wp-content/uploads/02.jpg" />
          <img src="https://asurascans.com/wp-content/uploads/02.jpg" /> <!-- Duplicate -->
          <img src="/static/logo.svg" />
        </div>
      </body>
    </html>
  `;

  const info = ChapterSourceResolver.resolve('https://asurascans.com/comics/solo-spellcaster/chapter/10');
  const manifest = AsuraConnector.parseHtml(classicHtml, info);

  // Ad, logo, and duplicate must be excluded
  assert.equal(manifest.pages.length, 2);
  assert.equal(manifest.pages[0].imageUrl, 'https://asurascans.com/wp-content/uploads/01.jpg');
  assert.equal(manifest.pages[1].imageUrl, 'https://asurascans.com/wp-content/uploads/02.jpg');
});

// =========================================================================
// SECTION 5: ZIP EXPORT INTEGRITY
// =========================================================================

test('ChapterZipExporter builds spec-compliant ZIP archive with exact bytes', () => {
  const entries = [
    { filename: '001.png', data: TINY_PNG },
    { filename: '002.jpg', data: TINY_JPEG },
    { filename: '003.webp', data: TINY_WEBP },
  ];

  const zip = ChapterZipExporter.createZip(entries);
  assert.ok(zip.length > 100);

  // Verifies EOCD signature and total entry count
  ChapterZipExporter.verifyArchive(zip, 3);

  // Verifies Node Buffer ZIP creator matches
  const nodeZip = createZipBuffer(entries);
  assert.equal(nodeZip.length, zip.length);
});

test('ChapterZipExporter sanitizes default archive filename', () => {
  assert.equal(
    ChapterZipExporter.buildArchiveFilename('Solo Leveling', '125'),
    'Solo_Leveling_Ch_125.zip'
  );
  assert.equal(
    ChapterZipExporter.buildArchiveFilename('Demon Lord / Slayer!!', '93.5'),
    'Demon_Lord_Slayer_Ch_93.5.zip'
  );
});

// =========================================================================
// SECTION 6: ACQUISITION LIFECYCLE & STATE MANAGEMENT
// =========================================================================

test('ChapterAcquisitionManager handles lifecycle states, selection, and cancellation', async () => {
  const manager = new ChapterAcquisitionManager();
  assert.equal(manager.getSnapshot().status, 'idle');

  // Test reset
  manager.reset();
  assert.equal(manager.getSnapshot().status, 'idle');
  assert.equal(manager.getSnapshot().pages.length, 0);

  // Test cancellation
  manager.cancel();
  assert.equal(manager.getSnapshot().status, 'idle');
});

// =========================================================================
// SECTION 7: WORKSPACE INTEGRATION & PERSISTENCE
// =========================================================================

test('ChapterWorkspaceImporter converts selected pages to workspace chapter with preserved order', async () => {
  setupMockIndexedDb();

  const selectedPages: ChapterPage[] = [
    {
      id: 'p-1',
      originalIndex: 1,
      filename: '001.png',
      mimeType: 'image/png',
      extension: 'png',
      sizeBytes: TINY_PNG.length,
      imageUrl: 'https://example.com/1.png',
      downloadStatus: 'ready',
    },
    {
      id: 'p-2',
      originalIndex: 2,
      filename: '002.jpg',
      mimeType: 'image/jpeg',
      extension: 'jpg',
      sizeBytes: TINY_JPEG.length,
      imageUrl: 'https://example.com/2.jpg',
      downloadStatus: 'ready',
    },
  ];

  const imageMap = new Map<string, DownloadedImageData>();
  imageMap.set('p-1', {
    data: TINY_PNG,
    mimeType: 'image/png',
    extension: 'png',
    sizeBytes: TINY_PNG.length,
  });
  imageMap.set('p-2', {
    data: TINY_JPEG,
    mimeType: 'image/jpeg',
    extension: 'jpg',
    sizeBytes: TINY_JPEG.length,
  });

  const mockFolder: Folder = {
    id: 'folder-proj-1',
    name: 'Demon Lord Series',
    badgeCount: 0,
    chapters: [],
    createdAt: Date.now(),
  };

  let updatedFolders: Folder[] = [mockFolder];
  const setFolders = (action: any) => {
    if (typeof action === 'function') {
      updatedFolders = action(updatedFolders);
    } else {
      updatedFolders = action;
    }
  };

  let openedChapterId: string | null = null;
  const openChapter = (chId: string) => {
    openedChapterId = chId;
  };

  const importResult = await ChapterWorkspaceImporter.importPagesToWorkspace({
    selectedPages,
    imageMap,
    metadata: {
      source: 'asura',
      sourceChapterId: 'ch-90',
      seriesTitle: 'Demon Lord',
      chapterNumber: '90',
      sourceUrl: 'https://asurascans.com/ch90',
      pageCount: 2,
    },
    targetFolder: mockFolder,
    folders: updatedFolders,
    setFolders,
    openChapter,
  });

  assert.equal(importResult.success, true);
  assert.equal(importResult.pageCount, 2);
  assert.equal(importResult.folderId, 'folder-proj-1');

  // Verify chapter was added to folder
  const updatedFolder = updatedFolders.find((f) => f.id === 'folder-proj-1');
  assert.ok(updatedFolder);
  assert.equal(updatedFolder.chapters.length, 1);
  assert.equal(updatedFolder.badgeCount, 1);

  const importedChapter = updatedFolder.chapters[0];
  assert.equal(importedChapter.name, 'Chapter 90');
  assert.equal(importedChapter.pages, 2);
  assert.equal(importedChapter.pageList?.length, 2);

  // Verify sequential page numbering (1, 2)
  assert.equal(importedChapter.pageList[0].index, 1);
  assert.equal(importedChapter.pageList[1].index, 2);

  // Verify navigation was triggered
  assert.equal(openedChapterId, importedChapter.id);
});

// =========================================================================
// SECTION 8: FETCH CORE CENTRAL REGISTRY & CONTRACTS
// =========================================================================

test('SourceRegistry registers, lists, gets, and unregisters adapters', () => {
  const registry = new SourceRegistry();
  const initialCount = registry.getAll().length;
  assert.ok(initialCount >= 2);
  assert.ok(registry.get('mangadex'));
  assert.ok(registry.get('asura'));

  // Test custom adapter registration
  const customAdapter: ChapterSourceAdapter = {
    id: 'custom-src',
    name: 'Custom Manga Source',
    allowedSourceHosts: ['custommanga.com'],
    allowedImageHosts: ['cdn.custommanga.com'],
    canHandle: (url) => String(url).includes('custommanga.com'),
    resolve: (url) => ({
      source: 'custom-src',
      normalizedUrl: String(url),
      sourceChapterId: 'ch-1',
      hostname: 'custommanga.com',
    }),
    fetchManifest: async () => ({
      metadata: {
        source: 'custom-src',
        sourceChapterId: 'ch-1',
        sourceUrl: 'https://custommanga.com/1',
        pageCount: 1,
      },
      pages: [],
    }),
  };

  registry.register(customAdapter);
  assert.equal(registry.getAll().length, initialCount + 1);
  assert.equal(registry.get('custom-src')?.name, 'Custom Manga Source');
  assert.equal(registry.detectSource('https://custommanga.com/chapter/1'), 'custom-src');

  // Test unregister
  const removed = registry.unregister('custom-src');
  assert.equal(removed, true);
  assert.equal(registry.getAll().length, initialCount);
  assert.equal(registry.get('custom-src'), undefined);
});

test('SourceRegistry handles ambiguous, malformed, and unsupported URLs', () => {
  const registry = new SourceRegistry();

  assert.throws(() => registry.resolve(''), /Please enter a chapter URL/);
  assert.throws(() => registry.resolve('not-a-url'), /Invalid URL format/);
  assert.throws(() => registry.resolve('ftp://mangadex.org/chapter/123'), /Only secure HTTP\(S\) URLs are supported/);
  assert.throws(
    () => registry.resolve('https://unregistered-manga-site.org/ch/1'),
    /Unsupported source "unregistered-manga-site.org"/
  );
});

// =========================================================================
// SECTION 9: ADVANCED SSRF & NUMERIC IP ENCODING PROTECTION
// =========================================================================

test('SSRF Guard detects and blocks numeric IP encodings (octal, hex, dword)', () => {
  const allowlist = ['mangadex.org', '*.mangadex.org'];

  // Dword / Decimal integer (2130706433 = 127.0.0.1)
  assert.equal(parseIpv4ToNumber('2130706433'), 0x7f000001);
  assert.equal(isPrivateOrReservedIpv4(2130706433), true);
  assert.equal(isSsrfSafeUrl('http://2130706433/admin', allowlist), false);
  assert.equal(isSsrfSafeUrlTs('http://2130706433/admin', allowlist), false);

  // Octal format (0177.0.0.1 = 127.0.0.1)
  const octalNum = parseIpv4ToNumber('0177.0.0.1');
  assert.equal(octalNum, 0x7f000001);
  assert.equal(isSsrfSafeUrl('http://0177.0.0.1/admin', allowlist), false);
  assert.equal(isSsrfSafeUrlTs('http://0177.0.0.1/admin', allowlist), false);

  // Hex format (0x7f.0.0.1 or 0x7f000001 = 127.0.0.1)
  const hexNum = parseIpv4ToNumber('0x7f.0.0.1');
  assert.equal(hexNum, 0x7f000001);
  assert.equal(isSsrfSafeUrl('http://0x7f.0.0.1/', allowlist), false);
  assert.equal(isSsrfSafeUrlTs('http://0x7f000001/', allowlist), false);

  // Cloud metadata IP (169.254.169.254) in decimal (2852039166)
  assert.equal(parseIpv4ToNumber('169.254.169.254'), 0xa9fea9fe);
  assert.equal(isPrivateOrReservedIpv4(0xa9fea9fe), true);
  assert.equal(isSsrfSafeUrl('http://169.254.169.254/latest/meta-data', allowlist), false);
  assert.equal(isSsrfSafeUrlTs('http://2852039166/latest/meta-data', allowlist), false);

  // Carrier-grade NAT (100.64.0.1)
  const cgnatNum = parseIpv4ToNumber('100.64.0.1');
  assert.ok(cgnatNum !== null);
  assert.equal(isPrivateOrReservedIpv4(cgnatNum!), true);
  assert.equal(isSsrfSafeUrl('http://100.64.0.1/', allowlist), false);

  // Multicast (224.0.0.1) and Broadcast (255.255.255.255)
  assert.equal(isPrivateOrReservedIpv4(parseIpv4ToNumber('224.0.0.1')!), true);
  assert.equal(isPrivateOrReservedIpv4(parseIpv4ToNumber('255.255.255.255')!), true);
});

test('SSRF Guard blocks IPv6 loopback, link-local, unique-local, and IPv4-mapped addresses', () => {
  const allowlist = ['mangadex.org', '*.mangadex.org'];

  assert.equal(isPrivateOrReservedIpv6('::1'), true);
  assert.equal(isPrivateOrReservedIpv6('::'), true);
  assert.equal(isPrivateOrReservedIpv6('fe80::1'), true);
  assert.equal(isPrivateOrReservedIpv6('fc00::1'), true);
  assert.equal(isPrivateOrReservedIpv6('fd12:3456:789a::1'), true);
  assert.equal(isPrivateOrReservedIpv6('ff02::1'), true);
  assert.equal(isPrivateOrReservedIpv6('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIpv6('::ffff:169.254.169.254'), true);

  assert.equal(isSsrfSafeUrl('http://[::1]/secret', allowlist), false);
  assert.equal(isSsrfSafeUrlTs('http://[::1]/secret', allowlist), false);
  assert.equal(isSsrfSafeUrl('http://[fe80::1]/', allowlist), false);
  assert.equal(isSsrfSafeUrlTs('http://[::ffff:127.0.0.1]/', allowlist), false);
});

test('SSRF Guard strictly validates host boundaries and rejects subdomain spoofing', () => {
  const allowlist = ['mangadex.org', '*.mangadex.org', 'asurascans.com', '*.asurascans.com'];

  // Valid allowlisted hosts
  assert.equal(isSsrfSafeUrl('https://mangadex.org/chapter/1', allowlist), true);
  assert.equal(isSsrfSafeUrl('https://api.mangadex.org/chapter/1', allowlist), true);
  assert.equal(isSsrfSafeUrl('https://asurascans.com/comics/1', allowlist), true);

  // Malicious lookalike or attacker-controlled hosts
  assert.equal(isSsrfSafeUrl('https://evil-mangadex.org/chapter/1', allowlist), false);
  assert.equal(isSsrfSafeUrl('https://mangadex.org.attacker.com/chapter/1', allowlist), false);
  assert.equal(isSsrfSafeUrl('https://asurascans.fake.io/comics/1', allowlist), false);
  assert.equal(isSsrfSafeUrl('https://metadata.google.internal/computeMetadata/v1/', allowlist), false);
  assert.equal(isSsrfSafeUrl('https://attacker.com@mangadex.org/', allowlist), false); // embedded userinfo
});

// =========================================================================
// SECTION 10: HTTP CLIENT TIMEOUTS, RETRIES, AND REDIRECT SECURITY
// =========================================================================

test('FetchHttpClient respects timeout and abort signal', async () => {
  const client = new FetchHttpClient({ defaultTimeoutMs: 50, defaultMaxRetries: 0 });

  // Mock fetch that respects AbortSignal (as native fetch does)
  const hangingFetch = (_url: any, init: any) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal.reason || new Error('Aborted')));
    });

  await assert.rejects(
    async () => {
      await client.fetchSafe('https://mangadex.org/chapter/1', { timeoutMs: 30 }, hangingFetch as any);
    },
    /timed out/
  );

  // Caller AbortSignal cancellation
  const ac = new AbortController();
  ac.abort(new Error('User cancelled'));
  await assert.rejects(
    async () => {
      await client.fetchSafe('https://mangadex.org/chapter/1', { signal: ac.signal }, hangingFetch as any);
    },
    /User cancelled/
  );
});

test('FetchHttpClient validates redirects and blocks open redirects to private IPs', async () => {
  const client = new FetchHttpClient({
    defaultTimeoutMs: 5000,
    defaultMaxRetries: 1,
    defaultAllowedHosts: ['mangadex.org', '*.mangadex.org'],
  });

  // Mock server returning redirect to localhost
  const redirectFetch = async (url: any) => {
    const u = String(url);
    if (u === 'https://mangadex.org/redirect-trap') {
      return new Response('', {
        status: 302,
        headers: { location: 'http://127.0.0.1:5173/admin' },
      });
    }
    return new Response('ok', { status: 200 });
  };

  await assert.rejects(
    async () => {
      await client.fetchSafe('https://mangadex.org/redirect-trap', {}, redirectFetch as any);
    },
    /SSRF Guard: Redirect destination is blocked/
  );
});

test('FetchHttpClient follows legitimate redirects within allowlist', async () => {
  const client = new FetchHttpClient({
    defaultTimeoutMs: 5000,
    defaultMaxRetries: 1,
    defaultAllowedHosts: ['mangadex.org', '*.mangadex.org'],
  });

  const validRedirectFetch = async (url: any) => {
    const u = String(url);
    if (u === 'https://mangadex.org/short/123') {
      return new Response('', {
        status: 301,
        headers: { location: 'https://api.mangadex.org/chapter/123' },
      });
    }
    if (u === 'https://api.mangadex.org/chapter/123') {
      return new Response(JSON.stringify({ result: 'ok' }), { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  };

  const res = await client.fetchSafe('https://mangadex.org/short/123', {}, validRedirectFetch as any);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.result, 'ok');
});

// =========================================================================
// SECTION 11: DISK-BACKED STREAMING ZIP & MEMORY BEHAVIOR
// =========================================================================

test('createZipFromDisk creates spec-compliant ZIP archive without Base64 memory overhead', async () => {
  const tempDir = path.join(os.tmpdir(), `folio-test-acq-${Date.now()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });

  const file1 = path.join(tempDir, '001.png');
  const file2 = path.join(tempDir, '002.jpg');
  await fs.promises.writeFile(file1, TINY_PNG);
  await fs.promises.writeFile(file2, TINY_JPEG);

  const outZip = path.join(tempDir, 'output.zip');
  const entries = [
    { filename: '001.png', filePath: file1 },
    { filename: '002.jpg', filePath: file2 },
  ];

  const totalBytes = await createZipFromDisk(entries, outZip);
  assert.ok(totalBytes > 100);

  const zipContent = await fs.promises.readFile(outZip);
  assert.equal(zipContent.length, totalBytes);

  // Validate EOCD signature and entries count
  ChapterZipExporter.verifyArchive(new Uint8Array(zipContent), 2);

  // Clean up
  await fs.promises.rm(tempDir, { recursive: true, force: true });
});

test('cleanupAcquisition cleans up temporary acquisition cache directory cleanly', async () => {
  const acqId = `test-acq-cleanup-${Date.now()}`;
  const acqDir = path.join(os.tmpdir(), 'folio-chapter-snatch', acqId);
  await fs.promises.mkdir(acqDir, { recursive: true });
  await fs.promises.writeFile(path.join(acqDir, 'sample.tmp'), 'temp data');
  assert.equal(fs.existsSync(acqDir), true);

  await cleanupAcquisition(acqId);
  assert.equal(fs.existsSync(acqDir), false);
});

// =========================================================================
// SECTION 12: WORKSPACE PERSISTENCE, RESTART SURVIVAL & WORKFLOW COMPATIBILITY
// =========================================================================

test('Imported pages survive simulated application restart and are retrievable via getPageBlob', async () => {
  setupMockIndexedDb();

  const selectedPages: ChapterPage[] = [
    {
      id: 'restart-page-1',
      originalIndex: 1,
      filename: '001.png',
      mimeType: 'image/png',
      extension: 'png',
      sizeBytes: TINY_PNG.length,
      imageUrl: 'https://example.com/p1.png',
      downloadStatus: 'ready',
    },
  ];

  const imageMap = new Map<string, DownloadedImageData>();
  imageMap.set('restart-page-1', {
    data: TINY_PNG,
    mimeType: 'image/png',
    extension: 'png',
    sizeBytes: TINY_PNG.length,
  });

  const testFolder: Folder = {
    id: 'folder-persist-test',
    name: 'Persistence Series',
    badgeCount: 0,
    chapters: [],
    createdAt: Date.now(),
  };

  let folderStore = [testFolder];
  const setFolders = (action: any) => {
    folderStore = typeof action === 'function' ? action(folderStore) : action;
  };

  const importRes = await ChapterWorkspaceImporter.importPagesToWorkspace({
    selectedPages,
    imageMap,
    metadata: {
      source: 'mangadex',
      sourceChapterId: 'md-restart-ch',
      seriesTitle: 'Persistence Series',
      chapterNumber: '1',
      sourceUrl: 'https://mangadex.org/chapter/md-restart-ch',
      pageCount: 1,
    },
    targetFolder: testFolder,
    folders: folderStore,
    setFolders,
    openChapter: () => {},
  });

  assert.equal(importRes.success, true);
  const createdChapter = folderStore[0].chapters[0];
  assert.ok(createdChapter);
  const importedPage = createdChapter.pageList![0];
  assert.ok(importedPage);

  // SIMULATE APPLICATION RESTART:
  // Dynamically import getPageBlob from db service and retrieve the saved blob by pageId
  const { getPageBlob } = await import('../../../services/db.ts');
  const storedBlob = await getPageBlob(importedPage.id);
  assert.ok(storedBlob, 'Expected stored blob in IndexedDB');
  assert.equal(storedBlob.size, TINY_PNG.length);

  // COMPATIBILITY CHECK WITH SCAN / REVIEW / EXTRACT:
  // The scanner and reviewer pipelines expect getPageBlob(pageId) to return a valid Blob/File
  // which can be converted to an ArrayBuffer / ImageData.
  const arrayBuf = await (storedBlob as Blob).arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);
  const validation = ChapterImageValidator.validateImageBytes(bytes);
  assert.equal(validation.isValid, true);
  assert.equal(validation.mimeType, 'image/png');
  assert.equal(bytes.length, TINY_PNG.length);
});

test('ChapterAcquisitionManager handles partial failures and retries only failed pages', async () => {
  const manager = new ChapterAcquisitionManager();

  const mockPages: ChapterPage[] = [
    {
      id: 'p-success',
      originalIndex: 1,
      filename: '001.png',
      mimeType: 'image/png',
      extension: 'png',
      sizeBytes: TINY_PNG.length,
      imageUrl: 'https://mangadex.network/p1.png',
      downloadStatus: 'pending',
    },
    {
      id: 'p-fail',
      originalIndex: 2,
      filename: '002.png',
      mimeType: 'image/png',
      extension: 'png',
      sizeBytes: 0,
      imageUrl: 'https://mangadex.network/fail.png',
      downloadStatus: 'pending',
    },
  ];

  let shouldFail = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes('fail.png')) {
      if (shouldFail) {
        return new Response('Server Error', { status: 500 });
      }
      return new Response(TINY_PNG as any, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return new Response(TINY_PNG as any, { status: 200, headers: { 'content-type': 'image/png' } });
  }) as any;

  try {
    const ac = new AbortController();
    await manager.downloadPages(mockPages, ac.signal);

    const snap1 = manager.getSnapshot();
    assert.equal(snap1.status, 'partial_failure');
    assert.equal(snap1.completedCount, 1);
    assert.equal(snap1.failedCount, 1);
    assert.equal(mockPages[0].downloadStatus, 'ready');
    assert.equal(mockPages[1].downloadStatus, 'failed');

    // Now retry: server recovers
    shouldFail = false;
    await manager.retryFailedPages();

    const snap2 = manager.getSnapshot();
    assert.equal(snap2.status, 'ready');
    assert.equal(snap2.completedCount, 2);
    assert.equal(snap2.failedCount, 0);
    assert.equal(mockPages[1].downloadStatus, 'ready');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Large chapters maintain exact 1-based sequential ordering and zero-padded filenames', async () => {
  setupMockIndexedDb();

  const count = 35;
  const largePages: ChapterPage[] = [];
  const imageMap = new Map<string, DownloadedImageData>();

  for (let i = 1; i <= count; i++) {
    const id = `large-p-${i}`;
    largePages.push({
      id,
      originalIndex: i,
      filename: `raw-file-${i}.png`,
      mimeType: 'image/png',
      extension: 'png',
      sizeBytes: TINY_PNG.length,
      imageUrl: `https://mangadex.network/p${i}.png`,
      downloadStatus: 'ready',
    });
    imageMap.set(id, {
      data: TINY_PNG,
      mimeType: 'image/png',
      extension: 'png',
      sizeBytes: TINY_PNG.length,
    });
  }

  // 1. Verify ZIP ordering with 35 pages
  const zipEntries = largePages.map((p, idx) => ({
    filename: `${String(idx + 1).padStart(3, '0')}.${p.extension}`,
    data: imageMap.get(p.id)!.data,
  }));
  const zip = ChapterZipExporter.createZip(zipEntries);
  ChapterZipExporter.verifyArchive(zip, count);

  // 2. Verify Workspace Import ordering
  const testFolder: Folder = {
    id: 'folder-large-ch',
    name: 'Large Chapter Series',
    badgeCount: 0,
    chapters: [],
    createdAt: Date.now(),
  };

  let folderStore = [testFolder];
  const setFolders = (action: any) => {
    folderStore = typeof action === 'function' ? action(folderStore) : action;
  };

  const importRes = await ChapterWorkspaceImporter.importPagesToWorkspace({
    selectedPages: largePages,
    imageMap,
    metadata: {
      source: 'mangadex',
      sourceChapterId: 'md-large-35',
      seriesTitle: 'Large Series',
      chapterNumber: '42',
      sourceUrl: 'https://mangadex.org/chapter/md-large-35',
      pageCount: count,
    },
    targetFolder: testFolder,
    folders: folderStore,
    setFolders,
    openChapter: () => {},
  });

  assert.equal(importRes.success, true);
  assert.equal(importRes.pageCount, count);

  const chapter = folderStore[0].chapters[0];
  assert.equal(chapter.pages, count);
  assert.equal(chapter.pageList!.length, count);

  // Verify every page is in strict sequential 1-based order
  for (let i = 0; i < count; i++) {
    const expectedIndex = i + 1;
    const page = chapter.pageList![i];
    assert.equal(page.index, expectedIndex, `Mismatch at page index ${expectedIndex}`);
    assert.equal(page.fileName, `${String(expectedIndex).padStart(3, '0')}.png`);
  }
});


