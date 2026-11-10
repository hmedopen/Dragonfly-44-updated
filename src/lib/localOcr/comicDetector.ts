import * as ort from 'onnxruntime-web';
import type {
  ComicDetectorClass,
  RawComicDetection,
  TileTransformRecord,
} from '../../types/localOcr.ts';
import {
  originalPixelsToNormalized1000,
  tileInputBoxToOriginalPixels,
} from './coordinateMapping.ts';
import { disposeOrtTensors } from './ortTensorUtils.ts';

export const COMIC_DETECTOR_CLASS_MAP: Record<0 | 1 | 2, ComicDetectorClass> = {
  0: 'bubble',
  1: 'text_bubble',
  2: 'text_free',
};

export interface RgbaImageBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/**
 * Extracts a 640x640 RGB float32 CHW tensor [1, 3, 640, 640] rescaled to [0, 1]
 * matching ogkalu/comic-text-and-bubble-detector's preprocessor_config.json
 * (do_rescale: true, rescale_factor: 1/255, do_normalize: false).
 * Area outside cropWidth/cropHeight (for pages smaller than 640px) is padded with white (1.0).
 */
export function buildTileDetectorTensorData(
  pageRgba: RgbaImageBuffer,
  tile: TileTransformRecord
): Float32Array {
  const dstW = tile.inputWidth;
  const dstH = tile.inputHeight;
  const plane = dstW * dstH;
  const tensor = new Float32Array(3 * plane);
  tensor.fill(1.0); // neutral white padding for edge tiles smaller than 640px

  const srcData = pageRgba.data;
  const srcW = pageRgba.width;
  const validW = Math.min(tile.cropWidth, Math.max(0, srcW - tile.originX));
  const validH = Math.min(tile.cropHeight, Math.max(0, pageRgba.height - tile.originY));

  for (let y = 0; y < validH; y++) {
    const srcRowOffset = ((tile.originY + y) * srcW + tile.originX) * 4;
    const dstRowOffset = y * dstW;
    for (let x = 0; x < validW; x++) {
      const si = srcRowOffset + x * 4;
      const di = dstRowOffset + x;
      tensor[di] = srcData[si] / 255.0;
      tensor[plane + di] = srcData[si + 1] / 255.0;
      tensor[2 * plane + di] = srcData[si + 2] / 255.0;
    }
  }

  return tensor;
}

export interface ComicDetectorSession {
  runTile: (
    pageRgba: RgbaImageBuffer,
    tile: TileTransformRecord,
    scoreThreshold?: number
  ) => Promise<RawComicDetection[]>;
  dispose: () => Promise<void>;
}

/**
 * Parses raw RT-DETR-v2 ONNX outputs (`labels`, `boxes`, `scores`) for a single tile
 * and projects boxes back to original page pixel coordinates and [0, 1000] normalized space.
 */
export function parseComicDetectorTileOutputs(options: {
  labels: BigInt64Array | Int32Array | ArrayLike<number | bigint>;
  boxes: Float32Array | ArrayLike<number>;
  scores: Float32Array | ArrayLike<number>;
  tile: TileTransformRecord;
  sourceWidth: number;
  sourceHeight: number;
  scoreThreshold: number;
}): RawComicDetection[] {
  const {
    labels,
    boxes,
    scores,
    tile,
    sourceWidth,
    sourceHeight,
    scoreThreshold,
  } = options;

  const detections: RawComicDetection[] = [];
  const validInputW = tile.inputWidth - tile.padRight;
  const validInputH = tile.inputHeight - tile.padBottom;
  const boundaryMarginPx = 4;

  for (let i = 0; i < scores.length; i++) {
    const rawScore = Number(scores[i]);
    if (!Number.isFinite(rawScore) || rawScore < scoreThreshold) continue;

    const rawClassId = Number(labels[i]);
    if (rawClassId !== 0 && rawClassId !== 1 && rawClassId !== 2) continue;

    // Verified RT-DETR ONNX output format: [xmin, ymin, xmax, ymax] in orig_target_sizes pixels
    const xmin = Number(boxes[i * 4]);
    const ymin = Number(boxes[i * 4 + 1]);
    const xmax = Number(boxes[i * 4 + 2]);
    const ymax = Number(boxes[i * 4 + 3]);

    if (
      !Number.isFinite(xmin) ||
      !Number.isFinite(ymin) ||
      !Number.isFinite(xmax) ||
      !Number.isFinite(ymax)
    ) {
      continue;
    }

    const pixelBox = tileInputBoxToOriginalPixels(
      [ymin, xmin, ymax, xmax],
      tile,
      sourceWidth,
      sourceHeight
    );

    if (pixelBox[2] - pixelBox[0] < 2 || pixelBox[3] - pixelBox[1] < 2) {
      continue;
    }

    const normalizedBox = originalPixelsToNormalized1000(
      pixelBox,
      sourceWidth,
      sourceHeight,
      1
    );

    detections.push({
      detectionId: `${tile.tileId}_det_${i}`,
      classLabel: COMIC_DETECTOR_CLASS_MAP[rawClassId],
      classId: rawClassId,
      pixelBox,
      normalizedBox,
      rawScore,
      tileId: tile.tileId,
      touchesTileInnerLeft: xmin <= boundaryMarginPx,
      touchesTileInnerTop: ymin <= boundaryMarginPx,
      touchesTileInnerRight: xmax >= validInputW - boundaryMarginPx,
      touchesTileInnerBottom: ymax >= validInputH - boundaryMarginPx,
    });
  }

  return detections;
}

