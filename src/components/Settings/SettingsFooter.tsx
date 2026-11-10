import React from 'react';

export interface SettingsFooterProps {
  hasUnsavedChanges: boolean;
  onClose: () => void;
  onApply: () => void;
  className?: string;
}

/**
 * SettingsFooter — Fixed bottom bar across the Settings panel.
 * - Stationary during content scrolling
 * - Displays status and unsaved changes indicator
 * - Easy to locate, restrained Close and Apply actions
 */
export const SettingsFooter: React.FC<SettingsFooterProps> = ({
  hasUnsavedChanges,
  onClose,
  onApply,
  className = '',
}) => {
  return (
    <footer
      className={`h-12 px-5 border-t border-white/[0.08] bg-[#09090c] flex items-center justify-between shrink-0 select-none ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
          System #6 Active
        </span>
        {hasUnsavedChanges && (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] font-mono font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>UNSAVED CHANGES</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-200 font-mono text-xs cursor-pointer transition-colors px-2 py-1"
        >
          Close
        </button>
        <button
          type="button"
          onClick={onApply}
          className="px-4 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-mono text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-98 select-none"
        >
          Apply
        </button>
      </div>
    </footer>
  );
};
