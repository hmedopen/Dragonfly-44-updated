import React, { useState } from 'react';
import { Play, Square, ShieldCheck } from 'lucide-react';
import type { DiagnosticSessionMetadata, RecordingPrivacyOptions } from '../types';
import { StatusBadge } from './StatusBadge';

export interface RecordingTabProps {
  activeRecording: DiagnosticSessionMetadata | null;
  privacyOptions: RecordingPrivacyOptions;
  onChangePrivacyOptions: (opts: RecordingPrivacyOptions) => void;
  onStartRecording: (label?: string) => void;
  onStopRecording: () => void;
  storageWriteErrors: number;
}

export const RecordingTab: React.FC<RecordingTabProps> = ({
  activeRecording,
  privacyOptions,
  onChangePrivacyOptions,
  onStartRecording,
  onStopRecording,
  storageWriteErrors,
}) => {
  const [sessionLabel, setSessionLabel] = useState('');

  const isRecording = Boolean(activeRecording);

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header & Session Controls */}
      <div className="p-4 rounded-lg bg-[#09090c] border border-white/[0.08] space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
                Diagnostic Session Recorder
              </h3>
              <StatusBadge
                status={isRecording ? 'running' : 'not_checked'}
                labelOverride={isRecording ? 'Recording Active' : 'Idle'}
              />
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Record structured telemetry across all subsystems while using Scan Page, Scan All, Review, Translation, Import, Export, and Settings normally.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <input
            type="text"
            value={sessionLabel}
            disabled={isRecording}
            onChange={(e) => setSessionLabel(e.target.value)}
            placeholder="Optional session label (e.g. Chapter 14 Scan All repro)..."
            aria-label="Diagnostic session label"
            className="flex-1 px-3 py-1.5 rounded bg-[#050508] border border-white/[0.10] text-zinc-200 font-mono text-xs focus:outline-none focus:border-white/25 disabled:opacity-50"
          />

          {isRecording ? (
            <button
              type="button"
              onClick={onStopRecording}
              className="px-4 py-1.5 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 font-mono text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              <span>Stop & Generate Report</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                onStartRecording(sessionLabel);
                setSessionLabel('');
              }}
              className="px-4 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-mono text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              <span>Start Recording</span>
            </button>
          )}
        </div>
      </div>

      {/* Privacy & Recording Detail Controls */}
      <div className="p-4 rounded-lg bg-[#09090c] border border-white/[0.08] space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
          <h4 className="font-mono text-xs uppercase font-semibold tracking-wider text-zinc-200">
            Privacy & Recording Detail
          </h4>
        </div>

        <p className="text-xs text-zinc-400">
          API keys, authentication headers, and full source page images are always excluded. Enable optional fields below before starting a recording session.
        </p>

        <div className="space-y-2 pt-1">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              disabled={isRecording}
              checked={privacyOptions.includeExtractedText}
              onChange={(e) =>
                onChangePrivacyOptions({
                  ...privacyOptions,
                  includeExtractedText: e.target.checked,
                })
              }
              className="mt-0.5 accent-sky-500"
            />
            <span className="text-xs text-zinc-200">
              Include extracted OCR & translated text snippets
              <span className="block text-[11px] text-zinc-500">
                Off by default. When off, text fields are replaced with length-only redaction markers.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              disabled={isRecording}
              checked={privacyOptions.includeDetailedPayloads}
              onChange={(e) =>
                onChangePrivacyOptions({
                  ...privacyOptions,
                  includeDetailedPayloads: e.target.checked,
                })
              }
              className="mt-0.5 accent-sky-500"
            />
            <span className="text-xs text-zinc-200">
              Include detailed prompt/response metadata previews
              <span className="block text-[11px] text-zinc-500">
                Off by default. Secrets and binary image payloads remain unconditionally scrubbed.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* Live Recording Session Summary */}
      {activeRecording && (
        <div className="p-4 rounded-lg bg-[#090b10] border border-sky-500/30 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-semibold text-sky-300 uppercase">
              Active Session: {activeRecording.label}
            </span>
            <span className="font-mono text-[10px] text-zinc-400">
              ID: {activeRecording.sessionId}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
            <div className="p-2.5 rounded bg-[#07070a] border border-white/[0.06]">
              <span className="text-[10px] text-zinc-500 block">RECORDED EVENTS</span>
              <span className="text-white font-semibold">{activeRecording.eventCount}</span>
            </div>
            <div className="p-2.5 rounded bg-[#07070a] border border-white/[0.06]">
              <span className="text-[10px] text-zinc-500 block">DROPPED EVENTS</span>
              <span className={activeRecording.droppedEventCount > 0 ? 'text-amber-400 font-semibold' : 'text-zinc-300'}>
                {activeRecording.droppedEventCount}
              </span>
            </div>
            <div className="p-2.5 rounded bg-[#07070a] border border-white/[0.06]">
              <span className="text-[10px] text-zinc-500 block">PAGES COVERED</span>
              <span className="text-white font-semibold">{activeRecording.pagesCovered.length}</span>
            </div>
            <div className="p-2.5 rounded bg-[#07070a] border border-white/[0.06]">
              <span className="text-[10px] text-zinc-500 block">OPERATIONS</span>
              <span className="text-white font-semibold">{activeRecording.operationsCovered.length}</span>
            </div>
          </div>

          {storageWriteErrors > 0 && (
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
              Warning: {storageWriteErrors} asynchronous storage flush error(s) occurred; events remain buffered in memory.
            </div>
          )}

          <div className="text-[11px] font-mono text-zinc-400 space-y-1">
            <div>
              Subsystems observed:{' '}
              {activeRecording.subsystemsSeen.length > 0
                ? activeRecording.subsystemsSeen.join(', ')
                : 'Waiting for events...'}
            </div>
            {activeRecording.operationsCovered.length > 0 && (
              <div className="truncate">
                Operations: {activeRecording.operationsCovered.join(', ')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
