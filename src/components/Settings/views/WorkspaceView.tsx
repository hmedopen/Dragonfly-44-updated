import React from 'react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';
import { Plus, Trash2, ArrowUp, ArrowDown, RotateCcw } from 'lucide-react';
import {
  assignNextTyperColor,
  DEFAULT_TYPERS,
  deriveFallbackTyperColor,
  formatTyperSymbol,
  normalizeHexColor,
  TYPER_COLOR_SWATCHES,
  type CustomTyperConfig,
  type ExtractedTextDirection,
  type TyperSettings,
  type TyperSymbolPosition,
} from '../../../types/typers';
import { TyperSymbolBadge } from '../../../features/manual-selection/components/TyperSymbolBadge';

export interface WorkspaceViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
  typerSettings: TyperSettings;
  setTyperSettings: React.Dispatch<React.SetStateAction<TyperSettings>>;
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  getVal,
  setVal,
  typerSettings,
  setTyperSettings,
}) => {
  const handleToggleIncludeTyperSymbols = (checked: boolean) => {
    setTyperSettings((prev) => ({ ...prev, includeTyperSymbols: checked }));
  };

  const handleSetSymbolPosition = (position: TyperSymbolPosition) => {
    setTyperSettings((prev) => ({ ...prev, symbolPosition: position }));
  };

  const handleSetTextDirection = (direction: ExtractedTextDirection) => {
    setTyperSettings((prev) => ({ ...prev, textDirection: direction }));
  };

  const handleUpdateTyper = (id: string, patch: Partial<CustomTyperConfig>) => {
    setTyperSettings((prev) => ({
      ...prev,
      typers: prev.typers.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };

  const handleDeleteTyper = (id: string) => {
    setTyperSettings((prev) => ({
      ...prev,
      typers: prev.typers.filter((t) => t.id !== id),
    }));
  };

  const handleMoveTyper = (index: number, delta: -1 | 1) => {
    setTyperSettings((prev) => {
      const targetIndex = index + delta;
      if (targetIndex < 0 || targetIndex >= prev.typers.length) return prev;
      const nextTypers = [...prev.typers];
      const [moved] = nextTypers.splice(index, 1);
      nextTypers.splice(targetIndex, 0, moved);
      return { ...prev, typers: nextTypers };
    });
  };

  const handleResetTypers = () => {
    setTyperSettings((prev) => ({
      ...prev,
      typers: DEFAULT_TYPERS.map((t) => ({ ...t })),
    }));
  };

  const handleAddTyper = () => {
    const newId = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setTyperSettings((prev) => {
      const nextColor = assignNextTyperColor(prev.typers);
      const newTyper: CustomTyperConfig = {
        id: newId,
        prefix: 'CT:',
        name: 'New Custom Typer',
        instructions: '',
        isDefault: false,
        color: nextColor,
        pinned: false,
      };
      return {
        ...prev,
        typers: [...prev.typers, newTyper],
      };
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          Workspace & Presentation
        </h2>
        <span className="text-xs text-zinc-500 font-mono">
          Canvas overlays, diagnostic HUDs, and export tag conventions
        </span>
      </div>

      <div className="space-y-1">
        {/* Dialogue Bounding Boxes */}
        <SettingRow
          label="Dialogue Bounding Boxes"
          description="Displays visual bounding box rectangles around detected dialogue bubbles on the canvas."
        >
          <SettingsSwitch
            id="workspace.overlay_boxes_visible"
            ariaLabel="Dialogue Bounding Boxes"
            checked={Boolean(getVal<boolean>('workspace.overlay_boxes_visible'))}
            onChange={(checked) => setVal('workspace.overlay_boxes_visible', checked)}
          />
        </SettingRow>

        {/* Selection Outline & Badge Size */}
        <SettingRow
          label="Selection Outline & Badge Size"
          description="Controls the visual thickness of selection outlines, number badge dimensions, and badge typography without changing coordinates or OCR."
        >
          <div
            role="group"
            aria-label="Selection Outline & Badge Size"
            className="flex items-center gap-1 bg-[#09090c] border border-white/[0.08] rounded p-0.5 text-xs font-mono"
          >
            {(['small', 'medium', 'big'] as const).map((sizeOption) => {
              const currentSize = getVal<string>('workspace.selection_overlay_size') || 'small';
              const active = currentSize === sizeOption;
              return (
                <button
                  key={sizeOption}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setVal('workspace.selection_overlay_size', sizeOption)}
                  className={`px-3 py-1 rounded transition-colors cursor-pointer capitalize ${
                    active
                      ? 'bg-white/[0.12] text-white font-medium'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {sizeOption}
                </button>
              );
            })}
          </div>
        </SettingRow>

        {/* Review Flag Markers */}
        <SettingRow
          label="Review Flag Markers"
          description="Renders warning markers and quality-control flags directly on affected dialogue bubbles."
        >
          <SettingsSwitch
            id="workspace.overlay_review_markers_visible"
            ariaLabel="Review Flag Markers"
            checked={Boolean(getVal<boolean>('workspace.overlay_review_markers_visible'))}
            onChange={(checked) => setVal('workspace.overlay_review_markers_visible', checked)}
          />
        </SettingRow>

        {/* Reading Order Flow Arrows */}
        <SettingRow
          label="Reading Order Flow Arrows"
          description="Visualizes directed vectors between consecutive dialogue bubbles reflecting current reading flow."
        >
          <SettingsSwitch
            id="workspace.overlay_reading_order_visible"
            ariaLabel="Reading Order Flow Arrows"
            checked={Boolean(getVal<boolean>('workspace.overlay_reading_order_visible'))}
            onChange={(checked) => setVal('workspace.overlay_reading_order_visible', checked)}
          />
        </SettingRow>

        {/* Panel Boundaries */}
        <SettingRow
          label="Panel Boundaries"
          description="Renders segmented comic/manga panel polygon boundaries over page artwork."
        >
          <SettingsSwitch
            id="workspace.overlay_panels_visible"
            ariaLabel="Panel Boundaries"
            checked={Boolean(getVal<boolean>('workspace.overlay_panels_visible'))}
            onChange={(checked) => setVal('workspace.overlay_panels_visible', checked)}
          />
        </SettingRow>

        {/* Coordinate Diagnostics HUD */}
        <SettingRow
          label="Coordinate Diagnostics HUD"
          description="Displays real-time transform matrices, screen/source round-trip coordinates, and rendering frame timings."
        >
          <SettingsSwitch
            id="workspace.coordinate_diagnostics"
            ariaLabel="Coordinate Diagnostics HUD"
            checked={Boolean(getVal<boolean>('workspace.coordinate_diagnostics'))}
            onChange={(checked) => setVal('workspace.coordinate_diagnostics', checked)}
          />
        </SettingRow>
      </div>

      {/* Typers & Export Tag Conventions */}
      <div className="pt-4 border-t border-white/[0.08] space-y-4">
        <div>
          <h3 className="text-xs font-mono uppercase font-semibold text-zinc-300">
            Typers & Export Tags
          </h3>
          <span className="text-[11px] text-zinc-500 font-mono">
            Tag prefixes, Arabic RTL positioning, and AI functional classification rules
          </span>
        </div>

        <div className="space-y-1">
          <SettingRow
            label="Include Typer Symbols in Exports"
            description="Appends designated prefix symbols to extracted dialogues during clipboard and file exports."
          >
            <SettingsSwitch
              id="typer.include_symbols"
              ariaLabel="Include Typer Symbols in Exports"
              checked={typerSettings.includeTyperSymbols}
              onChange={handleToggleIncludeTyperSymbols}
            />
          </SettingRow>

          <SettingRow
            label="Typer Symbol Position"
            description="Whether the typer prefix symbol is placed at the start or end of the dialogue line."
          >
            <div className="flex items-center gap-1 bg-[#09090c] border border-white/[0.08] rounded p-0.5 text-xs font-mono">
              {(['start', 'end'] as const).map((position) => {
                const active = typerSettings.symbolPosition === position;
                return (
                  <button
                    key={position}
                    type="button"
                    onClick={() => handleSetSymbolPosition(position)}
                    className={`px-3 py-1 rounded transition-colors cursor-pointer capitalize ${
                      active
                        ? 'bg-white/[0.12] text-white font-medium'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {position}
                  </button>
                );
              })}
            </div>
          </SettingRow>

          <SettingRow
            label="Extracted Text Direction"
            description="Controls text reading orientation for raw text exports (RTL for Arabic scanlation standard)."
          >
            <div className="flex items-center gap-1 bg-[#09090c] border border-white/[0.08] rounded p-0.5 text-xs font-mono">
              {(['rtl', 'ltr'] as const).map((direction) => {
                const active = typerSettings.textDirection === direction;
                return (
                  <button
                    key={direction}
                    type="button"
                    onClick={() => handleSetTextDirection(direction)}
                    className={`px-3 py-1 rounded transition-colors cursor-pointer uppercase ${
                      active
                        ? 'bg-white/[0.12] text-white font-medium'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {direction}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        </div>

        {/* Configured Typers List */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono text-zinc-400">
              Configured Typers ({typerSettings.typers.length})
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleResetTypers}
                title="Reset typers and colors to defaults"
                className="flex items-center gap-1 px-2 py-1 rounded bg-[#09090c] hover:bg-zinc-800 border border-white/[0.08] text-xs font-mono text-zinc-300 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Typers</span>
              </button>
              <button
                type="button"
                onClick={handleAddTyper}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-white/[0.08] text-xs font-mono text-zinc-200 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Typer</span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {typerSettings.typers.map((t, index) => {
              const activeColor = normalizeHexColor(t.color, deriveFallbackTyperColor(t.id));
              const displaySymbol = formatTyperSymbol(t.prefix, t.name);

              return (
                <div
                  key={t.id}
                  className="p-3 rounded-md bg-[#07070a] border border-white/[0.08] space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <TyperSymbolBadge
                      symbol={displaySymbol}
                      color={activeColor}
                      title={`${t.name} (${displaySymbol})`}
                    />
                    <input
                      type="text"
                      value={t.prefix}
                      aria-label={`Symbol prefix for ${t.name}`}
                      placeholder='Symbol e.g. "":'
                      onChange={(e) => handleUpdateTyper(t.id, { prefix: e.target.value })}
                      className="w-20 px-2 py-1 rounded bg-[#030305] border border-white/[0.08] text-zinc-200 font-mono text-xs focus:outline-none focus:border-white/25 select-text"
                    />
                    <input
                      type="text"
                      value={t.name}
                      aria-label={`Name for ${t.name}`}
                      placeholder="Typer Name"
                      onChange={(e) => handleUpdateTyper(t.id, { name: e.target.value })}
                      className="flex-1 px-2.5 py-1 rounded bg-[#030305] border border-white/[0.08] text-zinc-200 text-xs focus:outline-none focus:border-white/25 select-text"
                    />

                    {/* Individual Typer Color Input */}
                    <label
                      title={`Select color for ${t.name}`}
                      className="relative flex items-center gap-1 px-1.5 py-1 rounded bg-[#030305] border border-white/[0.08] hover:border-white/20 cursor-pointer shrink-0"
                    >
                      <span
                        style={{ backgroundColor: activeColor }}
                        className="w-3.5 h-3.5 rounded-sm block"
                      />
                      <span className="font-mono text-[10px] text-zinc-400 hidden sm:inline">
                        {activeColor}
                      </span>
                      <input
                        type="color"
                        value={activeColor}
                        aria-label={`Color for ${t.name}`}
                        onChange={(e) =>
                          handleUpdateTyper(t.id, { color: normalizeHexColor(e.target.value, activeColor) })
                        }
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                      />
                    </label>

                    {/* Reorder Up / Down */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => handleMoveTyper(index, -1)}
                        aria-label={`Move ${t.name} up`}
                        className="p-1 rounded text-zinc-500 hover:text-zinc-200 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={index === typerSettings.typers.length - 1}
                        onClick={() => handleMoveTyper(index, 1)}
                        aria-label={`Move ${t.name} down`}
                        className="p-1 rounded text-zinc-500 hover:text-zinc-200 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteTyper(t.id)}
                      aria-label={`Delete typer ${t.name}`}
                      title="Delete typer (existing records retain symbol and color fallback)"
                      className="p-1 rounded text-zinc-500 hover:text-red-400 transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Quick Solid Swatch Row + AI Instructions */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {TYPER_COLOR_SWATCHES.slice(0, 12).map((swatch) => {
                      const isChosen = activeColor === swatch;
                      return (
                        <button
                          key={swatch}
                          type="button"
                          aria-label={`Set ${t.name} color ${swatch}`}
                          onClick={() => handleUpdateTyper(t.id, { color: swatch })}
                          style={{ backgroundColor: swatch }}
                          className={`w-4 h-4 rounded-[3px] cursor-pointer transition-transform ${
                            isChosen ? 'ring-2 ring-white scale-110' : 'opacity-80 hover:opacity-100'
                          }`}
                        />
                      );
                    })}
                  </div>

                  <input
                    type="text"
                    value={t.instructions}
                    placeholder="AI classification instructions..."
                    onChange={(e) => handleUpdateTyper(t.id, { instructions: e.target.value })}
                    className="w-full px-2 py-1 rounded bg-[#030305] border border-white/[0.06] text-zinc-300 text-xs font-mono focus:outline-none focus:border-white/20 select-text"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
