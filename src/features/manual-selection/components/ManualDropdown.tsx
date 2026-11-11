import React, { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

export interface ManualDropdownProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  listboxLabel: string;
  triggerLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
  menuClassName?: string;
  triggerContent: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared dark-studio dropdown shell used by selectors in the Manual Selection panel.
 */
export const ManualDropdown: React.FC<ManualDropdownProps> = ({
  isOpen,
  onOpenChange,
  listboxLabel,
  triggerLabel,
  disabled = false,
  triggerClassName = 'w-full h-8 px-2',
  menuClassName = 'left-0 right-0',
  triggerContent,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, onOpenChange]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={triggerLabel}
        disabled={disabled}
        onClick={() => !disabled && onOpenChange(!isOpen)}
        className={`rounded-md bg-[#070709] hover:bg-[#111216] border border-white/[0.1] flex items-center justify-between gap-2 text-xs text-zinc-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${triggerClassName}`}
      >
        <div className="flex items-center gap-2 min-w-0">{triggerContent}</div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={listboxLabel}
          className={`absolute top-full mt-1 max-h-52 overflow-y-auto overscroll-contain custom-scrollbar rounded-md bg-[#111216] border border-white/[0.14] shadow-xl z-40 py-1 ${menuClassName}`}
        >
          {children}
        </div>
      )}
    </div>
  );
};
