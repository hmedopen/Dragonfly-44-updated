import { buildPrivacyManifest, DEFAULT_RECORDING_PRIVACY_OPTIONS, redactEventForPrivacy } from './privacyRedactor';
import { buildHumanReport } from './reportHuman';
import { buildTechnicalReport } from './reportTechnical';
import type { DiagnosticEngine } from './diagnosticEngine';
import type {
  DiagnosticSessionRecord,
  DualDiagnosticReport,
  RecordingPrivacyOptions,
} from './types';

export interface ReportEnvironmentCollector {
  getSettingsSnapshot?: () => Record<string, unknown>;
  getEnvironmentSnapshot?: () => Record<string, unknown>;
}

export function generateReportFromSession(
  engine: DiagnosticEngine,
  session: DiagnosticSessionRecord,
  collectors: ReportEnvironmentCollector = {}
): DualDiagnosticReport {
  const generatedAtIso = new Date().toISOString();
  const snapshots =
    session.systemSnapshots && session.systemSnapshots.length > 0
      ? session.systemSnapshots
      : engine.getAllSubsystemSnapshots();
  const overallStatus = engine.getOverallHealthStatus(snapshots);
  const traces = engine.reconstructCorrelatedTraces(session.events);
  const findings = snapshots.flatMap((s) => s.findings);
  const coverage = engine.getInstrumentationCoverage();
  const privacyManifest = buildPrivacyManifest(session.metadata.privacyOptions, session.events);

  const settingsSnapshot = collectors.getSettingsSnapshot ? collectors.getSettingsSnapshot() : {};
  const environment = collectors.getEnvironmentSnapshot ? collectors.getEnvironmentSnapshot() : {};

  const human = buildHumanReport({
    sessionId: session.metadata.sessionId,
    sessionMeta: session.metadata,
    overallStatus,
    snapshots,
    findings,
    traces,
    coverage,
    privacyManifest,
    droppedLiveEvents: session.metadata.droppedEventCount,
    generatedAtIso,
  });

  const technical = buildTechnicalReport({
    sessionId: session.metadata.sessionId,
    sessionMeta: session.metadata,
    overallStatus,
    snapshots,
    findings,
    traces,
    timeline: session.events,
    coverage,
    privacyManifest,
    droppedLiveEvents: session.metadata.droppedEventCount,
    settingsSnapshot,
    environment,
    generatedAtIso,
  });

  return { human, technical };
}

export function generateLiveSnapshotReport(
  engine: DiagnosticEngine,
  privacyOptions: RecordingPrivacyOptions = DEFAULT_RECORDING_PRIVACY_OPTIONS,
  collectors: ReportEnvironmentCollector = {}
): DualDiagnosticReport {
  const generatedAtIso = new Date().toISOString();
  const rawEvents = engine.eventBus.getEvents();
  const timeline = rawEvents.map((evt) => redactEventForPrivacy(evt, privacyOptions));
  const snapshots = engine.getAllSubsystemSnapshots();
  const overallStatus = engine.getOverallHealthStatus(snapshots);
  const traces = engine.reconstructCorrelatedTraces(timeline);
  const findings = engine.getAllFindings();
  const coverage = engine.getInstrumentationCoverage();
  const privacyManifest = buildPrivacyManifest(privacyOptions, timeline);
  const droppedLiveEvents = engine.eventBus.getDroppedLiveEventsCount();

  const settingsSnapshot = collectors.getSettingsSnapshot ? collectors.getSettingsSnapshot() : {};
  const environment = collectors.getEnvironmentSnapshot ? collectors.getEnvironmentSnapshot() : {};
  const sessionId = `live-snapshot-${Date.now()}`;

  const human = buildHumanReport({
    sessionId,
    sessionMeta: null,
    overallStatus,
    snapshots,
    findings,
    traces,
    coverage,
    privacyManifest,
    droppedLiveEvents,
    generatedAtIso,
  });

  const technical = buildTechnicalReport({
    sessionId,
    sessionMeta: null,
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
  });

  return { human, technical };
}
