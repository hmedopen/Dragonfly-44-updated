import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as ort from 'onnxruntime-web';
import { maskCropOutsideEllipse, maskCropOutsidePolygon } from '../ocr/lassoMask.ts';
import {
  executeManualCropOcrBatch,
  prepareManualCropRgba,
  type ManualWorkerRuntimeState,
} from '../ocr/manualOcrWorker.ts';
import {
  checkManualOcrModelReadiness,
  ManualOcrService,
} from '../ocr/manualOcrService.ts';
import type { LocalModelAssetProvider } from '../../../lib/localOcr/modelClient.ts';
import type { RgbaImageBuffer } from '../../../lib/localOcr/comicDetector.ts';
import type { BubbleItem } from '../../../types/workbench.ts';

const require = createRequire(import.meta.url);
const { createModelManager } = require('../../../../electron/modelManager.cjs');

function decodePngRgba(buf: Buffer): RgbaImageBuffer {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bpp;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const prevRow = new Uint8Array(stride);
  const currRow = new Uint8Array(stride);
  let pos = 0;

  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };

  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const val = raw[pos++];
      const a = x >= bpp ? currRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let recon = val;
      if (filter === 1) recon = (val + a) & 0xff;
      else if (filter === 2) recon = (val + b) & 0xff;
      else if (filter === 3) recon = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) recon = (val + paeth(a, b, c)) & 0xff;
      currRow[x] = recon;
    }
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      if (bpp === 4) {
        rgba[dst] = currRow[x * 4];
        rgba[dst + 1] = currRow[x * 4 + 1];
        rgba[dst + 2] = currRow[x * 4 + 2];
        rgba[dst + 3] = currRow[x * 4 + 3];
      } else if (bpp === 3) {
        rgba[dst] = currRow[x * 3];
        rgba[dst + 1] = currRow[x * 3 + 1];
        rgba[dst + 2] = currRow[x * 3 + 2];
        rgba[dst + 3] = 255;
      } else {
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = currRow[x];
        rgba[dst + 3] = 255;
      }
    }
    prevRow.set(currRow);
  }

  return { width, height, data: rgba };
}

test('Lasso mask zeroes out unrelated neighboring text outside the polygon perimeter', () => {
  // 100x100 white image with a dark neighboring artifact at top-left (10,10) and text inside polygon at center (50,50)
  const data = new Uint8ClampedArray(100 * 100 * 4).fill(255);
  for (let y = 5; y < 20; y++) {
    for (let x = 5; x < 20; x++) {
      const off = (y * 100 + x) * 4;
      data[off] = 0;
      data[off + 1] = 0;
      data[off + 2] = 0;
    }
  }
  for (let y = 45; y < 55; y++) {
    for (let x = 45; x < 55; x++) {
      const off = (y * 100 + x) * 4;
      data[off] = 10;
      data[off + 1] = 10;
      data[off + 2] = 10;
    }
  }

  const masked = maskCropOutsidePolygon(
    { width: 100, height: 100, data },
    [
      [35, 35],
      [75, 35],
      [75, 75],
      [35, 75],
    ]
  );

  // Outside pixel (10,10) must be masked to background white
  const outsideOff = (10 * 100 + 10) * 4;
  assert.equal(masked.data[outsideOff], 255);
  // Inside pixel (50,50) must stay intact
  const insideOff = (50 * 100 + 50) * 4;
  assert.equal(masked.data[insideOff], 10);

  // Bubble shape must also mask pixels outside its organic contour via prepareManualCropRgba
  const bubbleCrop = prepareManualCropRgba(
    { width: 100, height: 100, data },
    {
      regionId: 'bubble-mask-test',
      kind: 'bubble',
      box_2d: [0, 0, 800, 800],
      polygon: [
        [350, 350],
        [750, 350],
        [750, 750],
        [350, 750],
      ],
    }
  );
  const bubbleOutsideOff = (10 * bubbleCrop.cropRgba.width + 10) * 4;
  assert.equal(bubbleCrop.cropRgba.data[bubbleOutsideOff], 255, 'Bubble shape must mask exterior corner text');
});

