import type {
  NormalizedBox2D,
  NormalizedPolygon,
} from '../types/selection';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface ImageViewportMetrics {
  /** Intrinsic image dimensions in pixels */
  sourceWidth: number;
  sourceHeight: number;
  /** Rendered unzoomed/fitted image rectangle in viewport-local CSS pixels */
  renderedLeft: number;
  renderedTop: number;
  renderedWidth: number;
  renderedHeight: number;
}

const COORD_PRECISION = 1000; // preserve 3 decimal places in 0-1000 normalized space for ultra-tall strips

export function roundNorm(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1000, Math.round(value * COORD_PRECISION) / COORD_PRECISION));
}

/**
 * Clamps and validates a normalized [ymin, xmin, ymax, xmax] box on the 0-1000 scale,
 * preserving sub-integer precision so very tall long-strip images remain pixel-accurate.
 */
export function clampNormalizedBox(
  box: readonly [number, number, number, number],
  minSpan = 1.5
): NormalizedBox2D {
  let ymin = Number(box[0]);
  let xmin = Number(box[1]);
  let ymax = Number(box[2]);
  let xmax = Number(box[3]);

  if (!Number.isFinite(ymin)) ymin = 0;
  if (!Number.isFinite(xmin)) xmin = 0;
  if (!Number.isFinite(ymax)) ymax = minSpan;
  if (!Number.isFinite(xmax)) xmax = minSpan;

  if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
  if (xmin > xmax) [xmin, xmax] = [xmax, xmin];

  ymin = Math.max(0, Math.min(1000, ymin));
  xmin = Math.max(0, Math.min(1000, xmin));
  ymax = Math.max(0, Math.min(1000, ymax));
  xmax = Math.max(0, Math.min(1000, xmax));

  if (ymax - ymin < minSpan) {
    ymax = Math.min(1000, ymin + minSpan);
    if (ymax - ymin < minSpan) {
      ymin = Math.max(0, ymax - minSpan);
    }
  }
  if (xmax - xmin < minSpan) {
    xmax = Math.min(1000, xmin + minSpan);
    if (xmax - xmin < minSpan) {
      xmin = Math.max(0, xmax - minSpan);
    }
  }

  return [roundNorm(ymin), roundNorm(xmin), roundNorm(ymax), roundNorm(xmax)];
}

/**
 * Converts a point from rendered image client/element coordinates into normalized 0-1000 image space.
 */
export function renderedPointToNormalized(
  clientX: number,
  clientY: number,
  imageRect: { left: number; top: number; width: number; height: number }
): [number, number] | null {
  if (imageRect.width <= 0 || imageRect.height <= 0) return null;
  const nx = ((clientX - imageRect.left) / imageRect.width) * 1000;
  const ny = ((clientY - imageRect.top) / imageRect.height) * 1000;
  return [roundNorm(nx), roundNorm(ny)];
}

/**
 * Converts normalized 0-1000 image coordinates back to rendered pixel coordinates relative to image top-left.
 */
export function normalizedPointToRendered(
  normX: number,
  normY: number,
  renderedWidth: number,
  renderedHeight: number
): { x: number; y: number } {
  return {
    x: (normX / 1000) * renderedWidth,
    y: (normY / 1000) * renderedHeight,
  };
}

/**
 * Converts normalized [ymin, xmin, ymax, xmax] (0-1000) to original image pixel box [ymin, xmin, ymax, xmax].
 */
export function normalizedBoxToOriginalPixels(
  box: NormalizedBox2D,
  sourceWidth: number,
  sourceHeight: number
): [number, number, number, number] {
  const safeW = Math.max(1, sourceWidth);
  const safeH = Math.max(1, sourceHeight);
  const [ymin, xmin, ymax, xmax] = clampNormalizedBox(box, 0.05);

  const pymin = Math.max(0, Math.min(safeH - 1, Math.floor((ymin / 1000) * safeH)));
  const pxmin = Math.max(0, Math.min(safeW - 1, Math.floor((xmin / 1000) * safeW)));
  const pymax = Math.max(pymin + 1, Math.min(safeH, Math.ceil((ymax / 1000) * safeH)));
  const pxmax = Math.max(pxmin + 1, Math.min(safeW, Math.ceil((xmax / 1000) * safeW)));

  return [pymin, pxmin, pymax, pxmax];
}

/**
 * Converts original image pixel box [ymin, xmin, ymax, xmax] to normalized 0-1000 box.
 */
