export type SelectionOverlaySize = 'small' | 'medium' | 'big';
export type SelectionOutlineSize = 'small' | 'medium' | 'big';
export type BadgeSize = 'small' | 'medium' | 'big';

export const DEFAULT_SELECTION_OVERLAY_SIZE: SelectionOverlaySize = 'medium';
export const DEFAULT_SELECTION_OUTLINE_SIZE: SelectionOutlineSize = 'medium';
export const DEFAULT_BADGE_SIZE: BadgeSize = 'small';

export interface OutlineMetrics {
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
  /** Resize handle dimensions (in CSS px at 100%+ zoom). */
  handle: {
    sizePx: number;
    borderWidthPx: number;
    borderRadiusPx: number;
  };
}

export interface BadgeMetrics {
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
}

export interface SelectionOverlayMetrics extends OutlineMetrics {
  badge: BadgeMetrics;
}

/**
 * Outline metrics scale across small/medium/big.
 * Medium is the crisp, balanced default providing optimal visibility on screentones and black backgrounds.
 */
export const SELECTION_OUTLINE_METRICS: Record<SelectionOutlineSize, OutlineMetrics> = {
  small: {
    // Thinner, unobtrusive outline
    strokePx: 0.75,
    selectedStrokePx: 1.1,
    previewStrokePx: 0.9,
    strokeOpacity: 0.9,
    flaggedDash: [3.5, 2],
    fillAlpha: 0.02,
    flaggedFillAlpha: 0.04,
    selectedFillAlpha: 0.06,
    handle: {
      sizePx: 5,
      borderWidthPx: 1,
      borderRadiusPx: 1.5,
    },
  },
  medium: {
    // Best outline default: crisp 1.0px base stroke, 1.5px selected stroke,
    // 0.96 opacity for standout contrast without overwhelming comic artwork
    strokePx: 1.0,
    selectedStrokePx: 1.5,
    previewStrokePx: 1.2,
    strokeOpacity: 0.96,
    flaggedDash: [4, 2.5],
    fillAlpha: 0.025,
    flaggedFillAlpha: 0.05,
    selectedFillAlpha: 0.075,
    handle: {
      sizePx: 6,
      borderWidthPx: 1.25,
      borderRadiusPx: 2,
    },
  },
  big: {
    // Bold, high-contrast outline
    strokePx: 1.35,
    selectedStrokePx: 1.95,
    previewStrokePx: 1.55,
    strokeOpacity: 1,
    flaggedDash: [4.5, 2.5],
    fillAlpha: 0.035,
    flaggedFillAlpha: 0.065,
    selectedFillAlpha: 0.09,
    handle: {
      sizePx: 7,
      borderWidthPx: 1.5,
      borderRadiusPx: 2,
    },
  },
};

/**
 * Badge dimensions scale independently across small/medium/big.
 * Small uses the former "big" baseline sizing and behavior.
 * Medium and big provide clean upward steps without becoming oversized.
 */
export const BADGE_METRICS: Record<BadgeSize, BadgeMetrics> = {
  small: {
    // Former "big" baseline: clean, readable typography with compact bounding footprint
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
  medium: {
    // Balanced medium tier: comfortable readability bump
    paddingX: 4,
    paddingY: 2,
    gap: 3.5,
    borderRadius: 3.5,
    fontSize: 10.5,
    numberPaddingX: 2.5,
    offsetPx: 2.5,
    symbolMinWidth: 16,
    symbolHeight: 15,
    symbolPaddingX: 3,
    symbolFontSize: 9.5,
    symbolBorderRadius: 2.5,
    flagDotPx: 4.5,
  },
  big: {
    // Largest tier: noticeable increase without becoming oversized or obscuring artwork
    paddingX: 4.5,
    paddingY: 2.5,
    gap: 4,
    borderRadius: 4,
    fontSize: 11.5,
    numberPaddingX: 3,
    offsetPx: 3,
    symbolMinWidth: 18,
    symbolHeight: 17,
    symbolPaddingX: 3.5,
    symbolFontSize: 10.5,
    symbolBorderRadius: 3,
    flagDotPx: 5,
  },
};

/**
 * Combined metrics record kept for backwards compatibility.
 */
export const SELECTION_OVERLAY_METRICS: Record<SelectionOverlaySize, SelectionOverlayMetrics> = {
  small: {
    ...SELECTION_OUTLINE_METRICS.small,
    badge: BADGE_METRICS.small,
  },
  medium: {
    ...SELECTION_OUTLINE_METRICS.medium,
    badge: BADGE_METRICS.medium,
  },
  big: {
    ...SELECTION_OUTLINE_METRICS.big,
    badge: BADGE_METRICS.big,
  },
};

export function normalizeSelectionOutlineSize(val: unknown): SelectionOutlineSize {
  if (val === 'small' || val === 'medium' || val === 'big') {
    return val;
  }
  return DEFAULT_SELECTION_OUTLINE_SIZE;
}

export function normalizeBadgeSize(val: unknown): BadgeSize {
  if (val === 'small' || val === 'medium' || val === 'big') {
    return val;
  }
  return DEFAULT_BADGE_SIZE;
}

export function normalizeSelectionOverlaySize(val: unknown): SelectionOverlaySize {
  return normalizeSelectionOutlineSize(val);
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
