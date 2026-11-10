import type { TileTransformRecord } from '../../types/localOcr.ts';

export const DETECTOR_TARGET_SIZE = 640;
export const DEFAULT_TILE_OVERLAP_RATIO = 0.2;

export interface TilePlanOptions {
  tileSize?: number;
  overlapRatio?: number;
}

export interface AxisSlice {
  origin: number;
  cropSpan: number;
}

/**
 * Computes deterministic 1D tile slices covering [0, dimension) with zero uncovered pixels.
 * Avoids creating redundant tiles when dimension <= tileSize.
 */
export function computeAxisSlices(
  dimension: number,
  tileSize = DETECTOR_TARGET_SIZE,
  overlapRatio = DEFAULT_TILE_OVERLAP_RATIO
): AxisSlice[] {
  if (!Number.isFinite(dimension) || dimension <= 0) {
    throw new Error(`Invalid page dimension: ${dimension}`);
  }
  if (!Number.isFinite(tileSize) || tileSize <= 0) {
    throw new Error(`Invalid tileSize: ${tileSize}`);
  }
  const safeOverlap = Math.max(0, Math.min(0.49, overlapRatio));

  if (dimension <= tileSize) {
    return [{ origin: 0, cropSpan: dimension }];
  }

  const maxStride = Math.max(1, Math.floor(tileSize * (1 - safeOverlap)));
  const spanRemaining = dimension - tileSize;
  const count = Math.ceil(spanRemaining / maxStride) + 1;

  const slices: AxisSlice[] = [];
  for (let i = 0; i < count; i++) {
    const origin =
      i === count - 1
        ? spanRemaining
        : Math.round((spanRemaining * i) / (count - 1));
    slices.push({ origin, cropSpan: tileSize });
  }

  return slices;
}

/**
 * Plans adaptive overlapping 640x640 tiles across a page of arbitrary dimensions.
 * Handles portrait manga, wide spreads, and tall webtoon strips without full-page shrinking.
 */
export function planAdaptivePageTiles(
  sourceWidth: number,
  sourceHeight: number,
  options: TilePlanOptions = {}
): TileTransformRecord[] {
  const tileSize = options.tileSize ?? DETECTOR_TARGET_SIZE;
  const overlapRatio = options.overlapRatio ?? DEFAULT_TILE_OVERLAP_RATIO;

  const xSlices = computeAxisSlices(sourceWidth, tileSize, overlapRatio);
  const ySlices = computeAxisSlices(sourceHeight, tileSize, overlapRatio);

  const tiles: TileTransformRecord[] = [];

  for (let row = 0; row < ySlices.length; row++) {
    const ySlice = ySlices[row];
    for (let col = 0; col < xSlices.length; col++) {
      const xSlice = xSlices[col];

      const cropWidth = xSlice.cropSpan;
      const cropHeight = ySlice.cropSpan;
      const padRight = Math.max(0, tileSize - cropWidth);
      const padBottom = Math.max(0, tileSize - cropHeight);

      tiles.push({
        tileId: `tile_r${row}_c${col}`,
        row,
        col,
        originX: xSlice.origin,
        originY: ySlice.origin,
        cropWidth,
        cropHeight,
        inputWidth: tileSize,
        inputHeight: tileSize,
        // Native 1:1 pixel resolution inside each tile; smaller edges are zero/border-padded
        scaleX: 1,
        scaleY: 1,
        padRight,
        padBottom,
        touchesPageLeft: xSlice.origin === 0,
        touchesPageTop: ySlice.origin === 0,
        touchesPageRight: xSlice.origin + cropWidth >= sourceWidth,
        touchesPageBottom: ySlice.origin + cropHeight >= sourceHeight,
      });
    }
  }

  return tiles;
}

/**
 * Verifies that a planned tile list covers every integer pixel [0..W-1] x [0..H-1].
 */
export function verifyTileCoverage(
  tiles: TileTransformRecord[],
  sourceWidth: number,
  sourceHeight: number
): boolean {
  if (tiles.length === 0 || sourceWidth <= 0 || sourceHeight <= 0) return false;

  // Check coverage at all boundary and interval points along both axes
  const xPoints = new Set<number>([0, sourceWidth - 1]);
  const yPoints = new Set<number>([0, sourceHeight - 1]);
  for (const t of tiles) {
    xPoints.add(t.originX);
    xPoints.add(Math.min(sourceWidth - 1, t.originX + t.cropWidth - 1));
    if (t.originX + t.cropWidth < sourceWidth) xPoints.add(t.originX + t.cropWidth);
    yPoints.add(t.originY);
    yPoints.add(Math.min(sourceHeight - 1, t.originY + t.cropHeight - 1));
    if (t.originY + t.cropHeight < sourceHeight) yPoints.add(t.originY + t.cropHeight);
  }

  for (const y of yPoints) {
    for (const x of xPoints) {
      const covered = tiles.some(
        (t) =>
          x >= t.originX &&
          x < t.originX + t.cropWidth &&
          y >= t.originY &&
          y < t.originY + t.cropHeight
      );
      if (!covered) return false;
    }
  }

  return true;
}
