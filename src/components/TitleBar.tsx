import React from 'react';
import { Sliders, Activity, Sparkles } from 'lucide-react';
import { isTrainingStudioEnabled } from '../lib/training/env';
import folioIcon from '../assets/folio-icon.png';

interface TitleBarProps {
  activeFolderName?: string;
  onOpenSettings?: () => void;
  onOpenBenchmark?: () => void;
  onOpenTrainingStudio?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  onOpenSettings,
  onOpenBenchmark,
  onOpenTrainingStudio,
}) => {
  return (
    <header
      className="h-10 border-b border-white/[0.06] bg-black px-4 flex items-center justify-between select-none z-50 sticky top-0 [-webkit-app-region:drag]"
    >
      {/* Left: Application Branding (Folio Script) */}
      <div className="flex items-center gap-2.5 pointer-events-none select-none">
        <img
          src={folioIcon}
          alt="Folio Script"
          className="w-4 h-4 rounded-sm object-contain"
        />
        <span className="font-semibold text-xs tracking-tight text-zinc-200">
          Folio Script
        </span>
      </div>

      {/* Right Controls: Functional Navigation / Tools with clearance for Windows native titlebar controls */}
      <div className="flex items-center gap-1.5 pr-[140px] [-webkit-app-region:no-drag]">
        {isTrainingStudioEnabled() && onOpenTrainingStudio && (
          <button
            type="button"
            onClick={onOpenTrainingStudio}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono text-amber-300 hover:text-amber-100 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 transition-colors cursor-pointer"
            title="Open Training Studio (Dev Only)"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Training Studio</span>
          </button>
        )}

        {onOpenBenchmark && (
          <button
            type="button"
            onClick={onOpenBenchmark}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono text-zinc-300 hover:text-white bg-zinc-900/80 hover:bg-zinc-800 border border-white/[0.08] transition-colors cursor-pointer"
            title="Quality Benchmark Engine"
          >
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            <span>Benchmark</span>
          </button>
        )}

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Settings (Ctrl+,)"
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </header>
  );
};