test('Missing or blocked local OCR model reports explicit error and never falls back to Gemini or another model', async () => {
  const missingProvider: LocalModelAssetProvider = {
    getManifest: async () => ({ manifestVersion: 1, models: [] }),
    getStatus: async (modelId) => ({
      modelId: modelId || 'ppocr-v5-mobile-ko',
      state: 'not_installed',
      installedRevision: null,
      verifiedBytes: 0,
      expectedBytes: 1000,
      missingFiles: ['det/inference.onnx'],
      corruptFiles: [],
      policy: {
        developmentOnly: true,
        downloadPermitted: true,
        activationPermitted: true,
        redistributionApproved: false,
        commercialDistributionCleared: false,
        provenanceUnresolved: true,
        rejectionReason: null,
      },
    }),
    downloadModel: async () => {
      throw new Error('Offline');
    },
    cancelDownload: async () => false,
    removeModel: async () => {
      throw new Error('Not needed');
    },
    readModelAssets: async () => {
      throw new Error('Model not installed');
    },
  };

  const readiness = await checkManualOcrModelReadiness('ko', missingProvider);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.ocrModelId, 'ppocr-v5-mobile-ko');
  assert.match(readiness.error || '', /ppocr-v5-mobile-ko/);
  assert.equal(readiness.canDownload, true);
});

