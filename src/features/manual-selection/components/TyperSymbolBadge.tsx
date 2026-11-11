import React from 'react';
import { getContrastForeground } from '../../../types/typers';

export interface TyperSymbolBadgeProps {
  symbol: string;
  color: string;
  title?: string;
  size?: 'canvas' | 'xs' | 'sm' | 'md';
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders the actual typer prefix symbol inside a high-contrast solid colored box.
 * Never replaces typer symbols with decorative category icons or translucent pills.
 */
export const TyperSymbolBadge: React.FC<TyperSymbolBadgeProps> = ({
  symbol,
  color,
  title,
  size = 'sm',
  className = '',
  style,
}) => {
  const fgColor = getContrastForeground(color);
  const display = symbol && symbol.length > 0 ? symbol : '?';

  const sizeClass =
    size === 'canvas'
      ? ''
      : size === 'xs'
        ? 'min-w-[20px] h-5 px-1 text-[10px]'
        : size === 'md'
          ? 'min-w-[28px] h-7 px-1.5 text-xs'
          : 'min-w-[24px] h-6 px-1.5 text-[11px]';

  return (
    <span
      style={{ backgroundColor: color, color: fgColor, ...style }}
      title={title}
      className={`inline-flex items-center justify-center rounded-[4px] font-mono font-bold leading-none tracking-tight shrink-0 select-none ${sizeClass} ${className}`}
    >
      {display}
    </span>
  );
};
