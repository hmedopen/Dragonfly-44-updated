import React, { useMemo, useState } from 'react';
import { Copy, Download, Trash2, Check } from 'lucide-react';
import { buildDualReportForLiveSnapshot, buildDualReportForSession } from '../bootstrap';
import { saveDiagnosticFileViaElectron } from '../adapters/electronBridge';
import type {
  DiagnosticSessionMetadata,
  DiagnosticSessionRecord,
  RecordingPrivacyOptions,
} from '../types';
import { StatusBadge } from './StatusBadge';

export interface ReportsTabProps {
  sessions: DiagnosticSessionMetadata[];
  selectedSessionId: string;
  selectedSessionRecord: DiagnosticSessionRecord | null;
  privacyOptions: RecordingPrivacyOptions;
  snapshotVersion: number;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export const ReportsTab: React.FC<ReportsTabProps> = ({
  sessions,
  selectedSessionId,
  selectedSessionRecord,
  privacyOptions,
  snapshotVersion,
  onSelectSession,
  onDeleteSession,
}) => {
  const [reportFormat, setReportFormat] = useState<'human' | 'technical'>('human');
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const report = useMemo(() => {
    void snapshotVersion;
    if (selectedSessionId !== 'live' && selectedSessionRecord) {
      return buildDualReportForSession(selectedSessionRecord);
    }
    return buildDualReportForLiveSnapshot(privacyOptions);
  }, [selectedSessionId, selectedSessionRecord, privacyOptions, snapshotVersion]);

  const technicalJsonText = useMemo(
    () => JSON.stringify(report.technical, null, 2),
    [report.technical]
  );

  const handleCopy = async (kind: 'human' | 'technical') => {
    const content = kind === 'human' ? report.human.markdown : technicalJsonText;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedNotice(kind === 'human' ? 'Copied human report' : 'Copied JSON report');
      setTimeout(() => setCopiedNotice(null), 2500);
    } catch {
      setCopiedNotice('Clipboard write blocked');
      setTimeout(() => setCopiedNotice(null), 2500);
    }
  };

