import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface SettingTooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  delayMs?: number;
}

/**
 * SettingTooltip — Ergonomic, restrained contextual tooltip.
 * - Enforces an intentional ~1000ms hover delay threshold
 * - Instant dismissal on pointer exit
 * - Viewport boundary clamping to prevent edge clipping
 * - Clean architectural styling: dark neutral, subtle border, no gradients
 * - Does not set HTML `title` attribute to avoid duplicate browser tooltips
 */
export const SettingTooltip: React.FC<SettingTooltipProps> = ({
  content,
  children,
  position = 'top',
  className = '',
  delayMs = 900,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const timerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        let top = rect.top - 8;
        let left = rect.left + rect.width / 2;

        if (position === 'bottom') {
          top = rect.bottom + 8;
        }

        // Horizontal clamping within window
        const windowWidth = window.innerWidth;
        const estimatedTooltipWidth = Math.min(280, windowWidth - 32);
        left = Math.max(estimatedTooltipWidth / 2 + 16, Math.min(windowWidth - estimatedTooltipWidth / 2 - 16, left));

        setCoords({ top, left });
        setIsVisible(true);
      }
    }, delayMs);
  }, [clearTimer, delayMs, position]);

  const handleMouseLeave = useCallback(() => {
    clearTimer();
    setIsVisible(false);
  }, [clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`inline-flex items-center ${className}`}
    >
      {children}

      {isVisible && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            top: `${coords.top}px`,
            left: `${coords.left}px`,
          }}
          className={`fixed z-[100] -translate-x-1/2 ${
            position === 'bottom' ? 'translate-y-0' : '-translate-y-full'
          } max-w-[280px] px-2.5 py-1.5 rounded-md bg-[#16171d] border border-white/[0.14] shadow-2xl text-[11px] leading-relaxed text-zinc-300 font-sans pointer-events-none select-none animate-in fade-in zoom-in-95 duration-100`}
        >
          {content}
        </div>
      )}
    </div>
  );
};
