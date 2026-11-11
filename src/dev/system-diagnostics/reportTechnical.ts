import type {
  CorrelatedTrace,
  DiagnosticEvent,
  DiagnosticFinding,
  DiagnosticHealthStatus,
  DiagnosticSessionMetadata,
  InstrumentationCoverageEntry,
  PrivacyManifest,
  SubsystemHealthSnapshot,
  TechnicalReport,
} from './types';

export interface TechnicalReportInput {
  sessionId: string;
  sessionMeta?: DiagnosticSessionMetadata | null;
  overallStatus: DiagnosticHealthStatus;
  snapshots: SubsystemHealthSnapshot[];
  findings: DiagnosticFinding[];
  traces: CorrelatedTrace[];
  timeline: DiagnosticEvent[];
  coverage: InstrumentationCoverageEntry[];
  privacyManifest: PrivacyManifest;
  droppedLiveEvents: number;
  settingsSnapshot: Record<string, unknown>;
  environment: Record<string, unknown>;
  generatedAtIso: string;
}

export function buildTechnicalReport(input: TechnicalReportInput): TechnicalReport {
  const {
    sessionId,
    sessionMeta,
    overallStatus,
    snapshots,
    findings,
    traces,
    timeline,
    coverage,
    privacyManifest,
    droppedLiveEvents,
    settingsSnapshot,
    environment,
    generatedAtIso,
  } = input;

  const now = Date.now();
  const startedAt = sessionMeta?.startedAt ?? (timeline[0]?.timestamp || now);
  const endedAt = sessionMeta?.endedAt ?? (timeline[timeline.length - 1]?.timestamp || now);
  const durationMs = Math.max(0, (endedAt ?? now) - startedAt);

  const pagesCovered = sessionMeta
    ? sessionMeta.pagesCovered
    : Array.from(
        new Set(
          timeline
            .map((e) => e.identifiers?.pageId)
            .filter((v): v is string => typeof v === 'string' && v.length > 0)
        )
      );

  const operationsCovered = sessionMeta
    ? sessionMeta.operationsCovered
    : Array.from(new Set(timeline.map((e) => `${e.subsystem}:${e.operation}`)));

  return {
    schemaVersion: '1.0',
    reportType: 'folio_script_system_diagnostic_report',
    generatedAt: generatedAtIso,
    metadata: {
      sessionId,
      sessionStatus: sessionMeta ? sessionMeta.status : 'snapshot',
      startedAt,
      endedAt,
      durationMs,
      eventCount: timeline.length,
      droppedEventCount: sessionMeta ? sessionMeta.droppedEventCount : droppedLiveEvents,
      truncated: sessionMeta ? sessionMeta.truncated : droppedLiveEvents > 0,
      pagesCovered,
      operationsCovered,
    },
    privacyManifest,
    overallStatus,
    systemHealth: snapshots,
    findings,
    correlatedTraces: traces,
    timeline,
    settingsSnapshot,
    instrumentationCoverage: coverage,
    environment,
  };
}
