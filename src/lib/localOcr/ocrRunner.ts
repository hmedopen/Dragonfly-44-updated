import * as ort from 'onnxruntime-web';
import yaml from 'js-yaml';
import ClipperLib from 'clipper-lib';
import type {
  AssociatedTextCandidate,
  ModelAssetPayload,
  OcrRouteId,
  RawOcrLineDetection,
} from '../../types/localOcr.ts';
import type { RgbaImageBuffer } from './comicDetector.ts';
import {
  computePaddedPixelCrop,
  cropPolygonToOriginalPixels,
  originalPixelsToNormalized1000,
  pixelPolygonToPixelBox,
} from './coordinateMapping.ts';
import { disposeOrtTensors } from './ortTensorUtils.ts';
import { buildUstarArchive } from './ustarBuilder.ts';

interface OpenCvRuntime {
  Mat: any;
  Size: any;
  Scalar: any;
  CV_8UC1: number;
  CV_8UC4: number;
  CV_32FC2: number;
  RETR_LIST: number;
  CHAIN_APPROX_SIMPLE: number;
  INTER_CUBIC: number;
  INTER_LINEAR: number;
  BORDER_REPLICATE: number;
  ROTATE_90_COUNTERCLOCKWISE: number;
  matFromArray: (rows: number, cols: number, type: number, data: ArrayLike<number>) => any;
  cvtColor: (src: any, dst: any, code: number) => void;
  resize: (src: any, dst: any, dsize: any, fx: number, fy: number, interp: number) => void;
  findContours: (img: any, contours: any, hierarchy: any, mode: number, method: number) => void;
  minAreaRect: (contour: any) => { center: any; size: { width: number; height: number }; angle: number };
  RotatedRect: { points: (rect: any) => Array<{ x: number; y: number }> };
  getPerspectiveTransform: (src: any, dst: any) => any;
  warpPerspective: (src: any, dst: any, M: any, dsize: any, flags: number, borderMode: number, borderValue: any) => void;
  rotate: (src: any, dst: any, rotateCode: number) => void;
  contourArea: (contour: any, oriented: boolean) => number;
  arcLength: (curve: any, closed: boolean) => number;
  COLOR_RGBA2BGR: number;
  COLOR_GRAY2BGR: number;
  MatVector: any;
}

let cachedCvPromise: Promise<{ cv: OpenCvRuntime }> | null = null;

/**
 * Safely initializes @techstark/opencv-js avoiding Emscripten's Module.then infinite unwrap.
 * NOTE: Must never return raw `cvMod` from an async function because `cvMod.then` triggers infinite Promise unwrapping.
 */
export async function getOpenCvRuntime(): Promise<{ cv: OpenCvRuntime }> {
  if (!cachedCvPromise) {
    cachedCvPromise = (async () => {
      const modImport: any = await import('@techstark/opencv-js');
      const cvMod: any = modImport?.default ?? modImport;
      if (cvMod?.Mat) {
        return { cv: cvMod as OpenCvRuntime };
      }
      if (typeof cvMod?.then === 'function') {
        await new Promise<void>((resolve) => {
          cvMod.then(() => resolve());
        });
      } else {
        await new Promise<void>((resolve) => {
          const prev = cvMod.onRuntimeInitialized;
          cvMod.onRuntimeInitialized = () => {
            if (typeof prev === 'function') prev();
            resolve();
          };
        });
      }
      return { cv: cvMod as OpenCvRuntime };
    })().catch((err) => {
      cachedCvPromise = null;
      throw err;
    });
  }
  return cachedCvPromise;
}

export interface OcrLineRawOutput {
  poly: Array<[number, number]>;
  text: string;
  /** Uncalibrated aggregated line confidence (mean of CTC character timestep probabilities). */
  score: number;
  rawModelScoreMean?: number;
  tokenProbabilities?: number[];
  confidenceCalibrated?: boolean;
  detScore?: number;
}

export interface OcrPipelineAdapter {
  runtimeUsed: 'paddleocr_js' | 'ort_web_adapter';
  predictCrop: (cropRgba: RgbaImageBuffer) => Promise<OcrLineRawOutput[]>;
  dispose: () => Promise<void>;
}

/**
 * Extracts a padded RGBA pixel crop directly from the original decoded page image.
 */
export function extractRgbaCrop(
  pageRgba: RgbaImageBuffer,
  x: number,
  y: number,
  width: number,
  height: number
): RgbaImageBuffer {
  const out = new Uint8ClampedArray(width * height * 4);
  const srcStride = pageRgba.width * 4;
  const dstStride = width * 4;

  for (let row = 0; row < height; row++) {
    const srcStart = (y + row) * srcStride + x * 4;
    const dstStart = row * dstStride;
    out.set(pageRgba.data.subarray(srcStart, srcStart + dstStride), dstStart);
  }

  return { width, height, data: out };
}

