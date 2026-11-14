import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { sourceRegistry } from '../core/sourceRegistry';
import { ChapterAcquisitionManager } from '../services/acquisitionManager';
import { ChapterZipExporter } from '../services/zipExporter';
import { ChapterWorkspaceImporter } from '../services/workspaceImporter';
import {
  savePageBlob,
  getPageBlob,
  deletePageBlob,
} from '../../../services/db';
import { compileRawTextExtract } from '../../../lib/compileTypeR';
import type { BubbleItem, Folder } from '../../../types';
import {
  createZipFromDisk,
  cleanupAcquisition,
  validateImageBuffer,
} from '../../../../electron/chapterSnatchBackend.cjs';

// Minimal 1x1 valid PNG buffer
const SAMPLE_PNG_BYTES = new Uint8Array([
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
    delete(k: string) {
      storeMap.delete(k);
      const req: any = { result: undefined, error: null, onsuccess: null, onerror: null };
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
// SECTION 1: FULL ACQUISITION LIFECYCLE WORKFLOW
// =========================================================================

test('End-to-end acquisition workflow: Fetch -> Acquire -> Select -> ZIP export -> Workspace import', async () => {
  setupMockIndexedDb();
  const manager = new ChapterAcquisitionManager();

  // Mock global fetch to return sample PNG for images
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, _init?: any) => {
    const urlStr = String(input);
    if (urlStr.includes('/api/chapter-snatch/') || urlStr.includes('cdn')) {
      return new Response(SAMPLE_PNG_BYTES, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }
    return originalFetch(input, _init);
  };

  try {
    // 1. Resolve supported URL
    const targetUrl = 'https://www.webtoons.com/en/fantasy/tower-of-god/viewer?title_no=95&episode_no=1';
    const { adapter, info } = sourceRegistry.resolve(targetUrl);
    assert.equal(adapter.id, 'webtoons');
    assert.equal(info.sourceChapterId, '95-1');

    // 2. Fetch manifest with mock HTML
    const mockHtml = `
      <div class="header">
        <a class="subj">Tower of God</a>
        <h1 class="subj_episode">Ep. 1 - Ball</h1>
      </div>
      <div id="_imageList">
        <img data-url="https://cdn.example.com/p1.png" />
        <img data-url="https://cdn.example.com/p2.png" />
        <img data-url="https://cdn.example.com/p3.png" />
      </div>
    `;

    const manifest = (adapter as any).parseHtml(mockHtml, info);
    assert.equal(manifest.pages.length, 3);
    assert.equal(manifest.metadata.seriesTitle, 'Tower of God');
    assert.equal(manifest.metadata.chapterNumber, '1');

    // 3. Download pages with acquisition manager
    const acq = manager.getSnapshot();
    assert.equal(acq.status, 'idle');

    const downloadSignal = new AbortController().signal;
    await manager.downloadPages(manifest.pages, downloadSignal);

    const readyAcq = manager.getSnapshot();
    assert.equal(readyAcq.status, 'ready');
    assert.equal(readyAcq.completedCount, 3);
    assert.equal(readyAcq.failedCount, 0);

    // 4. Page Selection (User deselects page 2, keeping pages 1 and 3)
    const selectedPageIds = new Set([readyAcq.pages[0].id, readyAcq.pages[2].id]);
    const selectedPages = readyAcq.pages
      .filter((p) => selectedPageIds.has(p.id))
      .sort((a, b) => a.originalIndex - b.originalIndex);

    assert.equal(selectedPages.length, 2);
    assert.equal(selectedPages[0].originalIndex, 1);
    assert.equal(selectedPages[1].originalIndex, 3);

    // 5. ZIP Export Verification
    const zipName = ChapterZipExporter.buildArchiveFilename(
      manifest.metadata.seriesTitle,
      manifest.metadata.chapterNumber
    );
    assert.equal(zipName, 'Tower_of_God_Ch_1.zip');

    const zipResult = await ChapterZipExporter.exportSelectedPagesToZip(
      selectedPages,
      manager.getAllImages(),
      zipName,
      'test-acq-1'
    );
    assert.equal(zipResult.saved, true);
    assert.ok((zipResult.totalBytes || 0) > 0);

    // 6. Workspace Import Verification
    let openedChapterId: string | null = null;
    let openedFolderId: string | null = null;
    let openedPageId: string | null = null;
    let updatedFoldersState: Folder[] = [];

    const mockFolder: Folder = {
      id: 'proj-1',
      name: 'Tower of God Project',
      chapters: [],
      isDraft: false,
      badgeCount: 0,
      createdAt: Date.now(),
    };

    const importResult = await ChapterWorkspaceImporter.importPagesToWorkspace({
      selectedPages,
      imageMap: manager.getAllImages(),
      metadata: manifest.metadata,
      targetFolder: mockFolder,
      folders: [mockFolder],
      setFolders: (fn: any) => {
        updatedFoldersState = typeof fn === 'function' ? fn([mockFolder]) : fn;
      },
      openChapter: (cId, fId, pId) => {
        openedChapterId = cId;
        openedFolderId = fId || null;
        openedPageId = pId || null;
      },
    });

    assert.equal(importResult.success, true);
    assert.equal(importResult.pageCount, 2);
    assert.equal(importResult.chapterName, 'Chapter 1 — Ep. 1 - Ball');
    assert.equal(openedChapterId, importResult.chapterId);
    assert.equal(openedFolderId, 'proj-1');
    assert.ok(openedPageId);

    // Verify folder state was updated
    assert.equal(updatedFoldersState.length, 1);
    assert.equal(updatedFoldersState[0].chapters.length, 1);
    const importedChapter = updatedFoldersState[0].chapters[0];
    assert.equal(importedChapter.pages, 2);
    assert.ok(importedChapter.pageList);
    assert.equal(importedChapter.pageList.length, 2);
    assert.equal(importedChapter.pageList[0].index, 1);
    assert.equal(importedChapter.pageList[1].index, 2);
    assert.equal(importedChapter.pageList[0].scanStatus, 'unscanned');

    // 7. Verify pages persisted in IndexedDB and are retrievable by ID
    const p1Blob = await getPageBlob(importedChapter.pageList[0].id);
    assert.ok(p1Blob instanceof Blob);
    assert.equal(p1Blob.size, SAMPLE_PNG_BYTES.length);

    const p2Blob = await getPageBlob(importedChapter.pageList[1].id);
    assert.ok(p2Blob instanceof Blob);
    assert.equal(p2Blob.size, SAMPLE_PNG_BYTES.length);
  } finally {
    globalThis.fetch = originalFetch;
    manager.reset();
  }
});

// =========================================================================
// SECTION 2: DOWNSTREAM INTEGRATION & COMPATIBILITY
// =========================================================================

test('Downstream Compatibility: Imported ChapterSnatch pages work with Scan, Review, and Extract', async () => {
  setupMockIndexedDb();
  const testPageId = `page-snatch-${Date.now()}-1`;
  await deletePageBlob(testPageId);
  const blob = new Blob([SAMPLE_PNG_BYTES as any], { type: 'image/png' });
  await savePageBlob(testPageId, blob);

  // 1. Verify Scan Page / Batch Scan image retrieval
  const retrievedBlob = await getPageBlob(testPageId);
  assert.ok(retrievedBlob);
  assert.equal(retrievedBlob.size, SAMPLE_PNG_BYTES.length);

  // 2. Verify Bubble creation and Text Extraction
  const sampleBubbles: BubbleItem[] = [
    {
      id: 'b-1',
      pageId: testPageId,
      index: 1,
      box_2d: [100, 100, 250, 200],
      type: 'dialogue',
      typerPrefix: 'DIALOGUE:',
      sourceText: 'Hello from fetched chapter',
      originalSourceText: 'Hello from fetched chapter',
      translatedText: 'Bonjour du chapitre acquis',
      rawTranslatedText: 'Bonjour du chapitre acquis',
      reviewFlags: [],
    },
    {
      id: 'b-2',
      pageId: testPageId,
      index: 2,
      box_2d: [300, 120, 450, 220],
      type: 'thought',
      typerPrefix: 'THOUGHT:',
      sourceText: 'Second bubble text',
      originalSourceText: 'Second bubble text',
      translatedText: 'Deuxième bulle',
      rawTranslatedText: 'Deuxième bulle',
      reviewFlags: [],
    },
  ];

  // 3. Compile Raw Text Extract
  const extractedText = compileRawTextExtract({
    chapterName: 'Chapter 1 — Tower of God',
    pages: [{ pageIndex: 1, bubbles: sampleBubbles }],
    includePageHeaders: true,
    includeIndexTags: true,
    includePrefixTags: true,
    symbolPosition: 'start',
    textDirection: 'ltr',
  });

  assert.ok(extractedText.includes('CHAPTER 1 — TOWER OF GOD'));
  assert.ok(extractedText.includes('Hello from fetched chapter'));
  assert.ok(extractedText.includes('Second bubble text'));
});

// =========================================================================
// SECTION 3: RELIABILITY, CANCELLATION & RESOURCE MANAGEMENT
// =========================================================================

test('ChapterAcquisitionManager handles cancellation cleanly without leaking workers', async () => {
  const manager = new ChapterAcquisitionManager();

  const mockPages = Array.from({ length: 20 }, (_, idx) => ({
    id: `page-cancel-${idx + 1}`,
    originalIndex: idx + 1,
    filename: `${String(idx + 1).padStart(3, '0')}.png`,
    mimeType: 'image/png',
    extension: 'png',
    sizeBytes: 0,
    imageUrl: `https://mock.cdn/page-${idx + 1}.png`,
    downloadStatus: 'pending' as const,
  }));

  const abortController = new AbortController();

  // Mock slow fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    await new Promise((r) => setTimeout(r, 50));
    return new Response(SAMPLE_PNG_BYTES, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  };

  try {
    const downloadPromise = manager.downloadPages(mockPages, abortController.signal);
    // Abort after small delay
    setTimeout(() => abortController.abort(), 20);

    await downloadPromise;

    const snapshot = manager.getSnapshot();
    assert.equal(snapshot.status, 'cancelled');
    // Ensure not all 20 pages were completed due to timely cancellation
    assert.ok(snapshot.completedCount < 20);
  } finally {
    globalThis.fetch = originalFetch;
    manager.reset();
  }
});

test('Disk-backed streaming ZIP export handles multi-page chapters safely', async () => {
  const tmpDir = path.join(os.tmpdir(), `folio-zip-test-${Date.now()}`);
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const pageFiles: Array<{ filename: string; filePath: string }> = [];

  for (let i = 1; i <= 5; i++) {
    const filename = `${String(i).padStart(3, '0')}.png`;
    const filePath = path.join(tmpDir, filename);
    await fs.promises.writeFile(filePath, SAMPLE_PNG_BYTES);
    pageFiles.push({ filename, filePath });
  }

  const outZipPath = path.join(tmpDir, 'output.zip');

  try {
    const totalBytes = await createZipFromDisk(pageFiles, outZipPath);
    assert.ok(totalBytes > 0);

    // Verify written ZIP file exists and has valid signature
    const zipBuffer = await fs.promises.readFile(outZipPath);
    assert.ok(zipBuffer.length > 22);

    // End of Central Directory signature: 0x06054b50
    const eocdOffset = zipBuffer.length - 22;
    const sig = zipBuffer.readUInt32LE(eocdOffset);
    assert.equal(sig, 0x06054b50);

    const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
    assert.equal(totalEntries, 5);
  } finally {
    await cleanupAcquisition(path.basename(tmpDir));
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test('Image Validator verifies real image formats and rejects invalid payloads', () => {
  // Valid PNG
  const validPng = validateImageBuffer(Buffer.from(SAMPLE_PNG_BYTES));
  assert.equal(validPng.mimeType, 'image/png');
  assert.equal(validPng.extension, 'png');

  // Valid JPEG magic bytes (FF D8 FF)
  const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const validJpeg = validateImageBuffer(jpegBuf);
  assert.equal(validJpeg.mimeType, 'image/jpeg');
  assert.equal(validJpeg.extension, 'jpg');

  // HTML / Text Error payload should throw
  const htmlBuf = Buffer.from('<!DOCTYPE html><html><body>Access Denied</body></html>');
  assert.throws(
    () => validateImageBuffer(htmlBuf),
    /Server returned HTML or text error response/
  );
});
