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

interface CanvasPaneProps {
  imageUrl: string | null;
  isLoading: boolean;
  pageFileName?: string;
  bubbles: BubbleItem[];
  selectedBubbleId: string | null;
  focusTarget?: { bubbleId: string; box_2d: [number, number, number, number]; trigger: number } | null;
  centerTarget?: { bubbleId: string; box_2d: [number, number, number, number]; trigger: number } | null;
  panTarget?: { x: number; y: number; trigger: number } | null;
  isDrawBoxActive: boolean;
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
  onSelectBubble: (bubbleId: string) => void;
  onAddManualBubbleWithCoords?: (box_2d: [number, number, number, number]) => void;
  onIngestDroppedFiles?: (files: File[]) => void;
}

export const CanvasPane: React.FC<CanvasPaneProps> = ({
  imageUrl,
  isLoading,
  pageFileName,
  bubbles,
  selectedBubbleId,
  focusTarget,
  centerTarget,
  panTarget,
  isDrawBoxActive,
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
  onIngestDroppedFiles,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

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

  // Settings subscription for overlay visibility & diagnostics HUD
  const [overlaySettings, setOverlaySettings] = useState(() => ({
    boxesVisible: settingsService.getEffectiveValue<boolean>('workspace.overlay_boxes_visible').value,
    readingOrderVisible: settingsService.getEffectiveValue<boolean>('workspace.overlay_reading_order_visible').value,
    panelsVisible: settingsService.getEffectiveValue<boolean>('workspace.overlay_panels_visible').value,
    reviewMarkersVisible: settingsService.getEffectiveValue<boolean>('workspace.overlay_review_markers_visible').value,
    coordinateDiagnostics: settingsService.getEffectiveValue<boolean>('workspace.coordinate_diagnostics').value,
    includeSFX: settingsService.getEffectiveValue<boolean>('scanning.include_sfx').value,
  }));

  useEffect(() => {
    const unsub = settingsService.subscribe(() => {
      setOverlaySettings({
        boxesVisible: settingsService.getEffectiveValue<boolean>('workspace.overlay_boxes_visible').value,
        readingOrderVisible: settingsService.getEffectiveValue<boolean>('workspace.overlay_reading_order_visible').value,
        panelsVisible: settingsService.getEffectiveValue<boolean>('workspace.overlay_panels_visible').value,
        reviewMarkersVisible: settingsService.getEffectiveValue<boolean>('workspace.overlay_review_markers_visible').value,
        coordinateDiagnostics: settingsService.getEffectiveValue<boolean>('workspace.coordinate_diagnostics').value,
        includeSFX: settingsService.getEffectiveValue<boolean>('scanning.include_sfx').value,
      });
    });
    return () => unsub();
  }, []);

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
    if (isDrawBoxActive) return;
    if ((e.target as HTMLElement)?.closest('[data-flip-edge="true"]')) return;
    e.preventDefault();
    onResetZoom?.();
    setPan({ x: 0, y: 0 });
  };

  /**
   * Maps pointer event to canonical source space (0-1000) using geometryService inverse transform.
   */
  const getCanonicalSourceCoords = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const rawX = ((e.clientX - rect.left) / rect.width) * 1000;
    const rawY = ((e.clientY - rect.top) / rect.height) * 1000;

    return {
      x: Math.max(0, Math.min(1000, Math.round(rawX))),
      y: Math.max(0, Math.min(1000, Math.round(rawY))),
    };
  };

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
    }

    drawingStartRef.current = null;
    drawingCurrentRef.current = null;
    setDrawingStart(null);
    setDrawingCurrent(null);
  }, [onAddManualBubbleWithCoords]);

  // Window mousemove & mouseup for drawing across canvas boundaries
  useEffect(() => {
    if (!drawingStart || !isDrawBoxActive) return;

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
  }, [drawingStart, isDrawBoxActive, commitDrawnBox]);

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

    // If drawing box is active, initiate box creation
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

    if (!isDrawBoxActive || !drawingStartRef.current) return;
    if (coords) {
      drawingCurrentRef.current = coords;
      setDrawingCurrent(coords);
    }
  };

  const handleSvgMouseUp = () => {
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

  // Reading order sequence links for layer rendering
  const sortedBubbles = useMemo(() => {
    return [...visibleBubbles].sort((a, b) => a.index - b.index);
  }, [visibleBubbles]);

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
          isDrawBoxActive
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
            className="relative inline-flex items-center justify-center max-h-full max-w-full rounded-sm overflow-hidden select-none"
          >
            {/* Layer 1: Manga Artwork Image */}
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={pageFileName || 'Chapter page scan'}
                className="max-h-[calc(100vh-140px)] max-w-full w-auto h-auto object-contain select-none pointer-events-none block rounded-xs"
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
              {/* Layer 3: Reading Order Flow Vector Connectors (when enabled) */}
              {overlaySettings.readingOrderVisible && sortedBubbles.length > 1 && (
                <g className="reading-order-layer pointer-events-none opacity-60">
                  {sortedBubbles.slice(0, -1).map((b, idx) => {
                    const next = sortedBubbles[idx + 1];
                    const x1 = (b.box_2d[1] + b.box_2d[3]) / 2;
                    const y1 = (b.box_2d[0] + b.box_2d[2]) / 2;
                    const x2 = (next.box_2d[1] + next.box_2d[3]) / 2;
                    const y2 = (next.box_2d[0] + next.box_2d[2]) / 2;
                    return (
                      <line
                        key={`order-${b.id}-${next.id}`}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="#f59e0b"
                        strokeWidth="2"
                        strokeDasharray="4 3"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </g>
              )}

              {/* Layer 4: Bounding Boxes & Review Markers */}
              <g
                style={{
                  opacity: effectiveShowBoxes ? 1 : 0,
                  pointerEvents: isDrawBoxActive ? 'none' : (effectiveShowBoxes ? 'auto' : 'none'),
                  transition: 'opacity 150ms ease',
                }}
              >
                {visualRegions.map((region) => {
                  const ymin = region.box_2d[0];
                  const xmin = region.box_2d[1];
                  const ymax = region.box_2d[2];
                  const xmax = region.box_2d[3];

                  const width = Math.max(xmax - xmin, 16);
                  const height = Math.max(ymax - ymin, 16);
                  const isSelected = region.isSelected;
                  const isFlagged = region.isFlagged;

                  let strokeColor = '#38bdf8';
                  let strokeWidth = '1.5';
                  let strokeDasharray = 'none';
                  let fillColor = isSelected ? 'rgba(56, 189, 248, 0.08)' : 'rgba(56, 189, 248, 0.03)';

                  if (isFlagged) {
                    strokeColor = '#f59e0b';
                    strokeWidth = isSelected ? '2.0' : '1.5';
                    strokeDasharray = '5 3';
                    fillColor = isSelected ? 'rgba(245, 158, 11, 0.18)' : 'rgba(245, 158, 11, 0.08)';
                  } else if (isSelected) {
                    strokeColor = '#38bdf8';
                    strokeWidth = '2';
                    fillColor = 'rgba(56, 189, 248, 0.12)';
                  }

                  return (
                    <g
                      key={`region-box-${region.regionKey}`}
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
                      className="cursor-pointer group"
                    >
                      <rect
                        x={xmin}
                        y={ymin}
                        width={width}
                        height={height}
                        rx="3"
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeDasharray={strokeDasharray}
                        vectorEffect="non-scaling-stroke"
                        fill={fillColor}
                        className="transition-all duration-150 group-hover:stroke-sky-300"
                      />

                      {/* Selection handles (Section 4.5) */}
                      {isSelected && (
                        <>
                          <rect x={xmin - 3} y={ymin - 3} width="6" height="6" fill="#38bdf8" rx="1" vectorEffect="non-scaling-stroke" />
                          <rect x={xmax - 3} y={ymin - 3} width="6" height="6" fill="#38bdf8" rx="1" vectorEffect="non-scaling-stroke" />
                          <rect x={xmin - 3} y={ymax - 3} width="6" height="6" fill="#38bdf8" rx="1" vectorEffect="non-scaling-stroke" />
                          <rect x={xmax - 3} y={ymax - 3} width="6" height="6" fill="#38bdf8" rx="1" vectorEffect="non-scaling-stroke" />
                        </>
                      )}
                    </g>
                  );
                })}
              </g>

              {/* Drawing Preview Rectangle */}
              {isDrawBoxActive && drawingStart && drawingCurrent && (
                <rect
                  x={Math.min(drawingStart.x, drawingCurrent.x)}
                  y={Math.min(drawingStart.y, drawingCurrent.y)}
                  width={Math.abs(drawingCurrent.x - drawingStart.x)}
                  height={Math.abs(drawingCurrent.y - drawingStart.y)}
                  rx="3"
                  stroke="#38bdf8"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                  fill="rgba(56, 189, 248, 0.15)"
                />
              )}
            </svg>

            {/* Layer 5: Dedicated Non-Stretching Number Badge Overlay */}
            <div
              className="absolute inset-0 pointer-events-none select-none overflow-visible"
              style={{
                opacity: effectiveShowBoxes ? 1 : 0,
                transition: 'opacity 150ms ease',
              }}
            >
              {visualRegions.map((region) => {
                const isSelected = region.isSelected;
                const isFlagged = region.isFlagged;
                const labelText = region.label;

                // Use primary box coordinates (normalized 0-1000)
                const [ymin, xmin] = region.box_2d;

                // Collision & edge detection:
                const isNearTop = ymin < 40;
                const isNearRight = xmin > 850;

                // Zoom compensation factor: keeps badges compact, readable, and non-distorted across extreme zoom levels
                const effectiveZoom = Math.max(25, zoomLevel);
                const badgeZoomScale = Math.min(1.8, Math.max(0.65, 100 / effectiveZoom));

                let badgeBg = '#38bdf8';
                let badgeTextColor = '#050507';
                let borderColor = 'rgba(255, 255, 255, 0.2)';

                if (isFlagged) {
                  badgeBg = '#f59e0b';
                  badgeTextColor = '#050507';
                  borderColor = 'rgba(255, 255, 255, 0.4)';
                }

                const transformStr = isNearTop
                  ? (isNearRight ? `translate(-100%, 4px) scale(${badgeZoomScale})` : `translate(4px, 4px) scale(${badgeZoomScale})`)
                  : (isNearRight ? `translate(-100%, -100%) translateY(-4px) scale(${badgeZoomScale})` : `translate(0, -100%) translateY(-4px) scale(${badgeZoomScale})`);
                const transformOriginStr = isNearTop
                  ? (isNearRight ? 'top right' : 'top left')
                  : (isNearRight ? 'bottom right' : 'bottom left');

                return (
                  <div
                    key={`badge-region-${region.regionKey}`}
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
                      backgroundColor: badgeBg,
                      color: badgeTextColor,
                      borderColor,
                      pointerEvents: isDrawBoxActive ? 'none' : (effectiveShowBoxes ? 'auto' : 'none'),
                    }}
                    className={`cursor-pointer inline-flex items-center justify-center px-1.5 py-0.5 rounded-[3px] border shadow-md font-mono text-[10px] font-bold leading-none select-none tracking-tight transition-transform duration-100 ${
                      isSelected
                        ? 'ring-2 ring-white ring-offset-1 ring-offset-black scale-110 z-30'
                        : 'hover:scale-110 hover:shadow-lg z-20'
                    }`}
                    title={`Balloon ${labelText} — Click to select`}
                  >
                    {labelText}
                  </div>
                );
              })}
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
