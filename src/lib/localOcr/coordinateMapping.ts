import type { TileTransformRecord } from '../../types/localOcr.ts';
import { clampBox } from '../coordinateTransforms.ts';

/**
 * Maps a bounding box from tile detector input space [ymin, xmin, ymax, xmax] (pixels in 0..inputDim)
 * back to original page pixel coordinates, clamping to the valid page bounds.
 */
export function tileInputBoxToOriginalPixels(
  tileInputBox: [number, number, number, number],
  tile: TileTransformRecord,
  sourceWidth: number,
  sourceHeight: number
): [number, number, number, number] {
  const [inYmin, inXmin, inYmax, inXmax] = tileInputBox;

  const validInputW = tile.inputWidth - tile.padRight;
  const validInputH = tile.inputHeight - tile.padBottom;

  const clampedInYmin = Math.max(0, Math.min(validInputH, inYmin));
  const clampedInXmin = Math.max(0, Math.min(validInputW, inXmin));
  const clampedInYmax = Math.max(0, Math.min(validInputH, inYmax));
  const clampedInXmax = Math.max(0, Math.min(validInputW, inXmax));

  const localYmin = clampedInYmin / tile.scaleY;
  const localXmin = clampedInXmin / tile.scaleX;
  const localYmax = clampedInYmax / tile.scaleY;
  const localXmax = clampedInXmax / tile.scaleX;

  const pageYmin = Math.max(0, Math.min(sourceHeight, Math.round(tile.originY + localYmin)));
  const pageXmin = Math.max(0, Math.min(sourceWidth, Math.round(tile.originX + localXmin)));
  const pageYmax = Math.max(0, Math.min(sourceHeight, Math.round(tile.originY + localYmax)));
  const pageXmax = Math.max(0, Math.min(sourceWidth, Math.round(tile.originX + localXmax)));

  const y1 = Math.min(pageYmin, pageYmax);
  const y2 = Math.max(pageYmin, pageYmax);
  const x1 = Math.min(pageXmin, pageXmax);
  const x2 = Math.max(pageXmin, pageXmax);

  return [y1, x1, y2, x2];
}

/**
 * Converts a normalized [ymin, xmin, ymax, xmax] box in [0, 1] relative to tile input
 * into original page pixel coordinates.
 */
export function normalizedTileUnitBoxToOriginalPixels(
  unitBox: [number, number, number, number],
  tile: TileTransformRecord,
  sourceWidth: number,
  sourceHeight: number
): [number, number, number, number] {
  return tileInputBoxToOriginalPixels(
    [
      unitBox[0] * tile.inputHeight,
      unitBox[1] * tile.inputWidth,
      unitBox[2] * tile.inputHeight,
      unitBox[3] * tile.inputWidth,
    ],
    tile,
    sourceWidth,
    sourceHeight
  );
}

/**
 * Maps a crop-local polygon [[x, y], ...] back to original page pixel coordinates.
 */
export function cropPolygonToOriginalPixels(
  polygon: Array<[number, number]>,
  cropOriginX: number,
  cropOriginY: number,
  sourceWidth: number,
  sourceHeight: number
): Array<[number, number]> {
  return polygon.map(([cx, cy]) => [
    Math.max(0, Math.min(sourceWidth, Math.round(cropOriginX + cx))),
    Math.max(0, Math.min(sourceHeight, Math.round(cropOriginY + cy))),
  ]);
}

/**
 * Computes an axis-aligned bounding box [ymin, xmin, ymax, xmax] from pixel polygon vertices.
 */
export function pixelPolygonToPixelBox(
  polygon: Array<[number, number]>,
  sourceWidth: number,
  sourceHeight: number
): [number, number, number, number] {
  if (!polygon || polygon.length === 0) {
    return [0, 0, 1, 1];
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [
    Math.max(0, Math.min(sourceHeight, Math.round(minY))),
    Math.max(0, Math.min(sourceWidth, Math.round(minX))),
    Math.max(0, Math.min(sourceHeight, Math.round(maxY))),
    Math.max(0, Math.min(sourceWidth, Math.round(maxX))),
  ];
}

/**
 * Converts original page pixel coordinates [ymin, xmin, ymax, xmax] to Folio Script's
 * canonical 0-1000 normalized contract, preserving fine line granularity (minDimension=1).
 */
export function originalPixelsToNormalized1000(
  pixelBox: [number, number, number, number],
  sourceWidth: number,
  sourceHeight: number,
  minDimension = 1
): [number, number, number, number] {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return clampBox(pixelBox, 1000, minDimension);
  }
  const [ymin, xmin, ymax, xmax] = pixelBox;
  const normYmin = Math.round((ymin / sourceHeight) * 1000);
  const normXmin = Math.round((xmin / sourceWidth) * 1000);
  const normYmax = Math.round((ymax / sourceHeight) * 1000);
  const normXmax = Math.round((xmax / sourceWidth) * 1000);

  return clampBox([normYmin, normXmin, normYmax, normXmax], 1000, minDimension);
}

/**
 * Converts normalized 0-1000 coordinates back to original page pixel coordinates.
 */
export function normalized1000ToOriginalPixels(
  normBox: [number, number, number, number],
  sourceWidth: number,
  sourceHeight: number
): [number, number, number, number] {
  const [ymin, xmin, ymax, xmax] = clampBox(normBox, 1000, 1);
  return [
    Math.round((ymin / 1000) * sourceHeight),
    Math.round((xmin / 1000) * sourceWidth),
    Math.round((ymax / 1000) * sourceHeight),
    Math.round((xmax / 1000) * sourceWidth),
  ];
}

/**
 * Computes a padded pixel crop region on the original page for OCR recognition.
 */
export function computePaddedPixelCrop(
  pixelBox: [number, number, number, number],
  sourceWidth: number,
  sourceHeight: number,
  paddingPixels = 14
): { x: number; y: number; width: number; height: number } {
  const [ymin, xmin, ymax, xmax] = pixelBox;
  const x = Math.max(0, Math.floor(xmin - paddingPixels));
  const y = Math.max(0, Math.floor(ymin - paddingPixels));
  const right = Math.min(sourceWidth, Math.ceil(xmax + paddingPixels));
  const bottom = Math.min(sourceHeight, Math.ceil(ymax + paddingPixels));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}