export interface ComicDetectorSessionLike {
  inputNames: readonly string[];
  run: (feeds: Record<string, any>) => Promise<Record<string, any>>;
  release: () => Promise<void>;
}

export interface CreateComicDetectorDeps {
  createSession?: (onnxBytes: Uint8Array) => Promise<ComicDetectorSessionLike>;
  createTensor?: (type: 'float32' | 'int64', data: Float32Array | BigInt64Array, dims: number[]) => any;
  parseOutputs?: typeof parseComicDetectorTileOutputs;
}

export async function createComicDetectorSession(
  onnxBytes: Uint8Array,
  deps: CreateComicDetectorDeps = {}
): Promise<ComicDetectorSession> {
  const session: ComicDetectorSessionLike = deps.createSession
    ? await deps.createSession(onnxBytes)
    : await ort.InferenceSession.create(onnxBytes, {
        executionProviders: ['wasm'],
      });

  if (
    !session.inputNames.includes('images') ||
    !session.inputNames.includes('orig_target_sizes')
  ) {
    await session.release();
    throw new Error(
      `Unexpected comic detector inputs: [${session.inputNames.join(', ')}]. Expected [images, orig_target_sizes].`
    );
  }

  const makeTensor =
    deps.createTensor ??
    ((type: 'float32' | 'int64', data: Float32Array | BigInt64Array, dims: number[]) =>
      new ort.Tensor(type, data, dims));
  const parseTileOutputs = deps.parseOutputs ?? parseComicDetectorTileOutputs;

  return {
    async runTile(pageRgba, tile, scoreThreshold = 0.35) {
      const chw = buildTileDetectorTensorData(pageRgba, tile);
      const imageTensor = makeTensor('float32', chw, [
        1,
        3,
        tile.inputHeight,
        tile.inputWidth,
      ]);
      const sizeTensor = makeTensor(
        'int64',
        BigInt64Array.from([BigInt(tile.inputWidth), BigInt(tile.inputHeight)]),
        [1, 2]
      );

      let outputs: Record<string, any> | null = null;
      try {
        outputs = await session.run({
          images: imageTensor,
          orig_target_sizes: sizeTensor,
        });

        const labelsTensor = outputs.labels;
        const boxesTensor = outputs.boxes;
        const scoresTensor = outputs.scores;

        if (!labelsTensor || !boxesTensor || !scoresTensor) {
          throw new Error(
            `Comic detector output missing expected tensors. Got [${Object.keys(outputs).join(', ')}].`
          );
        }

        return parseTileOutputs({
          labels: labelsTensor.data as BigInt64Array,
          boxes: boxesTensor.data as Float32Array,
          scores: scoresTensor.data as Float32Array,
          tile,
          sourceWidth: pageRgba.width,
          sourceHeight: pageRgba.height,
          scoreThreshold,
        });
      } finally {
        disposeOrtTensors(outputs, [imageTensor, sizeTensor]);
      }
    },
    async dispose() {
      await session.release();
    },
  };
}
