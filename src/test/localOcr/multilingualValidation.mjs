/**
 * Phase 1.1 Real-Model Multilingual OCR Validation Runner (P1.3)
 *
 * Executes executeLocalPageOcrPipeline against verified CC-BY 4.0 comic/webtoon fixtures
 * using pinned ONNX models managed by electron/modelManager.cjs, and reports separated
 * accuracy, geometry, grouping, reading-order, and runtime metrics without altering thresholds.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as ort from 'onnxruntime-web';
import {
  DETECTOR_MODEL_ID,
  ROUTE_TO_MODEL_ID,
  evaluateModelDistributionPolicy,
  getModelManifestEntry,
} from '../../lib/localOcr/modelManifest.ts';
import { executeLocalPageOcrPipeline } from '../../lib/localOcr/ocrWorker.ts';
import {
  computeCharEditStats,
  evaluatePagePredictions,
} from './validationMetrics.ts';

const require = createRequire(import.meta.url);
const { createModelManager } = require('../../../electron/modelManager.cjs');

// Minimal HTTP origin marker so @paddleocr/paddleocr-js 0.4.2 runs cleanly in Node
if (!globalThis.location) {
  globalThis.location = { protocol: 'http:' };
}

function decodePngRgba(buf) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('Invalid PNG signature in validation fixture.');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 0;
  let interlace = 0;
  const idatChunks = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }

  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2 && colorType !== 0)) {
    throw new Error(
      `Unsupported PNG format (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}).`
    );
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

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function convertJpgToPng(jpgPath, pngPath) {
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Drawing',
      `$img = [System.Drawing.Image]::FromFile($env:SRC_JPG)`,
      `try { $img.Save($env:DST_PNG, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $img.Dispose() }`,
    ].join('; ');
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      env: { ...process.env, SRC_JPG: jpgPath, DST_PNG: pngPath },
      stdio: 'pipe',
    });
    return;
  }
  throw new Error(
    `Missing cached PNG "${pngPath}" and automatic JPG->PNG conversion is only configured for win32.`
  );
}

async function ensureFixturePng(fixture, cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const jpgPath = path.join(cacheDir, fixture.localFileName);
  const pngPath = path.join(cacheDir, fixture.pngFileName);

  if (!fs.existsSync(jpgPath)) {
    const res = await fetch(fixture.sourceUrl);
    if (!res.ok) {
      throw new Error(`Failed to download fixture ${fixture.fixtureId}: HTTP ${res.status}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(jpgPath, bytes);
  }

  const actualHash = sha256File(jpgPath);
  if (actualHash !== fixture.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${fixture.localFileName}: expected ${fixture.sha256}, got ${actualHash}`
    );
  }

  if (!fs.existsSync(pngPath)) {
    convertJpgToPng(jpgPath, pngPath);
  }

  return pngPath;
}

function formatPct(value) {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function aggregateMetrics(items) {
  const gtRegionCount = items.reduce((s, m) => s + m.gtRegionCount, 0);
  const predRegionCount = items.reduce((s, m) => s + m.predRegionCount, 0);
  const matchedRegionCount = items.reduce((s, m) => s + m.matchedRegionCount, 0);
  const duplicateOverlapCount = items.reduce((s, m) => s + m.duplicateOverlapCount, 0);
  const bubbleExpectedCount = items.reduce((s, m) => s + m.bubbleExpectedCount, 0);
  const bubbleMatchedCount = items.reduce((s, m) => s + m.bubbleMatchedCount, 0);

  let weightedIoUSum = 0;
  for (const m of items) {
    weightedIoUSum += m.meanMatchedIoU * m.matchedRegionCount;
  }

  const matchedCharEdits = items.reduce((s, m) => s + m.matchedCharEdits, 0);
  const matchedRefChars = items.reduce((s, m) => s + m.matchedRefChars, 0);
  const endToEndCharEdits = items.reduce((s, m) => s + m.endToEndCharEdits, 0);
  const totalRefChars = items.reduce((s, m) => s + m.totalRefChars, 0);

  const wordItems = items.filter((m) => m.matchedWordEdits !== null);
  const matchedWordEdits = wordItems.reduce((s, m) => s + (m.matchedWordEdits ?? 0), 0);
  const matchedRefWords = wordItems.reduce((s, m) => s + (m.matchedRefWords ?? 0), 0);
  const endToEndWordEdits = wordItems.reduce((s, m) => s + (m.endToEndWordEdits ?? 0), 0);
  const totalRefWords = wordItems.reduce((s, m) => s + (m.totalRefWords ?? 0), 0);

  const totalGtLines = items.reduce((s, m) => s + m.totalGtLines, 0);
  const verbatimExactLines = items.reduce((s, m) => s + m.verbatimExactLines, 0);
  const normalizedExactLines = items.reduce((s, m) => s + m.normalizedExactLines, 0);
  const multilineGtCount = items.reduce((s, m) => s + m.multilineGtCount, 0);
  const multilineGroupedCount = items.reduce((s, m) => s + m.multilineGroupedCount, 0);
  const readingOrderConcordantPairs = items.reduce((s, m) => s + m.readingOrderConcordantPairs, 0);
  const readingOrderTotalPairs = items.reduce((s, m) => s + m.readingOrderTotalPairs, 0);

  return {
    pages: items.length,
    gtRegionCount,
    predRegionCount,
    matchedRegionCount,
    duplicateOverlapCount,
    detectionRecall: gtRegionCount > 0 ? matchedRegionCount / gtRegionCount : 1,
    detectionPrecision: predRegionCount > 0 ? matchedRegionCount / predRegionCount : 0,
    bubbleRecall: bubbleExpectedCount > 0 ? bubbleMatchedCount / bubbleExpectedCount : null,
    bubbleMatchedCount,
    bubbleExpectedCount,
    meanMatchedIoU: matchedRegionCount > 0 ? weightedIoUSum / matchedRegionCount : 0,
    matchedCer: matchedRefChars > 0 ? matchedCharEdits / matchedRefChars : 0,
    endToEndCer: totalRefChars > 0 ? endToEndCharEdits / totalRefChars : 0,
    matchedWer: matchedRefWords > 0 ? matchedWordEdits / matchedRefWords : null,
    endToEndWer: totalRefWords > 0 ? endToEndWordEdits / totalRefWords : null,
    verbatimExactLineRate: totalGtLines > 0 ? verbatimExactLines / totalGtLines : 0,
    normalizedExactLineRate: totalGtLines > 0 ? normalizedExactLines / totalGtLines : 0,
    verbatimExactLines,
    normalizedExactLines,
    totalGtLines,
    multilineGroupedCount,
    multilineGtCount,
    multilineGroupingRate: multilineGtCount > 0 ? multilineGroupedCount / multilineGtCount : null,
    readingOrderConcordantPairs,
    readingOrderTotalPairs,
    readingOrderConcordance:
      readingOrderTotalPairs > 0 ? readingOrderConcordantPairs / readingOrderTotalPairs : null,
  };
}

function validateBoxInvariant(box, label) {
  assert.equal(box.length, 4, `${label}: box_2d must have 4 coordinates`);
  const [ymin, xmin, ymax, xmax] = box;
  for (const v of box) {
    assert.ok(Number.isFinite(v), `${label}: coordinate must be finite`);
    assert.ok(v >= 0 && v <= 1000, `${label}: coordinate ${v} out of [0, 1000]`);
  }
  assert.ok(ymin <= ymax && xmin <= xmax, `${label}: inverted box [${box.join(', ')}]`);
}

async function main() {
  const corpusPath = path.resolve('src/test/localOcr/multilingualValidationCorpus.json');
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const fixtureCacheDir =
    process.env.FOLIO_OCR_VALIDATION_CACHE_DIR ||
    path.join(os.tmpdir(), 'folio-script-validation-cache');
  const modelCacheDir =
    process.env.FOLIO_OCR_CACHE_DIR || path.join(os.tmpdir(), 'folio-script-ocr-cache');

  const cpus = os.cpus();
  console.log('=== LOCAL OCR PHASE 1.1 MULTILINGUAL VALIDATION ===');
  console.log(
    `Host (dev benchmark machine, not target baseline): ${cpus[0]?.model ?? 'unknown'} (${cpus.length} logical cores), ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB RAM, ${process.platform}/${process.arch}, Node ${process.version}`
  );
  console.log(`Fixture cache: ${fixtureCacheDir}`);
  console.log(`Model cache:   ${modelCacheDir}`);

  const manager = createModelManager({ userDataDir: modelCacheDir, isProduction: false });
  const requiredModels = [
    DETECTOR_MODEL_ID,
    ...Object.values(ROUTE_TO_MODEL_ID),
  ];

  const assetsByModelId = new Map();
  for (const modelId of requiredModels) {
    const status = await manager.getModelStatus(modelId);
    if (status.state !== 'installed') {
      console.log(`[Setup] Downloading pinned model ${modelId}...`);
      await manager.downloadModel(modelId);
    }
    const assets = await manager.readModelAssets(modelId);
    const manifestEntry = getModelManifestEntry(modelId);
    const prodPolicy = manifestEntry
      ? evaluateModelDistributionPolicy(manifestEntry, { isProduction: true })
      : null;
    console.log(
      `[Model] ${modelId}@${assets.revisionLabel} (status=${manifestEntry?.redistributionStatus ?? 'unknown'}, prodPermitted=${prodPolicy?.downloadPermitted ?? 'unknown'})`
    );
    assetsByModelId.set(modelId, assets);
  }

  const wasmPaths = pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist') + path.sep).href;
  ort.env.wasm.wasmPaths = wasmPaths;

  const state = {
    detectorKey: null,
    detectorModelId: null,
    detectorRevision: null,
    detectorSession: null,
    ocrKey: null,
    ocrModelId: null,
    ocrRevision: null,
    ocrAdapter: null,
  };

  const detectorAssets = assetsByModelId.get('comic-detector-v4-s-int8');
  const detectorKey = `${detectorAssets.modelId}@${detectorAssets.revisionLabel}`;

  const pageReports = [];
  const mixedScriptDetails = [];
  const totalStart = performance.now();

  try {
    for (let idx = 0; idx < corpus.fixtures.length; idx++) {
      const fixture = corpus.fixtures[idx];
      const pngPath = await ensureFixturePng(fixture, fixtureCacheDir);
      const pngBuffer = fs.readFileSync(pngPath);
      const imageBytes = pngBuffer.buffer.slice(
        pngBuffer.byteOffset,
        pngBuffer.byteOffset + pngBuffer.byteLength
      );

      const ocrModelId = ROUTE_TO_MODEL_ID[fixture.routeId];
      const ocrAssets = assetsByModelId.get(ocrModelId);
      const ocrKey = `${ocrAssets.modelId}@${ocrAssets.revisionLabel}`;

      const needDetectorAssets = state.detectorKey !== detectorKey;
      const needOcrAssets = state.ocrKey !== ocrKey;

      const serializable = await executeLocalPageOcrPipeline(
        {
          jobId: `p13-val-${idx + 1}`,
          pageId: fixture.fixtureId,
          imageBytes,
          mimeType: 'image/png',
          languageHint: fixture.language,
          resolvedRoute: fixture.routeId,
          effectiveLanguage: fixture.language,
          readingConvention: fixture.readingConvention,
          detectorModelKey: detectorKey,
          ocrModelKey: ocrKey,
          detectorAssets: needDetectorAssets ? detectorAssets : undefined,
          ocrAssets: needOcrAssets ? ocrAssets : undefined,
          wasmPaths,
          diagnostics: { includeTileDetails: true },
        },
        state,
        () => false,
        {
          decodeImage: async (bytes) => decodePngRgba(Buffer.from(bytes)),
        }
      );

      assert.equal(serializable.sourceDimensions.width, fixture.width);
      assert.equal(serializable.sourceDimensions.height, fixture.height);
      assert.equal(serializable.partialFailures.length, 0, `${fixture.fixtureId}: unexpected partial failures`);
      assert.notEqual(serializable.status, 'failed', `${fixture.fixtureId}: pipeline returned failed status`);

      for (const b of serializable.bubbleRegions) {
        validateBoxInvariant(b.geometry.box_2d, `${fixture.fixtureId}/${b.bubbleId}`);
        assert.ok(Number.isFinite(b.detectionConfidence), `${fixture.fixtureId}: bubble confidence must be finite`);
      }
      for (const tr of serializable.textRegions) {
        validateBoxInvariant(tr.geometry.box_2d, `${fixture.fixtureId}/${tr.regionId}`);
        assert.ok(Number.isFinite(tr.confidence.ocr), `${fixture.fixtureId}: OCR confidence must be finite`);
        for (const ls of tr.lineSegments) {
          validateBoxInvariant(ls.geometry.box_2d, `${fixture.fixtureId}/${ls.lineId}`);
          assert.ok(Number.isFinite(ls.recognitionConfidence), `${fixture.fixtureId}: line confidence must be finite`);
        }
      }

      const metrics = evaluatePagePredictions(
        fixture,
        serializable.textRegions,
        serializable.bubbleRegions
      );

      for (const detail of metrics.regionDetails) {
        if (detail.mixedScript) {
          mixedScriptDetails.push({
            fixtureId: fixture.fixtureId,
            language: fixture.language,
            ...detail,
          });
        }
      }

      pageReports.push({
        fixture,
        serializable,
        metrics,
      });
    }
  } finally {
    if (state.detectorSession) await state.detectorSession.dispose();
    if (state.ocrAdapter) await state.ocrAdapter.dispose();
  }

  const totalWallMs = Math.round(performance.now() - totalStart);

  console.log('\n=== PER-PAGE METRICS ===');
  for (const { fixture, serializable, metrics } of pageReports) {
    const werPart =
      metrics.matchedWer !== null
        ? ` | mWER=${formatPct(metrics.matchedWer)} eWER=${formatPct(metrics.endToEndWer)}`
        : '';
    const orderPart =
      metrics.readingOrderTotalPairs > 0
        ? ` | Order=${metrics.readingOrderConcordantPairs}/${metrics.readingOrderTotalPairs}`
        : '';
    const groupPart =
      metrics.multilineGtCount > 0
        ? ` | Group=${metrics.multilineGroupedCount}/${metrics.multilineGtCount}`
        : '';
    console.log(
      `${fixture.fixtureId.padEnd(24)} | ${fixture.width}x${fixture.height} | ` +
        `tiles=${String(serializable.timings.tileCount).padStart(2)} crops=${String(serializable.timings.cropCount).padStart(2)} | ` +
        `GT=${metrics.gtRegionCount} Pred=${metrics.predRegionCount} Match=${metrics.matchedRegionCount} Dup=${metrics.duplicateOverlapCount} | ` +
        `Rec=${formatPct(metrics.detectionRecall)} Prec=${formatPct(metrics.detectionPrecision)} BubRec=${formatPct(metrics.bubbleRecall)} IoU=${metrics.meanMatchedIoU.toFixed(3)} | ` +
        `mCER=${formatPct(metrics.matchedCer)} eCER=${formatPct(metrics.endToEndCer)}${werPart} | ` +
        `Lines=${metrics.normalizedExactLines}/${metrics.totalGtLines} (raw ${metrics.verbatimExactLines})${groupPart}${orderPart} | ` +
        `${serializable.timings.totalMs}ms (det=${serializable.timings.detectorMs} ocr=${serializable.timings.ocrMs})`
    );
  }

  console.log('\n=== PER-LANGUAGE & OVERALL AGGREGATES ===');
  for (const lang of ['en', 'ko', 'ja', 'zh']) {
    const subset = pageReports.filter((p) => p.fixture.language === lang).map((p) => p.metrics);
    const agg = aggregateMetrics(subset);
    const werPart =
      agg.matchedWer !== null
        ? ` | mWER=${formatPct(agg.matchedWer)} eWER=${formatPct(agg.endToEndWer)}`
        : '';
    console.log(
      `[${lang.toUpperCase()}] pages=${agg.pages} GT=${agg.gtRegionCount} Pred=${agg.predRegionCount} Match=${agg.matchedRegionCount} Dup=${agg.duplicateOverlapCount} | ` +
        `DetRec=${formatPct(agg.detectionRecall)} DetPrec=${formatPct(agg.detectionPrecision)} BubRec=${formatPct(agg.bubbleRecall)} IoU=${agg.meanMatchedIoU.toFixed(3)} | ` +
        `mCER=${formatPct(agg.matchedCer)} eCER=${formatPct(agg.endToEndCer)}${werPart} | ` +
        `ExactLine(norm/raw)=${agg.normalizedExactLines}/${agg.totalGtLines}(${formatPct(agg.normalizedExactLineRate)}) / ${agg.verbatimExactLines}/${agg.totalGtLines}(${formatPct(agg.verbatimExactLineRate)}) | ` +
        `Group=${agg.multilineGroupedCount}/${agg.multilineGtCount}(${formatPct(agg.multilineGroupingRate)}) | ` +
        `Order=${agg.readingOrderConcordantPairs}/${agg.readingOrderTotalPairs}(${formatPct(agg.readingOrderConcordance)})`
    );
  }

  const allAgg = aggregateMetrics(pageReports.map((p) => p.metrics));
  console.log(
    `[ALL] pages=${allAgg.pages} GT=${allAgg.gtRegionCount} Pred=${allAgg.predRegionCount} Match=${allAgg.matchedRegionCount} Dup=${allAgg.duplicateOverlapCount} | ` +
      `DetRec=${formatPct(allAgg.detectionRecall)} DetPrec=${formatPct(allAgg.detectionPrecision)} BubRec=${formatPct(allAgg.bubbleRecall)} IoU=${allAgg.meanMatchedIoU.toFixed(3)} | ` +
      `mCER=${formatPct(allAgg.matchedCer)} eCER=${formatPct(allAgg.endToEndCer)} | ` +
      `ExactLine(norm/raw)=${allAgg.normalizedExactLines}/${allAgg.totalGtLines}(${formatPct(allAgg.normalizedExactLineRate)}) / ${allAgg.verbatimExactLines}/${allAgg.totalGtLines}(${formatPct(allAgg.verbatimExactLineRate)}) | ` +
      `Group=${allAgg.multilineGroupedCount}/${allAgg.multilineGtCount}(${formatPct(allAgg.multilineGroupingRate)}) | ` +
      `Order=${allAgg.readingOrderConcordantPairs}/${allAgg.readingOrderTotalPairs}(${formatPct(allAgg.readingOrderConcordance)}) | ` +
      `TotalWallMs=${totalWallMs}`
  );

  // Mixed-script subset
  let mixedEdits = 0;
  let mixedRefChars = 0;
  let mixedMatched = 0;
  for (const d of mixedScriptDetails) {
    const c = computeCharEditStats(d.predictedText, d.expectedText);
    mixedEdits += c.edits;
    mixedRefChars += c.refChars;
    if (d.matchedPredId !== null) mixedMatched++;
  }
  console.log(
    `\n=== MIXED-SCRIPT REGIONS SUBSET (${mixedScriptDetails.length} regions, ${mixedMatched} matched, CER=${formatPct(mixedRefChars > 0 ? mixedEdits / mixedRefChars : 0)}) ===`
  );
  for (const d of mixedScriptDetails) {
    console.log(
      `  ${d.fixtureId}/${d.gtId}: match=${d.matchedPredId ?? 'MISS'} IoU=${d.iou.toFixed(3)} CER=${formatPct(d.cer)} | exp="${d.expectedText}" | pred="${d.predictedText}"`
    );
  }

  // Long webtoon strip subset
  const webtoonReport = pageReports.find((p) => p.fixture.isLongWebtoon);
  if (webtoonReport) {
    const { fixture, serializable, metrics } = webtoonReport;
    console.log(
      `\n=== LONG VERTICAL WEBTOON STRIP (${fixture.fixtureId}, ${fixture.width}x${fixture.height}) ===`
    );
    console.log(
      `  tiles=${serializable.timings.tileCount} crops=${serializable.timings.cropCount} totalMs=${serializable.timings.totalMs} (init=${serializable.timings.initMs} decode=${serializable.timings.decodeMs} det=${serializable.timings.detectorMs} ocr=${serializable.timings.ocrMs} post=${serializable.timings.postprocessMs})`
    );
    console.log(
      `  DetRec=${formatPct(metrics.detectionRecall)} (${metrics.matchedRegionCount}/${metrics.gtRegionCount}), DetPrec=${formatPct(metrics.detectionPrecision)} (pred=${metrics.predRegionCount}, dup=${metrics.duplicateOverlapCount}), mCER=${formatPct(metrics.matchedCer)}, eCER=${formatPct(metrics.endToEndCer)}, Group=${metrics.multilineGroupedCount}/${metrics.multilineGtCount}, Order=${metrics.readingOrderConcordantPairs}/${metrics.readingOrderTotalPairs}`
    );
  }

  console.log('\n=== IMPERFECT / FAILED / UNMATCHED REGIONS ===');
  for (const { fixture, serializable, metrics } of pageReports) {
    const issues = metrics.regionDetails.filter(
      (d) => d.matchedPredId === null || d.cer > 0 || d.groupedCleanly === false
    );
    const matchedPredIds = new Set(
      metrics.regionDetails.map((d) => d.matchedPredId).filter(Boolean)
    );
    const extraPreds = serializable.textRegions.filter((r) => !matchedPredIds.has(r.regionId));
    if (issues.length === 0 && extraPreds.length === 0) continue;
    console.log(`[${fixture.fixtureId}] issues=${issues.length} extraPreds=${extraPreds.length}`);
    for (const d of issues) {
      console.log(
        `  GT ${d.gtId}: predId=${d.matchedPredId ?? 'MISS'} IoU=${d.iou.toFixed(3)} CER=${formatPct(d.cer)} grouped=${String(d.groupedCleanly)} | exp="${d.expectedText}" | pred="${d.predictedText}"`
      );
    }
    for (const ep of extraPreds) {
      console.log(
        `  EXTRA ${ep.regionId} box=[${ep.geometry.box_2d.join(',')}] text="${ep.rawOCR}"`
      );
    }
  }

  console.log(
    '\n[Coverage Note] Pepper&Carrot JA/ZH pages use horizontal speech-bubble lettering. No open-licensed traditional vertical-text Japanese manga page with dialogue is currently included.'
  );
  console.log('\nALL VALIDATION INVARIANTS PASSED.');
}

main().catch((err) => {
  console.error('[Validation] Failed:', err);
  process.exit(1);
});