export function originalPixelBoxToNormalized(
  pixelBox: readonly [number, number, number, number],
  sourceWidth: number,
  sourceHeight: number
): NormalizedBox2D {
  const safeW = Math.max(1, sourceWidth);
  const safeH = Math.max(1, sourceHeight);
  return clampNormalizedBox(
    [
      (pixelBox[0] / safeH) * 1000,
      (pixelBox[1] / safeW) * 1000,
      (pixelBox[2] / safeH) * 1000,
      (pixelBox[3] / safeW) * 1000,
    ],
    0.05
  );
}

/**
 * Converts normalized 0-1000 polygon to original pixel polygon [[x, y], ...].
 */
export function normalizedPolygonToOriginalPixels(
  polygon: NormalizedPolygon,
  sourceWidth: number,
  sourceHeight: number
): Array<[number, number]> {
  const safeW = Math.max(1, sourceWidth);
  const safeH = Math.max(1, sourceHeight);
  return polygon.map(([nx, ny]) => [
    Math.max(0, Math.min(safeW, (nx / 1000) * safeW)),
    Math.max(0, Math.min(safeH, (ny / 1000) * safeH)),
  ]);
}

/**
 * Computes minimum normalized span that corresponds to at least `minPixels` on the original image,
 * bounded sensibly so tiny selections on tall strips remain selectable and large images stay accurate.
 */
export function getMinNormalizedSpan(
  sourceWidth: number,
  sourceHeight: number,
  minPixels = 8
): { minSpanX: number; minSpanY: number } {
  const safeW = Math.max(1, sourceWidth);
  const safeH = Math.max(1, sourceHeight);
  return {
    minSpanX: Math.max(0.5, Math.min(20, (minPixels / safeW) * 1000)),
    minSpanY: Math.max(0.2, Math.min(20, (minPixels / safeH) * 1000)),
  };
}

/**
 * Derives a tight axis-aligned bounding box [ymin, xmin, ymax, xmax] from a 0-1000 polygon.
 */
