import React from 'react';
import {
  Sliders,
  SlidersHorizontal,
  Layers,
  BookOpen,
  Scan,
  ShieldCheck,
  Database,
  Activity,
} from 'lucide-react';

export type SettingsNavCategory =
  | 'general'
  | 'tweaks'
  | 'workspace'
  | 'translate'
  | 'scanning'
  | 'review'
  | 'memory'
  | 'quality';

export interface NavItemConfig {
  id: SettingsNavCategory;
  label: string;
  icon: React.ReactElement;
  tagline: string;
}

export const SETTINGS_NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'general',
    label: 'General',
    icon: <Sliders className="w-4 h-4 shrink-0" />,
    tagline: 'General preferences, API vault, telemetry',
  },
  {
    id: 'tweaks',
    label: 'Tweaks',
    icon: <SlidersHorizontal className="w-4 h-4 shrink-0" />,
    tagline: 'Workflow tweaks and interaction defaults',
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: <Layers className="w-4 h-4 shrink-0" />,
    tagline: 'Canvas scale, overlays, reading order, typers',
  },
  {
    id: 'translate',
    label: 'Translate',
    icon: <BookOpen className="w-4 h-4 shrink-0" />,
    tagline: 'Models, eloquence, fidelity, humanizer',
  },
  {
    id: 'scanning',
    label: 'Scanning',
    icon: <Scan className="w-4 h-4 shrink-0" />,
    tagline: 'Reading order, SFX filters, OCR thresholds',
  },
  {
    id: 'review',
    label: 'Review',
    icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
    tagline: 'QC profiles, ambiguous OCR gate, auto-correction',
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: <Database className="w-4 h-4 shrink-0" />,
    tagline: 'Series memory, learning mode, token budgets',
  },
  {
    id: 'quality',
    label: 'Quality',
    icon: <Activity className="w-4 h-4 shrink-0" />,
    tagline: 'Diagnostics, benchmark runs, release gates',
  },
];

export interface SettingsNavigationProps {
  activeCategory: SettingsNavCategory;
  onSelectCategory: (category: SettingsNavCategory) => void;
  className?: string;
}

/**
 * SettingsNavigation — Fixed far-right navigation sidebar.
 * Requirements:
 * - Positioned on the far right of the settings panel
 * - Narrow, space-efficient, stationary during content scroll
 * - Strict horizontal arrangement: ICON → TITLE on the same row
 * - Restrained neutral active indicator (no neon, no loud cards)
 */
export const SettingsNavigation: React.FC<SettingsNavigationProps> = ({
  activeCategory,
  onSelectCategory,
  className = '',
}) => {
  return (
    <nav
      aria-label="Settings Categories"
      className={`w-44 lg:w-48 bg-[#09090c] border-l border-white/[0.06] flex flex-col py-3 px-2 gap-1 shrink-0 select-none overflow-y-auto custom-scrollbar ${className}`}
    >
      <div className="px-2.5 pb-2 pt-1 border-b border-white/[0.04] mb-1">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 font-semibold">
          Categories
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        {SETTINGS_NAV_ITEMS.map((item) => {
          const isActive = activeCategory === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelectCategory(item.id)}
              className={`w-full h-9 px-2.5 rounded-md flex items-center gap-2.5 text-left text-xs transition-colors duration-100 cursor-pointer ${
                isActive
                  ? 'bg-white/[0.08] text-white font-medium border-l-2 border-white'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03] border-l-2 border-transparent'
              }`}
            >
              <span className={isActive ? 'text-zinc-100' : 'text-zinc-500'}>
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
