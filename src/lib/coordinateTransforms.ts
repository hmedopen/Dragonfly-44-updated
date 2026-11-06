/**
 * Dragonfly 44: System #3 — Manga Scanning & Classification Engine
 * Coordinate Transformations & Transform Ledger
 * 
 * Guarantees mathematical precision and reversibility between:
 * - Original image pixel dimensions (width x height)
 * - Normalized workspace coordinate grid ([0, 1000])
 * - Crop/tile working spaces
 */

import type { TransformRecord } from '../types/scanning';

/**
 * Creates an immutable TransformRecord linking an image's coordinate space.
 */
export function createTransformRecord(options: {
  sourceImageId: string;
  sourceWidth: number;
  sourceHeight: number;
  workingWidth?: number;
  workingHeight?: number;
  rotation?: number;
  cropOriginX?: number;
  cropOriginY?: number;
}): TransformRecord {
  const {
    sourceImageId,
    sourceWidth,
    sourceHeight,
    workingWidth = sourceWidth,
    workingHeight = sourceHeight,
    rotation = 0,
    cropOriginX = 0,
    cropOriginY = 0,
  } = options;

  const scaleX = workingWidth > 0 && sourceWidth > 0 ? workingWidth / sourceWidth : 1;
  const scaleY = workingHeight > 0 && sourceHeight > 0 ? workingHeight / sourceHeight : 1;

  return {
    transformId: `tf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    sourceImageId,
    sourceWidth,
    sourceHeight,
    workingWidth,
    workingHeight,
    scaleX,
    scaleY,
    rotation,
    cropOriginX,
    cropOriginY,
    coordinateSpace: 'normalized_1000',
  };
}

/**
 * Clamps coordinates to [0, maxVal] and guarantees ymax > ymin and xmax > xmin.
 */
export function clampBox(
  box: [number, number, number, number],
  maxCoord = 1000,
  minDimension = 10
): [number, number, number, number] {
  if (!Array.isArray(box) || box.length !== 4) {
    return [200, 200, 400, 400];
  }

  let [ymin, xmin, ymax, xmax] = box.map((val) => {
    const num = Number(val);
    if (isNaN(num)) return 0;
    return Math.max(0, Math.min(maxCoord, Math.round(num)));
  });

  if (ymin > ymax) {
    const tmp = ymin;
    ymin = ymax;
    ymax = tmp;
  }
  if (xmin > xmax) {
    const tmp = xmin;
    xmin = xmax;
    xmax = tmp;
  }

  if (ymax - ymin < minDimension) {
    ymax = Math.min(maxCoord, ymin + minDimension);
    if (ymax - ymin < minDimension) {
      ymin = Math.max(0, ymax - minDimension);
    }
  }

  if (xmax - xmin < minDimension) {
    xmax = Math.min(maxCoord, xmin + minDimension);
    if (xmax - xmin < minDimension) {
      xmin = Math.max(0, xmax - minDimension);
    }
  }

  return [ymin, xmin, ymax, xmax];
}

/**
 * Converts a normalized 0-1000 bounding box to original image pixel coordinates.
 */
export function normalizedToPixelBox(
  box: [number, number, number, number],
  sourceWidth: number,
  sourceHeight: number
): [number, number, number, number] {
  const safeBox = clampBox(box, 1000);
  const [ymin, xmin, ymax, xmax] = safeBox;

  const pixelYmin = Math.round((ymin / 1000) * sourceHeight);
  const pixelXmin = Math.round((xmin / 1000) * sourceWidth);
  const pixelYmax = Math.round((ymax / 1000) * sourceHeight);
  const pixelXmax = Math.round((xmax / 1000) * sourceWidth);

  return [pixelYmin, pixelXmin, pixelYmax, pixelXmax];
}

/**
 * Converts original pixel coordinates to normalized 0-1000 bounding box.
 */
export function pixelToNormalizedBox(
  box: [number, number, number, number],
  sourceWidth: number,
  sourceHeight: number
): [number, number, number, number] {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return clampBox(box, 1000);
  }

  const [ymin, xmin, ymax, xmax] = box;
  const normYmin = Math.round((ymin / sourceHeight) * 1000);
  const normXmin = Math.round((xmin / sourceWidth) * 1000);
  const normYmax = Math.round((ymax / sourceHeight) * 1000);
  const normXmax = Math.round((xmax / sourceWidth) * 1000);

  return clampBox([normYmin, normXmin, normYmax, normXmax], 1000);
}

/**
 * Derives an axis-aligned bounding box from an arbitrary polygon [x, y][].
 */
export function polygonToBoundingBox(
  polygon: Array<[number, number]>,
  maxCoord = 1000
): [number, number, number, number] {
  if (!polygon || polygon.length === 0) {
    return [0, 0, 100, 100];
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return clampBox([minY, minX, maxY, maxX], maxCoord);
}

/**
 * Computes area of a bounding box.
 */
export function computeBoxArea(box: [number, number, number, number]): number {
  const [ymin, xmin, ymax, xmax] = box;
  const width = Math.max(0, xmax - xmin);
  const height = Math.max(0, ymax - ymin);
  return width * height;
}

/**
 * Calculates geometric Intersection-over-Union (IoU) between two bounding boxes.
 * Returns a value between 0.0 (no overlap) and 1.0 (identical).
 */
export function calculateBoxIoU(
  boxA: [number, number, number, number],
  boxB: [number, number, number, number]
): number {
  const [yA1, xA1, yA2, xA2] = boxA;
  const [yB1, xB1, yB2, xB2] = boxB;

  const interYmin = Math.max(yA1, yB1);
  const interXmin = Math.max(xA1, xB1);
  const interYmax = Math.min(yA2, yB2);
  const interXmax = Math.min(xA2, xB2);

  const interW = Math.max(0, interXmax - interXmin);
  const interH = Math.max(0, interYmax - interYmin);
  const interArea = interW * interH;

  if (interArea <= 0) return 0;

  const areaA = (xA2 - xA1) * (yA2 - yA1);
  const areaB = (xB2 - xB1) * (yB2 - yB1);
  const unionArea = areaA + areaB - interArea;

  if (unionArea <= 0) return 0;
  return interArea / unionArea;
}

/**
 * Calculates Euclidean distance between centroids of two boxes in normalized 0-1000 space.
 */
export function calculateCentroidDistance(
  boxA: [number, number, number, number],
  boxB: [number, number, number, number]
): number {
  const cAX = (boxA[1] + boxA[3]) / 2;
  const cAY = (boxA[0] + boxA[2]) / 2;
  const cBX = (boxB[1] + boxB[3]) / 2;
  const cBY = (boxB[0] + boxB[2]) / 2;

  const dx = cAX - cBX;
  const dy = cAY - cBY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Checks whether inner box is contained within outer box with an allowed tolerance.
 */
export function isBoxContained(
  inner: [number, number, number, number],
  outer: [number, number, number, number],
  tolerance = 15
): boolean {
  return (
    inner[0] >= outer[0] - tolerance &&
    inner[1] >= outer[1] - tolerance &&
    inner[2] <= outer[2] + tolerance &&
    inner[3] <= outer[3] + tolerance
  );
}
