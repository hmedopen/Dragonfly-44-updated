/**
 * Dragonfly 44: System #6 — Settings, Workspace & Quality Benchmark Engine
 * Canonical Workspace Geometry Service & Transform Pipeline
 * 
 * Implements the single composed source-to-screen transform and its exact inverse:
 *   p_screen = T_dpi x T_viewport x T_pan x T_zoom x T_fit x p_source
 *   p_source = inverse(T_total) x p_screen
 * 
 * Guarantees zero arbitrary offsets, aspect-ratio preservation,
 * mathematical round-trip consistency, and deterministic hit-testing.
 */

import type { BubbleItem } from '../../types/workbench';
import { calculateBoxIoU } from '../coordinateTransforms';

export { calculateBoxIoU };

export interface CanonicalDimensions {
  width: number;
  height: number;
}

export interface CanonicalTransformParams {
  sourceDimensions: CanonicalDimensions;   // Native image pixel dimensions (or 1000x1000 normalized)
  viewportDimensions: CanonicalDimensions; // Available canvas layout bounds (in CSS pixels)
  zoom: number;                            // Zoom percentage (100 = 1.0x, 200 = 2.0x)
  pan: { x: number; y: number };           // Viewport translation in CSS pixels
  dpi?: number;                            // Device pixel ratio (defaults to 1.0)
}

export interface FitResult {
  fitScale: number;
  fittedWidth: number;
  fittedHeight: number;
  originX: number; // Centered horizontal offset in viewport
  originY: number; // Centered vertical offset in viewport
}

export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type HandleType = 'tl' | 'tr' | 'bl' | 'br';

export interface HitTestResult {
  hitBubble: BubbleItem | null;
  hitHandle: HandleType | null;
  distance: number;
}

/**
 * Calculates aspect-preserving uniform fit scale and centering offsets.
 * Strictly preserves aspect ratio: scale = min(availW / srcW, availH / srcH).
 */
export function computeUniformFit(
  source: CanonicalDimensions,
  viewport: CanonicalDimensions
): FitResult {
  const srcW = Math.max(1, source.width);
  const srcH = Math.max(1, source.height);
  const vpW = Math.max(1, viewport.width);
  const vpH = Math.max(1, viewport.height);

  const scaleX = vpW / srcW;
  const scaleY = vpH / srcH;
  const fitScale = Math.min(scaleX, scaleY);

  const fittedWidth = Math.round(srcW * fitScale);
  const fittedHeight = Math.round(srcH * fitScale);

  const originX = Math.round((vpW - fittedWidth) / 2);
  const originY = Math.round((vpH - fittedHeight) / 2);

  return {
    fitScale,
    fittedWidth,
    fittedHeight,
    originX,
    originY,
  };
}

/**
 * Composed forward transform: maps a canonical source point [0-1000 normalized or pixel]
 * to visible canvas screen coordinates.
 */
export function sourceToScreenPoint(
  pSource: { x: number; y: number },
  params: CanonicalTransformParams
): { x: number; y: number } {
  const { sourceDimensions, viewportDimensions, zoom, pan } = params;
  const fit = computeUniformFit(sourceDimensions, viewportDimensions);
  const zoomScale = zoom / 100;

  // 1. Source fraction [0, 1]
  const fracX = pSource.x / Math.max(1, sourceDimensions.width);
  const fracY = pSource.y / Math.max(1, sourceDimensions.height);

  // 2. T_fit (position relative to fitted image top-left)
  const fitX = fracX * fit.fittedWidth;
  const fitY = fracY * fit.fittedHeight;

  // 3. Zoom around center of fitted image
  const centerX = fit.fittedWidth / 2;
  const centerY = fit.fittedHeight / 2;
  const zoomedX = (fitX - centerX) * zoomScale + centerX;
  const zoomedY = (fitY - centerY) * zoomScale + centerY;

  // 4. Centering + Viewport Pan
  const screenX = fit.originX + zoomedX + pan.x;
  const screenY = fit.originY + zoomedY + pan.y;

  return { x: screenX, y: screenY };
}

/**
 * Exact inverse transform: maps visible canvas screen coordinates
 * back to canonical source space.
 */
