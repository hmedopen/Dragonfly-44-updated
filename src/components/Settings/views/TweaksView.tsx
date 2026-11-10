import React from 'react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';

export interface TweaksViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
}

export const TweaksView: React.FC<TweaksViewProps> = ({ getVal, setVal }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          General Tweaks
        </h2>
        <span className="text-xs text-zinc-500 font-mono">
          Application behavior preferences and interaction defaults
        </span>
      </div>

      <div className="space-y-1">
        {/* 1. Keep Utility Rail Expanded */}
        <SettingRow
          label="Keep Utility Rail Expanded"
          description="When enabled, the Utility Rail stays expanded until explicitly collapsed. When disabled, the rail automatically collapses when the pointer leaves or you click outside."
        >
          <SettingsSwitch
            id="general.keep_utility_rail_expanded"
            ariaLabel="Keep Utility Rail Expanded"
            checked={Boolean(getVal<boolean>('general.keep_utility_rail_expanded'))}
            onChange={(checked) => setVal('general.keep_utility_rail_expanded', checked)}
          />
        </SettingRow>

        {/* 2. Double-Click Confirmation */}
        <SettingRow
          label="Double-Click Confirmation"
          description="Requires a deliberate second click to confirm critical actions like page deletion, chapter deletion, or returning to hub."
        >
          <SettingsSwitch
            id="workspace.double_click_confirmation"
            ariaLabel="Double-Click Confirmation for Critical Actions"
            checked={getVal<boolean>('workspace.double_click_confirmation') ?? true}
            onChange={(checked) => setVal('workspace.double_click_confirmation', checked)}
          />
        </SettingRow>
      </div>
    </div>
  );
};
