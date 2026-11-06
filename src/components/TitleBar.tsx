import React, { useState } from 'react';
import { Layers, Minus, Square, X, Sliders, Activity } from 'lucide-react';

interface TitleBarProps {
  activeFolderName: string;
  onOpenSettings?: () => void;
  onOpenBenchmark?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  activeFolderName,
  onOpenSettings,
  onOpenBenchmark,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = async () => {
    try {
      if ((window as any).__TAURI__?.window) {
        await (window as any).__TAURI__.window.getCurrentWindow().minimize();
      } else if ((window as any).electronAPI?.minimize) {
        (window as any).electronAPI.minimize();
      }
    } catch {}
  };

  const handleToggleMaximize = async () => {
    try {
      if ((window as any).__TAURI__?.window) {
        const win = (window as any).__TAURI__.window.getCurrentWindow();
        await win.toggleMaximize();
        setIsMaximized(!isMaximized);
      } else if ((window as any).electronAPI?.maximize) {
        (window as any).electronAPI.maximize();
        setIsMaximized(!isMaximized);
      }
    } catch {}
  };

  const handleClose = async () => {
    try {
      if ((window as any).__TAURI__?.window) {
        await (window as any).__TAURI__.window.getCurrentWindow().close();
      } else if ((window as any).electronAPI?.close) {
        (window as any).electronAPI.close();
      }
    } catch {}
  };

  return (
    <header
      data-tauri-drag-region
      className="h-10 border-b border-white/[0.08] bg-[#09090b] px-4 flex items-center justify-between select-none z-50 sticky top-0"
    >
      <div className="flex items-center gap-3 pointer-events-none" data-tauri-drag-region>
        <div className="flex items-center gap-2 text-xs font-mono tracking-widest text-zinc-400 uppercase">
          <Layers className="w-3.5 h-3.5 text-zinc-100" />
          <span className="font-semibold text-zinc-100">Dragonfly 44</span>
          <span className="text-zinc-600">/</span>
          <span className="text-zinc-400">Hub</span>
        </div>

        <div className="h-3 w-[1px] bg-zinc-800" />

        <div className="text-xs text-zinc-500 font-medium truncate max-w-xs">
          Active: <span className="text-zinc-300 font-normal">{activeFolderName}</span>
        </div>
      </div>

      {/* Right Controls: Workspace Ready Badge & Frameless Window Controls */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono tracking-tight bg-zinc-900 border border-white/[0.06] text-zinc-400 pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 animate-pulse" />
          Workspace Ready
        </span>

        {onOpenBenchmark && (
          <button
            type="button"
            onClick={onOpenBenchmark}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] transition-colors cursor-pointer"
            title="Quality Benchmark Engine (System #6)"
          >
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            <span>Benchmark</span>
          </button>
        )}

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Settings (Ctrl+,)"
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Frameless Desktop Window Controls */}
        <div className="flex items-center gap-1 border-l border-white/[0.08] pl-2 ml-1">
          <button
            type="button"
            onClick={handleMinimize}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