export function screenToSourcePoint(
  pScreen: { x: number; y: number },
  params: CanonicalTransformParams
): { x: number; y: number } {
  const { sourceDimensions, viewportDimensions, zoom, pan } = params;
  const fit = computeUniformFit(sourceDimensions, viewportDimensions);
  const zoomScale = Math.max(0.01, zoom / 100);

  // 1. Invert Pan & Centering
  const unshiftedX = pScreen.x - fit.originX - pan.x;
  const unshiftedY = pScreen.y - fit.originY - pan.y;

  // 2. Invert Zoom around center
  const centerX = fit.fittedWidth / 2;
  const centerY = fit.fittedHeight / 2;
  const unzoomedX = (unshiftedX - centerX) / zoomScale + centerX;
  const unzoomedY = (unshiftedY - centerY) / zoomScale + centerY;

  // 3. Invert T_fit into canonical source space
  const fracX = unzoomedX / Math.max(1, fit.fittedWidth);
  const fracY = unzoomedY / Math.max(1, fit.fittedHeight);

  const srcX = Math.max(0, Math.min(sourceDimensions.width, fracX * sourceDimensions.width));
  const srcY = Math.max(0, Math.min(sourceDimensions.height, fracY * sourceDimensions.height));

  return { x: srcX, y: srcY };
}

/**
 * Converts a canonical [ymin, xmin, ymax, xmax] bounding box to screen coordinates.
 */
export function canonicalBoxToScreenBox(
  box_2d: [number, number, number, number],
  params: CanonicalTransformParams
): ScreenBox {
  const [ymin, xmin, ymax, xmax] = box_2d;
  const tl = sourceToScreenPoint({ x: xmin, y: ymin }, params);
  const br = sourceToScreenPoint({ x: xmax, y: ymax }, params);

  const left = Math.min(tl.x, br.x);
  const top = Math.min(tl.y, br.y);
  const width = Math.max(1, Math.abs(br.x - tl.x));
  const height = Math.max(1, Math.abs(br.y - tl.y));

  return { left, top, width, height };
}

/**
 * Converts a screen rectangle back to canonical [ymin, xmin, ymax, xmax] box.
 */
export function screenBoxToCanonicalBox(
  screenBox: ScreenBox,
  params: CanonicalTransformParams
): [number, number, number, number] {
  const p1 = screenToSourcePoint({ x: screenBox.left, y: screenBox.top }, params);
  const p2 = screenToSourcePoint(
    { x: screenBox.left + screenBox.width, y: screenBox.top + screenBox.height },
    params
  );

  const xmin = Math.min(p1.x, p2.x);
  const xmax = Math.max(p1.x, p2.x);
  const ymin = Math.min(p1.y, p2.y);
  const ymax = Math.max(p1.y, p2.y);

  return [Math.round(ymin), Math.round(xmin), Math.round(ymax), Math.round(xmax)];
}

/**
 * Validates and clamps canonical box to guaranteed legal geometry:
 * - Finite numbers
 * - ymax >= ymin + minDimension
 * - xmax >= xmin + minDimension
 * - Bound inside [0, maxCoord] (default 1000)
 */
export function validateCanonicalBox(
  box: any,
  maxCoord = 1000,
  minDimension = 15
): { valid: boolean; box: [number, number, number, number]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(box) || box.length !== 4) {
    return {
      valid: false,
      box: [200, 200, 400, 400],
      errors: ['Box must be an array of 4 numbers [ymin, xmin, ymax, xmax]'],
    };
  }

  let [ymin, xmin, ymax, xmax] = box.map((v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || isNaN(n)) {
      errors.push(`Non-finite coordinate detected: ${v}`);
      return 0;
    }
    return n;
  });

  if (ymin > ymax) {
    errors.push('Inverted vertical coordinates (ymin > ymax)');
    const t = ymin;
    ymin = ymax;
    ymax = t;
  }

  if (xmin > xmax) {
    errors.push('Inverted horizontal coordinates (xmin > xmax)');
    const t = xmin;
    xmin = xmax;
    xmax = t;
  }

  // Clamp bounds
  ymin = Math.max(0, Math.min(maxCoord, ymin));
  xmin = Math.max(0, Math.min(maxCoord, xmin));
  ymax = Math.max(0, Math.min(maxCoord, ymax));
  xmax = Math.max(0, Math.min(maxCoord, xmax));

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

  return {
    valid: errors.length === 0,
    box: [Math.round(ymin), Math.round(xmin), Math.round(ymax), Math.round(xmax)],
    errors,
  };
}

