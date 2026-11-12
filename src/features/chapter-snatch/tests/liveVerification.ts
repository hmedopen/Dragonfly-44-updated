import assert from 'node:assert/strict';
import { ChapterSourceResolver } from '../services/sourceResolver.ts';
import { ChapterImageValidator } from '../services/imageValidator.ts';
import { ChapterZipExporter } from '../services/zipExporter.ts';
import { ChapterWorkspaceImporter } from '../services/workspaceImporter.ts';
import type { ChapterPage, DownloadedImageData } from '../types.ts';
import type { Folder } from '../../../types.ts';

// Setup IndexedDB mock for Node environment
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

async function runLiveVerification() {
  console.log('=== START LIVE VERIFICATION ===\n');
  setupMockIndexedDb();

  const baseUrl = 'http://127.0.0.1:5173';

  // -------------------------------------------------------------
  // TEST 1: MangaDex Live End-to-End Workflow
  // -------------------------------------------------------------
  console.log('[Test 1] MangaDex Live Workflow:');
  const mdUrl = 'https://mangadex.org/chapter/0aaf8b27-0013-4ae0-8935-91a089466874';
  const resolvedMd = ChapterSourceResolver.resolve(mdUrl);
  assert.equal(resolvedMd.source, 'mangadex');
  console.log('  1. Source resolved successfully:', resolvedMd);

  // Fetch metadata via local backend
  const mdMetaRes = await fetch(`${baseUrl}/api/chapter-snatch/metadata?url=${encodeURIComponent(mdUrl)}`);
  assert.equal(mdMetaRes.status, 200, `Expected 200, got ${mdMetaRes.status}`);
  const mdData = await mdMetaRes.json();
  assert.ok(mdData.metadata, 'Missing metadata in response');
  assert.equal(mdData.metadata.source, 'mangadex');
  assert.equal(mdData.metadata.chapterNumber, '1');
  assert.equal(mdData.metadata.pageCount, 15);
  assert.equal(mdData.pages.length, 15);
  console.log('  2. Manifest retrieved:', {
    series: mdData.metadata.seriesTitle,
    chapter: mdData.metadata.chapterNumber,
    pages: mdData.pages.length,
  });

  // Download page 1 and page 2 images
  const samplePages: ChapterPage[] = mdData.pages.slice(0, 2);
  const imageMap = new Map<string, DownloadedImageData>();

  for (const page of samplePages) {
    console.log(`  3. Downloading page ${page.originalIndex}: ${page.filename}...`);
    const pageRes = await fetch(
      `${baseUrl}/api/chapter-snatch/download-page?url=${encodeURIComponent(page.imageUrl)}`
    );
    assert.equal(pageRes.status, 200, `Failed to download page: ${pageRes.status}`);
    const pageJson = await pageRes.json();
    assert.ok(pageJson.dataBase64, 'Missing base64 data');

    const bytes = ChapterZipExporter.base64ToUint8Array(pageJson.dataBase64);
    assert.ok(bytes.length > 50000, `Image bytes too small: ${bytes.length}`);

    // Validate image integrity & magic bytes
    const val = ChapterImageValidator.validateImageBytes(bytes, pageJson.mimeType);
    assert.equal(val.isValid, true, `Image validation failed: ${val.error}`);
    assert.equal(val.mimeType, 'image/png');
    console.log(`     Validated: ${val.mimeType}, size: ${bytes.length} bytes`);

    imageMap.set(page.id, {
      data: bytes,
      mimeType: val.mimeType!,
      extension: val.extension!,
      sizeBytes: bytes.length,
    });
  }

  // 4. Test ZIP Export
  console.log('  4. Testing ZIP export for MangaDex selected pages...');
  const zipFilename = ChapterZipExporter.buildArchiveFilename(
    mdData.metadata.seriesTitle,
    mdData.metadata.chapterNumber
  );
  assert.ok(zipFilename.includes('Boku_wa_Ohime-sama_ni_Narenai_Ch_1.zip'));

  const zipEntries = samplePages.map((p, i) => ({
    filename: `${String(i + 1).padStart(3, '0')}.${imageMap.get(p.id)!.extension}`,
    data: imageMap.get(p.id)!.data,
  }));
  const zipBytes = ChapterZipExporter.createZip(zipEntries);
  assert.ok(zipBytes.length > 100000);
  // Verify standard ZIP EOCD header
  ChapterZipExporter.verifyArchive(zipBytes, 2);
  console.log(`     ZIP created and verified: ${zipFilename} (${zipBytes.length} bytes)`);

  // 5. Test Workspace Import
  console.log('  5. Testing Workspace Import for MangaDex selected pages...');
  const targetFolder: Folder = {
    id: 'folder-live-test',
    name: 'Live MangaDex Test Project',
    badgeCount: 0,
    chapters: [],
    createdAt: Date.now(),
  };

  let foldersList: Folder[] = [targetFolder];
  const setFolders = (action: any) => {
    foldersList = typeof action === 'function' ? action(foldersList) : action;
  };
  let openedChapterId: string | null = null;
  const openChapter = (chId: string) => {
    openedChapterId = chId;
  };

  const importResult = await ChapterWorkspaceImporter.importPagesToWorkspace({
    selectedPages: samplePages,
    imageMap,
    metadata: mdData.metadata,
    targetFolder,
    folders: foldersList,
    setFolders,
    openChapter,
  });

  assert.equal(importResult.success, true);
  assert.equal(importResult.pageCount, 2);
  const updatedFolder = foldersList.find((f) => f.id === 'folder-live-test')!;
  assert.equal(updatedFolder.chapters.length, 1);
  const importedChapter = updatedFolder.chapters[0];
  assert.equal(importedChapter.pages, 2);
  assert.equal(importedChapter.pageList?.length, 2);
  assert.equal(openedChapterId, importedChapter.id);
  console.log(`     Workspace import succeeded: Chapter "${importedChapter.name}" created with ${importedChapter.pages} pages.`);
  console.log('  -> MangaDex Live Workflow PASSED!\n');

  // -------------------------------------------------------------
  // TEST 2: Asura Scans Live Workflow
  // -------------------------------------------------------------
  console.log('[Test 2] Asura Scans Live Workflow:');
  const asuraUrl = 'https://asurascans.com/comics/what-a-bountiful-harvest-demon-lord-f212c582/chapter/90';
  const resolvedAsura = ChapterSourceResolver.resolve(asuraUrl);
  assert.equal(resolvedAsura.source, 'asura');
  console.log('  1. Source resolved successfully:', resolvedAsura);

  // Fetch metadata via local backend
  const asuraMetaRes = await fetch(`${baseUrl}/api/chapter-snatch/metadata?url=${encodeURIComponent(asuraUrl)}`);
  assert.equal(asuraMetaRes.status, 200, `Expected 200, got ${asuraMetaRes.status}`);
  const asuraData = await asuraMetaRes.json();
  assert.ok(asuraData.metadata, 'Missing metadata in response');
  assert.equal(asuraData.metadata.source, 'asura');
  assert.equal(asuraData.metadata.chapterNumber, '90');
  assert.ok(asuraData.pages.length > 10, 'Expected > 10 pages for Asura chapter');
  console.log('  2. Manifest retrieved:', {
    series: asuraData.metadata.seriesTitle,
    chapter: asuraData.metadata.chapterNumber,
    pages: asuraData.pages.length,
  });

  // Download page 1
  const asuraSamplePage = asuraData.pages[0];
  console.log(`  3. Downloading page 1: ${asuraSamplePage.imageUrl}...`);
  const asuraPageRes = await fetch(
    `${baseUrl}/api/chapter-snatch/download-page?url=${encodeURIComponent(asuraSamplePage.imageUrl)}&referer=${encodeURIComponent(asuraUrl)}`
  );
  assert.equal(asuraPageRes.status, 200, `Failed to download Asura page: ${asuraPageRes.status}`);
  const asuraPageJson = await asuraPageRes.json();
  assert.ok(asuraPageJson.dataBase64, 'Missing base64 data');

  const asuraBytes = ChapterZipExporter.base64ToUint8Array(asuraPageJson.dataBase64);
  assert.ok(asuraBytes.length > 10000, `Image bytes too small: ${asuraBytes.length}`);

  const asuraVal = ChapterImageValidator.validateImageBytes(asuraBytes, asuraPageJson.mimeType);
  assert.equal(asuraVal.isValid, true, `Image validation failed: ${asuraVal.error}`);
  assert.equal(asuraVal.mimeType, 'image/webp');
  console.log(`     Validated: ${asuraVal.mimeType}, size: ${asuraBytes.length} bytes`);
  console.log('  -> Asura Scans Live Workflow PASSED!\n');

  console.log('=== ALL LIVE VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
}

runLiveVerification().catch((err) => {
  console.error('LIVE VERIFICATION FAILED:', err);
  process.exit(1);
});
