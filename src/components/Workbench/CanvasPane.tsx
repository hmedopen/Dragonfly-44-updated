import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { BubbleItem } from '../../types/workbench';
import { extractFilesFromDataTransfer, ingestImageFiles } from '../../services/fileIngestion';
import { FileImage, Activity } from 'lucide-react';
import {
  validateCanonicalBox,
  hitTestWorkspace,
  type CanonicalTransformParams,
} from '../../lib/workspace/geometryService';
import { renderGenerationManager } from '../../lib/workspace/renderGeneration';
import { settingsService } from '../../services/settings/settingsService';
import { emitDiagnosticBoundary } from '../../lib/diagnosticTap';
import { resolveTyperVisual } from '../../types/typers';
import { useTyperSettings } from '../../features/manual-selection/symbols/useTyperSettings';
import { TyperSymbolBadge } from '../../features/manual-selection/components/TyperSymbolBadge';
import {
  finalizeLassoPolygon,
  finalizeTwoPointBox,
  isPointInBox,
  isPointInEllipse,
  isPointInPolygon,
  resizeBoxFromHandle,
  roundNorm,
  scalePolygonFromBox,
  translateSelectionGeometry,
  type ResizeHandle,
} from '../../features/manual-selection/selection/geometry';
import {
  computeOverlayZoomCompensation,
  normalizeSelectionOutlineSize,
  normalizeBadgeSize,
  SELECTION_OUTLINE_METRICS,
  BADGE_METRICS,
  type SelectionOutlineSize,
  type BadgeSize,
} from '../../features/manual-selection/selection/overlaySizing';
import type {
  NormalizedBox2D,
  NormalizedPolygon,
  SelectionMode,
} from '../../features/manual-selection/types/selection';

