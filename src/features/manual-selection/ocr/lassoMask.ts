import type { RgbaImageBuffer } from '../../../lib/localOcr/comicDetector';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computes a pixel-accurate crop rectangle from normalized 0-1000 [ymin, xmin, ymax, xmax] bounds.
 */
export function normalizedBoxToCropRect(
  box_2d: readonly [number, number, number, number],
  sourceWidth: number,
  sourceHeight: number,
  paddingPx = 6
): CropRect {
  const safeW = Math.max(1, sourceWidth);
  const safeH = Math.max(1, sourceHeight);
  const [ymin, xmin, ymax, xmax] = box_2d;

  const pxmin = Math.floor((xmin / 1000) * safeW) - paddingPx;
  const pymin = Math.floor((ymin / 1000) * safeH) - paddingPx;
  const pxmax = Math.ceil((xmax / 1000) * safeW) + paddingPx;
  const pymax = Math.ceil((ymax / 1000) * safeH) + paddingPx;

  const x = Math.max(0, Math.min(safeW - 1, pxmin));
  const y = Math.max(0, Math.min(safeH - 1, pymin));
  const right = Math.max(x + 1, Math.min(safeW, pxmax));
  const bottom = Math.max(y + 1, Math.min(safeH, pymax));

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

/**
 * Estimates a clean uniform fill color from sampled crop-local points
 * so masked regions match bubble/panel background without creating harsh false edges for OCR.
 */
function sampleMedianRgbaAtPoints(
  crop: RgbaImageBuffer,
  points: ReadonlyArray<[number, number]>
): [number, number, number, number] {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  for (const [rawX, rawY] of points) {
    const px = Math.max(0, Math.min(crop.width - 1, Math.round(rawX)));
    const py = Math.max(0, Math.min(crop.height - 1, Math.round(rawY)));
    const off = (py * crop.width + px) * 4;
    rs.push(crop.data[off]);
    gs.push(crop.data[off + 1]);
    bs.push(crop.data[off + 2]);
  }

  if (rs.length === 0) return [255, 255, 255, 255];
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  return [rs[mid], gs[mid], bs[mid], 255];
}

function collectPolygonPerimeterPoints(localPoly: Array<[number, number]>): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < localPoly.length; i++) {
    const [x1, y1] = localPoly[i];
    const [x2, y2] = localPoly[(i + 1) % localPoly.length];
    const samples = Math.max(1, Math.min(16, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 8)));
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      points.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
  }
  return points;
}

function collectEllipsePerimeterPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sampleCount = 32
): Array<[number, number]> {
  const sampleRx = Math.max(0.5, rx * 0.92);
  const sampleRy = Math.max(0.5, ry * 0.92);
  const points: Array<[number, number]> = [];
  for (let i = 0; i < sampleCount; i++) {
    const angle = (i / sampleCount) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * sampleRx, cy + Math.sin(angle) * sampleRy]);
  }
  return points;
}

/**
 * Masks all pixels outside a crop-local polygon using scanline rasterization.
 * Ensures neighboring dialogue outside an irregular lasso region never leaks into OCR.
 */
export function maskCropOutsidePolygon(
  crop: RgbaImageBuffer,
  localPolygon: Array<[number, number]>
): RgbaImageBuffer {
  if (!localPolygon || localPolygon.length < 3 || crop.width <= 0 || crop.height <= 0) {
    return crop;
  }

  const outData = new Uint8ClampedArray(crop.data);
  const [bgR, bgG, bgB, bgA] = sampleMedianRgbaAtPoints(
    crop,
    collectPolygonPerimeterPoints(localPolygon)
  );
  const { width, height } = crop;

  const xs: number[] = [];
  for (let y = 0; y < height; y++) {
    const scanY = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = localPolygon.length - 1; i < localPolygon.length; j = i++) {
      const [xi, yi] = localPolygon[i];
      const [xj, yj] = localPolygon[j];
      if ((yi <= scanY && yj > scanY) || (yj <= scanY && yi > scanY)) {
        xs.push(xi + ((scanY - yi) * (xj - xi)) / (yj - yi));
      }
    }

    if (xs.length < 2) {
      // Whole row is outside polygon -> fill row with background color
      const rowStart = y * width * 4;
      for (let x = 0; x < width; x++) {
        const off = rowStart + x * 4;
        outData[off] = bgR;
        outData[off + 1] = bgG;
        outData[off + 2] = bgB;
        outData[off + 3] = bgA;
      }
      continue;
    }

    xs.sort((a, b) => a - b);
    const insideMask = new Uint8Array(width);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const startX = Math.max(0, Math.floor(xs[k]));
      const endX = Math.min(width - 1, Math.ceil(xs[k + 1]));
      for (let x = startX; x <= endX; x++) {
        insideMask[x] = 1;
      }
    }

    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (insideMask[x] === 0) {
        const off = rowStart + x * 4;
        outData[off] = bgR;
        outData[off + 1] = bgG;
        outData[off + 2] = bgB;
        outData[off + 3] = bgA;
      }
    }
  }

  return {
    width,
    height,
    data: outData,
  };
}

/**
 * Masks all pixels outside a crop-local axis-aligned ellipse so OCR crops respect
 * parametric bubble selections rather than reading unmasked corner background.
 */
export function maskCropOutsideEllipse(
  crop: RgbaImageBuffer,
  localBounds: { left: number; top: number; right: number; bottom: number }
): RgbaImageBuffer {
  if (crop.width <= 0 || crop.height <= 0) {
    return crop;
  }
  const rx = (localBounds.right - localBounds.left) / 2;
  const ry = (localBounds.bottom - localBounds.top) / 2;
  if (rx <= 0 || ry <= 0) {
    return crop;
  }

  const cx = (localBounds.left + localBounds.right) / 2;
  const cy = (localBounds.top + localBounds.bottom) / 2;
  const outData = new Uint8ClampedArray(crop.data);
  const [bgR, bgG, bgB, bgA] = sampleMedianRgbaAtPoints(
    crop,
    collectEllipsePerimeterPoints(cx, cy, rx, ry)
  );
  const { width, height } = crop;

  for (let y = 0; y < height; y++) {
    const dy = (y + 0.5 - cy) / ry;
    const dy2 = dy * dy;
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5 - cx) / rx;
      if (dx * dx + dy2 > 1.0) {
        const off = rowStart + x * 4;
        outData[off] = bgR;
        outData[off + 1] = bgG;
        outData[off + 2] = bgB;
        outData[off + 3] = bgA;
      }
    }
  }

  return {
    width,
    height,
    data: outData,
  };
}
