/**
 * Real-Model Hybrid OCR Phase 2 End-to-End Verification
 *
 * Uses cached Phase 1.1 models managed by electron/modelManager.cjs (%TEMP%/folio-script-ocr-cache)
 * to run REAL RT-DETR-v2 + PP-OCR inference inside the Phase 2 hybrid pipeline
 * (scanPageWithGemini -> scanMangaPageHybridWithMeta -> mergeScanWithExistingState),
 * and also verifies electron/modelManager.cjs production-mode eligibility fallback.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';
import { scanPageWithGemini } from '../lib/geminiScan.ts';
import { executeLocalPageOcrPipeline } from '../lib/localOcr/ocrWorker.ts';
import { assembleLocalOcrScanResult } from '../lib/localOcr/resultAssembler.ts';
import { resolveOcrLanguageRoute } from '../lib/localOcr/languageRouter.ts';
import { ROUTE_TO_MODEL_ID } from '../lib/localOcr/modelManifest.ts';

const require = createRequire(import.meta.url);
const { createModelManager } = require('../../electron/modelManager.cjs');

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
    for (let i = 0; i < stride; i++) {
      const x = raw[pos++];
      const a = i >= bpp ? currRow[i - bpp] : 0;
      const b = prevRow[i];
      const c = i >= bpp ? prevRow[i - bpp] : 0;
      if (filter === 0) currRow[i] = x;
      else if (filter === 1) currRow[i] = (x + a) & 0xff;
      else if (filter === 2) currRow[i] = (x + b) & 0xff;
      else if (filter === 3) currRow[i] = (x + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) currRow[i] = (x + paeth(a, b, c)) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (bpp === 4) {
        rgba[di] = currRow[x * 4];
        rgba[di + 1] = currRow[x * 4 + 1];
        rgba[di + 2] = currRow[x * 4 + 2];
        rgba[di + 3] = currRow[x * 4 + 3];
      } else if (bpp === 3) {
        rgba[di] = currRow[x * 3];
        rgba[di + 1] = currRow[x * 3 + 1];
        rgba[di + 2] = currRow[x * 3 + 2];
        rgba[di + 3] = 255;
      } else {
        const g = currRow[x];
        rgba[di] = g;
        rgba[di + 1] = g;
        rgba[di + 2] = g;
        rgba[di + 3] = 255;
      }
    }
    prevRow.set(currRow);
  }
  return { width, height, data: rgba };
}

function readPngDimensions(buf) {
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

async function main() {
  const userDataDir = path.join(os.tmpdir(), 'folio-script-ocr-cache');
  const devManager = createModelManager({ userDataDir, isProduction: false });
  const prodManager = createModelManager({ userDataDir, isProduction: true });

  const wasmPaths = pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist') + path.sep).href;
  ort.env.wasm.wasmPaths = wasmPaths;

  const seed = JSON.parse(fs.readFileSync(path.resolve('public/seed_double_balloon_detection.json'), 'utf8'));
  const pngBuffer = Buffer.from(seed.examples[0].imageBase64, 'base64');
  const dims = readPngDimensions(pngBuffer);
  const blob = new Blob([pngBuffer], { type: 'image/png' });

  const detectorAssets = await devManager.readModelAssets('comic-detector-v4-s-int8');
  const pipelineState = {
    detectorKey: null,
    detectorSession: null,
    ocrKey: null,
    ocrAdapter: null,
  };

  const makeModelProviderFromManager = (mgr) => ({
    getManifest: async () => mgr.getManifest(),
    getStatus: async (modelId) => mgr.getModelStatus(modelId),
    downloadModel: async () => {
      throw new Error('Unexpected download during test');
    },
    cancelDownload: async () => true,
    removeModel: async () => {
      throw new Error('Unexpected removal');
    },
    readModelAssets: async (modelId) => mgr.readModelAssets(modelId),
  });

  const persistedBubbles = new Map();
  const persistedScans = new Map();

  // 1. Verify REAL local OCR -> Phase 2 hybrid scan & persistence (English seed fixture)
  const enResult = await scanPageWithGemini({
    pageId: 'real_seed_en_1',
    apiKey: 'AIza-RealModel-Test',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 2,
    includeSFX: true,
    sourceLanguageHint: 'en',
    readingConvention: 'manga_rtl',
    scanDeps: {
      getPageBubbles: async (pid) => persistedBubbles.get(pid) || [],
      savePageBubbles: async (pid, list) => persistedBubbles.set(pid, list),
      savePageScan: async (pid, rec) => persistedScans.set(pid, rec),
      getProjectLore: async () => null,
      getChapterIntelligence: async () => null,
      ingestPageIntelligence: async () => {},
      batchTranslateBubbles: async ({ bubbles }) => ({
        success: true,
        translationMap: new Map(
          bubbles.map((b) => [b.id, { rawText: `AR(${b.sourceText})`, humanizedText: `AR(${b.sourceText})` }])
        ),
        requestedCount: bubbles.length,
        translatedCount: bubbles.length,
      }),
    },
    hybridDeps: {
      getPageBlob: async () => blob,
      extractImageDimensions: async () => dims,
      getModelProvider: () => makeModelProviderFromManager(devManager),
      runLocalOcr: async (opts) => {
        const route = resolveOcrLanguageRoute(opts.languageHint, opts.sampleText);
        const ocrModelId = ROUTE_TO_MODEL_ID[route.routeId];
        const ocrAssets = await devManager.readModelAssets(ocrModelId);
        const buf = Buffer.from(await opts.image.arrayBuffer());
        const serializable = await executeLocalPageOcrPipeline(
          {
            jobId: `real-${opts.pageId}`,
            pageId: opts.pageId,
            imageBytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            mimeType: 'image/png',
            languageHint: opts.languageHint,
            resolvedRoute: route.routeId,
            readingConvention: opts.readingConvention || 'manga_rtl',
            detectorAssets,
            ocrAssets,
            wasmPaths,
          },
          pipelineState,
          () => Boolean(opts.signal?.aborted),
          { decodeImage: async (bytes) => decodePngRgba(Buffer.from(bytes)) }
        );
        return assembleLocalOcrScanResult({
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
      },
      runGeminiContextPass: async ({ candidates }) => ({
        pageContext: 'Real fixture double-balloon manga page.',
        panels: [{ panelId: 'p-1', box_2d: [0, 0, 1000, 1000] }],
        regionDecisions: candidates.map((c) => ({
          regionId: c.regionId,
          action: 'keep',
          primaryClass: 'dialogue',
          sourceLanguage: 'en',
        })),
        additionalRegions: [],
        detectedCharacters: [],
        detectedGlossaryTerms: [],
        detectedRelationships: [],
      }),
    },
  });

  assert.equal(enResult.ocrSource, 'hybrid');
  assert.ok(enResult.bubbles.length >= 1, 'Expected real detector + PP-OCR to produce at least 1 bubble');
  for (const b of enResult.bubbles) {
    const [ymin, xmin, ymax, xmax] = b.box_2d;
    assert.ok(ymin >= 0 && xmin >= 0 && ymax <= 1000 && xmax <= 1000 && ymax > ymin && xmax > xmin);
    assert.ok(b.sourceText.trim().length > 0);
    assert.ok(b.translatedText.startsWith('AR('));
  }
  console.log(
    `[RealModelPhase2] Hybrid EN seed_ex_db_1 PASS: bubbles=${enResult.bubbles.length}, texts=${JSON.stringify(enResult.bubbles.map((b) => b.sourceText))}`
  );

  // 2. Verify REAL packaged production electron/modelManager blocks dev_only models -> clean Gemini fallback
  let localInvokedInProd = false;
  const prodRes = await scanPageWithGemini({
    pageId: 'real_prod_gate',
    apiKey: 'AIza-RealModel-Test',
    selectedModel: 'gemini-3.8-flash',
    eloquenceLevel: 2,
    includeSFX: true,
    sourceLanguageHint: 'en',
    scanDeps: {
      getPageBubbles: async (pid) => persistedBubbles.get(pid) || [],
      savePageBubbles: async (pid, list) => persistedBubbles.set(pid, list),
      savePageScan: async (pid, rec) => persistedScans.set(pid, rec),
      getProjectLore: async () => null,
      getChapterIntelligence: async () => null,
      ingestPageIntelligence: async () => {},
      batchTranslateBubbles: async () => ({
        success: true,
        translationMap: new Map(),
        requestedCount: 0,
        translatedCount: 0,
      }),
    },
    hybridDeps: {
      getPageBlob: async () => blob,
      extractImageDimensions: async () => dims,
      getModelProvider: () => makeModelProviderFromManager(prodManager),
      runLocalOcr: async () => {
        localInvokedInProd = true;
        throw new Error('Must not invoke local OCR in production');
      },
      runGeminiFullFallback: async () => ({
        scanId: 'fb-prod',
        pageId: 'real_prod_gate',
        sourceImageId: 'real_prod_gate',
        sourceDimensions: dims,
        readingConvention: 'manga_rtl',
        status: 'complete',
        panels: [],
        regions: [],
        issues: [],
        transformLedger: {
          transformId: 'tf-prod',
          sourceImageId: 'real_prod_gate',
          sourceWidth: dims.width,
          sourceHeight: dims.height,
          workingWidth: dims.width,
          workingHeight: dims.height,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          cropOriginX: 0,
          cropOriginY: 0,
          coordinateSpace: 'normalized_1000',
        },
        createdAt: Date.now(),
        version: 1,
      }),
    },
  });
  assert.equal(localInvokedInProd, false);
  assert.equal(prodRes.ocrSource, 'gemini_fallback');
  console.log('[RealModelPhase2] Production eligibility fallback PASS');

  if (pipelineState.detectorSession) {
    await pipelineState.detectorSession.dispose();
  }
  if (pipelineState.ocrAdapter) {
    await pipelineState.ocrAdapter.dispose();
  }
}

main().catch((err) => {
  console.error('[RealModelPhase2] FAILED:', err);
  process.exit(1);
});
