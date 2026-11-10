import React from 'react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';
import { Activity, Sparkles } from 'lucide-react';
import { isTrainingStudioEnabled } from '../../../lib/training/env';
import { TrainingStudioScreen } from '../../Training/TrainingStudioScreen';

export interface QualityViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
  onOpenBenchmark?: () => void;
  onCloseSettings: () => void;
}

export const QualityView: React.FC<QualityViewProps> = ({
  getVal,
  setVal,
  onOpenBenchmark,
  onCloseSettings,
}) => {
  const showTraining = isTrainingStudioEnabled();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          Quality & Benchmark Gates
        </h2>
        <span className="text-xs text-zinc-500 font-mono">
          System #6: Benchmark regression gates, CER ceilings, and release qualifications
        </span>
      </div>

      <div className="space-y-1">
        {/* Benchmark Launcher */}
        <SettingRow
          label="Quality Benchmark Framework"
          description="Execute automated qualification runs, verify non-overridable hard gates, and inspect regressions."
          layout="vertical"
        >
          <div className="flex items-center justify-between p-3 rounded-md bg-[#08080b] border border-white/[0.06] mt-1">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-zinc-400" />
              <span className="text-xs font-mono text-zinc-300">
                System #6 Automated Verification Harness
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                onCloseSettings();
                onOpenBenchmark?.();
              }}
              className="px-3 py-1.5 rounded bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-mono font-semibold transition-colors cursor-pointer"
            >
              Open Benchmark Screen
            </button>
          </div>
        </SettingRow>

        {/* Enforce Hard Release Gates */}
        <SettingRow
          label="Enforce Hard Release Gates"
          description="Blocks export release approval if any critical safety or integrity invariant fails."
        >
          <SettingsSwitch
            id="quality.regression_gate_enabled"
            ariaLabel="Enforce Hard Release Gates"
            checked={Boolean(getVal<boolean>('quality.regression_gate_enabled'))}
            onChange={(checked) => setVal('quality.regression_gate_enabled', checked)}
          />
        </SettingRow>

        {/* Max Allowed CER */}
        <SettingRow
          label="Character Error Rate (CER) Ceiling"
          description="Maximum tolerable OCR character error rate before triggering regression warnings."
          layout="vertical"
        >
          <div className="space-y-1.5 mt-1">
            <div className="flex justify-between text-xs font-mono text-zinc-400">
              <span>Max Allowed CER</span>
              <span className="text-zinc-200 font-medium">
                {getVal<number>('quality.max_allowed_cer') ?? 0.05}
              </span>
            </div>
            <input
              type="range"
              min={0.01}
              max={0.20}
              step={0.01}
              value={getVal<number>('quality.max_allowed_cer') ?? 0.05}
              onChange={(e) => setVal('quality.max_allowed_cer', Number(e.target.value))}
              className="w-full accent-white"
            />
          </div>
        </SettingRow>
      </div>

      {/* Dev-Only Training Studio */}
      {showTraining && (
        <div className="pt-6 border-t border-white/[0.08] space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-zinc-400" />
            <h3 className="text-xs font-mono uppercase font-semibold text-zinc-300">
              Training Studio (Development Mode)
            </h3>
          </div>
          <div className="rounded-md border border-white/[0.06] overflow-hidden bg-[#050508] p-3 max-h-[400px] overflow-y-auto custom-scrollbar">
            <TrainingStudioScreen />
          </div>
        </div>
      )}
    </div>
  );
};
