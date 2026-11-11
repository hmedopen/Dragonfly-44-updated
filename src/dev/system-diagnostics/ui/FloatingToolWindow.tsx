import React, { useState, useEffect, useCallback } from 'react';
import {
  GripHorizontal,
  Minus,
  Square,
  Maximize2,
  Minimize2,
  X,
  RotateCcw,
} from 'lucide-react';

const GEOMETRY_STORAGE_KEY = 'folio_dev_diagnostics_window_v1';
const MIN_WIDTH = 680;
const MIN_HEIGHT = 440;

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getDefaultGeometry(): WindowGeometry {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 820;
  const width = Math.min(920, Math.max(MIN_WIDTH, vw - 80));
  const height = Math.min(620, Math.max(MIN_HEIGHT, vh - 90));
  return {
    x: Math.max(16, Math.round((vw - width) / 2)),
    y: Math.max(16, Math.round((vh - height) / 2)),
    width,
    height,
  };
}

function clampGeometry(geom: WindowGeometry): WindowGeometry {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 820;
  const maxW = Math.max(360, vw - 24);
  const maxH = Math.max(280, vh - 24);
  const width = Math.min(maxW, Math.max(Math.min(MIN_WIDTH, maxW), geom.width));
  const height = Math.min(maxH, Math.max(Math.min(MIN_HEIGHT, maxH), geom.height));
  const x = Math.max(12, Math.min(Math.max(12, vw - width - 12), geom.x));
  const y = Math.max(12, Math.min(Math.max(12, vh - 48), geom.y));
  return { x, y, width, height };
}

function loadGeometry(): WindowGeometry {
  try {
    const raw = localStorage.getItem(GEOMETRY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed?.x === 'number' &&
        typeof parsed?.y === 'number' &&
        typeof parsed?.width === 'number' &&
        typeof parsed?.height === 'number'
      ) {
        return clampGeometry(parsed);
      }
    }
  } catch {
    // Fallback to default
  }
  return getDefaultGeometry();
}

export interface FloatingToolWindowProps {
  title: string;
  headerBadge?: React.ReactNode;
  headerRightStatus?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

export const FloatingToolWindow: React.FC<FloatingToolWindowProps> = ({
  title,
  headerBadge,
  headerRightStatus,
  onClose,
  children,
}) => {
  const [geometry, setGeometry] = useState<WindowGeometry>(() => loadGeometry());
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const [dragState, setDragState] = useState<{ offsetX: number; offsetY: number } | null>(null);
  const [resizeState, setResizeState] = useState<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(GEOMETRY_STORAGE_KEY, JSON.stringify(geometry));
    } catch {
      // Ignore quota failure
    }
  }, [geometry]);

  useEffect(() => {
    const handleViewportResize = () => {
      setGeometry((prev) => clampGeometry(prev));
    };
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, []);

  useEffect(() => {
    if (!dragState && !resizeState) return;

    const onMouseMove = (e: MouseEvent) => {
      if (dragState) {
        setGeometry((prev) =>
          clampGeometry({
            ...prev,
            x: e.clientX - dragState.offsetX,
            y: e.clientY - dragState.offsetY,
          })
        );
      } else if (resizeState) {
        const dx = e.clientX - resizeState.startX;
        const dy = e.clientY - resizeState.startY;
        setGeometry((prev) =>
          clampGeometry({
            ...prev,
            width: resizeState.startWidth + dx,
            height: resizeState.startHeight + dy,
          })
        );
      }
    };

    const onMouseUp = () => {
      setDragState(null);
      setResizeState(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragState, resizeState]);

  const handleHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized) return;
      if (e.button !== 0) return;
      e.preventDefault();
      setDragState({
        offsetX: e.clientX - geometry.x,
        offsetY: e.clientY - geometry.y,
      });
    },
    [geometry.x, geometry.y, isMaximized]
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized || isMinimized) return;
      e.preventDefault();
      e.stopPropagation();
      setResizeState({
        startX: e.clientX,
        startY: e.clientY,
        startWidth: geometry.width,
        startHeight: geometry.height,
      });
    },
    [geometry.height, geometry.width, isMaximized, isMinimized]
  );

  const handleResetGeometry = () => {
    setIsMaximized(false);
    setIsMinimized(false);
    setGeometry(getDefaultGeometry());
  };

  const activeStyle: React.CSSProperties = isMaximized
    ? {
        left: '20px',
        top: '20px',
        width: 'calc(100vw - 40px)',
        height: isMinimized ? '40px' : 'calc(100vh - 40px)',
      }
    : {
        left: `${geometry.x}px`,
        top: `${geometry.y}px`,
        width: isMinimized ? '440px' : `${geometry.width}px`,
        height: isMinimized ? '40px' : `${geometry.height}px`,
      };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none select-none">
      <section
        role="region"
        aria-label={title}
        style={activeStyle}
        className="fixed pointer-events-auto flex flex-col rounded-xl border border-white/[0.14] bg-[#0b0c10] text-zinc-100 shadow-[0_24px_60px_rgba(0,0,0,0.85)] overflow-hidden"
      >
        {/* Movable Tool Window Title Bar */}
        <header
          onMouseDown={handleHeaderMouseDown}
          className={`h-10 px-3 bg-[#09090c] border-b border-white/[0.08] flex items-center justify-between shrink-0 gap-2 ${
            isMaximized ? 'cursor-default' : 'cursor-move'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <GripHorizontal className="w-3.5 h-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
            <span className="font-mono text-xs font-semibold tracking-wider text-zinc-100 uppercase truncate">
              {title}
            </span>
            {headerBadge}
          </div>

          <div
            className="flex items-center gap-1.5 shrink-0"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {headerRightStatus}

            <button
              type="button"
              onClick={handleResetGeometry}
              aria-label="Reset window position and size"
              title="Reset window position and size"
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setIsMinimized((prev) => !prev)}
              aria-label={isMinimized ? 'Expand Diagnostic Studio' : 'Minimize Diagnostic Studio'}
              title={isMinimized ? 'Expand' : 'Minimize'}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 cursor-pointer"
            >
              {isMinimized ? (
                <Square className="w-3 h-3" aria-hidden="true" />
              ) : (
                <Minus className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>

            {!isMinimized && (
              <button
                type="button"
                onClick={() => setIsMaximized((prev) => !prev)}
                aria-label={isMaximized ? 'Restore window size' : 'Maximize window'}
                title={isMaximized ? 'Restore' : 'Maximize'}
                className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 cursor-pointer"
              >
                {isMaximized ? (
                  <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Diagnostic Studio"
              title="Close Diagnostic Studio (Ctrl+Shift+D)"
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Window Content */}
        {!isMinimized && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
            {children}

            {!isMaximized && (
              <div
                onMouseDown={handleResizeMouseDown}
                aria-hidden="true"
                title="Drag to resize window"
                className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-1 opacity-60 hover:opacity-100 z-20"
              >
                <div className="w-2 h-2 border-r-2 border-b-2 border-zinc-400" />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
