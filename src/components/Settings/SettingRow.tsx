import React from 'react';
import { SettingTooltip } from './SettingTooltip';
import { HelpCircle } from 'lucide-react';

export interface SettingRowProps {
  label: string;
  description?: string;
  badge?: string;
  children: React.ReactNode;
  className?: string;
  layout?: 'horizontal' | 'vertical';
}

/**
 * SettingRow — Standardized row container for Folio Script settings.
 * - Displays setting name with high readability
 * - Encapsulates contextual description inside a 1-second delayed tooltip
 * - Keeps layout clean without permanent explanatory clutter
 * - Restrained dividers and alignment
 */
export const SettingRow: React.FC<SettingRowProps> = ({
  label,
  description,
  badge,
  children,
  className = '',
  layout = 'horizontal',
}) => {
  if (layout === 'vertical') {
    return (
      <div className={`py-3 border-b border-white/[0.04] last:border-b-0 space-y-2.5 ${className}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {description ? (
              <SettingTooltip content={description}>
                <span className="text-xs font-medium text-zinc-200 hover:text-white transition-colors cursor-help flex items-center gap-1">
                  {label}
                  <HelpCircle className="w-3 h-3 text-zinc-500 hover:text-zinc-400" />
                </span>
              </SettingTooltip>
            ) : (
              <span className="text-xs font-medium text-zinc-200">{label}</span>
            )}
          </div>
          {badge && (
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              {badge}
            </span>
          )}
        </div>
        <div>{children}</div>
      </div>
    );
  }

  return (
    <div
      className={`py-3.5 border-b border-white/[0.04] last:border-b-0 flex items-center justify-between gap-4 ${className}`}
    >
      <div className="flex-1 min-w-0 pr-3">
        <div className="flex items-center gap-1.5">
          {description ? (
            <SettingTooltip content={description}>
              <span className="text-xs font-medium text-zinc-200 hover:text-white transition-colors cursor-help flex items-center gap-1">
                {label}
                <HelpCircle className="w-3 h-3 text-zinc-500 hover:text-zinc-400" />
              </span>
            </SettingTooltip>
          ) : (
            <span className="text-xs font-medium text-zinc-200">{label}</span>
          )}
          {badge && (
            <span className="ml-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              {badge}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
};