test('Offline manual extraction processes ONLY selected pages, preserves partial success, and never makes network/Gemini calls', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  (globalThis as any).fetch = async () => {
    fetchCalled = true;
    throw new Error('OFFLINE VIOLATION: fetch() must never be called during local OCR');
  };

  try {
    const regionPage1: BubbleItem = {
      id: 'reg-p1-1',
      pageId: 'page-1',
      chapterId: 'ch-1',
      index: 1,
      box_2d: [100, 100, 300, 400],
      type: 'speech_bubbles',
      typerPrefix: '"":',
      sourceText: '',
      originalSourceText: '',
      translatedText: '',
      rawTranslatedText: '',
      reviewFlags: [],
      provenance: 'manual_selection',
      manualSelectionShape: 'box',
      manualExtractionStatus: 'created',
      manualTranslationStatus: 'untranslated',
    };
    const regionPage3: BubbleItem = {
      id: 'reg-p3-1',
      pageId: 'page-3',
      chapterId: 'ch-1',
      index: 1,
      box_2d: [200, 200, 400, 600],
      manualPolygon: [
        [200, 200],
        [600, 200],
        [600, 400],
        [200, 400],
      ],
      type: 'outside_text',
      typerPrefix: 'OT:',
      sourceText: '',
      originalSourceText: '',
      translatedText: '',
      rawTranslatedText: '',
      reviewFlags: [],
      provenance: 'manual_selection',
      manualSelectionShape: 'bubble',
      manualExtractionStatus: 'created',
      manualTranslationStatus: 'untranslated',
    };

    const pageBlobRequested: string[] = [];
    const savedOutcomes: Array<{ pageId: string; status: string | undefined; text: string }> = [];

    const mockProvider: LocalModelAssetProvider = {
      getManifest: async () => ({ manifestVersion: 1, models: [] }),
      getStatus: async () => ({
        modelId: 'ppocr-v6-small-en',
        state: 'installed',
        installedRevision: 'testrev',
        verifiedBytes: 100,
        expectedBytes: 100,
        missingFiles: [],
        corruptFiles: [],
      }),
      downloadModel: async () => {
        throw new Error('No download');
      },
      cancelDownload: async () => false,
      removeModel: async () => {
        throw new Error('No remove');
      },
      readModelAssets: async () => ({
        modelId: 'ppocr-v6-small-en',
        revisionLabel: 'testrev',
        files: {},
      }),
    };

    const fakeWorker = {
      listeners: new Map<string, Set<(ev: any) => void>>(),
      addEventListener(type: string, fn: (ev: any) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
      },
      removeEventListener(type: string, fn: (ev: any) => void) {
        this.listeners.get(type)?.delete(fn);
      },
      postMessage(msg: any) {
        if (msg.type === 'run_manual_crops') {
          setTimeout(() => {
            const outcomes = msg.targets.map((t: any) =>
              t.regionId === 'reg-p1-1'
                ? { regionId: t.regionId, status: 'ocr_success', text: 'Offline extracted text', confidence: 0.92, lineCount: 1 }
                : { regionId: t.regionId, status: 'ocr_failed', text: '', confidence: 0, lineCount: 0, error: 'Blank region' }
            );
            for (const fn of this.listeners.get('message') || []) {
              fn({
                data: {
                  type: 'job_result',
                  jobId: msg.jobId,
                  pageId: msg.pageId,
                  sourceDimensions: { width: 800, height: 6000 },
                  outcomes,
                  loadedOcrKey: msg.ocrModelKey,
                },
              });
            }
          }, 5);
        }
      },
      terminate() {},
    };

    const svc = new ManualOcrService({
      modelProvider: mockProvider,
      createWorker: () => fakeWorker as any,
      getPageBlob: async (pid: string) => {
        pageBlobRequested.push(pid);
        return new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
      },
      getPageBubbles: async (pid: string) =>
        pid === 'page-1' ? [regionPage1] : pid === 'page-3' ? [regionPage3] : [],
    });

    const summary = await svc.extractChapterSelections({
      pages: [
        { id: 'page-1', index: 1 },
        { id: 'page-2', index: 2 },
        { id: 'page-3', index: 3 },
      ],
      language: 'en',
      onPageComplete: async (pageId, updatedBubbles) => {
        for (const b of updatedBubbles) {
          savedOutcomes.push({
            pageId,
            status: b.manualExtractionStatus,
            text: b.sourceText,
          });
        }
      },
    });

    assert.equal(fetchCalled, false, 'Zero network requests permitted');
    assert.deepEqual(pageBlobRequested, ['page-1', 'page-3'], 'Unselected page-2 must NOT be scanned');
    assert.equal(summary.succeededRegions, 1);
    assert.equal(summary.failedRegions, 1);
    assert.equal(savedOutcomes[0].text, 'Offline extracted text');
    assert.equal(savedOutcomes[1].status, 'ocr_failed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Real-model offline OCR smoke check on a long-strip page when local cache models exist', async (t) => {
  const userDataDir =
    process.env.FOLIO_OCR_CACHE_DIR || path.join(os.tmpdir(), 'folio-script-ocr-cache');
  const manager = createModelManager({ userDataDir, isProduction: false });
  const enStatus = await manager.getModelStatus('ppocr-v6-small-en');
  if (enStatus.state !== 'installed') {
    t.skip('ppocr-v6-small-en not cached in local model cache; skipping real ONNX inference test.');
    return;
  }

  // Block global fetch completely so any network call fails immediately
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any) => {
    throw new Error(`Network blocked in offline test: ${String(input)}`);
  };

  try {
    if (!(globalThis as any).location) {
      (globalThis as any).location = { protocol: 'file:' };
    } else {
      // Force ORT Web file:// adapter which requires zero network and zero HTTP server
      (globalThis as any).location = { protocol: 'file:' };
    }

    const wasmPaths =
      pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist') + path.sep).href;
    ort.env.wasm.wasmPaths = wasmPaths;

    const seed = JSON.parse(
      fs.readFileSync(path.resolve('public/seed_double_balloon_detection.json'), 'utf8')
    );
    const fixture = seed.examples[0];
    const pngBuffer = Buffer.from(fixture.imageBase64, 'base64');
    const decoded = decodePngRgba(pngBuffer);

    // Embed the fixture inside a tall 800x4800 long-strip image at y=2800 to prove long-strip crop accuracy
    const stripW = Math.max(800, decoded.width);
    const stripH = 4800;
    const stripData = new Uint8ClampedArray(stripW * stripH * 4).fill(255);
    const pasteY = 2800;
    for (let y = 0; y < decoded.height; y++) {
      const srcOff = y * decoded.width * 4;
      const dstOff = (pasteY + y) * stripW * 4;
      stripData.set(decoded.data.subarray(srcOff, srcOff + decoded.width * 4), dstOff);
    }

    const boxNorm: [number, number, number, number] = [
      (pasteY / stripH) * 1000,
      0,
      ((pasteY + decoded.height) / stripH) * 1000,
      (decoded.width / stripW) * 1000,
    ];

    const enAssets = await manager.readModelAssets('ppocr-v6-small-en');
    const state: ManualWorkerRuntimeState = { ocrKey: null, ocrAdapter: null };

    const cropCheck = prepareManualCropRgba(
      { width: stripW, height: stripH, data: stripData },
      { regionId: 'strip-box-1', kind: 'box', box_2d: boxNorm }
    );
    assert.ok(cropCheck.cropRgba.height >= decoded.height);

    const res = await executeManualCropOcrBatch(
      {
        jobId: 'offline-real-1',
        pageId: 'strip-page-1',
        imageBytes: new ArrayBuffer(8),
        mimeType: 'image/png',
        language: 'en',
        routeId: 'en_ppocrv6_small',
        ocrModelKey: `ppocr-v6-small-en@${enAssets.revisionLabel}`,
        ocrAssets: enAssets,
        wasmPaths,
        targets: [{ regionId: 'strip-box-1', kind: 'box', box_2d: boxNorm }],
      },
      state,
      () => false,
      {
        decodeImage: async () => ({ width: stripW, height: stripH, data: stripData }),
      }
    );

    assert.equal(res.sourceDimensions.height, stripH);
    assert.equal(res.outcomes.length, 1);
    assert.ok(
      res.outcomes[0].status === 'ocr_success' || res.outcomes[0].status === 'ocr_partial',
      `Expected successful offline OCR, got ${res.outcomes[0].status}: ${res.outcomes[0].error}`
    );
    assert.ok(res.outcomes[0].text.trim().length > 0, 'Extracted text must be non-empty');

    if (state.ocrAdapter) {
      await state.ocrAdapter.dispose();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Real-model offline OCR covers JA, ZH (ppocr-v6-manga-v0.3) and KO long-strip (ppocr-v5-mobile-ko)', async (t) => {
  const userDataDir =
    process.env.FOLIO_OCR_CACHE_DIR || path.join(os.tmpdir(), 'folio-script-ocr-cache');
  const validationCacheDir = path.join(os.tmpdir(), 'folio-script-validation-cache');
  const manager = createModelManager({ userDataDir, isProduction: false });

  const jaPath = path.join(validationCacheDir, 'E03P01_ja.png');
  const cnPath = path.join(validationCacheDir, 'E03P01_cn.png');
  const koPath = path.join(validationCacheDir, 'E01XXL_kr.png');

  const jaStatus = await manager.getModelStatus('ppocr-v6-manga-v0.3');
  const koStatus = await manager.getModelStatus('ppocr-v5-mobile-ko');
  if (
    jaStatus.state !== 'installed' ||
    koStatus.state !== 'installed' ||
    !fs.existsSync(jaPath) ||
    !fs.existsSync(cnPath) ||
    !fs.existsSync(koPath)
  ) {
    t.skip('Multilingual cached models or validation PNG fixtures not present on disk.');
    return;
  }

  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any) => {
    throw new Error(`Network blocked in multilingual offline test: ${String(input)}`);
  };

  try {
    (globalThis as any).location = { protocol: 'file:' };
    const wasmPaths =
      pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist') + path.sep).href;
    ort.env.wasm.wasmPaths = wasmPaths;

    const mangaAssets = await manager.readModelAssets('ppocr-v6-manga-v0.3');
    const koAssets = await manager.readModelAssets('ppocr-v5-mobile-ko');
    const state: ManualWorkerRuntimeState = { ocrKey: null, ocrAdapter: null };

    // 1. Japanese crop (e03p01_ja_r2: [614, 107, 681, 275])
    const jaImg = decodePngRgba(fs.readFileSync(jaPath));
    const jaRes = await executeManualCropOcrBatch(
      {
        jobId: 'offline-ja-1',
        pageId: 'e03p01_ja',
        imageBytes: new ArrayBuffer(4),
        mimeType: 'image/png',
        language: 'ja',
        routeId: 'ja_zh_ppocrv6_manga',
        ocrModelKey: `ppocr-v6-manga-v0.3@${mangaAssets.revisionLabel}`,
        ocrAssets: mangaAssets,
        wasmPaths,
        targets: [{ regionId: 'ja-r2', kind: 'box', box_2d: [614, 107, 681, 275] }],
      },
      state,
      () => false,
      { decodeImage: async () => jaImg }
    );
    assert.ok(
      jaRes.outcomes[0].status === 'ocr_success' || jaRes.outcomes[0].status === 'ocr_partial',
      `JA OCR failed: ${jaRes.outcomes[0].error}`
    );
    assert.match(jaRes.outcomes[0].text, /星かぼちゃ|おはよう|店主/);

    // 2. Chinese crop (e03p01_cn_r2: [628, 135, 677, 248]) — reuses cached manga adapter!
    const cnImg = decodePngRgba(fs.readFileSync(cnPath));
    const cnRes = await executeManualCropOcrBatch(
      {
        jobId: 'offline-zh-1',
        pageId: 'e03p01_cn',
        imageBytes: new ArrayBuffer(4),
        mimeType: 'image/png',
        language: 'zh',
        routeId: 'ja_zh_ppocrv6_manga',
        ocrModelKey: `ppocr-v6-manga-v0.3@${mangaAssets.revisionLabel}`,
        ocrAssets: mangaAssets,
        wasmPaths,
        targets: [{ regionId: 'cn-r2', kind: 'box', box_2d: [628, 135, 677, 248] }],
      },
      state,
      () => false,
      { decodeImage: async () => cnImg }
    );
    assert.ok(
      cnRes.outcomes[0].status === 'ocr_success' || cnRes.outcomes[0].status === 'ocr_partial',
      `ZH OCR failed: ${cnRes.outcomes[0].error}`
    );
    assert.match(cnRes.outcomes[0].text, /老板|星葫芦|八个/);

    // 3. Korean long-strip 1200x5291 crop (e01xxl_kr_r6: [480, 511, 497, 622] "안 돼! 꿈도 꾸지 마!")
    const koImg = decodePngRgba(fs.readFileSync(koPath));
    assert.ok(koImg.height > 4000, 'Expected ultra-tall webtoon strip for Korean test');
    const koRes = await executeManualCropOcrBatch(
      {
        jobId: 'offline-ko-1',
        pageId: 'e01xxl_kr',
        imageBytes: new ArrayBuffer(4),
        mimeType: 'image/png',
        language: 'ko',
        routeId: 'ko_ppocrv5_mobile',
        ocrModelKey: `ppocr-v5-mobile-ko@${koAssets.revisionLabel}`,
        ocrAssets: koAssets,
        wasmPaths,
        targets: [{ regionId: 'ko-r6', kind: 'box', box_2d: [480, 511, 497, 622] }],
      },
      state,
      () => false,
      { decodeImage: async () => koImg }
    );
    assert.ok(
      koRes.outcomes[0].status === 'ocr_success' || koRes.outcomes[0].status === 'ocr_partial',
      `KO OCR failed: ${koRes.outcomes[0].error}`
    );
    assert.match(koRes.outcomes[0].text, /꿈도|꾸지|안\s*돼/);

    if (state.ocrAdapter) {
      await state.ocrAdapter.dispose();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Real-model offline lasso OCR excludes neighboring dialogue outside polygon perimeter', async (t) => {
  const userDataDir =
    process.env.FOLIO_OCR_CACHE_DIR || path.join(os.tmpdir(), 'folio-script-ocr-cache');
  const validationCacheDir = path.join(os.tmpdir(), 'folio-script-validation-cache');
  const manager = createModelManager({ userDataDir, isProduction: false });
  const enPath = path.join(validationCacheDir, 'E03P01_en.png');
  const enStatus = await manager.getModelStatus('ppocr-v6-small-en');
  if (enStatus.state !== 'installed' || !fs.existsSync(enPath)) {
    t.skip('ppocr-v6-small-en or E03P01_en.png not present in cache.');
    return;
  }

  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any) => {
    throw new Error(`Network blocked: ${String(input)}`);
  };

  try {
    (globalThis as any).location = { protocol: 'file:' };
    const wasmPaths =
      pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist') + path.sep).href;
    ort.env.wasm.wasmPaths = wasmPaths;

    const srcImg = decodePngRgba(fs.readFileSync(enPath));
    // Compose a 600x400 white canvas holding two adjacent dialogue bubbles inside one diagonal band:
    // Top-left quadrant: e03p01_en_r3 ("Here you are, that's 60Ko.*")
    // Bottom-right quadrant: e03p01_en_r4 ("...Oh dear.")
    const compW = 600;
    const compH = 400;
    const compData = new Uint8ClampedArray(compW * compH * 4).fill(255);

    const copyCrop = (normBox: [number, number, number, number], dstX: number, dstY: number) => {
      const y0 = Math.floor((normBox[0] / 1000) * srcImg.height);
      const x0 = Math.floor((normBox[1] / 1000) * srcImg.width);
      const y1 = Math.ceil((normBox[2] / 1000) * srcImg.height);
      const x1 = Math.ceil((normBox[3] / 1000) * srcImg.width);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const sOff = (y * srcImg.width + x) * 4;
          const dOff = ((dstY + (y - y0)) * compW + (dstX + (x - x0))) * 4;
          if (dOff >= 0 && dOff + 3 < compData.length) {
            compData[dOff] = srcImg.data[sOff];
            compData[dOff + 1] = srcImg.data[sOff + 1];
            compData[dOff + 2] = srcImg.data[sOff + 2];
            compData[dOff + 3] = 255;
          }
        }
      }
    };

    // Place "Here you are, that's 60Ko.*" at (20, 20) and "...Oh dear." nearby at (240, 120)
    copyCrop([622, 447, 651, 596], 20, 20);
    copyCrop([707, 849, 720, 941], 240, 120);

    // Polygon encloses ONLY (20..220, 20..100) while bounding rect if unmasked extends down to y=180
    const lassoPoly: Array<[number, number]> = [
      [(15 / compW) * 1000, (15 / compH) * 1000],
      [(230 / compW) * 1000, (15 / compH) * 1000],
      [(230 / compW) * 1000, (105 / compH) * 1000],
      [(15 / compW) * 1000, (105 / compH) * 1000],
    ];

    const enAssets = await manager.readModelAssets('ppocr-v6-small-en');
    const state: ManualWorkerRuntimeState = { ocrKey: null, ocrAdapter: null };
    const res = await executeManualCropOcrBatch(
      {
        jobId: 'offline-lasso-exclude',
        pageId: 'comp-page',
        imageBytes: new ArrayBuffer(4),
        mimeType: 'image/png',
        language: 'en',
        routeId: 'en_ppocrv6_small',
        ocrModelKey: `ppocr-v6-small-en@${enAssets.revisionLabel}`,
        ocrAssets: enAssets,
        wasmPaths,
        targets: [
          {
            regionId: 'lasso-only-r3',
            kind: 'lasso',
            // Intentionally broad bbox overlapping the excluded bottom-right neighbor at (240, 120)
            box_2d: [(15 / compH) * 1000, (15 / compW) * 1000, (190 / compH) * 1000, (390 / compW) * 1000],
            polygon: lassoPoly,
          },
        ],
      },
      state,
      () => false,
      { decodeImage: async () => ({ width: compW, height: compH, data: compData }) }
    );

    const extracted = res.outcomes[0].text;
    assert.match(extracted, /Here you are|60Ko/i);
    assert.ok(!/dear/i.test(extracted), `Lasso leaked excluded neighbor text: "${extracted}"`);

    if (state.ocrAdapter) {
      await state.ocrAdapter.dispose();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ManualOcrService preserves manual_text edits during chapter batch and supports AbortController cancellation', async () => {
  const manualEditedBubble: BubbleItem = {
    id: 'reg-manual-1',
    pageId: 'page-1',
    chapterId: 'ch-cancel',
    index: 1,
    box_2d: [50, 50, 150, 200],
    type: 'speech_bubbles',
    typerPrefix: '"":',
    sourceText: 'Human typed text preserved',
    originalSourceText: 'Human typed text preserved',
    translatedText: '',
    rawTranslatedText: '',
    reviewFlags: [],
    provenance: 'manual_selection',
    manualSelectionShape: 'box',
    manualExtractionStatus: 'manual_text',
  };
  const pendingPage1: BubbleItem = {
    id: 'reg-p1-ocr',
    pageId: 'page-1',
    chapterId: 'ch-cancel',
    index: 2,
    box_2d: [200, 50, 300, 200],
    type: 'speech_bubbles',
    typerPrefix: '"":',
    sourceText: '',
    originalSourceText: '',
    translatedText: '',
    rawTranslatedText: '',
    reviewFlags: [],
    provenance: 'manual_selection',
    manualSelectionShape: 'bubble',
    manualExtractionStatus: 'created',
  };
  const pendingPage2: BubbleItem = {
    id: 'reg-p2-ocr',
    pageId: 'page-2',
    chapterId: 'ch-cancel',
    index: 1,
    box_2d: [100, 100, 200, 250],
    type: 'speech_bubbles',
    typerPrefix: '"":',
    sourceText: '',
    originalSourceText: '',
    translatedText: '',
    rawTranslatedText: '',
    reviewFlags: [],
    provenance: 'manual_selection',
    manualSelectionShape: 'box',
    manualExtractionStatus: 'created',
  };

  const controller = new AbortController();
  const processedTargetIds: string[] = [];

  const mockProvider: LocalModelAssetProvider = {
    getManifest: async () => ({ manifestVersion: 1, models: [] }),
    getStatus: async () => ({
      modelId: 'ppocr-v6-small-en',
      state: 'installed',
      installedRevision: 'rev1',
      verifiedBytes: 10,
      expectedBytes: 10,
      missingFiles: [],
      corruptFiles: [],
    }),
    downloadModel: async () => {
      throw new Error('No download');
    },
    cancelDownload: async () => false,
    removeModel: async () => {
      throw new Error('No remove');
    },
    readModelAssets: async () => ({ modelId: 'ppocr-v6-small-en', revisionLabel: 'rev1', files: {} }),
  };

  const fakeWorker = {
    listeners: new Map<string, Set<(ev: any) => void>>(),
    addEventListener(type: string, fn: (ev: any) => void) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (ev: any) => void) {
      this.listeners.get(type)?.delete(fn);
    },
    postMessage(msg: any) {
      if (msg.type === 'run_manual_crops') {
        for (const t of msg.targets) processedTargetIds.push(t.regionId);
        setTimeout(() => {
          for (const fn of this.listeners.get('message') || []) {
            fn({
              data: {
                type: 'job_result',
                jobId: msg.jobId,
                pageId: msg.pageId,
                sourceDimensions: { width: 800, height: 1200 },
                outcomes: msg.targets.map((t: any) => ({
                  regionId: t.regionId,
                  status: 'ocr_success',
                  text: 'Extracted page 1',
                  confidence: 0.9,
                  lineCount: 1,
                })),
                loadedOcrKey: msg.ocrModelKey,
              },
            });
          }
        }, 5);
      }
    },
    terminate() {},
  };

  const svc = new ManualOcrService({
    modelProvider: mockProvider,
    createWorker: () => fakeWorker as any,
    getPageBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    getPageBubbles: async (pid: string) =>
      pid === 'page-1' ? [manualEditedBubble, pendingPage1] : [pendingPage2],
  });

  const savedPages: BubbleItem[][] = [];
  const summary = await svc.extractChapterSelections({
    pages: [
      { id: 'page-1', index: 1 },
      { id: 'page-2', index: 2 },
    ],
    language: 'en',
    signal: controller.signal,
    onPageComplete: async (_pid, updatedBubbles) => {
      savedPages.push(updatedBubbles);
      controller.abort();
    },
  });

  assert.equal(summary.cancelled, true);
  assert.deepEqual(processedTargetIds, ['reg-p1-ocr'], 'manual_text must be preserved and page 2 cancelled');
  assert.equal(savedPages.length, 1);
  assert.equal(savedPages[0].find((b) => b.id === 'reg-manual-1')?.sourceText, 'Human typed text preserved');
  assert.equal(savedPages[0].find((b) => b.id === 'reg-p1-ocr')?.sourceText, 'Extracted page 1');

  // Verify partial page failure in Extract All preserves subsequent surviving pages
  const resSvc = new ManualOcrService({
    modelProvider: mockProvider,
    createWorker: () => fakeWorker as any,
    getPageBlob: async (pid: string) =>
      pid === 'page-fail' ? null : new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    getPageBubbles: async (pid: string) =>
      pid === 'page-fail'
        ? [{ ...pendingPage1, id: 'fail-reg', pageId: 'page-fail' }]
        : [{ ...pendingPage2, id: 'survive-reg', pageId: 'page-ok' }],
  });

  const completedMap = new Map<string, BubbleItem[]>();
  const partialSummary = await resSvc.extractChapterSelections({
    pages: [
      { id: 'page-fail', index: 1 },
      { id: 'page-ok', index: 2 },
    ],
    language: 'en',
    onPageComplete: async (pid, list) => {
      completedMap.set(pid, list);
    },
  });

  assert.equal(partialSummary.succeededRegions, 1);
  assert.equal(partialSummary.failedRegions, 1);
  assert.equal(completedMap.get('page-fail')?.[0].manualExtractionStatus, 'ocr_failed');
  assert.equal(completedMap.get('page-ok')?.[0].manualExtractionStatus, 'ocr_success');
});

test('Parametric two-point ellipse OCR masking preserves interior pixels and masks exterior bounding corners', () => {
  const width = 200;
  const height = 200;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);

  const paintRect = (x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const off = (y * width + x) * 4;
        data[off] = r;
        data[off + 1] = g;
        data[off + 2] = b;
        data[off + 3] = 255;
      }
    }
  };

  // Paint corner distractions inside the ellipse's bounding box [200..600 -> 40..120px]
  // that fall OUTSIDE the inscribed ellipse
  paintRect(42, 42, 52, 52, 10, 10, 10);
  paintRect(108, 108, 118, 118, 10, 10, 10);
  // Paint dark text glyphs strictly INSIDE the center of the ellipse (center = 80, 80)
  paintRect(74, 74, 86, 86, 15, 15, 15);

  const prepared = prepareManualCropRgba(
    { width, height, data },
    {
      regionId: 'ellipse-reg-1',
      kind: 'bubble',
      box_2d: [200, 200, 600, 600],
    }
  );

  // Crop has 2px padding around [40..120, 40..120] -> cropX = 38, cropY = 38, crop size = 84x84
  assert.equal(prepared.cropX, 38);
  assert.equal(prepared.cropY, 38);
  assert.equal(prepared.cropRgba.width, 84);
  assert.equal(prepared.cropRgba.height, 84);

  const pixelAtPage = (px: number, py: number) => {
    const lx = px - prepared.cropX;
    const ly = py - prepared.cropY;
    const off = (ly * prepared.cropRgba.width + lx) * 4;
    return prepared.cropRgba.data[off];
  };

  // Center glyphs inside ellipse remain dark (~15)
  assert.equal(pixelAtPage(80, 80), 15);
  // Corner distractors inside bounding box but outside ellipse are masked to white (255)
  assert.equal(pixelAtPage(45, 45), 255);
  assert.equal(pixelAtPage(115, 115), 255);

  // Direct maskCropOutsideEllipse helper also handles anisotropic ovals cleanly
  const ovalCrop: RgbaImageBuffer = {
    width: 100,
    height: 60,
    data: new Uint8ClampedArray(100 * 60 * 4).fill(255),
  };
  for (let y = 2; y < 8; y++) {
    for (let x = 2; x < 8; x++) {
      const off = (y * 100 + x) * 4;
      ovalCrop.data[off] = 0;
      ovalCrop.data[off + 1] = 0;
      ovalCrop.data[off + 2] = 0;
    }
  }
  const maskedOval = maskCropOutsideEllipse(ovalCrop, { left: 0, top: 0, right: 100, bottom: 60 });
  assert.equal(maskedOval.data[(4 * 100 + 4) * 4], 255);
});
