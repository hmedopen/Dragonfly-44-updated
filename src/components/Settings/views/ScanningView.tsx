import React from 'react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';

export interface ScanningViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
}

export const ScanningView: React.FC<ScanningViewProps> = ({ getVal, setVal }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          Scanning & OCR
        </h2>
        <span className="text-xs text-zinc-500 font-mono">
          System #3: Detection profiles, reading conventions, SFX filters, and crop retries
        </span>
      </div>

      <div className="space-y-1">
        {/* Speed & Accuracy Profile */}
        <SettingRow
          label="Scanning Speed & Accuracy Profile"
          description="Balances detection throughput against exhaustive high-resolution verification passes."
          layout="vertical"
        >
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              { id: 'fast', name: 'Fast (Single Pass)', desc: 'High throughput, skips retries' },
              { id: 'balanced', name: 'Balanced', desc: 'Standard scan + crop verification' },
              { id: 'high_accuracy', name: 'High Accuracy', desc: 'Exhaustive verification passes' },
            ].map((p) => {
              const active = getVal<string>('scanning.profile') === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setVal('scanning.profile', p.id)}
                  className={`p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-white/[0.10] border-white/30 text-white'
                      : 'bg-[#08080b] border-white/[0.04] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="text-xs font-medium">{p.name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{p.desc}</div>
                </button>
              );
            })}
          </div>
        </SettingRow>

        {/* Reading Convention */}
        <SettingRow
          label="Reading Order Convention"
          description="Geometric sort heuristic used to sequence detected bubbles into reading order."
          layout="vertical"
        >
          <select
            value={getVal<string>('scanning.reading_convention') || 'manga_rtl'}
            onChange={(e) => setVal('scanning.reading_convention', e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-[#050508] border border-white/[0.10] text-zinc-200 text-xs font-mono focus:outline-none focus:border-white/20 mt-1"
          >
            <option value="auto">Auto-detect from page layout</option>
            <option value="manga_rtl">Manga Right-to-Left (RTL)</option>
            <option value="webtoon_v">Webtoon Vertical Scroll</option>
            <option value="ltr">Western Left-to-Right (LTR)</option>
          </select>
        </SettingRow>

        {/* Source Language */}
        <SettingRow
          label="Source Language"
          description="Primary language of the source pages used for OCR routing and extraction."
          layout="vertical"
        >
          <select
            value={getVal<string>('scanning.source_language') || 'auto'}
            onChange={(e) => setVal('scanning.source_language', e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-[#050508] border border-white/[0.10] text-zinc-200 text-xs font-mono focus:outline-none focus:border-white/20 mt-1"
          >
            <option value="auto">Auto-detect</option>
            <option value="en">English (en)</option>
            <option value="ko">Korean (ko)</option>
            <option value="ja">Japanese (ja)</option>
            <option value="zh">Chinese (zh)</option>
          </select>
        </SettingRow>

        {/* SFX Extraction */}
        <SettingRow
          label="Extract In-Art Sound Effects (SFX)"
          description="Includes onomatopoeia and decorative sound effects in the extracted dialogue stream."
        >
          <SettingsSwitch
            id="scanning.include_sfx"
            ariaLabel="Extract In-Art Sound Effects (SFX)"
            checked={Boolean(getVal<boolean>('scanning.include_sfx'))}
            onChange={(checked) => setVal('scanning.include_sfx', checked)}
          />
        </SettingRow>

        {/* OCR Confidence Threshold */}
        <SettingRow
          label="OCR Confidence Threshold"
          description="Minimum confidence score required before accepting OCR output without an ambiguity flag."
          layout="vertical"
        >
          <div className="space-y-1.5 mt-1">
            <div className="flex justify-between text-xs font-mono text-zinc-400">
              <span>Threshold</span>
              <span className="text-zinc-200 font-medium">
                {getVal<number>('scanning.ocr_confidence_threshold') ?? 0.65}
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={0.95}
              step={0.05}
              value={getVal<number>('scanning.ocr_confidence_threshold') ?? 0.65}
              onChange={(e) => setVal('scanning.ocr_confidence_threshold', Number(e.target.value))}
              className="w-full accent-white"
            />
          </div>
        </SettingRow>

        {/* High-Res Crop Retries */}
        <SettingRow
          label="Targeted High-Res Crop Retries"
          description="Re-crops and executes second-pass OCR at native resolution for low-confidence or small bubbles."
        >
          <SettingsSwitch
            id="scanning.enable_crop_retries"
            ariaLabel="Targeted High-Res Crop Retries"
            checked={Boolean(getVal<boolean>('scanning.enable_crop_retries'))}
            onChange={(checked) => setVal('scanning.enable_crop_retries', checked)}
          />
        </SettingRow>
      </div>
    </div>
  );
};
