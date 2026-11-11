import React from 'react';
import { ChevronRight } from 'lucide-react';
import type {
  ActiveOperationRecord,
  DiagnosticFinding,
  DiagnosticHealthStatus,
  DiagnosticSessionMetadata,
  SubsystemHealthSnapshot,
  SubsystemId,
} from '../types';
import { StatusBadge } from './StatusBadge';

export interface OverviewTabProps {
  overallStatus: DiagnosticHealthStatus;
  snapshots: SubsystemHealthSnapshot[];
  activeOperations: ActiveOperationRecord[];
  recentFindings: DiagnosticFinding[];
  activeRecording: DiagnosticSessionMetadata | null;
  lastDiagnosticRunAt: number | null;
  onInspectSubsystem: (subsystemId: SubsystemId) => void;
  onSelectFindingCorrelation: (correlationId: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  overallStatus,
  snapshots,
  activeOperations,
  recentFindings,
  activeRecording,
  lastDiagnosticRunAt,
  onInspectSubsystem,
  onSelectFindingCorrelation,
}) => {
  const healthyCount = snapshots.filter((s) => s.status === 'healthy').length;
  const warningCount = snapshots.filter((s) => s.status === 'warning').length;
  const failingCount = snapshots.filter(
    (s) => s.status === 'error' || s.status === 'critical'
  ).length;
  const notCheckedCount = snapshots.filter((s) => s.status === 'not_checked').length;
  const unsupportedCount = snapshots.filter((s) => s.status === 'unsupported').length;

  return (
    <div className="space-y-5">
      {/* Overall Diagnostic Verdict Strip */}
      <div className="p-3.5 rounded-lg bg-[#09090c] border border-white/[0.08] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
              System Readiness
            </span>
            <StatusBadge status={overallStatus} />
            {activeRecording && (
              <StatusBadge
                status="running"
                labelOverride={`Recording (${activeRecording.eventCount})`}
              />
            )}
          </div>
          <span className="font-mono text-[10px] text-zinc-500">
            Last check:{' '}
            {lastDiagnosticRunAt ? new Date(lastDiagnosticRunAt).toLocaleTimeString() : 'Never run'}
          </span>
        </div>

        <p className="text-xs text-zinc-300 leading-relaxed font-sans">
          {notCheckedCount === snapshots.length
            ? 'No diagnostic checks have run yet. Subsystems remain marked Not Checked until verified by a check or live execution evidence.'
            : `${healthyCount} verified healthy, ${warningCount} with warnings, ${failingCount} failing, ${notCheckedCount} not checked, ${unsupportedCount} unsupported in current runtime.`}
        </p>

        <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-white/[0.05] font-mono text-[11px] text-zinc-400">
          <span>
            Healthy: <strong className="text-emerald-400">{healthyCount}</strong>
          </span>
          <span>
            Warnings: <strong className="text-amber-400">{warningCount}</strong>
          </span>
          <span>
            Failed: <strong className="text-rose-400">{failingCount}</strong>
          </span>
          <span>
            Not Checked: <strong className="text-zinc-300">{notCheckedCount}</strong>
          </span>
          <span>
            Unsupported: <strong className="text-zinc-500">{unsupportedCount}</strong>
          </span>
        </div>
      </div>

      {/* Active Operations */}
      {activeOperations.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
            Active Operations ({activeOperations.length})
          </h3>
          <div className="divide-y divide-white/[0.05] rounded-lg border border-sky-500/25 bg-[#090b10]">
            {activeOperations.map((op) => (
              <div
                key={op.correlationId}
                className="px-3 py-2 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <StatusBadge status="running" compact />
                    <span className="text-zinc-200 font-semibold">
                      {op.subsystem} // {op.operation}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 truncate mt-0.5">{op.explanation}</p>
                </div>
                <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                  {new Date(op.startedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Registered Subsystem Matrix */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
            Subsystem Health Matrix ({snapshots.length})
          </h3>
          <span className="font-mono text-[10px] text-zinc-500">
            Click a subsystem to inspect checks & events
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {snapshots.map((sub) => (
            <button
              key={sub.subsystem}
              type="button"
              onClick={() => onInspectSubsystem(sub.subsystem)}
              className="p-3 rounded-lg bg-[#09090c] hover:bg-[#101118] border border-white/[0.06] hover:border-white/[0.14] text-left transition-colors cursor-pointer flex items-center justify-between gap-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-zinc-100 truncate">{sub.name}</span>
                  {sub.findings.length > 0 && (
                    <span className="font-mono text-[10px] text-zinc-500">
                      ({sub.findings.length} finding{sub.findings.length === 1 ? '' : 's'})
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-400 truncate">{sub.summary}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <StatusBadge status={sub.status} compact />
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Recent Findings */}
      <div className="space-y-2">
        <h3 className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
          Recent Diagnostic Findings ({recentFindings.length})
        </h3>
        {recentFindings.length === 0 ? (
          <div className="p-4 rounded-lg bg-[#09090c] border border-white/[0.06] text-xs text-zinc-500 font-sans">
            No findings recorded yet. Run safe diagnostics or operate Folio Script to collect system evidence.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06] bg-[#09090c]">
            {recentFindings.slice(0, 15).map((finding) => (
              <div key={finding.findingId} className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={finding.severity} compact />
                    <span className="font-mono text-[11px] text-zinc-300 font-semibold">
                      {finding.subsystem} // {finding.code}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {finding.correlationId && (
                      <button
                        type="button"
                        onClick={() => onSelectFindingCorrelation(finding.correlationId!)}
                        className="font-mono text-[10px] text-sky-400 hover:text-sky-300 underline cursor-pointer"
                      >
                        Trace {finding.correlationId.slice(0, 18)}
                      </button>
                    )}
                    <span className="font-mono text-[10px] text-zinc-500">
                      {new Date(finding.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
                <div className="text-xs font-medium text-zinc-200">{finding.title}</div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{finding.explanation}</p>
                {finding.remediation && (
                  <p className="text-[11px] text-zinc-500">
                    Next step: <span className="text-zinc-300">{finding.remediation}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
