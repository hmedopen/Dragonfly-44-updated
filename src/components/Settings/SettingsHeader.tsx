import React from 'react';
import { X, RotateCcw } from 'lucide-react';
import { ENGINE_PRESETS } from '../../services/settings/presets';

export interface SettingsHeaderProps {
  revision: number;
  onClose: () => void;
  onApplyPreset: (presetId: string) => void;
  onResetCategory: () => void;
  categoryLabel: string;
}

/**
 * SettingsHeader — Fixed top bar across the Settings panel.
 * - Displays clear restrained title & revision
 * - Engine preset quick selector
 * - Category reset action
 * - Close button and Esc keyboard hint
 */
export const SettingsHeader: React.FC<SettingsHeaderProps> = ({
  revision,
  onClose,
  onApplyPreset,
  onResetCategory,
  categoryLabel,
}) => {
  return (
    <header className="h-13 px-5 border-b border-white/[0.08] bg-[#09090c] flex items-center justify-between shrink-0 select-none">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold tracking-wider text-zinc-100 uppercase">
            Settings
          </span>
          <span className="text-zinc-600 font-mono text-xs">/</span>
          <span className="font-mono text-xs text-zinc-400">
            {categoryLabel}
          </span>
          <span className="ml-1.5 px-1.5 py-0.2 rounded text-[9px] font-mono bg-zinc-900 text-zinc-500 border border-white/[0.06]">
            r{revision}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Engine Presets */}
        <div className="hidden sm:flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
            Preset:
          </span>
          <div className="flex items-center gap-1">
            {Object.entries(ENGINE_PRESETS).map(([id, p]) => (
              <button
                key={id}
                type="button"
                onClick={() => onApplyPreset(id)}
                className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.06] text-[10px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                {p.name.split(' (')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Reset Category */}
        <button
          type="button"
          onClick={onResetCategory}
          className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.06] text-[10px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          title="Reset active category to defaults"
        >
          <RotateCcw className="w-3 h-3" />
          <span className="hidden md:inline">Reset Category</span>
        </button>

        {/* Shortcut hint & Close Button */}
        <div className="flex items-center gap-1.5 pl-2 border-l border-white/[0.08]">
          <span className="hidden sm:inline font-mono text-[10px] text-zinc-500 bg-zinc-900/80 px-1.5 py-0.5 rounded border border-white/[0.06]">
            Esc
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
