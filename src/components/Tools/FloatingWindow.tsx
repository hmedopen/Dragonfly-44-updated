import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GripHorizontal, Maximize2, Minimize2, Minus, RotateCcw, Square, X } from 'lucide-react';
import {
  clampFloatingGeometry,
  loadFloatingGeometry,
  type FloatingWindowGeometry,
} from './floatingWindowGeometry';

export type { FloatingWindowGeometry };

export interface FloatingWindowProps {
  isOpen: boolean;
  title: string;
  storageKey: string;
  defaultGeometry: FloatingWindowGeometry;
  minWidth?: number;
  minHeight?: number;
  minimizedWidth?: number;
  headerBadge?: React.ReactNode;
  headerRight?: React.ReactNode;
  allowMaximize?: boolean;
  closeTitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Shared smooth floating utility window following Diagnostic OBD's in-app overlay model.
 * Uses pointer-event + requestAnimationFrame DOM updates during drag/resize so React children
 * and localStorage do not churn on every pointer move frame.
 */
export const FloatingWindow: React.FC<FloatingWindowProps> = ({
  isOpen,
  title,
  storageKey,
  defaultGeometry,
  minWidth = 320,
  minHeight = 240,
  minimizedWidth = 320,
  headerBadge,
  headerRight,
  allowMaximize = false,
  closeTitle = 'Close window',
  onClose,
  children,
}) => {
  const [geometry, setGeometry] = useState<FloatingWindowGeometry>(() =>
    loadFloatingGeometry(storageKey, defaultGeometry, minWidth, minHeight)
  );
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const sectionRef = useRef<HTMLElement>(null);
  const geometryRef = useRef<FloatingWindowGeometry>(geometry);
  const rafRef = useRef<number | null>(null);
  const activeGestureRef = useRef<
    | {
        kind: 'drag';
        offsetX: number;
        offsetY: number;
        lastCommitted: FloatingWindowGeometry;
      }
    | {
        kind: 'resize';
        startX: number;
        startY: number;
        startWidth: number;
        startHeight: number;
        originX: number;
        originY: number;
        lastCommitted: FloatingWindowGeometry;
      }
    | null
  >(null);

  useEffect(() => {
    geometryRef.current = geometry;
  }, [geometry]);

  // Re-clamp cleanly when outer window resizes or monitor DPI changes
  useEffect(() => {
    const handleViewportResize = () => {
      setGeometry((prev) => {
        const clamped = clampFloatingGeometry(
          prev,
          window.innerWidth,
          window.innerHeight,
          minWidth,
          minHeight
        );
        geometryRef.current = clamped;
        try {
          localStorage.setItem(storageKey, JSON.stringify(clamped));
        } catch {
          // Ignore storage quota issues
        }
        return clamped;
      });
    };
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, [minHeight, minWidth, storageKey]);

  const stopActiveGesture = useCallback(() => {
    const active = activeGestureRef.current;
    if (!active) return;
    activeGestureRef.current = null;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const finalGeom = active.lastCommitted;
    geometryRef.current = finalGeom;
    setGeometry(finalGeom);
    try {
      localStorage.setItem(storageKey, JSON.stringify(finalGeom));
    } catch {
      // Ignore storage quota issues
    }
  }, [storageKey]);

  // Stable global pointer tracking for smooth drag/resize
  useEffect(() => {
    if (!isOpen) {
      stopActiveGesture();
      return;
    }

    const applyDomStyle = (geom: FloatingWindowGeometry) => {
      const el = sectionRef.current;
      if (!el) return;
      el.style.left = `${geom.x}px`;
      el.style.top = `${geom.y}px`;
      if (!isMinimized) {
        el.style.width = `${geom.width}px`;
        el.style.height = `${geom.height}px`;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const active = activeGestureRef.current;
      if (!active) return;

      let next: FloatingWindowGeometry;
      if (active.kind === 'drag') {
        next = clampFloatingGeometry(
          {
            ...active.lastCommitted,
            x: e.clientX - active.offsetX,
            y: e.clientY - active.offsetY,
          },
          window.innerWidth,
          window.innerHeight,
          minWidth,
          minHeight
        );
      } else {
        const dx = e.clientX - active.startX;
        const dy = e.clientY - active.startY;
        next = clampFloatingGeometry(
          {
            x: active.originX,
            y: active.originY,
            width: active.startWidth + dx,
            height: active.startHeight + dy,
          },
          window.innerWidth,
          window.innerHeight,
          minWidth,
          minHeight
        );
      }

      active.lastCommitted = next;

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (activeGestureRef.current) {
            applyDomStyle(activeGestureRef.current.lastCommitted);
          }
        });
      }
    };

    const handleGestureEnd = () => {
      stopActiveGesture();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handleGestureEnd);
    window.addEventListener('pointercancel', handleGestureEnd);
    window.addEventListener('blur', handleGestureEnd);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handleGestureEnd);
      window.removeEventListener('pointercancel', handleGestureEnd);
      window.removeEventListener('blur', handleGestureEnd);
      stopActiveGesture();
    };
  }, [isMinimized, isOpen, minHeight, minWidth, stopActiveGesture]);

  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (isMaximized) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, input, select, textarea, a, [data-no-drag="true"]')) {
        return;
      }
      e.preventDefault();

      const current = geometryRef.current;
      activeGestureRef.current = {
        kind: 'drag',
        offsetX: e.clientX - current.x,
        offsetY: e.clientY - current.y,
        lastCommitted: current,
      };
    },
    [isMaximized]
  );

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isMaximized || isMinimized || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const current = geometryRef.current;
      activeGestureRef.current = {
        kind: 'resize',
        startX: e.clientX,
        startY: e.clientY,
        startWidth: current.width,
        startHeight: current.height,
        originX: current.x,
        originY: current.y,
        lastCommitted: current,
      };
    },
    [isMaximized, isMinimized]
  );

  const handleResetGeometry = () => {
    setIsMaximized(false);
    setIsMinimized(false);
    const reset = clampFloatingGeometry(
      defaultGeometry,
      window.innerWidth,
      window.innerHeight,
      minWidth,
      minHeight
    );
    geometryRef.current = reset;
    setGeometry(reset);
    try {
      localStorage.setItem(storageKey, JSON.stringify(reset));
    } catch {
      // Ignore storage quota issues
    }
  };

  if (!isOpen) return null;

  const activeStyle: React.CSSProperties = isMaximized
    ? {
        left: '20px',
        top: '20px',
        width: 'calc(100vw - 40px)',
        height: isMinimized ? '38px' : 'calc(100vh - 40px)',
      }
    : {
        left: `${geometry.x}px`,
        top: `${geometry.y}px`,
        width: isMinimized ? `${Math.min(geometry.width, minimizedWidth)}px` : `${geometry.width}px`,
        height: isMinimized ? '38px' : `${geometry.height}px`,
      };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none select-none">
      <section
        ref={sectionRef}
        role="region"
        aria-label={title}
        style={activeStyle}
        className="fixed pointer-events-auto flex flex-col rounded-lg border border-white/[0.14] bg-[#0b0c10] text-zinc-100 overflow-hidden"
      >
        <header
          onPointerDown={handleHeaderPointerDown}
          className={`h-[38px] px-3 bg-[#09090c] border-b border-white/[0.08] flex items-center justify-between shrink-0 gap-2 touch-none ${
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
            data-no-drag="true"
            className="flex items-center gap-1 shrink-0"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {headerRight}

            <button
              type="button"
              onClick={handleResetGeometry}
              aria-label={`Reset ${title} position and size`}
              title="Reset position and size"
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setIsMinimized((prev) => !prev)}
              aria-label={isMinimized ? `Expand ${title}` : `Minimize ${title}`}
              title={isMinimized ? 'Expand' : 'Minimize'}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              {isMinimized ? (
                <Square className="w-3 h-3" aria-hidden="true" />
              ) : (
                <Minus className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>

            {allowMaximize && !isMinimized && (
              <button
                type="button"
                onClick={() => setIsMaximized((prev) => !prev)}
                aria-label={isMaximized ? 'Restore window size' : 'Maximize window'}
                title={isMaximized ? 'Restore' : 'Maximize'}
                className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400"
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
              aria-label={`Close ${title}`}
              title={closeTitle}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.08] cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </header>

        {!isMinimized && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
            {children}

            {!isMaximized && (
              <div
                onPointerDown={handleResizePointerDown}
                aria-hidden="true"
                title="Drag to resize window"
                className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-1 opacity-60 hover:opacity-100 z-20 touch-none"
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
