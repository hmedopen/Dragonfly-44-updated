import React from 'react';
import type { ChapterPage } from '../types';
import { Check, AlertCircle, RotateCcw, Loader2 } from 'lucide-react';

interface PageThumbnailCardProps {
  page: ChapterPage;
  isSelected: boolean;
  onToggleSelect: (pageId: string) => void;
  onRetrySingle?: (pageId: string) => void;
}

export const PageThumbnailCard: React.FC<PageThumbnailCardProps> = ({
  page,
  isSelected,
  onToggleSelect,
  onRetrySingle,
}) => {
  const isReady = page.downloadStatus === 'ready';
  const isFailed = page.downloadStatus === 'failed';
  const isLoading = page.downloadStatus === 'downloading' || page.downloadStatus === 'pending';

  return (
    <div
      onClick={() => isReady && onToggleSelect(page.id)}
      className={`group relative flex flex-col rounded-xl overflow-hidden border transition-all duration-150 select-none ${
        isReady
          ? isSelected
            ? 'border-white/40 bg-zinc-900/90 ring-1 ring-white/20 shadow-md cursor-pointer'
            : 'border-white/[0.08] bg-zinc-950/60 opacity-60 hover:opacity-90 hover:border-white/20 cursor-pointer'
          : isFailed
          ? 'border-rose-500/30 bg-rose-950/20'
          : 'border-white/[0.06] bg-zinc-900/40'
      }`}
    >
      {/* Thumbnail Image Container */}
      <div className="relative aspect-[3/4] w-full bg-zinc-950 flex items-center justify-center overflow-hidden">
        {page.thumbnailUrl ? (
          <img
            src={page.thumbnailUrl}
            alt={`Page ${page.originalIndex}`}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center">
            {isLoading && (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  Downloading
                </span>
              </div>
            )}
            {isFailed && (
              <div className="flex flex-col items-center gap-1.5 p-2 text-rose-400">
                <AlertCircle className="w-5 h-5" />
                <span className="text-[10px] font-mono font-medium leading-tight">
                  {page.error || 'Failed'}
                </span>
                {onRetrySingle && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetrySingle(page.id);
                    }}
                    className="mt-1 px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[10px] font-mono font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Top-Right Selection Pill / Checkbox */}
        {isReady && (
          <div className="absolute top-2 right-2 z-10">
            <div
              className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${
                isSelected
                  ? 'bg-white text-zinc-950 shadow-sm'
                  : 'bg-black/60 border border-white/20 text-transparent hover:border-white/50'
              }`}
            >
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            </div>
          </div>
        )}

        {/* Top-Left Page Index Badge */}
        <div className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-sm border border-white/10 text-[10px] font-mono font-bold text-zinc-200">
          p.{page.originalIndex}
        </div>
      </div>

      {/* Bottom Label Strip */}
      <div className="px-2.5 py-1.5 bg-[#090a0d] border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono">
        <span className="text-zinc-400 truncate max-w-[100px]" title={page.filename}>
          {page.filename}
        </span>
        {page.sizeBytes > 0 && (
          <span className="text-zinc-600 text-[10px] shrink-0">
            {Math.round(page.sizeBytes / 1024)} KB
          </span>
        )}
      </div>
    </div>
  );
};