function synthesizeMangaInferenceConfigs(dictBytes: Uint8Array): {
  detModelName: string;
  detYml: string;
  recModelName: string;
  recYml: string;
} {
  const dictText = new TextDecoder('utf-8').decode(dictBytes).replace(/\r\n/g, '\n');
  const dictLines = dictText.split('\n');
  if (dictLines.length > 0 && dictLines[dictLines.length - 1] === '') {
    dictLines.pop();
  }

  const detModelName = 'PP-OCRv6_manga_det';
  const recModelName = 'PP-OCRv6_manga_rec';

  const detYml = yaml.dump({
    Global: { model_name: detModelName },
    PreProcess: {
      transform_ops: [
        { DetResizeForTest: { resize_long: 960, limit_type: 'max', max_side_limit: 4000 } },
        {
          NormalizeImage: {
            mean: [0.485, 0.456, 0.406],
            std: [0.229, 0.224, 0.225],
            scale: '1./255.',
          },
        },
      ],
    },
    PostProcess: {
      name: 'DBPostProcess',
      thresh: 0.15,
      box_thresh: 0.25,
      max_candidates: 1000,
      unclip_ratio: 1.4,
    },
  });

  const recYml = yaml.dump({
    Global: { model_name: recModelName },
    PreProcess: {
      transform_ops: [{ RecResizeImg: { image_shape: [3, 48, 320] } }],
    },
    PostProcess: {
      name: 'CTCLabelDecode',
      character_dict: dictLines,
    },
  });

  return { detModelName, detYml, recModelName, recYml };
}

function resolveModelTarInputs(
  routeId: OcrRouteId,
  assets: ModelAssetPayload
): {
  detModelName: string;
  detOnnx: Uint8Array;
  detYml: string;
  recModelName: string;
  recOnnx: Uint8Array;
  recYml: string;
} {
  if (routeId === 'ja_zh_ppocrv6_manga') {
    const detOnnx = assets.files['det/manga_det.onnx'];
    const recOnnx = assets.files['rec/manga_rec.onnx'];
    const dictBytes = assets.files['ppocrv6_dict.txt'];
    if (!detOnnx || !recOnnx || !dictBytes) {
      throw new Error('Manga OCR assets are incomplete (expected manga_det.onnx, manga_rec.onnx, ppocrv6_dict.txt).');
    }
    const cfg = synthesizeMangaInferenceConfigs(dictBytes);
    return {
      detModelName: cfg.detModelName,
      detOnnx,
      detYml: cfg.detYml,
      recModelName: cfg.recModelName,
      recOnnx,
      recYml: cfg.recYml,
    };
  }

  const detOnnx = assets.files['det/inference.onnx'];
  const detYmlBytes = assets.files['det/inference.yml'];
  const recOnnx = assets.files['rec/inference.onnx'];
  const recYmlBytes = assets.files['rec/inference.yml'];

  if (!detOnnx || !detYmlBytes || !recOnnx || !recYmlBytes) {
    throw new Error(`OCR assets for route "${routeId}" are incomplete.`);
  }

  const detYml = new TextDecoder('utf-8').decode(detYmlBytes);
  const recYml = new TextDecoder('utf-8').decode(recYmlBytes);

  const detModelName =
    routeId === 'en_ppocrv6_small' ? 'PP-OCRv6_small_det' : 'PP-OCRv5_mobile_det';
  const recModelName =
    routeId === 'en_ppocrv6_small' ? 'PP-OCRv6_small_rec' : 'korean_PP-OCRv5_mobile_rec';

  return { detModelName, detOnnx, detYml, recModelName, recOnnx, recYml };
}

function parseDetConfig(detYml: string) {
  const parsed: any = yaml.load(detYml) || {};
  const ops: any[] = parsed?.PreProcess?.transform_ops || [];
  const resizeOp = ops.find((o) => o && typeof o === 'object' && 'DetResizeForTest' in o)?.DetResizeForTest || {};
  const normOp = ops.find((o) => o && typeof o === 'object' && 'NormalizeImage' in o)?.NormalizeImage || {};
  const post = parsed?.PostProcess || {};

  return {
    resizeLong: Number(resizeOp.resize_long ?? 960),
    mean: Array.isArray(normOp.mean) ? normOp.mean.map(Number) : [0.485, 0.456, 0.406],
    std: Array.isArray(normOp.std) ? normOp.std.map(Number) : [0.229, 0.224, 0.225],
    scale: 1 / 255,
    thresh: Number(post.thresh ?? 0.3),
    boxThresh: Number(post.box_thresh ?? 0.6),
    maxCandidates: Number(post.max_candidates ?? 1000),
    unclipRatio: Number(post.unclip_ratio ?? 1.5),
  };
}

function parseRecConfig(recYml: string) {
  const parsed: any = yaml.load(recYml) || {};
  const ops: any[] = parsed?.PreProcess?.transform_ops || [];
  const resizeOp = ops.find((o) => o && typeof o === 'object' && 'RecResizeImg' in o)?.RecResizeImg || {};
  const shape = Array.isArray(resizeOp.image_shape) ? resizeOp.image_shape.map(Number) : [3, 48, 320];
  const rawDict = Array.isArray(parsed?.PostProcess?.character_dict)
    ? parsed.PostProcess.character_dict.map(String)
    : [];
  return {
    imageShape: shape as [number, number, number],
    charDict: [...rawDict, ' '],
  };
}

