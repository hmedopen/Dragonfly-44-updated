import React, { useState, useRef, useEffect } from 'react';
import type { BubbleItem } from '../../types/workbench';
import { extractFilesFromDataTransfer, ingestImageFiles } from '../../services/fileIngestion';
import { 
  FileImage
} from 'lucide-react';

interface CanvasPaneProps {
  imageUrl: string | null;
  isLoading: boolean;
  pageFileName?: string;
  bubbles: BubbleItem[];
  selectedBubbleId: string | null;
  focusTarget?: { bubbleId: string; box_2d: [number, number, number, number]; trigger: number } | null;
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

  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
    onZoomChangeRef.current = onZoomChange;
  }, [zoomLevel, onZoomChange]);

  // Box drawing state (0-1000 normalized coordinates)
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null);
  const [drawingCurrent, setDrawingCurrent] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Reset pan on trigger or page switch via render-phase state adjustment
  const [lastPageFileName, setLastPageFileName] = useState(pageFileName);
  const [lastResetTrigger, setLastResetTrigger] = useState(resetViewTrigger);

  if (pageFileName !== lastPageFileName || resetViewTrigger !== lastResetTrigger) {
    setLastPageFileName(pageFileName);
    setLastResetTrigger(resetViewTrigger);
    if (!focusTarget) {
      setPan({ x: 0, y: 0 });
    }
  }

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

  // Window mousemove / mouseup for smooth click-and-drag panning
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
        // Alt + Wheel moves horizontally: wheel up -> right, wheel down -> left (Photoshop style)
        const delta = e.deltaY !== 0 ? e.deltaY : -e.deltaX;
        setPan((prev) => ({
          ...prev,
          x: prev.x - delta,
        }));
      } else if (e.shiftKey) {
        // Manhwa vertical scroll (Shift + Wheel)
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        setPan((prev) => ({
          ...prev,
          y: prev.y - delta,
        }));
      } else {
        // Mouse wheel zoom anchored to cursor
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
    
    // Only middle mouse button (button 1) moves the image — no left-click dragging
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

  const getSvgNormalizedCoords = (e: React.MouseEvent<SVGSVGElement>): { x: number; y: number } | null => {
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

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Middle mouse button pans image anywhere
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

    // Only LEFT mouse click (button 0) makes bubble boxes
    if (e.button !== 0) return;

    if (!isDrawBoxActive) return;
    const coords = getSvgNormalizedCoords(e);
    if (coords) {
      setDrawingStart(coords);
      setDrawingCurrent(coords);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDrawBoxActive || !drawingStart) return;
    const coords = getSvgNormalizedCoords(e);
    if (coords) {
      setDrawingCurrent(coords);
    }
  };

  const handleMouseUp = () => {
    if (!isDrawBoxActive || !drawingStart || !drawingCurrent) {
      setDrawingStart(null);
      setDrawingCurrent(null);
      return;
    }

    const xmin = Math.min(drawingStart.x, drawingCurrent.x);
    const xmax = Math.max(drawingStart.x, drawingCurrent.x);
    const ymin = Math.min(drawingStart.y, drawingCurrent.y);
    const ymax = Math.max(drawingStart.y, drawingCurrent.y);

    // Filter out accidental tiny clicks (< 15 units)
    if (xmax - xmin > 15 && ymax - ymin > 15) {
      onAddManualBubbleWithCoords?.([ymin, xmin, ymax, xmax]);
    }

    setDrawingStart(null);
    setDrawingCurrent(null);
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

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`h-full w-full rounded-2xl border border-white/[0.08] bg-[#07080a] shadow-2xl flex flex-col min-h-0 select-none relative overflow-hidden transition-all ${
        isDragOver ? 'ring-2 ring-sky-500/50 border-sky-400/60 bg-sky-950/10' : ''
      }`}
    >
      {/* Main Viewport & SVG Bounding Layer */}
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
        {/* Click-to-Flip Narrow Edge Hit-Zones (strictly outer 5.5% edges) */}
        {isFlipPageActive && (
          <>
            {/* Left Edge: Previous Page */}
            <div
              data-flip-edge="true"
              onClick={(e) => {
                e.stopPropagation();
                onPrevPage?.();
              }}
              className={`absolute inset-y-0 left-0 w-[5.5%] z-30 flex items-center justify-start pl-1 transition-all select-none ${
                hasPrevPage
                  ? 'cursor-pointer hover:bg-sky-500/10 group'
                  : 'cursor-not-allowed opacity-25'
              }`}
              title={hasPrevPage ? 'Previous Page' : 'First Page'}
            >
              {hasPrevPage && (
                <div className="w-1.5 h-12 rounded-full bg-sky-400/50 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" />
              )}
            </div>

            {/* Right Edge: Next Page */}
            <div
              data-flip-edge="true"
              onClick={(e) => {
                e.stopPropagation();
                onNextPage?.();
              }}
              className={`absolute inset-y-0 right-0 w-[5.5%] z-30 flex items-center justify-end pr-1 transition-all select-none ${
                hasNextPage
                  ? 'cursor-pointer hover:bg-sky-500/10 group'
                  : 'cursor-not-allowed opacity-25'
              }`}
              title={hasNextPage ? 'Next Page' : 'Last Page'}
            >
              {hasNextPage && (
                <div className="w-1.5 h-12 rounded-full bg-sky-400/50 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" />
              )}
            </div>
          </>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center gap-2.5 text-zinc-500 text-xs">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-200 rounded-full animate-spin" />
            <span>LOADING SCAN...</span>
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
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={pageFileName || 'Chapter page scan'}
                className="max-h-[calc(100vh-140px)] max-w-full object-contain select-none pointer-events-none block rounded-xs"
                draggable={false}
              />
            ) : (
              /* Fallback Visual Manga Panel Surface */
              <div className="w-[420px] h-[600px] bg-[#0d0e12] border border-white/[0.08] rounded-xl flex flex-col justify-between p-6 relative overflow-hidden shadow-2xl">
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-3 gap-2 p-4 pointer-events-none opacity-20">
                  <div className="border border-zinc-700 rounded-lg bg-zinc-900/40" />
                  <div className="border border-zinc-700 rounded-lg bg-zinc-900/40" />
                  <div className="border border-zinc-700 rounded-lg bg-zinc-900/40 col-span-2" />
                  <div className="border border-zinc-700 rounded-lg bg-zinc-900/40" />
                  <div className="border border-zinc-700 rounded-lg bg-zinc-900/40" />
                </div>

                <div className="relative z-10 flex items-center justify-between text-zinc-600 text-[10px]">
                  <span>PAGE PREVIEW</span>
                  <span>1000 x 1000 BOUNDING</span>
                </div>

                <div className="relative z-10 my-auto text-center flex flex-col items-center gap-2">
                  <FileImage className="w-8 h-8 text-zinc-500 stroke-[1.5]" />
                  <span className="text-xs text-zinc-300 font-semibold uppercase tracking-wider">
                    SCAN SURFACE READY
                  </span>
                  <span className="text-[11px] text-zinc-500 max-w-xs">
                    Drop images here from OS explorer to test interactive translation canvas.
                  </span>
                </div>

                <div className="relative z-10 text-center text-[10px] text-zinc-600">
                  READY
                </div>
              </div>
            )}

            {/* SVG Bounding Layer Locked Directly Over Scan Image */}
            <svg
              ref={svgRef}
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              className="absolute inset-0 w-full h-full pointer-events-auto"
            >
              {/* Non-destructive Box Visibility Group */}
              <g
                style={{
                  opacity: showBoxes ? 1 : 0,
                  pointerEvents: showBoxes ? 'auto' : 'none',
                  transition: 'opacity 150ms ease',
                }}
              >
                {bubbles.map((bubble) => {
                  const ymin = bubble.box_2d[0];
                  const xmin = bubble.box_2d[1];
                  const ymax = bubble.box_2d[2];
                  const xmax = bubble.box_2d[3];

                  const width = Math.max(xmax - xmin, 16);
                  const height = Math.max(ymax - ymin, 16);
                  const isSelected = selectedBubbleId === bubble.id;
                  const isFlagged = bubble.reviewFlags && bubble.reviewFlags.length > 0;
                  const paddedIndex = String(bubble.index).padStart(2, '0');

                  // Corner Chip Coordinates
                  const chipY = ymin >= 20 ? ymin - 18 : ymin + 2;
                  const chipX = Math.max(xmin, 2);

                  // Visual Styles
                  let strokeColor = '#38bdf8';
                  let strokeWidth = '1.5';
                  let strokeDasharray = 'none';
                  let fillColor = isSelected ? 'rgba(56, 189, 248, 0.08)' : 'rgba(56, 189, 248, 0.03)';
                  let badgeBg = '#38bdf8';
                  let badgeTextColor = '#050507';

                  if (isFlagged) {
                    strokeColor = '#f59e0b';
                    strokeWidth = isSelected ? '2.0' : '1.5';
                    strokeDasharray = '5 3';
                    fillColor = isSelected ? 'rgba(245, 158, 11, 0.18)' : 'rgba(245, 158, 11, 0.08)';
                    badgeBg = '#f59e0b';
                    badgeTextColor = '#050507';
                  } else if (isSelected) {
                    strokeColor = '#38bdf8';
                    strokeWidth = '2';
                    fillColor = 'rgba(56, 189, 248, 0.12)';
                    badgeBg = '#38bdf8';
                    badgeTextColor = '#050507';
                  }

                  return (
                    <g
                      key={bubble.id}
                      onMouseDown={(e) => {
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
                      }}
                      onClick={(e) => {
                        if (didMoveRef.current) return;
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        onSelectBubble(bubble.id);
                      }}
                      className="cursor-pointer group"
                    >
                      {/* Bounding box rectangle */}
                      <rect
                        x={xmin}
                        y={ymin}
                        width={width}
                        height={height}
                        rx="3"
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeDasharray={strokeDasharray}
                        fill={fillColor}
                        className="transition-all duration-150 group-hover:stroke-sky-300"
                      />

                      {/* Corner Index Tag #01 / #02 */}
                      <rect
                        x={chipX}
                        y={chipY}
                        width="26"
                        height="15"
                        rx="3"
                        fill={badgeBg}
                        className="transition-colors duration-150"
                      />

                      <text
                        x={chipX + 3}
                        y={chipY + 11}
                        fill={badgeTextColor}
                        fontSize="9.5"
                        fontFamily="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
                        fontWeight="700"
                        className="select-none pointer-events-none"
                      >
                        #{paddedIndex}
                      </text>

                      {/* Handle markers on 4 corners when selected */}
                      {isSelected && (
                        <>
                          {/* Top-left handle */}
                          <rect x={xmin - 3} y={ymin - 3} width="6" height="6" fill="#38bdf8" rx="1" />
                          {/* Top-right handle */}
                          <rect x={xmax - 3} y={ymin - 3} width="6" height="6" fill="#38bdf8" rx="1" />
                          {/* Bottom-left handle */}
                          <rect x={xmin - 3} y={ymax - 3} width="6" height="6" fill="#38bdf8" rx="1" />
                          {/* Bottom-right handle */}
                          <rect x={xmax - 3} y={ymax - 3} width="6" height="6" fill="#38bdf8" rx="1" />
                        </>
                      )}
                    </g>
                  );
                })}
              </g>

              {/* Live Drawing Preview Rectangle */}
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
                  fill="rgba(56, 189, 248, 0.15)"
                />
              )}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};
