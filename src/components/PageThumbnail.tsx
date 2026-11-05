import React, { useState, useEffect } from 'react';
import type { PageMetadata } from '../types';
import { getPageBlob } from '../services/db';
import { Trash2, FileText, ImageOff } from 'lucide-react';

interface PageThumbnailProps {
  page: PageMetadata;
  onDelete: (pageId: string) => void;
  onClick: () => void;
  isDragging?: boolean;
}

export const PageThumbnail: React.FC<PageThumbnailProps> = ({
  page,
  onDelete,
  onClick,
  isDragging = false,
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let createdUrl: string | null = null;

    getPageBlob(page.id)
      .then((blob) => {
        if (!isMounted) return;
        if (blob) {
          createdUrl = URL.createObjectURL(blob);
          setImageUrl(createdUrl);
          setIsLoading(false);
        } else {
          setHasError(true);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load page blob', err);
        if (isMounted) {
          setHasError(true);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [page.id]);

  return (
    <div
      onClick={onClick}
      className={`group relative aspect-[3/4] w-full rounded-xl overflow-hidden bg-[#131317] border transition-all shadow-md flex flex-col justify-between cursor-pointer ${
        isDragging
          ? 'border-white/[0.4] shadow-2xl ring-2 ring-white/20'
          : 'border-white/[0.08] hover:border-white/[0.28] hover:shadow-xl'
      }`}
    >
      {/* Page Image strictly contained in manga aspect ratio */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`Page ${page.index}`}
          className="w-full h-full object-cover object-top select-none pointer-events-none"
          loading="lazy"
        />
      ) : isLoading ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-3 text-zinc-600 bg-zinc-900/60 animate-pulse">
          <FileText className="w-7 h-7 mb-2 stroke-1 text-zinc-600" />
          <span className="text-[11px] font-mono text-zinc-500">p. {page.index}</span>
        </div>
      ) : hasError ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-3 text-zinc-600 bg-zinc-900/40">
          <ImageOff className="w-6 h-6 mb-1 text-zinc-700 stroke-1" />
          <span className="text-[10px] font-mono text-zinc-600">p. {page.index}</span>
        </div>
      ) : null}

      {/* Hover Delete Button (Top Right) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(page.id);
        }}
        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/80 hover:bg-red-600 text-zinc-300 hover:text-white border border-white/10 hover:border-red-500/50 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all cursor-pointer shadow-xl z-20 active:scale-95"
        title={`Delete page ${page.index}`}
        aria-label={`Delete page ${page.index}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      {/* Bottom Info Bar: Page Index & File Name with bigger, visible font inside image */}
      <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/95 via-black/60 to-transparent flex items-center justify-between pointer-events-none z-10 gap-2">
        <span className="px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md border border-white/15 font-mono text-xs font-semibold text-zinc-100 shadow-md shrink-0">
          p. {page.index}
        </span>
        <span
          className="px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md border border-white/15 font-mono text-xs font-medium text-white shadow-md truncate max-w-[65%] text-right"
          title={page.fileName}
        >
          {page.fileName}
        </span>
      </div>
    </div>
  );
};
