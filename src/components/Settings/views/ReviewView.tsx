import React from 'react';
import { SettingRow } from '../SettingRow';
import { SettingsSwitch } from '../SettingsSwitch';

export interface ReviewViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({ getVal, setVal }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          Review & Quality Control
        </h2>
        <span className="text-xs text-zinc-500 font-mono">
          System #4: Review strictness profiles, ambiguous OCR gates, and auto-correction
        </span>
      </div>

      <div className="space-y-1">
        {/* Strictness Profile */}
        <SettingRow
          label="Review Strictness Profile"
          description="Governs the sensitivity and audit depth of grammatical, contextual, and terminology checkers."
          layout="vertical"
        >
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              { id: 'conservative', name: 'Conservative', desc: 'Critical blockers only' },
              { id: 'balanced', name: 'Balanced', desc: 'Standard scanlation QC audit' },
              { id: 'thorough', name: 'Thorough', desc: 'Deep grammatical audit' },
            ].map((p) => {
              const active = getVal<string>('review.profile') === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setVal('review.profile', p.id)}
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

        {/* Source Reliability Gate */}
        <SettingRow
          label="Source Reliability Gate (Abstain on Ambiguous OCR)"
          description="Strictly abstains from raising speculative error flags when source artwork OCR is low-confidence or degraded."
        >
          <SettingsSwitch
            id="review.ambiguous_ocr_abstention"
            ariaLabel="Source Reliability Gate (Abstain on Ambiguous OCR)"
            checked={Boolean(getVal<boolean>('review.ambiguous_ocr_abstention'))}
            onChange={(checked) => setVal('review.ambiguous_ocr_abstention', checked)}
          />
        </SettingRow>

        {/* Automated Correction Batching */}
        <SettingRow
          label="Permit Automated Correction Batching"
          description="Allows verified mechanical corrections (whitespace, punctuation, common typos) to be batch-applied safely."
        >
          <SettingsSwitch
            id="review.auto_correction_eligibility"
            ariaLabel="Permit Automated Correction Batching"
            checked={Boolean(getVal<boolean>('review.auto_correction_eligibility'))}
            onChange={(checked) => setVal('review.auto_correction_eligibility', checked)}
          />
        </SettingRow>
      </div>
    </div>
  );
};