function orderQuadPoints(pts: Array<[number, number]>): Array<[number, number]> {
  const sortedX = [...pts].sort((a, b) => a[0] - b[0]);
  const left = sortedX.slice(0, 2).sort((a, b) => a[1] - b[1]);
  const right = sortedX.slice(2, 4).sort((a, b) => a[1] - b[1]);
  return [left[0], right[0], right[1], left[1]];
}

function clipSegmentToBounds(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): [number, number] | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;

  const clipTest = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    clipTest(-dx, x1 - minX) &&
    clipTest(dx, maxX - x1) &&
    clipTest(-dy, y1 - minY) &&
    clipTest(dy, maxY - y1)
  ) {
    return [t0, t1];
  }
  return null;
}

/**
 * Polygon-mask detector scoring consistent with DBPostProcess (`cv.fillPoly` + `cv.mean`).
 * Rasterizes the exact polygon interior and boundary inside the clipped map bounds [0..w-1, 0..h-1]
 * rather than averaging over the enclosing axis-aligned bounding box.
 */
export function scorePolygonMask(
  predMap: ArrayLike<number>,
  w: number,
  h: number,
  poly: Array<[number, number]>
): number {
  if (
    !predMap ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0 ||
    h <= 0 ||
    predMap.length < w * h ||
    !Array.isArray(poly) ||
    poly.length < 3
  ) {
    return 0;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let area2 = 0;

  for (let i = 0; i < poly.length; i++) {
    const pt = poly[i];
    if (!Array.isArray(pt) || pt.length < 2) return 0;
    const [px, py] = pt;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return 0;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    const next = poly[(i + 1) % poly.length];
    if (!Array.isArray(next) || next.length < 2) return 0;
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) return 0;
    area2 += px * next[1] - next[0] * py;
  }

  if (Math.abs(area2) < 1e-6) {
    return 0;
  }

  const xmin = Math.max(0, Math.floor(minX));
  const xmax = Math.min(w - 1, Math.ceil(maxX));
  const ymin = Math.max(0, Math.floor(minY));
  const ymax = Math.min(h - 1, Math.ceil(maxY));
  if (xmax < xmin || ymax < ymin) {
    return 0;
  }

  const rw = xmax - xmin + 1;
  const rh = ymax - ymin + 1;
  const mask = new Uint8Array(rw * rh);

  // 1. Scanline fill interior at integer rows
  const xs: number[] = [];
  for (let y = ymin; y <= ymax; y++) {
    xs.length = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const rowMaskOff = (y - ymin) * rw;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xStart = Math.max(xmin, Math.ceil(xs[k]));
      const xEnd = Math.min(xmax, Math.floor(xs[k + 1]));
      for (let x = xStart; x <= xEnd; x++) {
        mask[rowMaskOff + (x - xmin)] = 1;
      }
    }
  }

  // 2. Rasterize clipped boundary edges cleanly (matching cv.fillPoly edge coverage)
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const tRange = clipSegmentToBounds(x1, y1, x2, y2, xmin - 1, xmax + 1, ymin - 1, ymax + 1);
    if (!tRange) continue;
    const [t0, t1] = tRange;
    const sx = x1 + (x2 - x1) * t0;
    const sy = y1 + (y2 - y1) * t0;
    const ex = x1 + (x2 - x1) * t1;
    const ey = y1 + (y2 - y1) * t1;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(ex - sx), Math.abs(ey - sy))));
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const gx = Math.round(sx + (ex - sx) * u);
      const gy = Math.round(sy + (ey - sy) * u);
      if (gx >= xmin && gx <= xmax && gy >= ymin && gy <= ymax) {
        mask[(gy - ymin) * rw + (gx - xmin)] = 1;
      }
    }
  }

  let sum = 0;
  let count = 0;
  for (let my = 0; my < rh; my++) {
    const rowOff = (ymin + my) * w;
    const maskOff = my * rw;
    for (let mx = 0; mx < rw; mx++) {
      if (mask[maskOff + mx]) {
        const val = predMap[rowOff + xmin + mx];
        if (Number.isFinite(val)) {
          sum += val;
          count++;
        }
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

function unclipPolygon(poly: Array<[number, number]>, unclipRatio: number): Array<[number, number]> | null {
  if (poly.length < 3) return null;
  let area = 0;
  let perim = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    area += x1 * y2 - x2 * y1;
    perim += Math.hypot(x2 - x1, y2 - y1);
  }
  area = Math.abs(area) * 0.5;
  if (area <= 0 || perim <= 0) return null;

  const distance = (area * unclipRatio) / perim;
  const co = new ClipperLib.ClipperOffset();
  const path = poly.map(([x, y]) => ({ X: Math.round(x * 10), Y: Math.round(y * 10) }));
  co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const solution: Array<Array<{ X: number; Y: number }>> = [];
  co.Execute(solution, distance * 10);
  if (!solution || solution.length === 0) return null;

  let bestPath = solution[0];
  let bestArea = -1;
  for (const candidate of solution) {
    if (candidate.length < 3) continue;
    let candidateArea = 0;
    for (let i = 0; i < candidate.length; i++) {
      const p1 = candidate[i];
      const p2 = candidate[(i + 1) % candidate.length];
      candidateArea += p1.X * p2.Y - p2.X * p1.Y;
    }
    candidateArea = Math.abs(candidateArea) * 0.5;
    if (candidateArea > bestArea) {
      bestArea = candidateArea;
      bestPath = candidate;
    }
  }
  return bestPath.map((p) => [p.X / 10, p.Y / 10]);
}

export type RecognizerOutputFormat = 'probabilities' | 'logits' | 'auto';

/**
 * Verified ONNX recognizer output representations for Folio Script's pinned models.
 * Inspected directly against cached ONNX files:
 * - ppocr-v6-small-en (rec/inference.onnx): trailing Softmax -> probabilities in [0, 1]
 * - ppocr-v6-manga-v0.3 (rec/manga_rec.onnx): trailing Softmax -> probabilities in [0, 1]
 * - ppocr-v5-mobile-ko (rec/inference.onnx): trailing Softmax -> probabilities in [0, 1]
 */
export const RECOGNIZER_OUTPUT_FORMAT_BY_ROUTE: Record<OcrRouteId, 'probabilities' | 'logits'> = {
  en_ppocrv6_small: 'probabilities',
  ja_zh_ppocrv6_manga: 'probabilities',
  ko_ppocrv5_mobile: 'probabilities',
};

export interface CtcDecodeOptions {
  outputFormat?: RecognizerOutputFormat;
}

export interface CtcDecodeResult {
  text: string;
  /** Uncalibrated aggregated line confidence (arithmetic mean of selected timestep probabilities in [0, 1]). */
  score: number;
  /** Mean of raw model output values at selected character timesteps (distinct from probability when logits). */
  rawScoreMean: number;
  /** Per-selected-character timestep probabilities in [0, 1]. */
  tokenProbabilities: number[];
  outputFormatUsed: 'probabilities' | 'logits';
  /** Explicitly false: Phase 1.1 does not apply statistical accuracy calibration. */
  confidenceCalibrated: false;
}

/**
 * Checks whether a single timestep row forms a valid probability distribution
 * (all entries finite in [0, 1] within float32 tolerance, summing to ~1.0).
 */
export function isProbabilityDistributionRow(
  data: ArrayLike<number>,
  offset: number,
  classes: number
): boolean {
  if (classes <= 0 || offset < 0 || offset + classes > data.length) {
    return false;
  }
  let sum = 0;
  for (let c = 0; c < classes; c++) {
    const v = data[offset + c];
    if (!Number.isFinite(v) || v < -1e-4 || v > 1 + 1e-4) {
      return false;
    }
    sum += v;
  }
  return Math.abs(sum - 1.0) <= 0.05;
}

/**
 * Numerically stable softmax probability for the argmax class of a logit row.
 * Returns null if the row contains NaN, +Infinity, or only -Infinity entries.
 */
export function computeStableSoftmaxArgmax(
  data: ArrayLike<number>,
  offset: number,
  classes: number
): { maxIdx: number; maxLogit: number; prob: number } | null {
  let maxIdx = -1;
  let maxVal = -Infinity;

  for (let c = 0; c < classes; c++) {
    const v = data[offset + c];
    if (Number.isNaN(v) || v === Infinity) {
      return null;
    }
    if (v > maxVal) {
      maxVal = v;
      maxIdx = c;
    }
  }

  if (maxIdx < 0 || !Number.isFinite(maxVal)) {
    return null;
  }

  let sumExp = 0;
  for (let c = 0; c < classes; c++) {
    const v = data[offset + c];
    if (v === -Infinity) continue;
    sumExp += Math.exp(v - maxVal);
  }

  if (!Number.isFinite(sumExp) || sumExp <= 0) {
    return null;
  }

  const prob = Math.max(0, Math.min(1, 1 / sumExp));
  return { maxIdx, maxLogit: maxVal, prob };
}

function resolveDetectedOutputFormat(
  data: ArrayLike<number>,
  timeSteps: number,
  classes: number,
  requested: RecognizerOutputFormat
): 'probabilities' | 'logits' {
  if (requested === 'probabilities' || requested === 'logits') {
    return requested;
  }
  for (let t = 0; t < timeSteps; t++) {
    const rowOff = t * classes;
    let allFinite = true;
    for (let c = 0; c < classes; c++) {
      if (!Number.isFinite(data[rowOff + c])) {
        allFinite = false;
        break;
      }
    }
    if (!allFinite) continue;
    return isProbabilityDistributionRow(data, rowOff, classes) ? 'probabilities' : 'logits';
  }
  return 'probabilities';
}

/**
 * Decodes greedy CTC output matrices [timeSteps, classes] while strictly respecting
 * whether the recognizer outputs raw logits or already-softmaxed probabilities.
 */
export function decodeCtcOutput(
  data: ArrayLike<number>,
  timeSteps: number,
  classes: number,
  charDict: string[],
  options: CtcDecodeOptions = {}
): CtcDecodeResult {
  const requestedFormat = options.outputFormat ?? 'auto';
  if (
    !data ||
    !Number.isFinite(timeSteps) ||
    !Number.isFinite(classes) ||
    timeSteps <= 0 ||
    classes <= 0 ||
    data.length < timeSteps * classes
  ) {
    return {
      text: '',
      score: 0,
      rawScoreMean: 0,
      tokenProbabilities: [],
      outputFormatUsed: requestedFormat === 'logits' ? 'logits' : 'probabilities',
      confidenceCalibrated: false,
    };
  }

  const formatUsed = resolveDetectedOutputFormat(data, timeSteps, classes, requestedFormat);

  let prevIdx = -1;
  let text = '';
  const tokenProbabilities: number[] = [];
  const rawScores: number[] = [];

  for (let t = 0; t < timeSteps; t++) {
    const rowOff = t * classes;
    let maxIdx = 0;
    let prob = 0;
    let rawVal = 0;

    if (formatUsed === 'logits') {
      const sm = computeStableSoftmaxArgmax(data, rowOff, classes);
      if (!sm) {
        prevIdx = -1;
        continue;
      }
      maxIdx = sm.maxIdx;
      prob = sm.prob;
      rawVal = sm.maxLogit;
    } else {
      let maxVal = -Infinity;
      let sum = 0;
      let rowValid = true;
      for (let c = 0; c < classes; c++) {
        const v = data[rowOff + c];
        if (!Number.isFinite(v) || v < -1e-4 || v > 1 + 1e-4) {
          rowValid = false;
          break;
        }
        sum += Math.max(0, v);
        if (v > maxVal) {
          maxVal = v;
          maxIdx = c;
        }
      }
      if (!rowValid || sum <= 0 || !Number.isFinite(maxVal)) {
        prevIdx = -1;
        continue;
      }
      prob = Math.max(0, Math.min(1, maxVal));
      rawVal = maxVal;
    }

    if (maxIdx > 0 && maxIdx !== prevIdx) {
      const dictIdx = maxIdx - 1;
      if (dictIdx >= 0 && dictIdx < charDict.length) {
        text += charDict[dictIdx];
        tokenProbabilities.push(prob);
        rawScores.push(rawVal);
      }
    }
    prevIdx = maxIdx;
  }

  const score =
    tokenProbabilities.length > 0
      ? tokenProbabilities.reduce((a, b) => a + b, 0) / tokenProbabilities.length
      : 0;
  const rawScoreMean =
    rawScores.length > 0 ? rawScores.reduce((a, b) => a + b, 0) / rawScores.length : 0;

  return {
    text,
    score,
    rawScoreMean,
    tokenProbabilities,
    outputFormatUsed: formatUsed,
    confidenceCalibrated: false,
  };
}

export interface OrtSessionLike {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run: (feeds: Record<string, any>) => Promise<Record<string, any>>;
  release: () => Promise<void>;
}

export interface OrtWebAdapterDeps {
  cv?: OpenCvRuntime;
  createSession?: (bytes: Uint8Array) => Promise<OrtSessionLike>;
  createTensor?: (type: 'float32', data: Float32Array, dims: number[]) => any;
  recognizerOutputFormat?: RecognizerOutputFormat;
}

/**
 * Narrowly scoped ONNX Runtime Web adapter used when @paddleocr/paddleocr-js
 * cannot run (e.g. packaged Electron file:// origins blocked by ensureServedFromHttp()).
 */
export async function createOrtWebOcrAdapter(
  routeId: OcrRouteId,
  assets: ModelAssetPayload,
  deps: OrtWebAdapterDeps = {}
): Promise<OcrPipelineAdapter> {
  const cv = deps.cv ?? (await getOpenCvRuntime()).cv;
  const resolved = resolveModelTarInputs(routeId, assets);
  const detCfg = parseDetConfig(resolved.detYml);
  const recCfg = parseRecConfig(resolved.recYml);
  const recOutputFormat =
    deps.recognizerOutputFormat ?? RECOGNIZER_OUTPUT_FORMAT_BY_ROUTE[routeId];

  const createSession =
    deps.createSession ??
    ((bytes: Uint8Array) =>
      ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }));
  const makeTensor =
    deps.createTensor ??
    ((type: 'float32', data: Float32Array, dims: number[]) => new ort.Tensor(type, data, dims));

  const [detSettled, recSettled] = await Promise.allSettled([
    createSession(resolved.detOnnx),
    createSession(resolved.recOnnx),
  ]);

  if (detSettled.status === 'rejected' || recSettled.status === 'rejected') {
    if (detSettled.status === 'fulfilled') {
      await detSettled.value.release().catch(() => {});
    }
    if (recSettled.status === 'fulfilled') {
      await recSettled.value.release().catch(() => {});
    }
    const err =
      detSettled.status === 'rejected'
        ? detSettled.reason
        : (recSettled as PromiseRejectedResult).reason;
    throw err instanceof Error ? err : new Error(String(err));
  }

  const detSession = detSettled.value;
  const recSession = recSettled.value;

  return {
    runtimeUsed: 'ort_web_adapter',
    async predictCrop(cropRgba: RgbaImageBuffer): Promise<OcrLineRawOutput[]> {
      if (cropRgba.width <= 0 || cropRgba.height <= 0) {
        return [];
      }
      const srcMat = cv.matFromArray(cropRgba.height, cropRgba.width, cv.CV_8UC4, cropRgba.data);
      try {
        const srcW = cropRgba.width;
        const srcH = cropRgba.height;
        const maxSide = Math.max(srcW, srcH);
        const ratio = maxSide > detCfg.resizeLong ? detCfg.resizeLong / maxSide : 1.0;
        const resizeW = Math.max(32, Math.round((srcW * ratio) / 32) * 32);
        const resizeH = Math.max(32, Math.round((srcH * ratio) / 32) * 32);

        const plane = resizeW * resizeH;
        const detInput = new Float32Array(3 * plane);
        const resized = new cv.Mat();
        const bgr = new cv.Mat();
        try {
          cv.resize(srcMat, resized, new cv.Size(resizeW, resizeH), 0, 0, cv.INTER_LINEAR);
          cv.cvtColor(resized, bgr, cv.COLOR_RGBA2BGR);
          const bgrData: Uint8Array = bgr.data;
          for (let i = 0; i < plane; i++) {
            const bi = i * 3;
            detInput[i] = (bgrData[bi] * detCfg.scale - detCfg.mean[0]) / detCfg.std[0];
            detInput[plane + i] = (bgrData[bi + 1] * detCfg.scale - detCfg.mean[1]) / detCfg.std[1];
            detInput[2 * plane + i] = (bgrData[bi + 2] * detCfg.scale - detCfg.mean[2]) / detCfg.std[2];
          }
        } finally {
          resized.delete();
          bgr.delete();
        }

        const detTensor = makeTensor('float32', detInput, [1, 3, resizeH, resizeW]);
        let detOut: Record<string, any> | null = null;
        let predMap: Float32Array;
        let mapW = resizeW;
        let mapH = resizeH;
        try {
          detOut = await detSession.run({ [detSession.inputNames[0]]: detTensor });
          const detOutTensor = detOut?.[detSession.outputNames[0]];
          if (!detOutTensor || !detOutTensor.data) {
            throw new Error(
              `OCR detector output missing expected tensor "${detSession.outputNames[0]}".`
            );
          }
          const dims = detOutTensor.dims;
          if (Array.isArray(dims) && dims.length === 4) {
            mapH = Number(dims[2]);
            mapW = Number(dims[3]);
          } else if (Array.isArray(dims) && dims.length === 3) {
            mapH = Number(dims[1]);
            mapW = Number(dims[2]);
          }
          const rawData = detOutTensor.data as Float32Array;
          if (rawData.length < mapW * mapH) {
            throw new Error(
              `OCR detector output size ${rawData.length} smaller than expected ${mapW}x${mapH}.`
            );
          }
          // Copy probability map out before disposing ORT-owned output tensors
          predMap = new Float32Array(rawData.length);
          predMap.set(rawData);
        } finally {
          disposeOrtTensors(detOut, [detTensor]);
        }

        const mapPlane = mapW * mapH;
        const maskData = new Uint8Array(mapPlane);
        for (let i = 0; i < mapPlane; i++) {
          maskData[i] = predMap[i] > detCfg.thresh ? 255 : 0;
        }

        const detectedPolys: Array<{ poly: Array<[number, number]>; detScore: number }> = [];
        const maskMat = cv.matFromArray(mapH, mapW, cv.CV_8UC1, maskData);
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        try {
          cv.findContours(maskMat, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
          const limit = Math.min(contours.size(), detCfg.maxCandidates);
          for (let c = 0; c < limit; c++) {
            const cnt = contours.get(c);
            try {
              if (cnt.rows < 4) continue;
              const pts: Array<[number, number]> = [];
              for (let p = 0; p < cnt.rows; p++) {
                pts.push([cnt.data32S[p * 2], cnt.data32S[p * 2 + 1]]);
              }
              const detScore = scorePolygonMask(predMap, mapW, mapH, pts);
              if (detScore < detCfg.boxThresh) continue;
              const expanded = unclipPolygon(pts, detCfg.unclipRatio);
              if (!expanded || expanded.length < 3) continue;

              const flatExp: number[] = [];
              for (const [ex, ey] of expanded) flatExp.push(ex, ey);
              const expMat = cv.matFromArray(expanded.length, 1, cv.CV_32FC2, flatExp);
              let rect: { center: any; size: { width: number; height: number }; angle: number };
              try {
                rect = cv.minAreaRect(expMat);
              } finally {
                expMat.delete();
              }

              if (Math.min(rect.size.width, rect.size.height) < 3) continue;
              const rectPts = cv.RotatedRect.points(rect).map(
                (pt: { x: number; y: number }): [number, number] => [
                  Math.max(0, Math.min(srcW, Math.round((pt.x / mapW) * srcW))),
                  Math.max(0, Math.min(srcH, Math.round((pt.y / mapH) * srcH))),
                ]
              );
              detectedPolys.push({ poly: orderQuadPoints(rectPts), detScore });
            } finally {
              cnt.delete();
            }
          }
        } finally {
          maskMat.delete();
          contours.delete();
          hierarchy.delete();
        }

        const lineOutputs: OcrLineRawOutput[] = [];
        const [, targetH, baseW] = recCfg.imageShape;

        for (const item of detectedPolys) {
          const ordered = item.poly;
          const wTop = Math.hypot(ordered[1][0] - ordered[0][0], ordered[1][1] - ordered[0][1]);
          const wBot = Math.hypot(ordered[2][0] - ordered[3][0], ordered[2][1] - ordered[3][1]);
          const hLeft = Math.hypot(ordered[3][0] - ordered[0][0], ordered[3][1] - ordered[0][1]);
          const hRight = Math.hypot(ordered[2][0] - ordered[1][0], ordered[2][1] - ordered[1][1]);
          const cropW = Math.max(1, Math.floor(Math.max(wTop, wBot)));
          const cropH = Math.max(1, Math.floor(Math.max(hLeft, hRight)));

          let warped: any = null;
          let recW = 1;
          let recChw: Float32Array;
          try {
            const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
              ordered[0][0], ordered[0][1],
              ordered[1][0], ordered[1][1],
              ordered[2][0], ordered[2][1],
              ordered[3][0], ordered[3][1],
            ]);
            const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
              0, 0, cropW, 0, cropW, cropH, 0, cropH,
            ]);
            const transform = cv.getPerspectiveTransform(srcTri, dstTri);
            warped = new cv.Mat();
            try {
              cv.warpPerspective(
                srcMat,
                warped,
                transform,
                new cv.Size(cropW, cropH),
                cv.INTER_CUBIC,
                cv.BORDER_REPLICATE,
                new cv.Scalar()
              );
            } finally {
              srcTri.delete();
              dstTri.delete();
              transform.delete();
            }

            if (warped.rows / Math.max(1, warped.cols) >= 1.5) {
              const rotated = new cv.Mat();
              cv.rotate(warped, rotated, cv.ROTATE_90_COUNTERCLOCKWISE);
              warped.delete();
              warped = rotated;
            }

            const rw = warped.cols;
            const rh = warped.rows;
            const ratioWh = rw / Math.max(1, rh);
            const maxWhRatio = Math.max(baseW / Math.max(1, targetH), ratioWh);
            recW = Math.max(1, Math.min(3200, Math.trunc(targetH * maxWhRatio)));
            const resizedW = Math.min(recW, Math.ceil(targetH * ratioWh));

            const recResized = new cv.Mat();
            const recBgr = new cv.Mat();
            try {
              cv.resize(warped, recResized, new cv.Size(resizedW, targetH), 0, 0, cv.INTER_LINEAR);
              cv.cvtColor(recResized, recBgr, cv.COLOR_RGBA2BGR);
              recChw = new Float32Array(3 * targetH * recW);
              const recPlane = targetH * recW;
              const bgrBytes: Uint8Array = recBgr.data;
              for (let y = 0; y < targetH; y++) {
                for (let x = 0; x < resizedW; x++) {
                  const si = (y * resizedW + x) * 3;
                  const di = y * recW + x;
                  recChw[di] = (bgrBytes[si] / 255.0 - 0.5) / 0.5;
                  recChw[recPlane + di] = (bgrBytes[si + 1] / 255.0 - 0.5) / 0.5;
                  recChw[2 * recPlane + di] = (bgrBytes[si + 2] / 255.0 - 0.5) / 0.5;
                }
              }
            } finally {
              recResized.delete();
              recBgr.delete();
            }
          } finally {
            if (warped) warped.delete();
          }

          const recTensor = makeTensor('float32', recChw, [1, 3, targetH, recW]);
          let recOut: Record<string, any> | null = null;
          try {
            recOut = await recSession.run({ [recSession.inputNames[0]]: recTensor });
            const outTensor = recOut?.[recSession.outputNames[0]];
            if (!outTensor || !outTensor.data || !Array.isArray(outTensor.dims) || outTensor.dims.length < 3) {
              throw new Error(
                `OCR recognizer output missing expected 3D tensor "${recSession.outputNames[0]}".`
              );
            }
            const dims = outTensor.dims;
            const decoded = decodeCtcOutput(
              outTensor.data as Float32Array,
              Number(dims[1]),
              Number(dims[2]),
              recCfg.charDict,
              { outputFormat: recOutputFormat }
            );
            lineOutputs.push({
              poly: ordered,
              text: decoded.text,
              score: decoded.score,
              rawModelScoreMean: decoded.rawScoreMean,
              tokenProbabilities: decoded.tokenProbabilities,
              confidenceCalibrated: decoded.confidenceCalibrated,
              detScore: item.detScore,
            });
          } finally {
            disposeOrtTensors(recOut, [recTensor]);
          }
        }

        return lineOutputs;
      } finally {
        srcMat.delete();
      }
    },
    async dispose() {
      await Promise.all([detSession.release(), recSession.release()]);
    },
  };
}