function hexToRgba(hexColor: string, alpha: number): string {
  const clean = hexColor.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `rgba(56, 189, 248, ${alpha})`;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const RESIZE_HANDLES: Array<{
  id: ResizeHandle;
  cursor: string;
  getPoint: (box: NormalizedBox2D) => [number, number];
}> = [
  { id: 'nw', cursor: 'nwse-resize', getPoint: (b) => [b[1], b[0]] },
  { id: 'n', cursor: 'ns-resize', getPoint: (b) => [(b[1] + b[3]) / 2, b[0]] },
  { id: 'ne', cursor: 'nesw-resize', getPoint: (b) => [b[3], b[0]] },
  { id: 'e', cursor: 'ew-resize', getPoint: (b) => [b[3], (b[0] + b[2]) / 2] },
  { id: 'se', cursor: 'nwse-resize', getPoint: (b) => [b[3], b[2]] },
  { id: 's', cursor: 'ns-resize', getPoint: (b) => [(b[1] + b[3]) / 2, b[2]] },
  { id: 'sw', cursor: 'nesw-resize', getPoint: (b) => [b[1], b[2]] },
  { id: 'w', cursor: 'ew-resize', getPoint: (b) => [b[1], (b[0] + b[2]) / 2] },
];

const CORNER_HANDLE_IDS = new Set<ResizeHandle>(['nw', 'ne', 'se', 'sw']);

function setSvgRectBounds(el: SVGRectElement, box: NormalizedBox2D): void {
  el.setAttribute('x', String(box[1]));
  el.setAttribute('y', String(box[0]));
  el.setAttribute('width', String(Math.max(0.5, box[3] - box[1])));
  el.setAttribute('height', String(Math.max(0.5, box[2] - box[0])));
}

function setSvgEllipseBounds(el: SVGEllipseElement, box: NormalizedBox2D): void {
  el.setAttribute('cx', String((box[1] + box[3]) / 2));
  el.setAttribute('cy', String((box[0] + box[2]) / 2));
  el.setAttribute('rx', String(Math.max(0.25, (box[3] - box[1]) / 2)));
  el.setAttribute('ry', String(Math.max(0.25, (box[2] - box[0]) / 2)));
}

function isParametricBubbleItem(bubble: Pick<BubbleItem, 'manualSelectionShape' | 'manualPolygon'>): boolean {
  return (
    bubble.manualSelectionShape === 'bubble' &&
    !(bubble.manualPolygon && bubble.manualPolygon.length >= 3)
  );
}

type ManualCanvasGesture =
  | {
      kind: 'draw_box';
      shape: 'box' | 'bubble';
      startNorm: [number, number];
      currentNorm: [number, number];
      startClient: [number, number];
      didDrag: boolean;
    }
  | {
      kind: 'draw_freehand';
      mode: 'lasso';
      points: NormalizedPolygon;
      startClient: [number, number];
      didDrag: boolean;
    }
  | {
      kind: 'move';
      bubbleId: string;
      isEllipse?: boolean;
      initialBox: NormalizedBox2D;
      initialPolygon?: NormalizedPolygon;
      startNorm: [number, number];
      currentBox: NormalizedBox2D;
      currentPolygon?: NormalizedPolygon;
      didDrag: boolean;
    }
  | {
      kind: 'resize';
      bubbleId: string;
      isEllipse?: boolean;
      handle: ResizeHandle;
      initialBox: NormalizedBox2D;
      initialPolygon?: NormalizedPolygon;
      currentBox: NormalizedBox2D;
      currentPolygon?: NormalizedPolygon;
      didDrag: boolean;
    };

interface CanvasPaneProps {
  projectId?: string | null;
  imageUrl: string | null;
  isLoading: boolean;
  pageFileName?: string;
  bubbles: BubbleItem[];
  selectedBubbleId: string | null;
  focusTarget?: { bubbleId: string; box_2d: [number, number, number, number]; trigger: number } | null;
  centerTarget?: { bubbleId: string; box_2d: [number, number, number, number]; trigger: number } | null;
  panTarget?: { x: number; y: number; trigger: number } | null;
  isDrawBoxActive: boolean;
  isManualSelectionActive?: boolean;
  manualSelectionMode?: SelectionMode;
  manualActiveTyperColor?: string;
  zoomLevel: number;
  showBoxes?: boolean;
  isFlipPageActive?: boolean;
  hasPrevPage?: boolean;
  hasNextPage?: boolean;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onZoomChange?: (newZoom: number) => void;
  onResetZoom?: () => void;
  resetViewTrigger?: number;
  onPanChange?: (pan: { x: number; y: number }) => void;
  onSelectBubble: (bubbleId: string | null) => void;
  onAddManualBubbleWithCoords?: (box_2d: [number, number, number, number]) => void;
  onCreateManualSelection?: (input: {
    shape: SelectionMode;
    box_2d: NormalizedBox2D;
    polygon?: NormalizedPolygon;
  }) => void;
  onUpdateManualSelectionGeometry?: (
    bubbleId: string,
    next: { box_2d: NormalizedBox2D; polygon?: NormalizedPolygon }
  ) => void;
  onManualDrawingStateChange?: (drawing: boolean) => void;
  onIngestDroppedFiles?: (files: File[]) => void;
}

export const CanvasPane: React.FC<CanvasPaneProps> = ({
  projectId = null,
  imageUrl,
  isLoading,
  pageFileName,
  bubbles,
  selectedBubbleId,
  focusTarget,
  centerTarget,
  panTarget,
  isDrawBoxActive,
  isManualSelectionActive = false,
  manualSelectionMode = 'box',
  manualActiveTyperColor = '#2563EB',
  zoomLevel,
  showBoxes = true,
  isFlipPageActive = false,
  hasPrevPage = false,
  hasNextPage = false,
  onPrevPage,
  onNextPage,
  onZoomChange,
  onResetZoom,
  resetViewTrigger = 0,
  onPanChange,
  onSelectBubble,
  onAddManualBubbleWithCoords,
  onCreateManualSelection,
  onUpdateManualSelectionGeometry,
  onManualDrawingStateChange,
  onIngestDroppedFiles,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const typerSettings = useTyperSettings();
  const imgRef = useRef<HTMLImageElement>(null);
  const imgNaturalRef = useRef<{ width: number; height: number }>({ width: 1000, height: 1000 });
  const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number }>({
    width: 1000,
    height: 1000,
  });
  const manualGestureRef = useRef<ManualCanvasGesture | null>(null);
  const manualRafRef = useRef<number | null>(null);
  const previewRectRef = useRef<SVGRectElement>(null);
  const previewEllipseRef = useRef<SVGEllipseElement>(null);
  const previewPolyRef = useRef<SVGPolygonElement>(null);
  const previewFreehandRef = useRef<SVGPathElement>(null);

  // Pan and drag state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const didMoveRef = useRef(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomLevelRef = useRef(zoomLevel);
  const onZoomChangeRef = useRef(onZoomChange);
  const onPanChangeRef = useRef(onPanChange);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    onPanChangeRef.current = onPanChange;
  }, [onPanChange]);

  useEffect(() => {
    onPanChangeRef.current?.(pan);
  }, [pan]);

  // Settings subscription for overlay visibility, sizing & diagnostics HUD
  const [settingsRevision, setSettingsRevision] = useState(() => settingsService.getRevision());

  useEffect(() => {
    const unsub = settingsService.subscribe(() => {
      setSettingsRevision(settingsService.getRevision());
    });
    return () => unsub();
  }, []);

  const overlaySettings = useMemo(() => {
    void settingsRevision;
    return {
      boxesVisible: settingsService.getEffectiveValue<boolean>('workspace.overlay_boxes_visible', { projectId }).value,
      panelsVisible: settingsService.getEffectiveValue<boolean>('workspace.overlay_panels_visible', { projectId }).value,
      reviewMarkersVisible: settingsService.getEffectiveValue<boolean>('workspace.overlay_review_markers_visible', { projectId }).value,
      coordinateDiagnostics: settingsService.getEffectiveValue<boolean>('workspace.coordinate_diagnostics', { projectId }).value,
      selectionOutlineSize: normalizeSelectionOutlineSize(
        settingsService.getEffectiveValue<SelectionOutlineSize>('workspace.selection_overlay_size', { projectId }).value
      ),
      badgeSize: normalizeBadgeSize(
        settingsService.getEffectiveValue<BadgeSize>('workspace.badge_size', { projectId }).value
      ),
      includeSFX: settingsService.getEffectiveValue<boolean>('scanning.include_sfx', { projectId }).value,
    };
  }, [projectId, settingsRevision]);

  // Cursor coordinates for diagnostics HUD
  const [cursorPos, setCursorPos] = useState<{ screenX: number; screenY: number; srcX: number; srcY: number } | null>(null);

  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
    onZoomChangeRef.current = onZoomChange;
  }, [zoomLevel, onZoomChange]);

  // Phase 1.3: Dynamic SFX visibility filtering
  const visibleBubbles = useMemo(() => {
    if (overlaySettings.includeSFX) {
      return bubbles;
    }
    return bubbles.filter((b) => b.type !== 'sfx' && b.typerPrefix !== 'SFX:');
  }, [bubbles, overlaySettings.includeSFX]);

  // Phase 2.1: Group bubbles into shared physical visual regions
  interface VisualRegionGroup {
    regionKey: string;
    box_2d: [number, number, number, number];
    bubbles: BubbleItem[];
    indices: number[];
    label: string;
    isSelected: boolean;
    isFlagged: boolean;
    primaryBubbleId: string;
  }

  const visualRegions = useMemo(() => {
    const groups = new Map<string, BubbleItem[]>();
    for (const b of visibleBubbles) {
      const isSfx = b.type === 'sfx' || b.typerPrefix === 'SFX:';
      let key = `box-${b.id}`;

      // SFX records are independent sound effects and must NEVER collapse into composite regions.
      // For non-SFX records with a regionId, only group if they share physical bounding box coordinates (split bubble lobes).
      if (!isSfx && b.regionId) {
        const candidateKey = `region-${b.regionId}`;
        const existingGroup = groups.get(candidateKey);
        if (existingGroup && existingGroup.length > 0) {
          const first = existingGroup[0];
          const isSamePhysicalBox =
            Math.abs(first.box_2d[0] - b.box_2d[0]) <= 25 &&
            Math.abs(first.box_2d[1] - b.box_2d[1]) <= 25 &&
            Math.abs(first.box_2d[2] - b.box_2d[2]) <= 25 &&
            Math.abs(first.box_2d[3] - b.box_2d[3]) <= 25;
          if (isSamePhysicalBox) {
            key = candidateKey;
          }
        } else {
          key = candidateKey;
        }
      }

      const list = groups.get(key) || [];
      list.push(b);
      groups.set(key, list);
    }

    const result: VisualRegionGroup[] = [];
    for (const [key, items] of groups.entries()) {
      const sorted = [...items].sort((a, b) => a.index - b.index);
      const indices = sorted.map((b) => b.index);
      const isSelected = sorted.some((b) => b.id === selectedBubbleId);
      const isFlagged = sorted.some(
        (b) => overlaySettings.reviewMarkersVisible && b.reviewFlags && b.reviewFlags.length > 0
      );
      const label = indices.map((idx) => `#${idx}`).join('/');

      result.push({
        regionKey: key,
        box_2d: sorted[0].box_2d,
        bubbles: sorted,
        indices,
        label,
        isSelected,
        isFlagged,
        primaryBubbleId: sorted[0].id,
      });
    }
    return result;
  }, [visibleBubbles, selectedBubbleId, overlaySettings.reviewMarkersVisible]);

  // Box drawing state (0-1000 normalized coordinates)
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null);
  const [drawingCurrent, setDrawingCurrent] = useState<{ x: number; y: number } | null>(null);
  const drawingStartRef = useRef<{ x: number; y: number } | null>(null);
  const drawingCurrentRef = useRef<{ x: number; y: number } | null>(null);

  // Active page generation token (Section 4.7)
  const [generationToken, setGenerationToken] = useState(() =>
    renderGenerationManager.startNewGeneration(pageFileName || 'canvas')
  );

  // Reset pan on trigger or page switch
  const [lastPageFileName, setLastPageFileName] = useState(pageFileName);
  const [lastResetTrigger, setLastResetTrigger] = useState(resetViewTrigger);

  if (pageFileName !== lastPageFileName || resetViewTrigger !== lastResetTrigger) {
    setLastPageFileName(pageFileName);
    setLastResetTrigger(resetViewTrigger);
    setGenerationToken(renderGenerationManager.startNewGeneration(pageFileName || 'canvas'));
    if (!focusTarget) {
      setPan({ x: 0, y: 0 });
    }
  }

  // Track viewport dimensions reactively via ResizeObserver
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({ width: 800, height: 1000 });

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const updateSize = () => {
      setViewportSize({ width: vp.clientWidth || 800, height: vp.clientHeight || 1000 });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  // Canonical Transform Parameters
  const transformParams: CanonicalTransformParams = useMemo(() => {
    return {
      sourceDimensions: { width: 1000, height: 1000 },
      viewportDimensions: viewportSize,
      zoom: zoomLevel,
      pan,
    };
  }, [viewportSize, zoomLevel, pan]);

  // Focus and zoom in on target bubble
  useEffect(() => {
    if (!focusTarget || isLoading || !svgRef.current || !viewportRef.current) return;
    const { box_2d } = focusTarget;
    const [ymin, xmin, ymax, xmax] = box_2d;
    const boxCenterX = (xmin + xmax) / 2;
    const boxCenterY = (ymin + ymax) / 2;

    const boxW = Math.max(10, xmax - xmin);
    const boxH = Math.max(10, ymax - ymin);
    const maxDim = Math.max(boxW, boxH);
    const calculatedZoom = Math.round((400 / maxDim) * 100);
    const targetZoom = Math.max(150, Math.min(220, calculatedZoom));

    onZoomChangeRef.current?.(targetZoom);

    const svgRect = svgRef.current.getBoundingClientRect();
    const currentScale = (zoomLevelRef.current || 100) / 100;
    const unscaledW = svgRect.width / currentScale;
    const unscaledH = svgRect.height / currentScale;

    const normOffsetX = (boxCenterX - 500) / 1000;
    const normOffsetY = (boxCenterY - 500) / 1000;

    const newScale = targetZoom / 100;
    setPan({
      x: Math.round(-normOffsetX * unscaledW * newScale),
      y: Math.round(-normOffsetY * unscaledH * newScale),
    });
  }, [focusTarget, isLoading]);

  // Center on bubble without changing zoom level (triggered by clicking dialogue card)
  useEffect(() => {
    if (!centerTarget || isLoading || !svgRef.current || !viewportRef.current) return;
    const { box_2d } = centerTarget;
    const [ymin, xmin, ymax, xmax] = box_2d;
    const boxCenterX = (xmin + xmax) / 2;
    const boxCenterY = (ymin + ymax) / 2;

    const svgRect = svgRef.current.getBoundingClientRect();
    const currentScale = (zoomLevelRef.current || 100) / 100;
    const unscaledW = svgRect.width / currentScale;
    const unscaledH = svgRect.height / currentScale;

    const normOffsetX = (boxCenterX - 500) / 1000;
    const normOffsetY = (boxCenterY - 500) / 1000;

    setPan({
      x: Math.round(-normOffsetX * unscaledW * currentScale),
      y: Math.round(-normOffsetY * unscaledH * currentScale),
    });
  }, [centerTarget, isLoading]);

  // Restore pan target if provided
  useEffect(() => {
    if (!panTarget) return;
    setPan({ x: panTarget.x, y: panTarget.y });
  }, [panTarget]);

  // Window mousemove / mouseup for smooth panning
  useEffect(() => {
    if (!isPanning) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.startX;
      const dy = e.clientY - panStartRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        didMoveRef.current = true;
      }
      setPan({
        x: panStartRef.current.startPanX + dx,
        y: panStartRef.current.startPanY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsPanning(false);
      panStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanning]);

  // Mouse wheel zoom (anchored) & Manhwa vertical scroll (Shift + Wheel)
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.altKey) {
        // Horizontal scroll
        const delta = e.deltaY !== 0 ? e.deltaY : -e.deltaX;
        setPan((prev) => ({
          ...prev,
          x: prev.x - delta,
        }));
      } else if (e.shiftKey) {
        // Vertical scroll
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        setPan((prev) => ({
          ...prev,
          y: prev.y - delta,
        }));
      } else {
        // Wheel zoom anchored to cursor
        const step = e.deltaY < 0 ? 15 : -15;
        const current = zoomLevelRef.current;
        const nextZoom = Math.max(25, Math.min(1000, current + step));

        if (nextZoom !== current) {
          const rect = vp.getBoundingClientRect();
          const cx = e.clientX - (rect.left + rect.width / 2);
          const cy = e.clientY - (rect.top + rect.height / 2);
          const ratio = nextZoom / current;

          setPan((prev) => ({
            x: Math.round(prev.x * ratio + cx * (1 - ratio)),
            y: Math.round(prev.y * ratio + cy * (1 - ratio)),
          }));

          onZoomChangeRef.current?.(nextZoom);
        }
      }
    };

    vp.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      vp.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const handleContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement)?.closest('[data-flip-edge="true"]')) return;

    // Middle mouse button (button 1) moves the image
    if (e.button === 1) {
      e.preventDefault();
      panStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      didMoveRef.current = false;
      setIsPanning(true);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isDrawBoxActive || isManualSelectionActive) return;
    if ((e.target as HTMLElement)?.closest('[data-flip-edge="true"]')) return;
    e.preventDefault();
    onResetZoom?.();
    setPan({ x: 0, y: 0 });
  };

  /**
   * Maps pointer event to canonical source space (0-1000) with sub-pixel float precision.
   */
  const getCanonicalFloatCoords = useCallback(
    (e: { clientX: number; clientY: number }): [number, number] | null => {
      const targetEl = imgRef.current ?? svgRef.current;
      if (!targetEl) return null;
      const rect = targetEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      const rawX = ((e.clientX - rect.left) / rect.width) * 1000;
      const rawY = ((e.clientY - rect.top) / rect.height) * 1000;
      return [roundNorm(rawX), roundNorm(rawY)];
    },
    []
  );

  const getCanonicalSourceCoords = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const pt = getCanonicalFloatCoords(e);
    if (!pt) return null;
    return { x: Math.round(pt[0]), y: Math.round(pt[1]) };
  };

  const clearManualPreview = useCallback(() => {
    if (manualRafRef.current !== null) {
      cancelAnimationFrame(manualRafRef.current);
      manualRafRef.current = null;
    }
    if (previewRectRef.current) previewRectRef.current.style.display = 'none';
    if (previewEllipseRef.current) previewEllipseRef.current.style.display = 'none';
    if (previewPolyRef.current) previewPolyRef.current.style.display = 'none';
    if (previewFreehandRef.current) previewFreehandRef.current.style.display = 'none';
  }, []);

  const scheduleManualPreviewPaint = useCallback(() => {
    if (manualRafRef.current !== null) return;
    manualRafRef.current = requestAnimationFrame(() => {
      manualRafRef.current = null;
      const g = manualGestureRef.current;
      if (!g) {
        clearManualPreview();
        return;
      }

      const rectEl = previewRectRef.current;
      const ellipseEl = previewEllipseRef.current;
      const polyEl = previewPolyRef.current;
      const pathEl = previewFreehandRef.current;

      if (g.kind === 'draw_box') {
        if (polyEl) polyEl.style.display = 'none';
        if (pathEl) pathEl.style.display = 'none';
        const box: NormalizedBox2D = [
          Math.min(g.startNorm[1], g.currentNorm[1]),
          Math.min(g.startNorm[0], g.currentNorm[0]),
          Math.max(g.startNorm[1], g.currentNorm[1]),
          Math.max(g.startNorm[0], g.currentNorm[0]),
        ];
        if (g.shape === 'bubble') {
          if (rectEl) rectEl.style.display = 'none';
          if (ellipseEl) {
            ellipseEl.style.display = 'block';
            setSvgEllipseBounds(ellipseEl, box);
          }
        } else {
          if (ellipseEl) ellipseEl.style.display = 'none';
          if (rectEl) {
            rectEl.style.display = 'block';
            setSvgRectBounds(rectEl, box);
          }
        }
      } else if (g.kind === 'draw_freehand') {
        if (rectEl) rectEl.style.display = 'none';
        if (ellipseEl) ellipseEl.style.display = 'none';
        if (polyEl) polyEl.style.display = 'none';
        if (pathEl && g.points.length > 0) {
          const d =
            g.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ') +
            (g.points.length >= 3 ? ' Z' : '');
          pathEl.style.display = 'block';
          pathEl.setAttribute('d', d);
        }
      } else {
        if (pathEl) pathEl.style.display = 'none';
        if (g.currentPolygon && g.currentPolygon.length >= 3) {
          if (rectEl) rectEl.style.display = 'none';
          if (ellipseEl) ellipseEl.style.display = 'none';
          if (polyEl) {
            polyEl.style.display = 'block';
            polyEl.setAttribute('points', g.currentPolygon.map(([x, y]) => `${x},${y}`).join(' '));
          }
        } else if (g.isEllipse) {
          if (rectEl) rectEl.style.display = 'none';
          if (polyEl) polyEl.style.display = 'none';
          if (ellipseEl) {
            ellipseEl.style.display = 'block';
            setSvgEllipseBounds(ellipseEl, g.currentBox);
          }
        } else {
          if (polyEl) polyEl.style.display = 'none';
          if (ellipseEl) ellipseEl.style.display = 'none';
          if (rectEl) {
            rectEl.style.display = 'block';
            setSvgRectBounds(rectEl, g.currentBox);
          }
        }
      }
    });
  }, [clearManualPreview]);

  const hitTestAnyBubbleAt = useCallback(
    (nx: number, ny: number): BubbleItem | null => {
      // Check visible bubbles in reverse order so top-most / newly added wins on overlap
      for (let i = visibleBubbles.length - 1; i >= 0; i--) {
        const b = visibleBubbles[i];
        if (b.manualPolygon && b.manualPolygon.length >= 3) {
          if (isPointInPolygon(nx, ny, b.manualPolygon)) return b;
        } else if (b.manualSelectionShape === 'bubble') {
          if (isPointInEllipse(nx, ny, b.box_2d, 0.5)) return b;
        } else if (isPointInBox(nx, ny, b.box_2d, 0.5)) {
          return b;
        }
      }
      return null;
    },
    [visibleBubbles]
  );

  const commitManualGesture = useCallback(
    (e?: { clientX: number; clientY: number }) => {
      const g = manualGestureRef.current;
      manualGestureRef.current = null;
      onManualDrawingStateChange?.(false);
      clearManualPreview();
      if (!g) return;

      const natW = imgNaturalRef.current.width || 1000;
      const natH = imgNaturalRef.current.height || 1000;

      if (g.kind === 'draw_box') {
        if (!g.didDrag) {
          if (e) {
            const coords = getCanonicalFloatCoords(e);
            const hit = coords ? hitTestAnyBubbleAt(coords[0], coords[1]) : null;
            onSelectBubble(hit ? hit.id : null);
          }
          return;
        }
        const box = finalizeTwoPointBox(g.startNorm, g.currentNorm, natW, natH);
        if (box) {
          onCreateManualSelection?.({
            shape: g.shape,
            box_2d: box,
          });
        }
        return;
      }

      if (g.kind === 'draw_freehand') {
        if (!g.didDrag || g.points.length < 3) {
          if (e) {
            const coords = getCanonicalFloatCoords(e);
            const hit = coords ? hitTestAnyBubbleAt(coords[0], coords[1]) : null;
            onSelectBubble(hit ? hit.id : null);
          }
          return;
        }
        const result = finalizeLassoPolygon(g.points, natW, natH);
        if (result.valid) {
          onCreateManualSelection?.({
            shape: 'lasso',
            box_2d: result.box_2d,
            polygon: result.polygon,
          });
        }
        return;
      }

      if (g.kind === 'move') {
        if (!g.didDrag) {
          onSelectBubble(g.bubbleId);
          return;
        }
        onUpdateManualSelectionGeometry?.(g.bubbleId, {
          box_2d: g.currentBox,
          ...(g.currentPolygon ? { polygon: g.currentPolygon } : {}),
        });
        return;
      }

      if (g.kind === 'resize' && g.didDrag) {
        onUpdateManualSelectionGeometry?.(g.bubbleId, {
          box_2d: g.currentBox,
          ...(g.currentPolygon ? { polygon: g.currentPolygon } : {}),
        });
      }
    },
    [
      clearManualPreview,
      getCanonicalFloatCoords,
      hitTestAnyBubbleAt,
      onCreateManualSelection,
      onManualDrawingStateChange,
      onSelectBubble,
      onUpdateManualSelectionGeometry,
    ]
  );

  // Global mousemove/mouseup/keydown listeners while a manual gesture is active (stable, 0 rerenders per frame)
  const attachManualWindowListeners = useCallback(() => {
    const handleMove = (ev: MouseEvent) => {
      const g = manualGestureRef.current;
      if (!g) return;
      const coords = getCanonicalFloatCoords(ev);
      if (!coords) return;

      if (g.kind === 'draw_box') {
        g.currentNorm = coords;
        if (!g.didDrag && Math.hypot(ev.clientX - g.startClient[0], ev.clientY - g.startClient[1]) >= 4) {
          g.didDrag = true;
          onManualDrawingStateChange?.(true);
        }
      } else if (g.kind === 'draw_freehand') {
        if (!g.didDrag && Math.hypot(ev.clientX - g.startClient[0], ev.clientY - g.startClient[1]) >= 4) {
          g.didDrag = true;
          onManualDrawingStateChange?.(true);
        }
        const prev = g.points[g.points.length - 1];
        if (!prev || Math.hypot(coords[0] - prev[0], coords[1] - prev[1]) >= 1.2) {
          g.points.push(coords);
        }
      } else if (g.kind === 'move') {
        const dx = coords[0] - g.startNorm[0];
        const dy = coords[1] - g.startNorm[1];
        if (!g.didDrag && (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3)) {
          g.didDrag = true;
        }
        const translated = translateSelectionGeometry(
          { box_2d: g.initialBox, polygon: g.initialPolygon },
          dx,
          dy
        );
        g.currentBox = translated.box_2d;
        g.currentPolygon = translated.polygon;
      } else if (g.kind === 'resize') {
        g.didDrag = true;
        const nextBox = resizeBoxFromHandle(g.initialBox, g.handle, coords[0], coords[1], 0.8, 0.5);
        g.currentBox = nextBox;
        g.currentPolygon = g.initialPolygon
          ? scalePolygonFromBox(g.initialPolygon, g.initialBox, nextBox)
          : undefined;
      }

      scheduleManualPreviewPaint();
    };

    const handleUp = (ev: MouseEvent) => {
      if (ev.button !== 0 && manualGestureRef.current) return;
      cleanup();
      commitManualGesture(ev);
    };

    const handleBlur = () => {
      cleanup();
      manualGestureRef.current = null;
      onManualDrawingStateChange?.(false);
      clearManualPreview();
    };

    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && manualGestureRef.current) {
        ev.preventDefault();
        ev.stopPropagation();
        handleBlur();
      }
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('keydown', handleKey, true);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('keydown', handleKey, true);
  }, [
    clearManualPreview,
    commitManualGesture,
    getCanonicalFloatCoords,
    onManualDrawingStateChange,
    scheduleManualPreviewPaint,
  ]);

  const startManualResizeGesture = useCallback(
    (bubble: BubbleItem, handle: ResizeHandle, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      manualGestureRef.current = {
        kind: 'resize',
        bubbleId: bubble.id,
        isEllipse: isParametricBubbleItem(bubble),
        handle,
        initialBox: [...bubble.box_2d] as NormalizedBox2D,
        initialPolygon: bubble.manualPolygon ? bubble.manualPolygon.map((p) => [...p] as [number, number]) : undefined,
        currentBox: [...bubble.box_2d] as NormalizedBox2D,
        currentPolygon: bubble.manualPolygon,
        didDrag: false,
      };
      attachManualWindowListeners();
    },
    [attachManualWindowListeners]
  );

  const commitDrawnBox = useCallback(() => {
    const start = drawingStartRef.current;
    const current = drawingCurrentRef.current;
    if (!start || !current) {
      drawingStartRef.current = null;
      drawingCurrentRef.current = null;
      setDrawingStart(null);
      setDrawingCurrent(null);
      return;
    }

    const rawBox: [number, number, number, number] = [
      Math.min(start.y, current.y),
      Math.min(start.x, current.x),
      Math.max(start.y, current.y),
      Math.max(start.x, current.x),
    ];

    // Canonical Geometry Validation (Section 4.6)
    const validated = validateCanonicalBox(rawBox, 1000, 15);
    if (validated.valid) {
      onAddManualBubbleWithCoords?.(validated.box);
    } else {
      emitDiagnosticBoundary({
        subsystem: 'rendering-ui',
        component: 'CanvasPane',
        operation: 'manualBoxValidation',
        eventType: 'decision',
        severity: 'warning',
        status: 'degraded',
        payload: { rawBox, errors: validated.errors },
        explanation: `Drawn manual bounding box required geometry clamping (${validated.errors.join('; ')}).`,
      });
    }

    drawingStartRef.current = null;
    drawingCurrentRef.current = null;
    setDrawingStart(null);
    setDrawingCurrent(null);
  }, [onAddManualBubbleWithCoords]);

  // Window mousemove & mouseup for legacy Add-Bubble drawing across canvas boundaries
  useEffect(() => {
    if (!drawingStart || !isDrawBoxActive || isManualSelectionActive) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const coords = getCanonicalSourceCoords(e);
      if (coords) {
        drawingCurrentRef.current = coords;
        setDrawingCurrent(coords);
      }
    };

    const handleWindowMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      commitDrawnBox();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        drawingStartRef.current = null;
        drawingCurrentRef.current = null;
        setDrawingStart(null);
        setDrawingCurrent(null);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [drawingStart, isDrawBoxActive, isManualSelectionActive, commitDrawnBox]);

  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 1) {
      e.preventDefault();
      panStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      didMoveRef.current = false;
      setIsPanning(true);
      return;
    }

    if (e.button !== 0) return;

    // Manual Selection direct drawing & editing on the existing Workbench canvas
    if (isManualSelectionActive) {
      const coords = getCanonicalFloatCoords(e);
      if (!coords) return;

      const hit = hitTestAnyBubbleAt(coords[0], coords[1]);
      if (hit && hit.provenance === 'manual_selection') {
        manualGestureRef.current = {
          kind: 'move',
          bubbleId: hit.id,
          isEllipse: isParametricBubbleItem(hit),
          initialBox: [...hit.box_2d] as NormalizedBox2D,
          initialPolygon: hit.manualPolygon
            ? hit.manualPolygon.map((p) => [...p] as [number, number])
            : undefined,
          startNorm: coords,
          currentBox: [...hit.box_2d] as NormalizedBox2D,
          currentPolygon: hit.manualPolygon,
          didDrag: false,
        };
        attachManualWindowListeners();
        return;
      }

      if (manualSelectionMode === 'box' || manualSelectionMode === 'bubble') {
        manualGestureRef.current = {
          kind: 'draw_box',
          shape: manualSelectionMode,
          startNorm: coords,
          currentNorm: coords,
          startClient: [e.clientX, e.clientY],
          didDrag: false,
        };
      } else {
        manualGestureRef.current = {
          kind: 'draw_freehand',
          mode: 'lasso',
          points: [coords],
          startClient: [e.clientX, e.clientY],
          didDrag: false,
        };
      }
      attachManualWindowListeners();
      return;
    }

    // If legacy Add Bubble drawing box is active, initiate box creation
    if (isDrawBoxActive) {
      const coords = getCanonicalSourceCoords(e);
      if (coords) {
        drawingStartRef.current = coords;
        drawingCurrentRef.current = coords;
        setDrawingStart(coords);
        setDrawingCurrent(coords);
      }
      return;
    }

    // Hit-test on bubbles with deterministic innermost overlap resolution
    if (svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const coords = getCanonicalSourceCoords(e);
      if (coords) {
        const hit = hitTestWorkspace(
          { x: coords.x, y: coords.y },
          visibleBubbles,
          {
            sourceDimensions: { width: 1000, height: 1000 },
            viewportDimensions: { width: rect.width, height: rect.height },
            zoom: 100,
            pan: { x: 0, y: 0 },
          },
          { selectedBubbleId }
        );

        if (hit.hitBubble) {
          onSelectBubble(hit.hitBubble.id);
        }
      }
    }
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const coords = getCanonicalSourceCoords(e);
    if (coords && overlaySettings.coordinateDiagnostics) {
      setCursorPos({
        screenX: Math.round(e.clientX),
        screenY: Math.round(e.clientY),
        srcX: coords.x,
        srcY: coords.y,
      });
    }

    if (isManualSelectionActive || !isDrawBoxActive || !drawingStartRef.current) return;
    if (coords) {
      drawingCurrentRef.current = coords;
      setDrawingCurrent(coords);
    }
  };

  const handleSvgMouseUp = () => {
    if (isManualSelectionActive) return;
    if (!isDrawBoxActive || !drawingStartRef.current) {
      drawingStartRef.current = null;
      drawingCurrentRef.current = null;
      setDrawingStart(null);
      setDrawingCurrent(null);
      return;
    }

    commitDrawnBox();
  };

  // Drag and drop ingestion onto Canvas
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    try {
      const files = await extractFilesFromDataTransfer(e.dataTransfer);
      if (files.length > 0) {
        if (onIngestDroppedFiles) {
          onIngestDroppedFiles(files);
        } else {
          await ingestImageFiles(files);
        }
      }
    } catch (err) {
      console.error('Failed to ingest dropped files onto canvas', err);
    }
  };

  const effectiveShowBoxes = showBoxes && overlaySettings.boxesVisible;
  const outlineMetrics = SELECTION_OUTLINE_METRICS[overlaySettings.selectionOutlineSize];
  const badgeMetrics = BADGE_METRICS[overlaySettings.badgeSize];
  const zoomComp = useMemo(() => computeOverlayZoomCompensation(zoomLevel), [zoomLevel]);
  const previewStrokeWidth = String(outlineMetrics.previewStrokePx / zoomComp.strokeDivisor);
  const previewDashArray = `${outlineMetrics.flaggedDash[0] / zoomComp.strokeDivisor} ${outlineMetrics.flaggedDash[1] / zoomComp.strokeDivisor}`;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`h-full w-full rounded-2xl border border-white/[0.08] bg-[#07080a] shadow-2xl flex flex-col min-h-0 select-none relative overflow-hidden transition-all ${
        isDragOver ? 'ring-2 ring-sky-500/50 border-sky-400/60 bg-sky-950/10' : ''
      }`}
    >
      {/* Viewport Canvas Layer */}
      <div
        ref={viewportRef}
        onMouseDown={handleContainerMouseDown}
        onDoubleClick={handleDoubleClick}
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        className={`flex-1 min-h-0 p-3 flex items-center justify-center relative overflow-hidden select-none ${
          isManualSelectionActive || isDrawBoxActive
            ? 'cursor-crosshair'
            : isPanning
            ? 'cursor-grabbing'
            : 'cursor-default'
        }`}
      >
        {/* Flip Page Edge Hit-Zones */}
        {isFlipPageActive && (
          <>
            <div
              data-flip-edge="true"
              onClick={(e) => {
                e.stopPropagation();
                onPrevPage?.();
              }}
              className={`absolute inset-y-0 left-0 w-[8%] min-w-[56px] max-w-[96px] z-30 flex items-center justify-start pl-2 select-none transition-all duration-300 ease-out group ${
                hasPrevPage
                  ? 'cursor-pointer bg-gradient-to-r from-sky-500/25 via-sky-500/[0.08] to-transparent opacity-0 hover:opacity-100'
                  : 'cursor-not-allowed opacity-0 pointer-events-none'
              }`}
              title={hasPrevPage ? 'Previous Page' : 'First Page'}
            >
              {hasPrevPage && (
                <div className="flex items-center gap-1">
                  <div className="w-1 h-16 rounded-full bg-sky-400/70 shadow-[0_0_12px_rgba(56,189,248,0.45)] transition-transform duration-300 group-hover:scale-y-110" />
                </div>
              )}
            </div>

            <div
              data-flip-edge="true"
              onClick={(e) => {
                e.stopPropagation();
                onNextPage?.();
              }}
              className={`absolute inset-y-0 right-0 w-[8%] min-w-[56px] max-w-[96px] z-30 flex items-center justify-end pr-2 select-none transition-all duration-300 ease-out group ${
                hasNextPage
                  ? 'cursor-pointer bg-gradient-to-l from-sky-500/25 via-sky-500/[0.08] to-transparent opacity-0 hover:opacity-100'
                  : 'cursor-not-allowed opacity-0 pointer-events-none'
              }`}
              title={hasNextPage ? 'Next Page' : 'Last Page'}
            >
              {hasNextPage && (
                <div className="flex items-center gap-1">
                  <div className="w-1 h-16 rounded-full bg-sky-400/70 shadow-[0_0_12px_rgba(56,189,248,0.45)] transition-transform duration-300 group-hover:scale-y-110" />
                </div>
              )}
            </div>
          </>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center gap-2.5 text-zinc-500 text-xs font-mono">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-200 rounded-full animate-spin" />
            <span>LOADING CANONICAL SCAN...</span>
          </div>
        ) : (
          <div
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoomLevel / 100})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 100ms ease-out',
            }}
            className="relative inline-flex items-center justify-center rounded-sm overflow-visible select-none"
          >
            {/* Layer 1: Manga Artwork Image */}
            {imageUrl ? (
              <img
                ref={imgRef}
                src={imageUrl}
                alt={pageFileName || 'Chapter page scan'}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    const nextSize = { width: img.naturalWidth, height: img.naturalHeight };
                    imgNaturalRef.current = nextSize;
                    setImgNaturalSize(nextSize);
                  }
                }}
                onError={() => {
                  emitDiagnosticBoundary({
                    subsystem: 'rendering-ui',
                    component: 'CanvasPane',
                    operation: 'renderPageImage',
                    eventType: 'error',
                    severity: 'error',
                    status: 'failed',
                    payload: { pageFileName },
                    explanation: `Failed to render page image element on canvas (${pageFileName || 'unknown page'}).`,
                  });
                }}
                style={{
                  maxWidth: Math.max(120, viewportSize.width - 24),
                  maxHeight: Math.max(120, viewportSize.height - 24),
                }}
                className="w-auto h-auto select-none pointer-events-none block rounded-xs"
                draggable={false}
              />
            ) : (
              <div className="w-[420px] h-[600px] bg-[#0d0e12] border border-white/[0.08] rounded-xl flex flex-col justify-between p-6 relative overflow-hidden shadow-2xl">
                <div className="relative z-10 flex items-center justify-between text-zinc-600 text-[10px] font-mono">
                  <span>CANONICAL SCAN SURFACE</span>
                  <span>1000 x 1000 UNITS</span>
                </div>
                <div className="relative z-10 my-auto text-center flex flex-col items-center gap-2">
                  <FileImage className="w-8 h-8 text-zinc-500 stroke-[1.5]" />
                  <span className="text-xs text-zinc-300 font-semibold uppercase tracking-wider font-mono">
                    CANVAS READY
                  </span>
                  <span className="text-[11px] text-zinc-500 max-w-xs">
                    Drop images here from OS explorer to test interactive translation canvas.
                  </span>
                </div>
                <div className="relative z-10 text-center text-[10px] text-zinc-600 font-mono">
                  READY
                </div>
              </div>
            )}

            {/* Layer 2-6: SVG Overlay Layer Locked Over Canonical Space */}
            <svg
              ref={svgRef}
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              onMouseDown={handleSvgMouseDown}
              onMouseMove={handleSvgMouseMove}
              onMouseUp={handleSvgMouseUp}
              className="absolute inset-0 w-full h-full pointer-events-auto"
            >
              {/* Layer 3: Reading Order Flow Vector Connectors — removed */}

              {/* Layer 4: Selection Polygons, Bounding Boxes & Review Markers */}
              <g
                style={{
                  opacity: effectiveShowBoxes ? 1 : 0,
                  pointerEvents:
                    isDrawBoxActive || isManualSelectionActive
                      ? 'none'
                      : effectiveShowBoxes
                        ? 'auto'
                        : 'none',
                  transition: 'opacity 150ms ease',
                }}
              >
                {visualRegions.map((region) => {
                  const primary = region.bubbles[0];
                  const typerVisual = resolveTyperVisual(primary, typerSettings.typers);
                  const ymin = region.box_2d[0];
                  const xmin = region.box_2d[1];
                  const ymax = region.box_2d[2];
                  const xmax = region.box_2d[3];

                  const width = Math.max(xmax - xmin, 0.5);
                  const height = Math.max(ymax - ymin, 0.5);
                  const isSelected = region.isSelected;
                  const isFlagged = region.isFlagged;
                  const hasPoly = Boolean(primary.manualPolygon && primary.manualPolygon.length >= 3);
                  const isParametricEllipse = !hasPoly && primary.manualSelectionShape === 'bubble';

                  const strokeColor = typerVisual.color;
                  const baseStrokePx = isSelected ? outlineMetrics.selectedStrokePx : outlineMetrics.strokePx;
                  const strokeWidth = String(baseStrokePx / zoomComp.strokeDivisor);
                  const strokeOpacity = isSelected ? 1 : outlineMetrics.strokeOpacity;
                  const strokeDasharray = isFlagged
                    ? `${outlineMetrics.flaggedDash[0] / zoomComp.strokeDivisor} ${outlineMetrics.flaggedDash[1] / zoomComp.strokeDivisor}`
                    : 'none';
                  const fillColor = hexToRgba(
                    typerVisual.color,
                    isSelected
                      ? outlineMetrics.selectedFillAlpha
                      : isFlagged
                        ? outlineMetrics.flaggedFillAlpha
                        : outlineMetrics.fillAlpha
                  );

                  return (
                    <g
                      key={`region-box-${region.regionKey}`}
                      onClick={(e) => {
                        if (didMoveRef.current || isManualSelectionActive) return;
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        const currentSelIdx = region.bubbles.findIndex((b) => b.id === selectedBubbleId);
                        const nextBubble = currentSelIdx >= 0 && currentSelIdx < region.bubbles.length - 1
                          ? region.bubbles[currentSelIdx + 1]
                          : region.bubbles[0];
                        onSelectBubble(nextBubble.id);
                      }}
                      className="cursor-pointer group"
                    >
                      {hasPoly ? (
                        <polygon
                          points={primary.manualPolygon!.map(([px, py]) => `${px},${py}`).join(' ')}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          strokeOpacity={strokeOpacity}
                          strokeDasharray={strokeDasharray}
                          strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                          fill={fillColor}
                        />
                      ) : isParametricEllipse ? (
                        <ellipse
                          cx={(xmin + xmax) / 2}
                          cy={(ymin + ymax) / 2}
                          rx={Math.max((xmax - xmin) / 2, 0.25)}
                          ry={Math.max((ymax - ymin) / 2, 0.25)}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          strokeOpacity={strokeOpacity}
                          strokeDasharray={strokeDasharray}
                          vectorEffect="non-scaling-stroke"
                          fill={fillColor}
                        />
                      ) : (
                        <rect
                          x={xmin}
                          y={ymin}
                          width={width}
                          height={height}
                          rx="0.5"
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          strokeOpacity={strokeOpacity}
                          strokeDasharray={strokeDasharray}
                          vectorEffect="non-scaling-stroke"
                          fill={fillColor}
                        />
                      )}
                    </g>
                  );
                })}
              </g>

              {/* Imperative RAF Live Drawing / Editing Previews (Manual Selection) */}
              <rect
                ref={previewRectRef}
                style={{ display: 'none' }}
                rx="0.5"
                stroke={manualActiveTyperColor}
                strokeWidth={previewStrokeWidth}
                strokeDasharray={previewDashArray}
                vectorEffect="non-scaling-stroke"
                fill={hexToRgba(manualActiveTyperColor, outlineMetrics.selectedFillAlpha)}
                pointerEvents="none"
              />
              <ellipse
                ref={previewEllipseRef}
                style={{ display: 'none' }}
                stroke={manualActiveTyperColor}
                strokeWidth={previewStrokeWidth}
                strokeDasharray={previewDashArray}
                vectorEffect="non-scaling-stroke"
                fill={hexToRgba(manualActiveTyperColor, outlineMetrics.selectedFillAlpha)}
                pointerEvents="none"
              />
              <polygon
                ref={previewPolyRef}
                style={{ display: 'none' }}
                stroke={manualActiveTyperColor}
                strokeWidth={previewStrokeWidth}
                strokeDasharray={previewDashArray}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                fill={hexToRgba(manualActiveTyperColor, outlineMetrics.selectedFillAlpha)}
                pointerEvents="none"
              />
              <path
                ref={previewFreehandRef}
                style={{ display: 'none' }}
                stroke={manualActiveTyperColor}
                strokeWidth={previewStrokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                fill={hexToRgba(manualActiveTyperColor, outlineMetrics.selectedFillAlpha)}
                pointerEvents="none"
              />

              {/* Legacy Add-Bubble Drawing Preview Rectangle */}
              {!isManualSelectionActive && isDrawBoxActive && drawingStart && drawingCurrent && (
                <rect
                  x={Math.min(drawingStart.x, drawingCurrent.x)}
                  y={Math.min(drawingStart.y, drawingCurrent.y)}
                  width={Math.abs(drawingCurrent.x - drawingStart.x)}
                  height={Math.abs(drawingCurrent.y - drawingStart.y)}
                  rx="0.5"
                  stroke="#38bdf8"
                  strokeWidth={previewStrokeWidth}
                  strokeDasharray={previewDashArray}
                  vectorEffect="non-scaling-stroke"
                  fill="rgba(56, 189, 248, 0.06)"
                />
              )}
            </svg>

            {/* Layer 5: Non-Stretching Symbol + Number Badges & Interactive Resize Handles */}
            <div
              className="absolute inset-0 pointer-events-none select-none overflow-visible"
              data-selection-outline-size={overlaySettings.selectionOutlineSize}
              data-selection-badge-size={overlaySettings.badgeSize}
              style={{
                opacity: effectiveShowBoxes ? 1 : 0,
                transition: 'opacity 150ms ease',
              }}
            >
              {visualRegions.map((region) => {
                const primary = region.bubbles[0];
                const typerVisual = resolveTyperVisual(primary, typerSettings.typers);
                const isSelected = region.isSelected;
                const isFlagged = region.isFlagged;
                const labelText = region.label;

                const [ymin, xmin] = region.box_2d;
                const isNearTop = ymin < 40;
                const isNearRight = xmin > 850;
                const badgeZoomScale = zoomComp.badgeTransformScale;
                const offset = badgeMetrics.offsetPx;

                const transformStr = isNearTop
                  ? (isNearRight
                      ? `translate(-100%, ${offset}px) scale(${badgeZoomScale})`
                      : `translate(${offset}px, ${offset}px) scale(${badgeZoomScale})`)
                  : (isNearRight
                      ? `translate(-100%, -100%) translateY(-${offset}px) scale(${badgeZoomScale})`
                      : `translate(0, -100%) translateY(-${offset}px) scale(${badgeZoomScale})`);
                const transformOriginStr = isNearTop
                  ? (isNearRight ? 'top right' : 'top left')
                  : (isNearRight ? 'bottom right' : 'bottom left');

                return (
                  <div
                    key={`badge-region-${region.regionKey}`}
                    data-selection-badge="true"
                    onClick={(e) => {
                      if (didMoveRef.current) return;
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      const currentSelIdx = region.bubbles.findIndex((b) => b.id === selectedBubbleId);
                      const nextBubble = currentSelIdx >= 0 && currentSelIdx < region.bubbles.length - 1
                        ? region.bubbles[currentSelIdx + 1]
                        : region.bubbles[0];
                      onSelectBubble(nextBubble.id);
                    }}
                    style={{
                      position: 'absolute',
                      top: `${ymin / 10}%`,
                      left: `${xmin / 10}%`,
                      transform: transformStr,
                      transformOrigin: transformOriginStr,
                      padding: `${badgeMetrics.paddingY}px ${badgeMetrics.paddingX}px`,
                      gap: `${badgeMetrics.gap}px`,
                      borderRadius: `${badgeMetrics.borderRadius}px`,
                      fontSize: `${badgeMetrics.fontSize}px`,
                      lineHeight: 1,
                      pointerEvents:
                        isDrawBoxActive || isManualSelectionActive
                          ? 'none'
                          : effectiveShowBoxes
                            ? 'auto'
                            : 'none',
                    }}
                    className={`cursor-pointer inline-flex items-center bg-[#09090b]/95 border border-white/20 font-mono font-semibold text-zinc-100 select-none ${
                      isSelected
                        ? 'ring-1 ring-white/90 z-30'
                        : 'z-20'
                    }`}
                    title={`${labelText} — ${typerVisual.name}${typerVisual.symbol ? ` (${typerVisual.symbol})` : ''}`}
                  >
                    {typerVisual.isClassified && (
                      <TyperSymbolBadge
                        symbol={typerVisual.symbol}
                        color={typerVisual.color}
                        size="canvas"
                        style={{
                          minWidth: `${badgeMetrics.symbolMinWidth}px`,
                          height: `${badgeMetrics.symbolHeight}px`,
                          padding: `0 ${badgeMetrics.symbolPaddingX}px`,
                          fontSize: `${badgeMetrics.symbolFontSize}px`,
                          borderRadius: `${badgeMetrics.symbolBorderRadius}px`,
                        }}
                      />
                    )}
                    <span
                      style={{ padding: `0 ${badgeMetrics.numberPaddingX}px` }}
                      className="tabular-nums"
                    >
                      {labelText}
                    </span>
                    {isFlagged && (
                      <span
                        aria-label="Flagged"
                        style={{
                          width: `${badgeMetrics.flagDotPx}px`,
                          height: `${badgeMetrics.flagDotPx}px`,
                        }}
                        className="rounded-full bg-amber-400 shrink-0"
                      />
                    )}
                  </div>
                );
              })}

              {/* Resize Handles for Active Manual Selection (Box, Bubble, Lasso) */}
              {isManualSelectionActive &&
                effectiveShowBoxes &&
                selectedBubbleId &&
                (() => {
                  const selectedManual = visibleBubbles.find(
                    (b) => b.id === selectedBubbleId && b.provenance === 'manual_selection'
                  );
                  if (!selectedManual) return null;
                  const visual = resolveTyperVisual(selectedManual, typerSettings.typers);
                  const availW = Math.max(120, viewportSize.width - 24);
                  const availH = Math.max(120, viewportSize.height - 24);
                  const baseImgScale = Math.min(
                    1,
                    availW / Math.max(1, imgNaturalSize.width),
                    availH / Math.max(1, imgNaturalSize.height)
                  );
                  const surfaceW = imgNaturalSize.width * baseImgScale * (zoomLevel / 100);
                  const surfaceH = imgNaturalSize.height * baseImgScale * (zoomLevel / 100);
                  const renderedW = ((selectedManual.box_2d[3] - selectedManual.box_2d[1]) / 1000) * surfaceW;
                  const renderedH = ((selectedManual.box_2d[2] - selectedManual.box_2d[0]) / 1000) * surfaceH;
                  const visibleHandles =
                    renderedW < 28 || renderedH < 28
                      ? RESIZE_HANDLES.filter((h) => CORNER_HANDLE_IDS.has(h.id))
                      : RESIZE_HANDLES;
                  const handleScale = zoomComp.handleTransformScale;
                  const handleMetrics = outlineMetrics.handle;

                  return visibleHandles.map((h) => {
                    const [hx, hy] = h.getPoint(selectedManual.box_2d);
                    return (
                      <div
                        key={`handle-${selectedManual.id}-${h.id}`}
                        data-manual-resize-handle={h.id}
                        onMouseDown={(e) => startManualResizeGesture(selectedManual, h.id, e)}
                        style={{
                          position: 'absolute',
                          left: `${hx / 10}%`,
                          top: `${hy / 10}%`,
                          width: `${handleMetrics.sizePx}px`,
                          height: `${handleMetrics.sizePx}px`,
                          borderWidth: `${handleMetrics.borderWidthPx}px`,
                          borderStyle: 'solid',
                          borderRadius: `${handleMetrics.borderRadiusPx}px`,
                          transform: `translate(-50%, -50%) scale(${handleScale})`,
                          cursor: h.cursor,
                          backgroundColor: '#FFFFFF',
                          borderColor: visual.color,
                          pointerEvents: 'auto',
                        }}
                        className="z-40"
                        title={`Resize (${h.id.toUpperCase()})`}
                      />
                    );
                  });
                })()}
            </div>
          </div>
        )}

        {/* Section 10.3: Coordinate Diagnostics HUD Overlay */}
        {overlaySettings.coordinateDiagnostics && (
          <div className="absolute bottom-3 left-3 z-40 p-2.5 rounded-lg bg-black/80 border border-white/[0.14] font-mono text-[10px] text-zinc-300 space-y-1 shadow-2xl backdrop-blur-xs pointer-events-none">
            <div className="flex items-center gap-1.5 text-amber-400 font-bold border-b border-white/[0.08] pb-1">
              <Activity className="w-3 h-3" />
              <span>COORDINATE DIAGNOSTICS HUD // v6</span>
            </div>
            <div>Zoom: <span className="text-white">{zoomLevel}%</span> | Pan: <span className="text-white">[{pan.x}, {pan.y}]</span></div>
            <div>Viewport: <span className="text-white">{transformParams.viewportDimensions.width}x{transformParams.viewportDimensions.height}</span></div>
            <div>Generation: <span className="text-emerald-400">#{generationToken.generation}</span> (Token: {generationToken.pageId})</div>
            {cursorPos && (
              <div>
                Cursor Screen: <span className="text-sky-300">[{cursorPos.screenX}, {cursorPos.screenY}]</span> | Source: <span className="text-amber-300">[{cursorPos.srcX}, {cursorPos.srcY}]</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