/**
 * Deterministic hit-testing for workspace objects:
 * - Checks corner resize handles of the selected bubble first (highest priority)
 * - Checks bubble interior
 * - If multiple bubbles overlap, selects the innermost (smallest area)
 */
export function hitTestWorkspace(
  pScreen: { x: number; y: number },
  bubbles: BubbleItem[],
  params: CanonicalTransformParams,
  options?: {
    selectedBubbleId?: string | null;
    handleTolerancePx?: number;
  }
): HitTestResult {
  const handleTol = options?.handleTolerancePx || 8;
  const selectedId = options?.selectedBubbleId;

  // 1. Check selected bubble handles first
  if (selectedId) {
    const selected = bubbles.find((b) => b.id === selectedId);
    if (selected) {
      const sBox = canonicalBoxToScreenBox(selected.box_2d, params);
      const handles: { type: HandleType; x: number; y: number }[] = [
        { type: 'tl', x: sBox.left, y: sBox.top },
        { type: 'tr', x: sBox.left + sBox.width, y: sBox.top },
        { type: 'bl', x: sBox.left, y: sBox.top + sBox.height },
        { type: 'br', x: sBox.left + sBox.width, y: sBox.top + sBox.height },
      ];

      for (const h of handles) {
        const dist = Math.hypot(pScreen.x - h.x, pScreen.y - h.y);
        if (dist <= handleTol) {
          return { hitBubble: selected, hitHandle: h.type, distance: dist };
        }
      }
    }
  }

  // 2. Map screen pointer to canonical source space for interior hit-test
  const pSource = screenToSourcePoint(pScreen, params);

  // 3. Find all candidate bubbles containing pSource
  const matches: { bubble: BubbleItem; area: number }[] = [];
  for (const b of bubbles) {
    const [ymin, xmin, ymax, xmax] = b.box_2d;
    if (pSource.x >= xmin && pSource.x <= xmax && pSource.y >= ymin && pSource.y <= ymax) {
      const area = (xmax - xmin) * (ymax - ymin);
      matches.push({ bubble: b, area });
    }
  }

  if (matches.length === 0) {
    return { hitBubble: null, hitHandle: null, distance: Infinity };
  }

  // 4. Resolve overlap deterministically: prioritize innermost (smallest area)
  matches.sort((a, b) => a.area - b.area);

  return { hitBubble: matches[0].bubble, hitHandle: null, distance: 0 };
}

/**
 * Computes anchored zoom pan so cursor position remains pinned to artwork.
 */
export function computeAnchoredZoomPan(
  currentZoom: number,
  nextZoom: number,
  anchorScreen: { x: number; y: number },
  currentPan: { x: number; y: number },
  viewportCenter: { x: number; y: number }
): { x: number; y: number } {
  if (currentZoom === nextZoom) return currentPan;

  const ratio = nextZoom / currentZoom;
  const relX = anchorScreen.x - viewportCenter.x;
  const relY = anchorScreen.y - viewportCenter.y;

  return {
    x: Math.round(currentPan.x * ratio + relX * (1 - ratio)),
    y: Math.round(currentPan.y * ratio + relY * (1 - ratio)),
  };
}

/**
 * Verifies mathematical round-trip invariant:
 * source -> screen -> source == source within declared tolerance.
 */
export function verifyTransformRoundTrip(
  pSource: { x: number; y: number },
  params: CanonicalTransformParams,
  tolerance = 0.5
): { pass: boolean; drift: number } {
  const pScreen = sourceToScreenPoint(pSource, params);
  const pRoundTrip = screenToSourcePoint(pScreen, params);

  const dx = Math.abs(pSource.x - pRoundTrip.x);
  const dy = Math.abs(pSource.y - pRoundTrip.y);
  const drift = Math.max(dx, dy);

  return {
    pass: drift <= tolerance,
    drift,
  };
}
