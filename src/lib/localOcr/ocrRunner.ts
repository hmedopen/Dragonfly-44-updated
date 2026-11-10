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
  score: number;
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

function boxScoreFast(predMap: Float32Array, w: number, h: number, poly: Array<[number, number]>): number {
  let xmin = w - 1;
  let xmax = 0;
  let ymin = h - 1;
  let ymax = 0;
  for (const [px, py] of poly) {
    xmin = Math.min(xmin, Math.max(0, Math.floor(px)));
    xmax = Math.max(xmax, Math.min(w - 1, Math.ceil(px)));
    ymin = Math.min(ymin, Math.max(0, Math.floor(py)));
    ymax = Math.max(ymax, Math.min(h - 1, Math.ceil(py)));
  }
  if (xmax <= xmin || ymax <= ymin) return 0;

  let sum = 0;
  let count = 0;
  for (let y = ymin; y <= ymax; y++) {
    const rowOff = y * w;
    for (let x = xmin; x <= xmax; x++) {
      // Bounding-box mean score over probability map inside contour bbox
      sum += predMap[rowOff + x];
      count++;
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
  return solution[0].map((p) => [p.X / 10, p.Y / 10]);
}

function decodeCtcSoftmax(
  data: Float32Array,
  timeSteps: number,
  classes: number,
  charDict: string[]
): { text: string; score: number } {
  let prevIdx = -1;
  let text = '';
  const probs: number[] = [];

  for (let t = 0; t < timeSteps; t++) {
    const rowOff = t * classes;
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let c = 0; c < classes; c++) {
      const v = data[rowOff + c];
      if (v > maxVal) {
        maxVal = v;
        maxIdx = c;
      }
    }
    if (maxIdx > 0 && maxIdx !== prevIdx) {
      const dictIdx = maxIdx - 1;
      if (dictIdx >= 0 && dictIdx < charDict.length) {
        text += charDict[dictIdx];
        probs.push(maxVal);
      }
    }
    prevIdx = maxIdx;
  }

  const score = probs.length > 0 ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;
  return { text, score };
}

/**
 * Narrowly scoped ONNX Runtime Web adapter used when @paddleocr/paddleocr-js
 * cannot run (e.g. packaged Electron file:// origins blocked by ensureServedFromHttp()).
 */
async function createOrtWebOcrAdapter(
  routeId: OcrRouteId,
  assets: ModelAssetPayload
): Promise<OcrPipelineAdapter> {
  const { cv } = await getOpenCvRuntime();
  const resolved = resolveModelTarInputs(routeId, assets);
  const detCfg = parseDetConfig(resolved.detYml);
  const recCfg = parseRecConfig(resolved.recYml);

  const [detSession, recSession] = await Promise.all([
    ort.InferenceSession.create(resolved.detOnnx, { executionProviders: ['wasm'] }),
    ort.InferenceSession.create(resolved.recOnnx, { executionProviders: ['wasm'] }),
  ]);

  return {
    runtimeUsed: 'ort_web_adapter',
    async predictCrop(cropRgba: RgbaImageBuffer): Promise<OcrLineRawOutput[]> {
      const srcMat = cv.matFromArray(cropRgba.height, cropRgba.width, cv.CV_8UC4, cropRgba.data);
      try {
        const srcW = cropRgba.width;
        const srcH = cropRgba.height;
        const maxSide = Math.max(srcW, srcH);
        const ratio = maxSide > detCfg.resizeLong ? detCfg.resizeLong / maxSide : 1.0;
        const resizeW = Math.max(32, Math.round((srcW * ratio) / 32) * 32);
        const resizeH = Math.max(32, Math.round((srcH * ratio) / 32) * 32);

        const resized = new cv.Mat();
        const bgr = new cv.Mat();
        cv.resize(srcMat, resized, new cv.Size(resizeW, resizeH), 0, 0, cv.INTER_LINEAR);
        cv.cvtColor(resized, bgr, cv.COLOR_RGBA2BGR);

        const plane = resizeW * resizeH;
        const detInput = new Float32Array(3 * plane);
        const bgrData: Uint8Array = bgr.data;
        for (let i = 0; i < plane; i++) {
          const bi = i * 3;
          detInput[i] = (bgrData[bi] * detCfg.scale - detCfg.mean[0]) / detCfg.std[0];
          detInput[plane + i] = (bgrData[bi + 1] * detCfg.scale - detCfg.mean[1]) / detCfg.std[1];
          detInput[2 * plane + i] = (bgrData[bi + 2] * detCfg.scale - detCfg.mean[2]) / detCfg.std[2];
        }
        resized.delete();
        bgr.delete();

        const detTensor = new ort.Tensor('float32', detInput, [1, 3, resizeH, resizeW]);
        let predMap: Float32Array;
        try {
          const detOut = await detSession.run({ [detSession.inputNames[0]]: detTensor });
          predMap = detOut[detSession.outputNames[0]].data as Float32Array;
        } finally {
          detTensor.dispose();
        }

        const maskData = new Uint8Array(plane);
        for (let i = 0; i < plane; i++) {
          maskData[i] = predMap[i] > detCfg.thresh ? 255 : 0;
        }
        const maskMat = cv.matFromArray(resizeH, resizeW, cv.CV_8UC1, maskData);
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(maskMat, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        maskMat.delete();
        hierarchy.delete();

        const detectedPolys: Array<{ poly: Array<[number, number]>; detScore: number }> = [];
        const limit = Math.min(contours.size(), detCfg.maxCandidates);
        for (let c = 0; c < limit; c++) {
          const cnt = contours.get(c);
          try {
            if (cnt.rows < 4) continue;
            const pts: Array<[number, number]> = [];
            for (let p = 0; p < cnt.rows; p++) {
              pts.push([cnt.data32S[p * 2], cnt.data32S[p * 2 + 1]]);
            }
            const detScore = boxScoreFast(predMap, resizeW, resizeH, pts);
            if (detScore < detCfg.boxThresh) continue;
            const expanded = unclipPolygon(pts, detCfg.unclipRatio);
            if (!expanded || expanded.length < 3) continue;

            const flatExp: number[] = [];
            for (const [ex, ey] of expanded) flatExp.push(ex, ey);
            const expMat = cv.matFromArray(expanded.length, 1, cv.CV_32FC2, flatExp);
            const rect = cv.minAreaRect(expMat);
            expMat.delete();

            if (Math.min(rect.size.width, rect.size.height) < 3) continue;
            const rectPts = cv.RotatedRect.points(rect).map(
              (pt: { x: number; y: number }): [number, number] => [
                Math.max(0, Math.min(srcW, Math.round((pt.x / resizeW) * srcW))),
                Math.max(0, Math.min(srcH, Math.round((pt.y / resizeH) * srcH))),
              ]
            );
            detectedPolys.push({ poly: orderQuadPoints(rectPts), detScore });
          } finally {
            cnt.delete();
          }
        }
        contours.delete();

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
          let warped = new cv.Mat();
          cv.warpPerspective(
            srcMat,
            warped,
            transform,
            new cv.Size(cropW, cropH),
            cv.INTER_CUBIC,
            cv.BORDER_REPLICATE,
            new cv.Scalar()
          );
          srcTri.delete();
          dstTri.delete();
          transform.delete();

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
          const recW = Math.max(1, Math.min(3200, Math.trunc(targetH * maxWhRatio)));
          const resizedW = Math.min(recW, Math.ceil(targetH * ratioWh));

          const recResized = new cv.Mat();
          const recBgr = new cv.Mat();
          cv.resize(warped, recResized, new cv.Size(resizedW, targetH), 0, 0, cv.INTER_LINEAR);
          cv.cvtColor(recResized, recBgr, cv.COLOR_RGBA2BGR);
          warped.delete();
          recResized.delete();

          const recChw = new Float32Array(3 * targetH * recW);
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
          recBgr.delete();

          const recTensor = new ort.Tensor('float32', recChw, [1, 3, targetH, recW]);
          try {
            const recOut = await recSession.run({ [recSession.inputNames[0]]: recTensor });
            const outTensor = recOut[recSession.outputNames[0]];
            const dims = outTensor.dims;
            const decoded = decodeCtcSoftmax(
              outTensor.data as Float32Array,
              Number(dims[1]),
              Number(dims[2]),
              recCfg.charDict
            );
            lineOutputs.push({
              poly: ordered,
              text: decoded.text,
              score: decoded.score,
              detScore: item.detScore,
            });
          } finally {
            recTensor.dispose();
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
      rawDetectionScore: line.detScore,
      pixelPolygon,
      pixelBox,
      normalizedBox,
      isVertical: lineH / lineW >= 1.5,
    };
  });
}
