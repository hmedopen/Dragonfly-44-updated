import React from 'react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';
import { Terminal } from 'lucide-react';
import { GEMINI_MODEL_PROFILES, type GeminiModelKey } from '../../../types/workbench';

const PROMPT_PRESETS = [
  {
    label: '[Murim / Cultivation]',
    snippet:
      'Adopt ancient martial arts terminology. Render internal energy as طاقة داخلية / تشي, martial sects as طوائف, dantian as دانتيان, cultivation realms with solemn classical weight.',
  },
  {
    label: '[Modern Action]',
    snippet:
      'Keep dialogue punchy, realistic, and street-level. Avoid archaic expressions. Translate modern military and slang with contemporary Arabic equivalents fit for fast visual pacing.',
  },
  {
    label: '[Recruitment Test / Hints Mode]',
    snippet:
      'Strict adherence to official scanlation test conventions: do not summarize or omit text. Provide full context notes for puns or cultural references, and flag any ambiguous reading orders.',
  },
];

export interface TranslateViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
}

export const TranslateView: React.FC<TranslateViewProps> = ({ getVal, setVal }) => {
  const currentModel = getVal<string>('translation.model') || 'gemini-3.8-flash';
  const isArmed = Boolean(getVal<boolean>('translation.master_prompt_active'));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          Translation & Humanizer
        </h2>
        <span className="text-xs text-zinc-500 font-mono">
          System #2: Models, eloquence, fidelity, Arabic Humanizer, and master directives
        </span>
      </div>

      <div className="space-y-1">
        {/* Multimodal Vision Model */}
        <SettingRow
          label="Vision & Translation Model"
          description="Multimodal neural model utilized for image OCR, spatial text reasoning, and scanlation translation."
          badge="Next Op"
          layout="vertical"
        >
          <div className="space-y-2 mt-1">
            <select
              value={currentModel}
              onChange={(e) => setVal('translation.model', e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[#050508] border border-white/[0.10] text-zinc-200 text-xs font-mono focus:outline-none focus:border-white/20"
            >
              {Object.keys(GEMINI_MODEL_PROFILES).map((key) => {
                const profile = GEMINI_MODEL_PROFILES[key as GeminiModelKey];
                return (
                  <option key={key} value={key}>
                    {profile.name} — {profile.description}
                  </option>
                );
              })}
            </select>

            {currentModel === 'custom' && (
              <input
                type="text"
                placeholder="Enter custom model endpoint (e.g. gemini-3.8-pro-preview)..."
                value={getVal<string>('translation.custom_model') || ''}
                onChange={(e) => setVal('translation.custom_model', e.target.value)}
                className="w-full px-3 py-1.5 rounded-md bg-[#050508] border border-white/[0.10] text-zinc-200 text-xs font-mono focus:outline-none focus:border-white/20"
              />
            )}
          </div>
        </SettingRow>

        {/* Arabic Eloquence Standard */}
        <SettingRow
          label="Arabic Eloquence Standard"
          description="Dialectal and literary register calibration: 1 = Casual Modern, 2 = Standard Scanlation Literary, 3 = High Classical."
          layout="vertical"
        >
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              { level: 1, label: 'Casual Modern', sub: 'فصحى مبسطة' },
              { level: 2, label: 'Standard Literary', sub: 'فصحى معيارية' },
              { level: 3, label: 'High Classical', sub: 'فصحى بليغة' },
            ].map((item) => {
              const active = getVal<number>('translation.eloquence') === item.level;
              return (
                <button
                  key={item.level}
                  type="button"
                  onClick={() => setVal('translation.eloquence', item.level)}
                  className={`p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-white/[0.10] border-white/30 text-white'
                      : 'bg-[#08080b] border-white/[0.04] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="text-xs font-medium">{item.label}</div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{item.sub}</div>
                </button>
              );
            })}
          </div>
        </SettingRow>

        {/* Translation Fidelity Mode */}
        <SettingRow
          label="Translation Fidelity Mode"
          description="Fidelity strategy balancing semantic closeness against natural Arabic idiomatic flow."
          layout="vertical"
        >
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              { id: 'faithful', name: 'Faithful', desc: 'Semantic alignment' },
              { id: 'localized', name: 'Localized', desc: 'Scanlation idioms' },
              { id: 'expressive', name: 'Expressive', desc: 'Heightened impact' },
            ].map((f) => {
              const active = getVal<string>('translation.fidelity') === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setVal('translation.fidelity', f.id)}
                  className={`p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-white/[0.10] border-white/30 text-white'
                      : 'bg-[#08080b] border-white/[0.04] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="text-xs font-medium">{f.name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{f.desc}</div>
                </button>
              );
            })}
          </div>
        </SettingRow>

        {/* Arabic Humanizer Engine */}
        <SettingRow
          label="Arabic Humanizer Engine"
          description="Post-translation neutralization pass that strips synthetic AI cadence and restores human scanlation flow."
        >
          <SettingsSwitch
            id="translation.humanizer_enabled"
            ariaLabel="Arabic Humanizer Engine"
            checked={Boolean(getVal<boolean>('translation.humanizer_enabled'))}
            onChange={(checked) => setVal('translation.humanizer_enabled', checked)}
          />
        </SettingRow>

        {/* Humanizer Intensity (conditional) */}
        {getVal<boolean>('translation.humanizer_enabled') && (
          <SettingRow
            label="Humanizer Intensity Profile"
            description="Aggressiveness of synthetic idiom replacement and rhetorical cadence restoration."
            layout="vertical"
          >
            <div className="grid grid-cols-4 gap-1.5 mt-1">
              {['light', 'balanced', 'strong', 'maximum'].map((int) => {
                const active = getVal<string>('translation.humanizer_intensity') === int;
                return (
                  <button
                    key={int}
                    type="button"
                    onClick={() => setVal('translation.humanizer_intensity', int)}
                    className={`py-1.5 px-2 rounded-md font-mono text-xs capitalize cursor-pointer text-center transition-colors ${
                      active
                        ? 'bg-white/[0.12] text-white font-medium border border-white/20'
                        : 'bg-[#08080b] border border-white/[0.04] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {int}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        )}

        {/* Master Prompt Directive */}
        <SettingRow
          label="Master Prompt Directive"
          description="Injected directly into the system prompt instructions with unconditional priority over all other rules."
          layout="vertical"
        >
          <div className="p-3 rounded-md bg-[#07070a] border border-white/[0.06] space-y-3 mt-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-zinc-400">
                <Terminal className="w-3.5 h-3.5" />
                <span className="text-[11px] font-mono uppercase font-medium">Directive Status</span>
              </div>
              <button
                type="button"
                onClick={() => setVal('translation.master_prompt_active', !isArmed)}
                className={`px-2.5 py-0.5 rounded font-mono text-[10px] font-semibold border transition-colors cursor-pointer ${
                  isArmed
                    ? 'bg-white text-zinc-950 border-white'
                    : 'bg-zinc-900 text-zinc-500 border-white/[0.06]'
                }`}
              >
                {isArmed ? '● ARMED' : '○ DISARMED'}
              </button>
            </div>

            <textarea
              rows={3}
              value={getVal<string>('translation.master_prompt_override') || ''}
              onChange={(e) => setVal('translation.master_prompt_override', e.target.value)}
              placeholder="Enter highest-priority directive injected into model prompt..."
              className="w-full p-2.5 rounded bg-[#030305] border border-white/[0.08] text-zinc-200 font-mono text-xs focus:outline-none focus:border-white/20 resize-y"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              {PROMPT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    const curr = getVal<string>('translation.master_prompt_override') || '';
                    setVal('translation.master_prompt_override', curr ? `${curr}\n\n${p.snippet}` : p.snippet);
                  }}
                  className="px-2 py-0.5 rounded bg-zinc-900 border border-white/[0.06] text-[10px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setVal('translation.master_prompt_override', '')}
                className="ml-auto px-2 py-0.5 rounded bg-zinc-900 border border-white/[0.06] text-[10px] font-mono text-zinc-500 hover:text-red-400 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </SettingRow>
      </div>
    </div>
  );
};
