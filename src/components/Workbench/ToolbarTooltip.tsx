import React, { useState, useRef, useEffect } from 'react';

interface ToolbarTooltipProps {
  title: string;
  description: string;
  children: React.ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
  disabled?: boolean;
}

export const ToolbarTooltip: React.FC<ToolbarTooltipProps> = ({
  title,
  description,
  children,
  align = 'center',
  className = '',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  const handleMouseEnter = () => {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setIsOpen(true);
    }, 120);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsOpen(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const shouldShow = isOpen && !disabled;

  let alignClasses = 'left-1/2 -translate-x-1/2';
  let arrowClasses = 'left-1/2 -translate-x-1/2';
  if (align === 'left') {
    alignClasses = 'left-0 translate-x-0';
    arrowClasses = 'left-4';
  } else if (align === 'right') {
    alignClasses = 'right-0 translate-x-0';
    arrowClasses = 'right-4';
  }

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {shouldShow && (
        <div
          className={`absolute top-full mt-2.5 z-50 pointer-events-none min-w-[170px] max-w-[230px] p-2.5 rounded-xl bg-[#121318] border border-white/20 shadow-2xl flex flex-col items-center text-center ${alignClasses}`}
        >
          {/* Top arrow pointer */}
          <div
            className={`absolute -top-1 w-2 h-2 rotate-45 bg-[#121318] border-t border-l border-white/20 ${arrowClasses}`}
          />
          <span className="relative z-10 text-xs font-bold text-sky-400 mb-1 text-center select-none">
            {title}
          </span>
          <span className="relative z-10 text-[11px] text-[#FFFFFF] font-normal leading-snug text-center select-none">
            {description}
          </span>
        </div>
      )}
    </div>
  );
};