export function deriveBoundingBoxFromPolygon(polygon: NormalizedPolygon): NormalizedBox2D {
  if (!polygon || polygon.length === 0) {
    return [0, 0, 10, 10];
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
  return clampNormalizedBox([minY, minX, maxY, maxX], 0.2);
}

/**
 * Ramer-Douglas-Peucker simplification for freeform lasso strokes in normalized 0-1000 space.
 */
export function simplifyPolygon(
  points: NormalizedPolygon,
  epsilon = 0.8
): NormalizedPolygon {
  if (points.length <= 3) {
    return points.map(([x, y]) => [roundNorm(x), roundNorm(y)]);
  }

  const distPointToSegment = (
    p: [number, number],
    a: [number, number],
    b: [number, number]
  ): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };

  let maxDist = 0;
  let splitIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = distPointToSegment(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      splitIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPolygon(points.slice(0, splitIdx + 1), epsilon);
    const right = simplifyPolygon(points.slice(splitIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [
    [roundNorm(first[0]), roundNorm(first[1])],
    [roundNorm(last[0]), roundNorm(last[1])],
  ];
}

function segmentsIntersect(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number]
): boolean {
  const cross = (
    o: [number, number],
    p: [number, number],
    q: [number, number]
  ) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);

  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

/**
 * Checks whether a closed polygon has any non-adjacent intersecting edges.
 */
export function hasPolygonSelfIntersection(polygon: NormalizedPolygon): boolean {
  const n = polygon.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      // Skip adjacent edges (including closing edge to edge 0)
      if (i === 0 && j === n - 1) continue;
      const b1 = polygon[j];
      const b2 = polygon[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Computes shoelace polygon area in 0-1000 space.
 */
export function computePolygonArea(polygon: NormalizedPolygon): number {
  if (polygon.length < 3) return 0;
  let area2 = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    area2 += x1 * y2 - x2 * y1;
  }
  return Math.abs(area2) * 0.5;
}

/**
 * Resolves simple self-intersections (bowtie untangling) by performing 2-opt edge uncrossing,
 * or falls back to convex hull / monotonic ordering if heavily tangled.
 */
export function untanglePolygon(polygon: NormalizedPolygon): NormalizedPolygon {
  const pts = polygon.map(([x, y]): [number, number] => [roundNorm(x), roundNorm(y)]);
  const n = pts.length;
  if (n < 4) return pts;

  // Bounded 2-opt untangling pass
  const maxPasses = 40;
  for (let pass = 0; pass < maxPasses; pass++) {
    let swapped = false;
    for (let i = 0; i < n; i++) {
      const a1 = pts[i];
      const a2 = pts[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const b1 = pts[j];
        const b2 = pts[(j + 1) % n];
        if (segmentsIntersect(a1, a2, b1, b2)) {
          // Reverse segment [i+1 .. j]
          let l = i + 1;
          let r = j;
          while (l < r) {
            const tmp = pts[l];
            pts[l] = pts[r];
            pts[r] = tmp;
            l++;
            r--;
          }
          swapped = true;
          break;
        }
      }
      if (swapped) break;
    }
    if (!swapped) break;
  }

  if (!hasPolygonSelfIntersection(pts)) {
    return pts;
  }

  // Fallback: Andrew's monotone chain convex hull guarantees a simple closed polygon
  const sorted = [...pts].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: NormalizedPolygon = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: NormalizedPolygon = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export interface ValidatedLassoResult {
  valid: boolean;
  polygon: NormalizedPolygon;
  box_2d: NormalizedBox2D;
  wasUntangled: boolean;
  reason?: string;
}

/**
 * Validates, simplifies, untangles (if needed), and closes a raw freeform lasso path.
 */
export function finalizeLassoPolygon(
  rawPoints: NormalizedPolygon,
  sourceWidth = 1000,
  sourceHeight = 1000
): ValidatedLassoResult {
  if (!rawPoints || rawPoints.length < 3) {
    return {
      valid: false,
      polygon: [],
      box_2d: [0, 0, 10, 10],
      wasUntangled: false,
      reason: 'Draw a larger closed lasso region around the text.',
    };
  }

  // Deduplicate adjacent near-identical points
  const deduped: NormalizedPolygon = [];
  for (const pt of rawPoints) {
    const clamped: [number, number] = [roundNorm(pt[0]), roundNorm(pt[1])];
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(clamped[0] - prev[0], clamped[1] - prev[1]) >= 0.4) {
      deduped.push(clamped);
    }
  }

  // Scale simplification epsilon gently for ultra-tall images
  const aspectRatio = Math.max(1, sourceHeight / Math.max(1, sourceWidth));
  const epsilon = aspectRatio > 3 ? 0.35 : 0.7;
  let simplified = simplifyPolygon(deduped, epsilon);
  if (simplified.length < 3 && deduped.length >= 3) {
    simplified = deduped;
  }

  if (simplified.length < 3) {
    return {
      valid: false,
      polygon: [],
      box_2d: [0, 0, 10, 10],
      wasUntangled: false,
      reason: 'Lasso needs at least 3 distinct points.',
    };
  }

  let wasUntangled = false;
  if (hasPolygonSelfIntersection(simplified)) {
    simplified = untanglePolygon(simplified);
    wasUntangled = true;
  }

  const box_2d = deriveBoundingBoxFromPolygon(simplified);
  const boxW = box_2d[3] - box_2d[1];
  const boxH = box_2d[2] - box_2d[0];
  const { minSpanX, minSpanY } = getMinNormalizedSpan(sourceWidth, sourceHeight, 8);
  const area = computePolygonArea(simplified);

  if (boxW < minSpanX || boxH < minSpanY || area < minSpanX * minSpanY * 0.25) {
    return {
      valid: false,
      polygon: [],
      box_2d,
      wasUntangled,
      reason: 'Lasso selection is too small to contain readable text.',
    };
  }

  return {
    valid: true,
    polygon: simplified,
    box_2d,
    wasUntangled,
  };
}

/**
 * Resamples a closed loop into N evenly spaced arc-length vertices so noisy pointer clusters
 * smooth evenly without skewing towards slow stroke regions.
 */
export function resampleClosedPath(
  polygon: NormalizedPolygon,
  sampleCount: number
): NormalizedPolygon {
  if (!polygon || polygon.length < 3 || sampleCount < 3) return polygon;

  const segLens: number[] = [];
  let totalPerimeter = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segLens.push(d);
    totalPerimeter += d;
  }

  if (totalPerimeter < 1e-3) return polygon;

  const step = totalPerimeter / sampleCount;
  const out: NormalizedPolygon = [];
  let edgeIdx = 0;
  let edgeStartDist = 0;

  for (let k = 0; k < sampleCount; k++) {
    const targetDist = k * step;
    while (edgeIdx < segLens.length - 1 && edgeStartDist + segLens[edgeIdx] < targetDist) {
      edgeStartDist += segLens[edgeIdx];
      edgeIdx++;
    }
    const len = Math.max(1e-6, segLens[edgeIdx]);
    const t = Math.max(0, Math.min(1, (targetDist - edgeStartDist) / len));
    const p0 = polygon[edgeIdx];
    const p1 = polygon[(edgeIdx + 1) % polygon.length];
    out.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
  }

  return out;
}

/**
 * Applies closed-loop Chaikin corner cutting iterations to transform a hand-drawn stroke
 * into an organic, rounded speech-bubble silhouette while faithfully preserving asymmetric egg/oval contours.
 */
export function smoothClosedChaikin(
  polygon: NormalizedPolygon,
  iterations = 3
): NormalizedPolygon {
  if (!polygon || polygon.length < 3 || iterations <= 0) return polygon;

  let current: NormalizedPolygon = polygon.map(([x, y]) => [x, y]);
  for (let iter = 0; iter < iterations; iter++) {
    const next: NormalizedPolygon = [];
    const n = current.length;
    for (let i = 0; i < n; i++) {
      const p0 = current[i];
      const p1 = current[(i + 1) % n];
      next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
      next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
    }
    current = next;
  }
  return current;
}

/**
 * Converts a rough Photoshop-style freehand Bubble stroke into a clean, rounded, organic closed outline
 * without forcing a symmetric circle/ellipse or converting it into a rectangle.
 */
export function finalizeBubblePolygon(
  rawPoints: NormalizedPolygon,
  sourceWidth = 1000,
  sourceHeight = 1000
): ValidatedLassoResult {
  if (!rawPoints || rawPoints.length < 3) {
    return {
      valid: false,
      polygon: [],
      box_2d: [0, 0, 10, 10],
      wasUntangled: false,
      reason: 'Draw a larger bubble outline around the text.',
    };
  }

  // Filter adjacent duplicate tremor points
  const deduped: NormalizedPolygon = [];
  for (const pt of rawPoints) {
    const clamped: [number, number] = [roundNorm(pt[0]), roundNorm(pt[1])];
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(clamped[0] - prev[0], clamped[1] - prev[1]) >= 0.6) {
      deduped.push(clamped);
    }
  }

  if (deduped.length < 3) {
    return {
      valid: false,
      polygon: [],
      box_2d: [0, 0, 10, 10],
      wasUntangled: false,
      reason: 'Bubble outline needs at least 3 distinct points.',
    };
  }

  // Estimate closed perimeter to pick balanced coarse sample count before Chaikin smoothing
  let perimeter = 0;
  for (let i = 0; i < deduped.length; i++) {
    const a = deduped[i];
    const b = deduped[(i + 1) % deduped.length];
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const coarseSamples = Math.max(16, Math.min(36, Math.round(perimeter / 18)));
  let working = resampleClosedPath(deduped, coarseSamples);

  let wasUntangled = false;
  if (hasPolygonSelfIntersection(working)) {
    working = untanglePolygon(working);
    wasUntangled = true;
  }

  const chaikinSmoothed = smoothClosedChaikin(working, 3);
  const decimated = simplifyPolygon(chaikinSmoothed, 0.38).map(
    ([x, y]): [number, number] => [roundNorm(x), roundNorm(y)]
  );
  const finalPoly = decimated.length >= 8 ? decimated : chaikinSmoothed.map(([x, y]): [number, number] => [roundNorm(x), roundNorm(y)]);

  const box_2d = deriveBoundingBoxFromPolygon(finalPoly);
  const boxW = box_2d[3] - box_2d[1];
  const boxH = box_2d[2] - box_2d[0];
  const { minSpanX, minSpanY } = getMinNormalizedSpan(sourceWidth, sourceHeight, 8);
  const area = computePolygonArea(finalPoly);

  if (boxW < minSpanX || boxH < minSpanY || area < minSpanX * minSpanY * 0.25) {
    return {
      valid: false,
      polygon: [],
      box_2d,
      wasUntangled,
      reason: 'Bubble selection is too small to contain readable text.',
    };
  }

  return {
    valid: true,
    polygon: finalPoly,
    box_2d,
    wasUntangled,
  };
}

/**
 * Proportionally scales a Bubble or Lasso polygon when its enclosing bounding box is resized.
 */
export function scalePolygonFromBox(
  polygon: NormalizedPolygon,
  oldBox: NormalizedBox2D,
  newBox: NormalizedBox2D
): NormalizedPolygon {
  const oldW = Math.max(1e-4, oldBox[3] - oldBox[1]);
  const oldH = Math.max(1e-4, oldBox[2] - oldBox[0]);
  const newW = newBox[3] - newBox[1];
  const newH = newBox[2] - newBox[0];

  return polygon.map(([px, py]): [number, number] => {
    const rx = (px - oldBox[1]) / oldW;
    const ry = (py - oldBox[0]) / oldH;
    return [roundNorm(newBox[1] + rx * newW), roundNorm(newBox[0] + ry * newH)];
  });
}

/**
 * Ray-casting point-in-polygon check in normalized 0-1000 coordinates.
 */
export function isPointInPolygon(
  px: number,
  py: number,
  polygon: NormalizedPolygon
): boolean {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function finalizeTwoPointBox(
  start: [number, number],
  end: [number, number],
  sourceWidth?: number,
  sourceHeight?: number,
  minPixels = 6
): NormalizedBox2D | null {
  const box = clampNormalizedBox([
    roundNorm(Math.min(start[1], end[1])),
    roundNorm(Math.min(start[0], end[0])),
    roundNorm(Math.max(start[1], end[1])),
    roundNorm(Math.max(start[0], end[0])),
  ]);
  const { minSpanX, minSpanY } = getMinNormalizedSpan(
    sourceWidth ?? 1000,
    sourceHeight ?? 1000,
    minPixels
  );
  if (box[3] - box[1] < minSpanX || box[2] - box[0] < minSpanY) {
    return null;
  }
  return box;
}

export function isPointInBox(
  px: number,
  py: number,
  box: NormalizedBox2D,
  padding = 0
): boolean {
  return (
    px >= box[1] - padding &&
    px <= box[3] + padding &&
    py >= box[0] - padding &&
    py <= box[2] + padding
  );
}

export function isPointInEllipse(
  px: number,
  py: number,
  box: NormalizedBox2D,
  padding = 0
): boolean {
  const rx = (box[3] - box[1]) / 2 + padding;
  const ry = (box[2] - box[0]) / 2 + padding;
  if (rx <= 0 || ry <= 0) return false;
  const cx = (box[1] + box[3]) / 2;
  const cy = (box[0] + box[2]) / 2;
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/**
 * Translates a selection (box + polygon if Bubble/Lasso) by (dx, dy) in normalized 0-1000 space,
 * keeping its full shape clamped inside [0, 1000].
 */
export function translateSelectionGeometry(
  region: { box_2d: NormalizedBox2D; polygon?: NormalizedPolygon },
  rawDx: number,
  rawDy: number
): { box_2d: NormalizedBox2D; polygon?: NormalizedPolygon } {
  const [ymin, xmin, ymax, xmax] = region.box_2d;
  const clampedDx = Math.max(-xmin, Math.min(1000 - xmax, rawDx));
  const clampedDy = Math.max(-ymin, Math.min(1000 - ymax, rawDy));

  const nextBox: NormalizedBox2D = [
    roundNorm(ymin + clampedDy),
    roundNorm(xmin + clampedDx),
    roundNorm(ymax + clampedDy),
    roundNorm(xmax + clampedDx),
  ];

  const nextPolygon = region.polygon
    ? region.polygon.map(([px, py]): [number, number] => [
        roundNorm(px + clampedDx),
        roundNorm(py + clampedDy),
      ])
    : undefined;

  return { box_2d: nextBox, polygon: nextPolygon };
}

/**
 * Resizes a bounding box from a given handle without inverting past minimum dimensions.
 */
export function resizeBoxFromHandle(
  initialBox: NormalizedBox2D,
  handle: ResizeHandle,
  targetNormX: number,
  targetNormY: number,
  minSpanX = 1.5,
  minSpanY = 1.0
): NormalizedBox2D {
  let [ymin, xmin, ymax, xmax] = initialBox;
  const clampedX = Math.max(0, Math.min(1000, targetNormX));
  const clampedY = Math.max(0, Math.min(1000, targetNormY));

  if (handle.includes('n')) {
    ymin = Math.min(ymax - minSpanY, clampedY);
  }
  if (handle.includes('s')) {
    ymax = Math.max(ymin + minSpanY, clampedY);
  }
  if (handle.includes('w')) {
    xmin = Math.min(xmax - minSpanX, clampedX);
  }
  if (handle.includes('e')) {
    xmax = Math.max(xmin + minSpanX, clampedX);
  }

  return clampNormalizedBox([ymin, xmin, ymax, xmax], Math.min(minSpanX, minSpanY));
}

/**
 * Computes a stable signature string for a selection's geometry so post-OCR edits
 * can track whether geometry changed since last extraction.
 */
export function computeGeometrySignature(
  box_2d: NormalizedBox2D,
  polygon?: NormalizedPolygon
): string {
  const boxPart = box_2d.map((n) => n.toFixed(3)).join(',');
  if (!polygon || polygon.length === 0) {
    return `box:${boxPart}`;
  }
  const polyPart = polygon.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(';');
  return `poly:${boxPart}|${polyPart}`;
}
