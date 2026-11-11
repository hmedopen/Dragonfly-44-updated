import React from 'react';
import { Play } from 'lucide-react';
import type {
  DiagnosticEvent,
  SubsystemHealthSnapshot,
  SubsystemId,
  SubsystemInspector,
} from '../types';
import { CoverageBadge, SafetyBadge, StatusBadge } from './StatusBadge';

export interface SystemsTabProps {
  inspectors: SubsystemInspector[];
  snapshots: SubsystemHealthSnapshot[];
  selectedSubsystemId: SubsystemId;
  onSelectSubsystem: (id: SubsystemId) => void;
  events: DiagnosticEvent[];
  runningCheckKey: string | null;
  onRunSubsystemSafeChecks: (id: SubsystemId) => void;
  onRunSingleCheck: (subsystemId: SubsystemId, checkId: string) => void;
}

export const SystemsTab: React.FC<SystemsTabProps> = ({
  inspectors,
  snapshots,
  selectedSubsystemId,
  onSelectSubsystem,
  events,
  runningCheckKey,
  onRunSubsystemSafeChecks,
  onRunSingleCheck,
}) => {
  const activeInspector =
    inspectors.find((i) => i.id === selectedSubsystemId) || inspectors[0];
  const activeSnapshot =
    snapshots.find((s) => s.subsystem === activeInspector?.id) || snapshots[0];

  if (!activeInspector || !activeSnapshot) {
    return (
      <div className="text-xs text-zinc-500 font-mono">
        No subsystem inspectors registered.
      </div>
    );
  }

  const subsystemEvents = events
    .filter((e) => e.subsystem === activeInspector.id)
    .slice(-25)
    .reverse();

  return (
    <div className="flex flex-col md:flex-row gap-4 h-full min-h-0">
      {/* Left: Subsystem List */}
      <div className="md:w-56 shrink-0 border border-white/[0.06] rounded-lg bg-[#09090c] overflow-y-auto custom-scrollbar divide-y divide-white/[0.04]">
        {snapshots.map((sub) => {
          const isSelected = sub.subsystem === activeInspector.id;
          return (
            <button
              key={sub.subsystem}
              type="button"
              onClick={() => onSelectSubsystem(sub.subsystem)}
              className={`w-full px-3 py-2.5 text-left transition-colors cursor-pointer flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 ${
                isSelected
                  ? 'bg-white/[0.08] text-white border-l-2 border-sky-400'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03] border-l-2 border-transparent'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{sub.name}</div>
                <div className="font-mono text-[10px] text-zinc-500">
                  {sub.findings.length} finding(s) • {sub.recentEventCount} evt
                </div>
              </div>
              <StatusBadge status={sub.status} compact />
            </button>
          );
        })}
      </div>

      {/* Right: Inspector Workspace */}
      <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar space-y-5 pr-1">
        {/* Header Summary */}
        <div className="p-3.5 rounded-lg bg-[#09090c] border border-white/[0.08] space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-mono font-semibold uppercase tracking-wider text-zinc-100">
                  {activeInspector.name}
                </h3>
                <StatusBadge status={activeSnapshot.status} />
                <CoverageBadge tier={activeInspector.coverageLevel} />
              </div>
              <p className="text-xs text-zinc-400 mt-1">{activeInspector.description}</p>
            </div>

            <button
              type="button"
              onClick={() => onRunSubsystemSafeChecks(activeInspector.id)}
              disabled={runningCheckKey !== null}
              className="px-3 py-1.5 rounded bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 font-mono text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Play className="w-3 h-3 fill-current" aria-hidden="true" />
              <span>Run Safe Checks</span>
            </button>
          </div>

          <p className="text-xs text-zinc-300 pt-2 border-t border-white/[0.05]">
            {activeSnapshot.summary}
          </p>
        </div>

        {/* Diagnostic Checks */}
        <div className="space-y-2">
          <h4 className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
            Diagnostic Checks ({activeInspector.checks.length})
          </h4>
          <div className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06] bg-[#09090c]">
            {activeInspector.checks.map((chk) => {
              const lastResult = activeSnapshot.checkResults.find((r) => r.checkId === chk.checkId);
              const isRunningThis = runningCheckKey === `${activeInspector.id}:${chk.checkId}`;
              return (
                <div key={chk.checkId} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-zinc-100">{chk.name}</span>
                        <SafetyBadge safety={chk.safety} />
                        {lastResult && <StatusBadge status={lastResult.status} compact />}
                      </div>
                      <p className="text-[11px] text-zinc-400">{chk.description}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onRunSingleCheck(activeInspector.id, chk.checkId)}
                      disabled={runningCheckKey !== null}
                      className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 border border-white/[0.08] font-mono text-[10px] cursor-pointer shrink-0"
                    >
                      {isRunningThis ? 'Running...' : 'Run Check'}
                    </button>
                  </div>

                  {lastResult && (
                    <div className="p-2.5 rounded bg-[#060609] border border-white/[0.05] text-[11px] space-y-1">
                      <div className="flex items-center justify-between font-mono text-[10px] text-zinc-500">
                        <span>Result ({lastResult.durationMs}ms)</span>
                        <span>{new Date(lastResult.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-zinc-300">{lastResult.summary}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Preserved Findings */}
        <div className="space-y-2">
          <h4 className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
            Subsystem Findings ({activeSnapshot.findings.length})
          </h4>
          {activeSnapshot.findings.length === 0 ? (
            <div className="p-3 rounded-lg bg-[#09090c] border border-white/[0.06] text-xs text-zinc-500">
              No findings recorded for this subsystem.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06] bg-[#09090c]">
              {activeSnapshot.findings.map((f) => (
                <div key={f.findingId} className="p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={f.severity} compact />
                      <span className="font-mono text-[11px] text-zinc-300">{f.code}</span>
                    </div>
                    <span className="font-mono text-[10px] text-zinc-500">
                      {new Date(f.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-zinc-200">{f.title}</div>
                  <p className="text-[11px] text-zinc-400">{f.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Declared Instrumentation Coverage */}
        <div className="space-y-2">
          <h4 className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
            Instrumentation Capabilities
          </h4>
          <div className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06] bg-[#09090c]">
            {activeInspector.capabilities.map((cap) => (
              <div key={cap.capability} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="text-zinc-200">{cap.capability}</div>
                  <div className="text-[11px] text-zinc-500">{cap.notes}</div>
                </div>
                <CoverageBadge tier={cap.tier} />
              </div>
            ))}
          </div>
        </div>

        {/* Recent Subsystem Events */}
        <div className="space-y-2">
          <h4 className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
            Recent Events ({subsystemEvents.length})
          </h4>
          {subsystemEvents.length === 0 ? (
            <div className="p-3 rounded-lg bg-[#09090c] border border-white/[0.06] text-xs text-zinc-500">
              No live events observed in this subsystem yet.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04] rounded-lg border border-white/[0.06] bg-[#07070a]">
              {subsystemEvents.map((evt) => (
                <div key={evt.eventId} className="px-3 py-2 text-[11px] space-y-0.5">
                  <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={evt.status} compact />
                      <span className="text-zinc-200">{evt.operation}</span>
                    </div>
                    <span className="text-zinc-500">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-zinc-300">{evt.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
