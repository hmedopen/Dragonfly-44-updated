import { formatHealthStatusLabel } from './humanExplainer';
import type {
  CorrelatedTrace,
  DiagnosticFinding,
  DiagnosticHealthStatus,
  DiagnosticSessionMetadata,
  HumanReport,
  InstrumentationCoverageEntry,
  PrivacyManifest,
  SubsystemHealthSnapshot,
} from './types';

export interface HumanReportInput {
  sessionId: string;
  sessionMeta?: DiagnosticSessionMetadata | null;
  overallStatus: DiagnosticHealthStatus;
  snapshots: SubsystemHealthSnapshot[];
  findings: DiagnosticFinding[];
  traces: CorrelatedTrace[];
  coverage: InstrumentationCoverageEntry[];
  privacyManifest: PrivacyManifest;
  droppedLiveEvents: number;
  generatedAtIso: string;
}

export function buildHumanReport(input: HumanReportInput): HumanReport {
  const {
    sessionId,
    sessionMeta,
    overallStatus,
    snapshots,
    findings,
    traces,
    coverage,
    privacyManifest,
    droppedLiveEvents,
    generatedAtIso,
  } = input;

  const healthyCount = snapshots.filter((s) => s.status === 'healthy').length;
  const warningCount = snapshots.filter((s) => s.status === 'warning').length;
  const failedCount = snapshots.filter(
    (s) => s.status === 'error' || s.status === 'critical'
  ).length;
  const notCheckedCount = snapshots.filter((s) => s.status === 'not_checked').length;
  const unsupportedCount = snapshots.filter((s) => s.status === 'unsupported').length;

  const parts: string[] = [];
  parts.push(
    `Overall application status is ${formatHealthStatusLabel(overallStatus).toUpperCase()} across ${snapshots.length} registered subsystem(s): ${healthyCount} verified healthy, ${warningCount} with warnings, ${failedCount} failing, ${notCheckedCount} not yet checked, and ${unsupportedCount} unsupported in the current runtime.`
  );

  if (sessionMeta) {
    const durationSec = sessionMeta.endedAt
      ? ((sessionMeta.endedAt - sessionMeta.startedAt) / 1000).toFixed(1)
      : 'active';
    parts.push(
      `Session "${sessionMeta.label}" recorded ${sessionMeta.eventCount} event(s) over ${durationSec}s covering ${sessionMeta.pagesCovered.length} page(s) and ${sessionMeta.operationsCovered.length} distinct operation(s).`
    );
    if (sessionMeta.droppedEventCount > 0) {
      parts.push(
        `Warning: ${sessionMeta.droppedEventCount} event(s) were dropped because the session reached its ${sessionMeta.maxEventsCap}-event cap.`
      );
    }
  } else if (droppedLiveEvents > 0) {
    parts.push(
      `Note: ${droppedLiveEvents} older live buffer event(s) rolled off the in-memory ring buffer before this snapshot.`
    );
  }

  if (notCheckedCount > 0) {
    parts.push(
      `${notCheckedCount} subsystem(s) have no diagnostic evidence yet and are explicitly reported as Not Checked rather than healthy.`
    );
  }

  const executiveSummary = parts.join(' ');

  const subsystemSummaries = snapshots.map((s) => ({
    subsystem: s.subsystem,
    name: s.name,
    status: s.status,
    summary: s.summary,
    findingCount: s.findings.length,
  }));

  const operationNarratives = traces.slice(0, 40).map((t) => ({
    correlationId: t.correlationId,
    title: `${t.rootSubsystem} // ${t.rootOperation}`,
    outcome: t.outcome,
    narrative: t.summary,
  }));

  const failureAnalyses: HumanReport['failureAnalyses'] = [];

  for (const trace of traces) {
    if (trace.outcome === 'failed' || trace.outcome === 'degraded') {
      failureAnalyses.push({
        findingOrTraceId: trace.correlationId,
        origin: trace.rootCauseSummary || `${trace.rootSubsystem} (${trace.rootOperation})`,
        consequence: trace.summary,
        affectedComponents: trace.affectedComponents,
        explanation: trace.summary,
      });
    }
  }

  for (const f of findings) {
    const alreadyCoveredByTrace =
      f.correlationId && failureAnalyses.some((fa) => fa.findingOrTraceId === f.correlationId);
    if (!alreadyCoveredByTrace) {
      failureAnalyses.push({
        findingOrTraceId: f.findingId,
        origin: `${f.subsystem} (${f.code})`,
        consequence: f.impact || f.explanation,
        affectedComponents: [f.subsystem],
        explanation: `${f.title}: ${f.explanation}${f.remediation ? ` Suggested action: ${f.remediation}` : ''}`,
      });
    }
  }

  const coverageNotes = coverage.map(
    (c) =>
      `${c.name} (${c.subsystem}): ${c.tier.replace(/_/g, ' ')} — ${
        c.capabilities.map((cap) => `${cap.capability} [${cap.tier}]`).join('; ') || 'No declared capabilities.'
      }`
  );

  const privacyDisclosure = [...privacyManifest.notes];
  if (privacyManifest.totalRedactedFields > 0) {
    privacyDisclosure.push(
      `Total scrubbed/redacted field occurrences in recorded events: ${privacyManifest.totalRedactedFields}.`
    );
  }

  const mdLines: string[] = [];
  mdLines.push(`# Folio Script Diagnostic Report`);
  mdLines.push(`- **Generated:** ${generatedAtIso}`);
  mdLines.push(`- **Session ID:** ${sessionId}`);
  mdLines.push(`- **Overall Status:** ${formatHealthStatusLabel(overallStatus)}`);
  mdLines.push('');
  mdLines.push(`## Executive Summary`);
  mdLines.push(executiveSummary);
  mdLines.push('');
  mdLines.push(`## Subsystem Health`);
  for (const sub of subsystemSummaries) {
    mdLines.push(
      `- **${sub.name}** (\`${sub.subsystem}\`) — **${formatHealthStatusLabel(sub.status)}** (${sub.findingCount} finding(s)): ${sub.summary}`
    );
  }
  mdLines.push('');
  mdLines.push(`## Failures & Degraded Operations`);
  if (failureAnalyses.length === 0) {
    mdLines.push(`- No failures or degraded operations were recorded within the observed evidence.`);
  } else {
    for (const fa of failureAnalyses) {
      mdLines.push(`- **${fa.origin}** (${fa.findingOrTraceId}): ${fa.explanation}`);
      if (fa.affectedComponents.length > 0) {
        mdLines.push(`  - Affected: ${fa.affectedComponents.join(', ')}`);
      }
    }
  }
  mdLines.push('');
  mdLines.push(`## Operation Timeline Narratives (${operationNarratives.length})`);
  if (operationNarratives.length === 0) {
    mdLines.push(`- No correlated operations recorded yet.`);
  } else {
    for (const op of operationNarratives) {
      mdLines.push(`- **${op.title}** [\`${op.outcome}\`] (${op.correlationId}): ${op.narrative}`);
    }
  }
  mdLines.push('');
  mdLines.push(`## Instrumentation Coverage & Known Gaps`);
  for (const note of coverageNotes) {
    mdLines.push(`- ${note}`);
  }
  mdLines.push('');
  mdLines.push(`## Privacy & Export Disclosure`);
  for (const disc of privacyDisclosure) {
    mdLines.push(`- ${disc}`);
  }

  return {
    title: 'Folio Script System Diagnostic Report',
    generatedAt: generatedAtIso,
    sessionId,
    overallStatus,
    executiveSummary,
    subsystemSummaries,
    operationNarratives,
    failureAnalyses,
    coverageNotes,
    privacyDisclosure,
    markdown: mdLines.join('\n'),
  };
}
