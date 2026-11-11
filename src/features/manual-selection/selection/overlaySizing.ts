export type SelectionOverlaySize = 'small' | 'medium' | 'big';

export const DEFAULT_SELECTION_OVERLAY_SIZE: SelectionOverlaySize = 'small';

export interface SelectionOverlayMetrics {
  /** Base outline stroke width in CSS px at 100% zoom (unselected). */
  strokePx: number;
  /** Base outline stroke width in CSS px at 100% zoom (selected). */
  selectedStrokePx: number;
  /** Base outline stroke width in CSS px at 100% zoom (live draw/resize preview). */
  previewStrokePx: number;
  /** Unselected outline stroke opacity. */
  strokeOpacity: number;
  /** SVG dash pattern for flagged outlines (at 100% zoom). */
  flaggedDash: [number, number];
  /** Fill alpha for unselected / flagged / selected regions. */
  fillAlpha: number;
  flaggedFillAlpha: number;
  selectedFillAlpha: number;
  /** Badge visual metrics (in CSS px at 100%+ zoom). */
  badge: {
    paddingX: number;
    paddingY: number;
    gap: number;
    borderRadius: number;
    fontSize: number;
    numberPaddingX: number;
    offsetPx: number;
    symbolMinWidth: number;
    symbolHeight: number;
    symbolPaddingX: number;
    symbolFontSize: number;
    symbolBorderRadius: number;
    flagDotPx: number;
  };
  /** Resize handle dimensions (in CSS px at 100%+ zoom). */
  handle: {
    sizePx: number;
    borderWidthPx: number;
    borderRadiusPx: number;
  };
}

/**
 * Compact visual scale for canvas selection overlays.
 * Small is default; even Big stays noticeably leaner than the legacy oversized rendering.
 */
export const SELECTION_OVERLAY_METRICS: Record<SelectionOverlaySize, SelectionOverlayMetrics> = {
  small: {
    strokePx: 0.6,
    selectedStrokePx: 0.95,
    previewStrokePx: 0.75,
    strokeOpacity: 0.88,
    flaggedDash: [3, 2],
    fillAlpha: 0.015,
    flaggedFillAlpha: 0.035,
    selectedFillAlpha: 0.05,
    badge: {
      paddingX: 2,
      paddingY: 1,
      gap: 2,
      borderRadius: 2,
      fontSize: 7.5,
      numberPaddingX: 1,
      offsetPx: 1,
      symbolMinWidth: 10,
      symbolHeight: 9,
      symbolPaddingX: 1.5,
      symbolFontSize: 6.5,
      symbolBorderRadius: 1.5,
      flagDotPx: 3,
    },
    handle: {
      sizePx: 4.5,
      borderWidthPx: 1,
      borderRadiusPx: 1,
    },
  },
  medium: {
    strokePx: 0.85,
    selectedStrokePx: 1.25,
    previewStrokePx: 1.0,
    strokeOpacity: 0.94,
    flaggedDash: [3.5, 2],
    fillAlpha: 0.025,
    flaggedFillAlpha: 0.045,
    selectedFillAlpha: 0.065,
    badge: {
      paddingX: 2.5,
      paddingY: 1,
      gap: 2.5,
      borderRadius: 2.5,
      fontSize: 8.5,
      numberPaddingX: 1.5,
      offsetPx: 1.5,
      symbolMinWidth: 12,
      symbolHeight: 11,
      symbolPaddingX: 2,
      symbolFontSize: 7.5,
      symbolBorderRadius: 2,
      flagDotPx: 3.5,
    },
    handle: {
      sizePx: 5,
      borderWidthPx: 1.25,
      borderRadiusPx: 1.5,
    },
  },
  big: {
    strokePx: 1.1,
    selectedStrokePx: 1.5,
    previewStrokePx: 1.25,
    strokeOpacity: 1,
    flaggedDash: [4, 2.5],
    fillAlpha: 0.03,
    flaggedFillAlpha: 0.055,
    selectedFillAlpha: 0.08,
    badge: {
      paddingX: 3.5,
      paddingY: 1.5,
      gap: 3,
      borderRadius: 3,
      fontSize: 9.5,
      numberPaddingX: 2,
      offsetPx: 2,
      symbolMinWidth: 14,
      symbolHeight: 13,
      symbolPaddingX: 2.5,
      symbolFontSize: 8.5,
      symbolBorderRadius: 2,
      flagDotPx: 4,
    },
    handle: {
      sizePx: 6,
      borderWidthPx: 1.5,
      borderRadiusPx: 1.5,
    },
  },
};

export function normalizeSelectionOverlaySize(val: unknown): SelectionOverlaySize {
  if (val === 'small' || val === 'medium' || val === 'big') {
    return val;
  }
  return DEFAULT_SELECTION_OVERLAY_SIZE;
}

/**
 * Computes inverse CSS transform scale factors so overlays stay crisp and never
 * balloon when zooming in (100%..1000%), while gently scaling down when zoomed out (<100%).
 */
export function computeOverlayZoomCompensation(zoomLevel: number): {
  zoomScale: number;
  badgeTransformScale: number;
  handleTransformScale: number;
  strokeDivisor: number;
} {
  const effectiveZoom = Math.max(25, Number.isFinite(zoomLevel) ? zoomLevel : 100);
  const zoomScale = effectiveZoom / 100;

  // Keep badges at true 1.0x screen pixels from 100%..1000%, and shrink moderately below 100%.
  const targetBadgeScreenFactor = effectiveZoom < 100 ? Math.max(0.55, zoomScale) : 1;
  const targetHandleScreenFactor = effectiveZoom < 100 ? Math.max(0.6, zoomScale) : 1;
  const targetStrokeScreenFactor = effectiveZoom < 100 ? Math.max(0.75, zoomScale) : 1;

  return {
    zoomScale,
    badgeTransformScale: targetBadgeScreenFactor / zoomScale,
    handleTransformScale: targetHandleScreenFactor / zoomScale,
    strokeDivisor: zoomScale / targetStrokeScreenFactor,
  };
}
