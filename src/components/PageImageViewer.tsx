import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { PageMetadata } from '../types';
import { getPageBlob } from '../services/db';
import { 
  X, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  ChevronLeft, 
  ChevronRight,
  FileText
} from 'lucide-react';

interface PageImageViewerProps {
  pages: PageMetadata[];
  initialIndex: number;
  onClose: () => void;
}

export const PageImageViewer: React.FC<PageImageViewerProps> = ({
  pages,
  initialIndex,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Zoom & Pan state
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const posStartRef = useRef({ x: 0, y: 0 });
  const hasMovedRef = useRef(false);

  const currentPage = pages[currentIndex];

  const resetTransform = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handlePrev = useCallback(() => {
    setCurrentIndex((idx) => {
      if (idx > 0) {
        setScale(1);
        setPosition({ x: 0, y: 0 });
        setIsLoading(true);
        return idx - 1;
      }
      return idx;
    });
  }, []);

  const handleNext = useCallback(() => {
    setCurrentIndex((idx) => {
      if (idx < pages.length - 1) {
        setScale(1);
        setPosition({ x: 0, y: 0 });
        setIsLoading(true);
        return idx + 1;
      }
      return idx;
    });
  }, [pages.length]);

  // Load image blob for current page
  useEffect(() => {
    let isMounted = true;
    let createdUrl: string | null = null;

    if (currentPage) {
      getPageBlob(currentPage.id)
        .then((blob) => {
          if (!isMounted) return;
          if (blob) {
            createdUrl = URL.createObjectURL(blob);
            setImageUrl(createdUrl);
            setIsLoading(false);
          }
        })
        .catch((err) => {
          console.error('Failed to load blob in viewer', err);
          if (isMounted) setIsLoading(false);
        });
    }

    return () => {
      isMounted = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [currentPage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, onClose]);

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = -e.deltaY * 0.0015;
    setScale((prev) => Math.min(Math.max(prev + zoomFactor, 0.4), 7));
  };

  // Pan / Drag to move around
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    setIsPanning(true);
    hasMovedRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    posStartRef.current = { ...position };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMovedRef.current = true;
    }
    setPosition({
      x: posStartRef.current.x + dx,
      y: posStartRef.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Double click toggles between 1x and 2.5x zoom
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale > 1.05) {
      resetTransform();
    } else {
      setScale(2.5);
    }
  };

  // Backdrop click (click on space outside of the page takes you back to earlier screen)
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !hasMovedRef.current) {
      onClose();
    }
  };

  if (!currentPage) return null;

  return (
    <div
      onClick={handleBackdropClick}
      onWheel={handleWheel}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-md flex flex-col justify-between overflow-hidden select-none animate-in fade-in duration-150"
    >
      {/* Top Bar with Page Info & Zoom Controls */}
      <div 
        onClick={(e) => e.stopPropagation()} 
        className="w-full flex items-center justify-between p-4 px-6 z-20 shrink-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent"
      >
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/10 text-white font-mono text-xs font-semibold">
            Page {currentPage.index} of {pages.length}
          </span>
          <span className="text-zinc-400 font-mono text-xs truncate max-w-xs sm:max-w-md">
            {currentPage.fileName}
          </span>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1.5 bg-zinc-900/90 border border-white/10 rounded-xl p-1 backdrop-blur-md shadow-xl">
          <button
            onClick={() => setScale((s) => Math.max(s - 0.25, 0.4))}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono text-zinc-300 px-2 min-w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.min(s + 0.25, 7))}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={resetTransform}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Reset Zoom"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="h-4 w-[1px] bg-white/10 mx-1" />
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Image Viewport: Click space outside to close, Drag image to pan */}
      <div
        onClick={handleBackdropClick}
        className="flex-1 w-full h-full relative flex items-center justify-center overflow-hidden cursor-default"
      >
        {/* Navigation Buttons (Left/Right) */}
        {currentIndex > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            className="absolute left-6 z-30 p-3 rounded-full bg-black/60 hover:bg-black/90 text-zinc-400 hover:text-white border border-white/10 backdrop-blur-md transition-all shadow-2xl cursor-pointer hover:scale-105 active:scale-95"
            title="Previous Page (Left Arrow)"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {currentIndex < pages.length - 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="absolute right-6 z-30 p-3 rounded-full bg-black/60 hover:bg-black/90 text-zinc-400 hover:text-white border border-white/10 backdrop-blur-md transition-all shadow-2xl cursor-pointer hover:scale-105 active:scale-95"
            title="Next Page (Right Arrow)"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {/* Image Container with Zoom & Drag / Pan */}
        <div
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
            transition: isPanning ? 'none' : 'transform 0.15s ease-out',
          }}
          className={`relative max-w-[90vw] max-h-[85vh] flex items-center justify-center select-none ${
            isPanning ? 'cursor-grabbing' : scale > 1.05 ? 'cursor-grab' : 'cursor-zoom-in'
          }`}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`Page ${currentPage.index}`}
              draggable={false}
              className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-white/[0.08]"
            />
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center p-12 text-zinc-500 animate-pulse">
              <FileText className="w-12 h-12 mb-3 stroke-1 text-zinc-600" />
              <span className="text-sm font-mono">Loading image...</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Subtle Hint Bar at Bottom */}
      <div 
        onClick={(e) => e.stopPropagation()} 
        className="w-full p-3 text-center z-20 pointer-events-none"
      >
        <span className="text-[11px] font-mono text-zinc-500 bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1 rounded-full">
          Scroll to zoom · Drag to pan · Double-click to toggle zoom · Click outside to return
        </span>
      </div>
    </div>
  );
};
