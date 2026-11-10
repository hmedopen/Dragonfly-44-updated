import React, { useCallback } from 'react';

export interface SettingsSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * SettingsSwitch — Shared, robust, accessible boolean switch component.
 * Features:
 * - Pure controlled component
 * - role="switch" and aria-checked for screen readers
 * - Keyboard accessible (Space and Enter toggle)
 * - Immediate visual feedback with CSS hardware-accelerated transforms
 * - Prevents event bubbling races and duplicate click triggers
 * - Architectural, restrained dark/light styling
 */
export const SettingsSwitch: React.FC<SettingsSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  id,
  ariaLabel,
  className = '',
}) => {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        onChange(!checked);
      }
    },
    [checked, disabled, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onChange(!checked);
      }
    },
    [checked, disabled, onChange]
  );

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-label={ariaLabel}
      aria-checked={checked}
      disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`relative inline-flex items-center shrink-0 w-9 h-5 rounded-full transition-colors duration-150 ease-out outline-none select-none ${
        disabled
          ? 'opacity-40 cursor-not-allowed bg-zinc-900 border border-white/[0.04]'
          : checked
          ? 'bg-zinc-100 hover:bg-white cursor-pointer border border-transparent shadow-[0_1px_3px_rgba(0,0,0,0.4)]'
          : 'bg-[#181920] hover:bg-[#22232c] cursor-pointer border border-white/[0.12]'
      } focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:ring-offset-1 focus-visible:ring-offset-black ${className}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none block w-3.5 h-3.5 rounded-full transition-transform duration-150 ease-out ${
          checked
            ? 'translate-x-[18px] bg-zinc-950 shadow-sm'
            : 'translate-x-[3px] bg-zinc-400'
        }`}
      />
    </button>
  );
};
