import React, { useState, useRef, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';

export interface UtilityRailTool {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  isActive?: boolean;
  shortcut?: string;
}

interface UtilityRailProps {
  isExpanded: boolean;
  onToggleExpand: () => void;
  onCollapse: () => void;
  keepExpanded: boolean;
  tools: UtilityRailTool[];
  className?: string;
}

export const UtilityRail: React.FC<UtilityRailProps> = ({
  isExpanded,
  onToggleExpand,
  onCollapse,
  keepExpanded,
  tools,
  className = '',
}) => {
  const railRef = useRef<HTMLDivElement>(null);
  const collapseTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Delayed Tooltip state (800-1000ms delay) for collapsed mode
  const [activeTooltip, setActiveTooltip] = useState<{
    toolId: string;
    x: number;
    y: number;
  } | null>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Clear pending timers on unmount
  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // Automatic collapse on outside click when keepExpanded is false
  useEffect(() => {
    if (!isExpanded || keepExpanded) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) {
        onCollapse();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isExpanded, keepExpanded, onCollapse]);

  // Handle pointer leaving the rail container for auto-collapse
  const handleRailMouseEnter = () => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  };

  const handleRailMouseLeave = () => {
    if (isExpanded && !keepExpanded) {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = setTimeout(() => {
        onCollapse();
      }, 250);
    }
  };

  // Delayed hover tooltip handlers for collapsed mode
  const handleToolMouseEnter = (e: React.MouseEvent<HTMLButtonElement>, tool: UtilityRailTool) => {
    if (isExpanded) return;
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const targetX = rect.right + 12;
    const targetY = rect.top + rect.height / 2;

    hoverTimerRef.current = setTimeout(() => {
      setActiveTooltip({
        toolId: tool.id,
        x: targetX,
        y: targetY,
      });
    }, 900);
  };

  const handleToolMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setActiveTooltip(null);
  };

  const handleToolClick = (tool: UtilityRailTool) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setActiveTooltip(null);
    tool.onClick();
  };

  const activeToolData = activeTooltip
    ? tools.find((t) => t.id === activeTooltip.toolId)
    : null;

  return (
    <>
      <aside
        className={`w-[48px] h-full shrink-0 relative z-40 select-none overflow-visible ${className}`}
        aria-label="Workspace Utility Rail"
      >
        <div
          ref={railRef}
          onMouseEnter={handleRailMouseEnter}
          onMouseLeave={handleRailMouseLeave}
          className={`absolute top-0 left-0 h-full bg-[#000000] flex flex-col py-0 overflow-hidden transition-[width] duration-200 ease-in-out ${
            isExpanded
              ? 'w-[240px] shadow-[6px_0_24px_rgba(0,0,0,0.7)]'
              : 'w-[48px] shadow-none'
          }`}
        >
          {/* Header & Fixed Arrow Control */}
          <div className="h-12 shrink-0 flex items-center [-webkit-app-region:no-drag]">
            <div className="w-[48px] shrink-0 flex items-center justify-center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand();
                }}
                className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white transition-colors cursor-pointer group bg-transparent border-0 outline-none"
                title={isExpanded ? 'Collapse Utility Rail' : 'Expand Utility Rail'}
                aria-label={isExpanded ? 'Collapse Utility Rail' : 'Expand Utility Rail'}
              >
                <ChevronRight
                  className={`w-4 h-4 transition-transform duration-200 ease-in-out pointer-events-none ${
                    isExpanded ? 'rotate-180 text-zinc-200' : 'rotate-0 text-zinc-400 group-hover:text-white'
                  }`}
                />
              </button>
            </div>
            <span
              className={`text-xs font-semibold tracking-wide text-zinc-200 transition-opacity duration-200 select-none whitespace-nowrap pointer-events-none ${
                isExpanded ? 'opacity-100' : 'opacity-0'
              }`}
            >
              Utilities
            </span>
          </div>

          {/* Vertical Spacing */}
          <div className="h-2 shrink-0" />

          {/* Vertical Tools List */}
          <div className="flex-1 flex flex-col gap-1 overflow-y-auto overflow-x-hidden custom-scrollbar [-webkit-app-region:no-drag]">
            {tools.map((tool) => {
              const Icon = tool.icon;
              const isActive = Boolean(tool.isActive);

              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => handleToolClick(tool)}
                  onMouseEnter={(e) => handleToolMouseEnter(e, tool)}
                  onMouseLeave={handleToolMouseLeave}
                  className="w-full h-11 flex items-center cursor-pointer group bg-transparent border-0 outline-none focus-visible:ring-1 focus-visible:ring-sky-400 shrink-0 select-none [-webkit-app-region:no-drag]"
                  aria-label={tool.name}
                >
                  <div className="w-[48px] shrink-0 flex items-center justify-center pointer-events-none">
                    <Icon
                      className={`w-5 h-5 transition-colors pointer-events-none ${
                        isActive
                          ? 'text-sky-400'
                          : 'text-zinc-400 group-hover:text-white'
                      }`}
                    />
                  </div>
                  <span
                    className={`text-xs font-medium tracking-tight truncate select-none pointer-events-none transition-opacity duration-200 pr-3 ${
                      isExpanded ? 'opacity-100' : 'opacity-0'
                    } ${
                      isActive ? 'text-sky-300 font-semibold' : 'text-zinc-300 group-hover:text-white'
                    }`}
                  >
                    {tool.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Floating Delayed Hover Tooltip (collapsed mode only) */}
      {activeTooltip && activeToolData && !isExpanded && (
        <div
          style={{
            left: `${activeTooltip.x}px`,
            top: `${activeTooltip.y}px`,
          }}
          className="fixed -translate-y-1/2 z-50 pointer-events-none min-w-[190px] max-w-[240px] p-2.5 rounded-xl bg-[#121318] border border-white/20 shadow-2xl backdrop-blur-md animate-in fade-in duration-150 select-none"
        >
          <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-[#121318] border-b border-l border-white/20" />
          <div className="text-xs font-bold text-sky-400 mb-1">
            {activeToolData.name}
          </div>
          <div className="text-[11px] text-white font-normal leading-snug">
            {activeToolData.description}
          </div>
        </div>
      )}
    </>
  );
};
