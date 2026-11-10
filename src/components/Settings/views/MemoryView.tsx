import React from 'react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';

export interface MemoryViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
}

export const MemoryView: React.FC<MemoryViewProps> = ({ getVal, setVal }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          Project Memory
        </h2>
        <span className="text-xs text-zinc-500 font-mono">
          System #5: Knowledge learning modes, lore approval gates, and context token budgets
        </span>
      </div>

      <div className="space-y-1">
        {/* Knowledge Learning Mode */}
        <SettingRow
          label="Knowledge Learning Mode"
          description="Dictates how character relationships, glossary entries, and proper nouns are ingested into series memory."
          layout="vertical"
        >
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              { id: 'candidate_only', name: 'Candidate Only', desc: 'Explicit operator approval' },
              { id: 'autonomous_observed', name: 'Autonomous', desc: 'Auto-learns high-confidence lore' },
              { id: 'disabled', name: 'Disabled', desc: 'No lore memory ingestion' },
            ].map((m) => {
              const active = getVal<string>('memory.learning_mode') === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setVal('memory.learning_mode', m.id)}
                  className={`p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-white/[0.10] border-white/30 text-white'
                      : 'bg-[#08080b] border-white/[0.04] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="text-xs font-medium">{m.name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{m.desc}</div>
                </button>
              );
            })}
          </div>
        </SettingRow>

        {/* Cross-Chapter Knowledge Propagation */}
        <SettingRow
          label="Cross-Chapter Knowledge Propagation"
          description="Propagates verified characters, glossary terminology, and honorific rules across all project chapters."
        >
          <SettingsSwitch
            id="memory.cross_chapter_learning"
            ariaLabel="Cross-Chapter Knowledge Propagation"
            checked={Boolean(getVal<boolean>('memory.cross_chapter_learning'))}
            onChange={(checked) => setVal('memory.cross_chapter_learning', checked)}
          />
        </SettingRow>

        {/* Context Token Budget Cap */}
        <SettingRow
          label="Context Token Budget Cap"
          description="Maximum token allocation reserved for series memory injection into prompt windows."
          layout="vertical"
        >
          <div className="space-y-1.5 mt-1">
            <div className="flex justify-between text-xs font-mono text-zinc-400">
              <span>Token Budget</span>
              <span className="text-zinc-200 font-medium">
                {getVal<number>('memory.context_budget_tokens') ?? 2000} tokens
              </span>
            </div>
            <input
              type="range"
              min={500}
              max={6000}
              step={250}
              value={getVal<number>('memory.context_budget_tokens') ?? 2000}
              onChange={(e) => setVal('memory.context_budget_tokens', Number(e.target.value))}
              className="w-full accent-white"
            />
          </div>
        </SettingRow>
      </div>
    </div>
  );
};
