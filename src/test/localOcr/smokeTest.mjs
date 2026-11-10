/**
 * Real-Model Local OCR Smoke Test (Phase 1)
 *
 * Uses the pinned models managed by electron/modelManager.cjs (cached outside the Git repo)
 * and executes the full local OCR pipeline (RT-DETR-v2 comic geometry detection +
 * adaptive tiling + cross-tile fusion + PaddleOCR.js USTAR OCR + script-aware line grouping)
 * against a local PNG image fixture extracted from public/seed_double_balloon_detection.json.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as ort from 'onnxruntime-web';
import { executeLocalPageOcrPipeline } from '../../lib/localOcr/ocrWorker.ts';
import { assembleLocalOcrScanResult } from '../../lib/localOcr/resultAssembler.ts';

const require = createRequire(import.meta.url);
const { createModelManager } = require('../../../electron/modelManager.cjs');

// Minimal HTTP origin marker so @paddleocr/paddleocr-js 0.4.2 runs cleanly in Node smoke harness
if (!globalThis.location) {
  globalThis.location = { protocol: 'http:' };
}

function decodePngRgba(buf) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks = [];

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

  const paeth = (a, b, c) => {
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

async function main() {
  const userDataDir = process.env.FOLIO_OCR_CACHE_DIR || path.join(os.tmpdir(), 'folio-script-ocr-cache');
  // Smoke test runs in development mode to exercise pinned local models
  const manager = createModelManager({ userDataDir, isProduction: false });
  const requiredModels = [
    'comic-detector-v4-s-int8',
    'ppocr-v6-small-en',
    'ppocr-v6-manga-v0.3',
    'ppocr-v5-mobile-ko',
  ];

  console.log(`[SmokeTest] Model cache directory: ${userDataDir}`);
  for (const modelId of requiredModels) {
    const status = await manager.getModelStatus(modelId);
    console.log(`[SmokeTest] Model ${modelId}: ${status.state}`);
    if (status.state !== 'installed') {
      console.log(`[SmokeTest] Downloading ${modelId}...`);
      await manager.downloadModel(modelId);
    }
  }

  console.log('[SmokeTest] Extracting fixture...');
  // Extract local PNG fixture from public/seed_double_balloon_detection.json (in-memory only)
  const seedPath = path.resolve('public/seed_double_balloon_detection.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const fixture = seed.examples[0];
  const pngBuffer = Buffer.from(fixture.imageBase64, 'base64');
  const imageBytes = pngBuffer.buffer.slice(
    pngBuffer.byteOffset,
    pngBuffer.byteOffset + pngBuffer.byteLength
  );

  const wasmPaths = pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist') + path.sep).href;
  ort.env.wasm.wasmPaths = wasmPaths;

  console.log('[SmokeTest] Reading detector + EN OCR assets...');
  const detectorAssets = await manager.readModelAssets('comic-detector-v4-s-int8');
  const enAssets = await manager.readModelAssets('ppocr-v6-small-en');
  console.log('[SmokeTest] Running executeLocalPageOcrPipeline...');

  const state = {
    detectorKey: null,
    detectorSession: null,
    ocrKey: null,
    ocrAdapter: null,
  };

  const memBefore = process.memoryUsage().rss;
  const serializable = await executeLocalPageOcrPipeline(
    {
      jobId: 'smoke-en-1',
      pageId: 'seed_ex_db_1',
      imageBytes,
      mimeType: 'image/png',
      languageHint: 'en',
      resolvedRoute: 'en_ppocrv6_small',
      readingConvention: 'manga_rtl',
      detectorAssets,
      ocrAssets: enAssets,
      wasmPaths,
      diagnostics: { includeTileDetails: true },
    },
    state,
    () => false,
    {
      decodeImage: async (bytes) => decodePngRgba(Buffer.from(bytes)),
    }
  );
  const memAfter = process.memoryUsage().rss;

  const fullResult = assembleLocalOcrScanResult({
    ...serializable,
    sourceWidth: serializable.sourceDimensions.width,
    sourceHeight: serializable.sourceDimensions.height,
    fusedBubbles: serializable.bubbleRegions.map((b) => ({
      id: b.bubbleId,
      classLabel: 'bubble',
      pixelBox: [0, 0, 0, 0],
      normalizedBox: b.geometry.box_2d,
      rawScore: b.detectionConfidence,
      sourceTileIds: b.tileOriginIds || [],
      boundaryUncertain: Boolean(b.boundaryUncertain),
      flags: b.flags || [],
    })),
  });
  const canonical = fullResult.toCanonicalPageScanResult();

  console.log('\n=== LOCAL OCR SMOKE TEST SUMMARY (EN via PaddleOCR.js) ===');
  console.log('Status:', canonical.status);
  console.log('Dimensions:', canonical.sourceDimensions);
  console.log('Models used:', JSON.stringify(fullResult.modelsUsed));
  console.log('Timings:', JSON.stringify(fullResult.timings));
  console.log(`Node RSS before=${(memBefore / 1048576).toFixed(1)} MB, after=${(memAfter / 1048576).toFixed(1)} MB`);
  console.log('Physical bubbleRegions:', canonical.bubbleRegions?.length ?? 0);
  console.log('Logical textRegions:', canonical.regions.length);
  console.log('Line segments:', fullResult.lineSegments.length);

  for (const r of canonical.regions) {
    console.log(
      `  #${r.order.sequenceIndex} [${r.regionId}] bubble=${r.associations.bubbleId ?? 'null'} ` +
        `detScore=${r.confidence.regionDetection.toFixed(3)} ocrScore=${r.confidence.ocr.toFixed(3)} ` +
        `lines=${r.lineSegments?.length ?? 0} box=${JSON.stringify(r.geometry.box_2d)} ` +
        `text=${JSON.stringify(r.rawOCR)}`
    );
  }

  // Also verify Manga v0.3 and Korean routes initialize and execute cleanly through the pipeline
  const mangaAssets = await manager.readModelAssets('ppocr-v6-manga-v0.3');
  const koAssets = await manager.readModelAssets('ppocr-v5-mobile-ko');

  const mangaRes = await executeLocalPageOcrPipeline(
    {
      jobId: 'smoke-ja-1',
      pageId: 'seed_ex_db_1',
      imageBytes,
      mimeType: 'image/png',
      languageHint: 'ja',
      resolvedRoute: 'ja_zh_ppocrv6_manga',
      readingConvention: 'manga_rtl',
      detectorAssets,
      ocrAssets: mangaAssets,
      wasmPaths,
    },
    state,
    () => false,
    { decodeImage: async (bytes) => decodePngRgba(Buffer.from(bytes)) }
  );
  console.log(
    `\n[SmokeTest] ja_zh_ppocrv6_manga route: status=${mangaRes.status}, regions=${mangaRes.textRegions.length}, ` +
      `initMs=${mangaRes.timings.initMs}, ocrMs=${mangaRes.timings.ocrMs}, sample="${mangaRes.textRegions[0]?.rawOCR ?? ''}"`
  );

  const koRes = await executeLocalPageOcrPipeline(
    {
      jobId: 'smoke-ko-1',
      pageId: 'seed_ex_db_1',
      imageBytes,
      mimeType: 'image/png',
      languageHint: 'ko',
      resolvedRoute: 'ko_ppocrv5_mobile',
      readingConvention: 'webtoon_v',
      detectorAssets,
      ocrAssets: koAssets,
      wasmPaths,
    },
    state,
    () => false,
    { decodeImage: async (bytes) => decodePngRgba(Buffer.from(bytes)) }
  );
  console.log(
    `[SmokeTest] ko_ppocrv5_mobile route: status=${koRes.status}, regions=${koRes.textRegions.length}, ` +
      `initMs=${koRes.timings.initMs}, ocrMs=${koRes.timings.ocrMs}, sample="${koRes.textRegions[0]?.rawOCR ?? ''}"`
  );

  // Verify ORT Web file:// fallback adapter directly as well
  globalThis.location = { protocol: 'file:' };
  state.ocrKey = null;
  if (state.ocrAdapter) {
    await state.ocrAdapter.dispose();
    state.ocrAdapter = null;
  }
  const fileOriginRes = await executeLocalPageOcrPipeline(
    {
      jobId: 'smoke-file-fallback',
      pageId: 'seed_ex_db_1',
      imageBytes,
      mimeType: 'image/png',
      languageHint: 'en',
      resolvedRoute: 'en_ppocrv6_small',
      readingConvention: 'manga_rtl',
      detectorAssets,
      ocrAssets: enAssets,
      wasmPaths,
    },
    state,
    () => false,
    { decodeImage: async (bytes) => decodePngRgba(Buffer.from(bytes)) }
  );
  console.log(
    `[SmokeTest] file:// ORT Web fallback adapter: runtime=${fileOriginRes.modelsUsed.ocrRuntimeUsed}, ` +
      `status=${fileOriginRes.status}, regions=${fileOriginRes.textRegions.length}, sample="${fileOriginRes.textRegions[0]?.rawOCR ?? ''}"`
  );

  if (state.detectorSession) await state.detectorSession.dispose();
  if (state.ocrAdapter) await state.ocrAdapter.dispose();
}

main().catch((err) => {
  console.error('[SmokeTest] FAILED:', err);
  process.exit(1);
});