  const handleExport = async (kind: 'human' | 'technical') => {
    const isHuman = kind === 'human';
    const content = isHuman ? report.human.markdown : technicalJsonText;
    const format = isHuman ? 'markdown' : 'json';
    const ext = isHuman ? 'md' : 'json';
    const baseName = `folio-diagnostics-${report.technical.metadata.sessionId}`;

    try {
      const electronResult = await saveDiagnosticFileViaElectron({
        content,
        format,
        defaultName: baseName,
      });
      if (electronResult) {
        if (electronResult.saved) {
          setExportNotice(`Saved ${electronResult.fileName}`);
          setTimeout(() => setExportNotice(null), 3000);
        }
        return;
      }
    } catch {
      // Fallback to browser download
    }

    const blob = new Blob([content], {
      type: isHuman ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setExportNotice(`Downloaded ${baseName}.${ext}`);
    setTimeout(() => setExportNotice(null), 3000);
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Top Toolbar: Session Selector + Format Toggle + Export */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/[0.06] shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="diag-report-session" className="sr-only">
            Select Diagnostic Session
          </label>
          <select
            id="diag-report-session"
            value={selectedSessionId}
            onChange={(e) => onSelectSession(e.target.value)}
            className="px-2.5 py-1 rounded bg-[#09090c] border border-white/[0.08] text-zinc-200 font-mono text-[11px] max-w-[260px]"
          >
            <option value="live">Current Live Buffer Snapshot</option>
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.label} ({s.eventCount} evt • {s.status})
              </option>
            ))}
          </select>

          {selectedSessionId !== 'live' && (
            <button
              type="button"
              onClick={() => onDeleteSession(selectedSessionId)}
              aria-label="Delete selected session"
              title="Delete selected session"
              className="p-1.5 rounded bg-[#09090c] hover:bg-zinc-800 border border-white/[0.08] text-zinc-400 hover:text-rose-400 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}

          <div className="flex items-center p-0.5 rounded bg-[#09090c] border border-white/[0.08] font-mono text-[10px]">
            <button
              type="button"
              onClick={() => setReportFormat('human')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                reportFormat === 'human'
                  ? 'bg-white/[0.12] text-white font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Human-Readable
            </button>
            <button
              type="button"
              onClick={() => setReportFormat('technical')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                reportFormat === 'technical'
                  ? 'bg-white/[0.12] text-white font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Technical JSON
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(copiedNotice || exportNotice) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-mono text-[10px]">
              <Check className="w-3 h-3" aria-hidden="true" />
              <span>{copiedNotice || exportNotice}</span>
            </span>
          )}

          <button
            type="button"
            onClick={() => handleCopy(reportFormat)}
            className="px-2.5 py-1 rounded bg-[#09090c] hover:bg-zinc-800 border border-white/[0.08] text-zinc-200 font-mono text-[10px] flex items-center gap-1 cursor-pointer"
          >
            <Copy className="w-3 h-3" aria-hidden="true" />
            <span>Copy</span>
          </button>

          <button
            type="button"
            onClick={() => handleExport('human')}
            className="px-2.5 py-1 rounded bg-[#09090c] hover:bg-zinc-800 border border-white/[0.08] text-zinc-200 font-mono text-[10px] flex items-center gap-1 cursor-pointer"
          >
            <Download className="w-3 h-3" aria-hidden="true" />
            <span>Export .md</span>
          </button>

          <button
            type="button"
            onClick={() => handleExport('technical')}
            className="px-2.5 py-1 rounded bg-zinc-100 hover:bg-white text-zinc-950 font-mono text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
          >
            <Download className="w-3 h-3" aria-hidden="true" />
            <span>Export .json</span>
          </button>
        </div>
      </div>

      {/* Explicit Privacy Disclosure Strip */}
      <div className="px-3 py-2 rounded bg-[#09090c] border border-white/[0.06] flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-zinc-400 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <span>API Keys: <strong className="text-emerald-400">REDACTED</strong></span>
          <span>Source Images: <strong className="text-emerald-400">EXCLUDED</strong></span>
          <span>
            Extracted Text:{' '}
            <strong className={report.technical.privacyManifest.includeExtractedText ? 'text-amber-300' : 'text-zinc-200'}>
              {report.technical.privacyManifest.includeExtractedText ? 'INCLUDED' : 'REDACTED'}
            </strong>
          </span>
          <span>
            Detailed Payloads:{' '}
            <strong className={report.technical.privacyManifest.includeDetailedPayloads ? 'text-amber-300' : 'text-zinc-200'}>
              {report.technical.privacyManifest.includeDetailedPayloads ? 'INCLUDED' : 'OMITTED'}
            </strong>
          </span>
        </div>
        <span>
          Events: {report.technical.metadata.eventCount}
          {report.technical.metadata.droppedEventCount > 0
            ? ` (${report.technical.metadata.droppedEventCount} dropped)`
            : ''}
        </span>
      </div>

      {/* Report Body */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar border border-white/[0.06] rounded-lg bg-[#07070a] p-4 select-text">
        {reportFormat === 'human' ? (
          <div className="space-y-5 text-xs">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <h3 className="font-mono text-xs uppercase font-semibold text-zinc-100">
                  Executive Summary
                </h3>
                <StatusBadge status={report.human.overallStatus} compact />
              </div>
              <p className="text-zinc-300 leading-relaxed font-sans">
                {report.human.executiveSummary}
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-mono text-[11px] uppercase font-semibold text-zinc-400">
                Subsystem Breakdown
              </h4>
              <div className="divide-y divide-white/[0.05] rounded border border-white/[0.06] bg-[#09090c]">
                {report.human.subsystemSummaries.map((sub) => (
                  <div key={sub.subsystem} className="p-2.5 flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="font-medium text-zinc-200">{sub.name}</div>
                      <p className="text-[11px] text-zinc-400">{sub.summary}</p>
                    </div>
                    <StatusBadge status={sub.status} compact />
                  </div>
                ))}
              </div>
            </div>

            {report.human.failureAnalyses.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-mono text-[11px] uppercase font-semibold text-rose-300">
                  Failures & Root Causes ({report.human.failureAnalyses.length})
                </h4>
                <div className="space-y-2">
                  {report.human.failureAnalyses.map((fa) => (
                    <div
                      key={fa.findingOrTraceId}
                      className="p-3 rounded border border-rose-500/25 bg-[#120a0d] space-y-1"
                    >
                      <div className="font-mono text-[11px] text-rose-300 font-semibold">
                        {fa.origin}
                      </div>
                      <p className="text-zinc-200">{fa.explanation}</p>
                      <div className="text-[10px] font-mono text-zinc-400">
                        Affected: {fa.affectedComponents.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="font-mono text-[11px] uppercase font-semibold text-zinc-400">
                Operation Narratives ({report.human.operationNarratives.length})
              </h4>
              {report.human.operationNarratives.length === 0 ? (
                <p className="text-zinc-500">No correlated operations recorded in this view.</p>
              ) : (
                <div className="divide-y divide-white/[0.05] rounded border border-white/[0.06] bg-[#09090c]">
                  {report.human.operationNarratives.map((op) => (
                    <div key={op.correlationId} className="p-2.5 space-y-0.5">
                      <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                        <span className="text-zinc-200 font-semibold">{op.title}</span>
                        <span className="text-zinc-500">{op.outcome}</span>
                      </div>
                      <p className="text-[11px] text-zinc-300">{op.narrative}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <h4 className="font-mono text-[11px] uppercase font-semibold text-zinc-400">
                Coverage & Privacy Disclosure
              </h4>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-zinc-400">
                {report.human.coverageNotes.map((n, idx) => (
                  <li key={`cov-${idx}`}>{n}</li>
                ))}
                {report.human.privacyDisclosure.map((p, idx) => (
                  <li key={`priv-${idx}`} className="text-zinc-300">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed">
            {technicalJsonText}
          </pre>
        )}
      </div>
    </div>
  );
};