/**
 * Creates an OCR pipeline adapter backed by @paddleocr/paddleocr-js 0.4.2 when served over HTTP(S),
 * falling back cleanly to the verified ORT Web adapter on file:// (packaged Electron) origins.
 */
export async function createOcrPipelineAdapter(options: {
  routeId: OcrRouteId;
  assets: ModelAssetPayload;
  wasmPaths: string;
  numThreads: number;
  simd: boolean;
}): Promise<OcrPipelineAdapter> {
  const { routeId, assets, wasmPaths, numThreads, simd } = options;

  const isFileOrigin =
    typeof globalThis.location !== 'undefined' && globalThis.location?.protocol === 'file:';

  if (isFileOrigin) {
    return createOrtWebOcrAdapter(routeId, assets);
  }

  const { cv } = await getOpenCvRuntime();
  const { PaddleOCR } = await import('@paddleocr/paddleocr-js');
  const resolved = resolveModelTarInputs(routeId, assets);

  const detTar = buildUstarArchive([
    { name: 'inference.onnx', data: resolved.detOnnx },
    { name: 'inference.yml', data: new TextEncoder().encode(resolved.detYml) },
  ]);
  const recTar = buildUstarArchive([
    { name: 'inference.onnx', data: resolved.recOnnx },
    { name: 'inference.yml', data: new TextEncoder().encode(resolved.recYml) },
  ]);

  const localAssetFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('det.tar')) {
      return new Response(new Uint8Array(detTar), { status: 200 });
    }
    if (url.endsWith('rec.tar')) {
      return new Response(new Uint8Array(recTar), { status: 200 });
    }
    return fetch(input);
  };

  const instance = await PaddleOCR.create({
    textDetectionModelName: resolved.detModelName,
    textDetectionModelAsset: { url: 'https://local-folio-assets.invalid/det.tar' },
    textRecognitionModelName: resolved.recModelName,
    textRecognitionModelAsset: { url: 'https://local-folio-assets.invalid/rec.tar' },
    ortOptions: {
      backend: 'wasm',
      wasmPaths,
      simd,
      numThreads,
      disableWasmProxy: true,
    },
    fetch: localAssetFetch,
  });

  return {
    runtimeUsed: 'paddleocr_js',
    async predictCrop(cropRgba: RgbaImageBuffer): Promise<OcrLineRawOutput[]> {
      const mat = cv.matFromArray(cropRgba.height, cropRgba.width, cv.CV_8UC4, cropRgba.data);
      try {
        const results = await instance.predict(mat);
        const items = results?.[0]?.items || [];
        return items.map((item: any) => ({
          poly: (item.poly || []).map((pt: [number, number]) => [Number(pt[0]), Number(pt[1])]),
          text: typeof item.text === 'string' ? item.text : '',
          score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0,
        }));
      } finally {
        mat.delete();
      }
    },
    async dispose() {
      await instance.dispose();
    },
  };
}

