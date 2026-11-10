import React from 'react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';
import { Plus, Trash2 } from 'lucide-react';
import type {
  CustomTyperConfig,
  ExtractedTextDirection,
  TyperSettings,
  TyperSymbolPosition,
} from '../../../types/typers';

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

  const handleAddTyper = () => {
    const newId = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newTyper: CustomTyperConfig = {
      id: newId,
      prefix: '',
      name: 'New Custom Typer',
      instructions: '',
      isDefault: false,
    };
    setTyperSettings((prev) => ({
      ...prev,
      typers: [...prev.typers, newTyper],
    }));
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
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-400">
              Configured Typers ({typerSettings.typers.length})
            </span>
            <button
              type="button"
              onClick={handleAddTyper}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-white/[0.08] text-xs font-mono text-zinc-200 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Typer</span>
            </button>
          </div>

          <div className="space-y-2">
            {typerSettings.typers.map((t) => (
              <div
                key={t.id}
                className="p-3 rounded-md bg-[#07070a] border border-white/[0.06] space-y-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={t.prefix}
                    placeholder='Prefix e.g. "":'
                    onChange={(e) => handleUpdateTyper(t.id, { prefix: e.target.value })}
                    className="w-20 px-2 py-1 rounded bg-[#030305] border border-white/[0.08] text-zinc-200 font-mono text-xs focus:outline-none focus:border-white/20"
                  />
                  <input
                    type="text"
                    value={t.name}
                    placeholder="Typer Name"
                    onChange={(e) => handleUpdateTyper(t.id, { name: e.target.value })}
                    className="flex-1 px-2.5 py-1 rounded bg-[#030305] border border-white/[0.08] text-zinc-200 text-xs focus:outline-none focus:border-white/20"
                  />
                  <button
                    type="button"
                    onClick={() => handleDeleteTyper(t.id)}
                    aria-label={`Delete typer ${t.name}`}
                    className="p-1 rounded text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  value={t.instructions}
                  placeholder="AI classification instructions..."
                  onChange={(e) => handleUpdateTyper(t.id, { instructions: e.target.value })}
                  className="w-full px-2 py-1 rounded bg-[#030305] border border-white/[0.06] text-zinc-300 text-xs font-mono focus:outline-none focus:border-white/20"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