/**
 * Runs OCR on a single detected text-bearing candidate by cropping directly from
 * the original decoded page image with padding, then mapping lines back to page space.
 */
export async function recognizeTextCandidateFromOriginal(options: {
  adapter: OcrPipelineAdapter;
  pageRgba: RgbaImageBuffer;
  candidate: AssociatedTextCandidate;
  paddingPixels?: number;
}): Promise<RawOcrLineDetection[]> {
  const { adapter, pageRgba, candidate, paddingPixels = 14 } = options;

  const cropRect = computePaddedPixelCrop(
    candidate.pixelBox,
    pageRgba.width,
    pageRgba.height,
    paddingPixels
  );
  const cropRgba = extractRgbaCrop(
    pageRgba,
    cropRect.x,
    cropRect.y,
    cropRect.width,
    cropRect.height
  );

  const rawLines = await adapter.predictCrop(cropRgba);

  return rawLines.map((line, idx) => {
    const pixelPolygon = cropPolygonToOriginalPixels(
      line.poly,
      cropRect.x,
      cropRect.y,
      pageRgba.width,
      pageRgba.height
    );
    const pixelBox = pixelPolygonToPixelBox(pixelPolygon, pageRgba.width, pageRgba.height);
    const normalizedBox = originalPixelsToNormalized1000(
      pixelBox,
      pageRgba.width,
      pageRgba.height,
      1
    );
    const lineW = Math.max(1, pixelBox[3] - pixelBox[1]);
    const lineH = Math.max(1, pixelBox[2] - pixelBox[0]);

    return {
      lineId: `${candidate.candidateId}_line_${idx + 1}`,
      candidateId: candidate.candidateId,
      text: line.text,
      rawRecognitionScore: line.score,
      rawModelScoreMean: line.rawModelScoreMean,
      tokenProbabilities: line.tokenProbabilities,
      confidenceCalibrated: line.confidenceCalibrated ?? false,
      rawDetectionScore: line.detScore,
      pixelPolygon,
      pixelBox,
      normalizedBox,
      isVertical: lineH / lineW >= 1.5,
    };
  });
}
