import type { DiagnosticEvent, DiagnosticHealthStatus, SubsystemHealthSnapshot } from './types';

export function formatHealthStatusLabel(status: DiagnosticHealthStatus): string {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'warning':
      return 'Warning';
    case 'error':
      return 'Error';
    case 'critical':
      return 'Critical';
    case 'running':
      return 'Running';
    case 'unsupported':
      return 'Unsupported';
    case 'not_checked':
    default:
      return 'Not Checked';
  }
}

export function explainSubsystemSnapshot(snapshot: SubsystemHealthSnapshot): string {
  if (!snapshot.hasEvidence && snapshot.status === 'not_checked') {
    return `${snapshot.name} has not been inspected yet. Run diagnostics or perform an operation in this subsystem to verify health.`;
  }

  if (snapshot.status === 'unsupported') {
    return `${snapshot.name} cannot run its checks in the current runtime environment.`;
  }

  const errorCount = snapshot.findings.filter(
    (f) => f.severity === 'error' || f.severity === 'critical'
  ).length;
  const warningCount = snapshot.findings.filter((f) => f.severity === 'warning').length;

  if (snapshot.status === 'critical' || snapshot.status === 'error') {
    return `${snapshot.name} reported ${errorCount} failing issue(s)${
      warningCount > 0 ? ` and ${warningCount} warning(s)` : ''
    }. Inspect findings to trace the origin.`;
  }

  if (snapshot.status === 'warning') {
    return `${snapshot.name} is operating with ${warningCount} warning(s). Core execution succeeded, but degraded or partial behavior was observed.`;
  }

  if (snapshot.status === 'running') {
    return `${snapshot.name} currently has ${snapshot.activeOperationsCount} active operation(s) in flight.`;
  }

  const passedChecks = snapshot.checkResults.filter((c) => c.status === 'healthy').length;
  if (passedChecks > 0) {
    return `${snapshot.name} passed ${passedChecks} diagnostic check(s)${
      snapshot.findings.length > 0
        ? ` with ${snapshot.findings.length} preserved informational/historical note(s)`
        : ''
    }.`;
  }

  return `${snapshot.name} recorded verified successful activity with no unresolved errors or warnings.`;
}

export function describeTraceOutcome(events: DiagnosticEvent[]): string {
  if (events.length === 0) {
    return 'No events were captured for this trace.';
  }

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const failed = sorted.find(
    (e) => e.status === 'failed' || e.severity === 'error' || e.severity === 'critical'
  );
  const degraded = sorted.find((e) => e.status === 'degraded' || e.severity === 'warning');
  const cancelled = sorted.find((e) => e.status === 'cancelled');

  const durationMs = Math.max(0, last.timestamp - first.timestamp);
  const stages = sorted.map((e) => e.explanation).filter(Boolean);

  if (failed) {
    return `${first.operation} failed in ${failed.subsystem} (${failed.component}) after ${durationMs}ms: ${failed.explanation}${
      failed.error?.message ? ` Error: ${failed.error.message}` : ''
    }`;
  }

  if (cancelled) {
    return `${first.operation} was cancelled after ${durationMs}ms in ${cancelled.subsystem}: ${cancelled.explanation}`;
  }

  if (degraded) {
    return `${first.operation} completed in ${durationMs}ms in a degraded state (${degraded.subsystem}): ${degraded.explanation}`;
  }

  if (stages.length === 1) {
    return stages[0];
  }

  return `${first.operation} progressed across ${sorted.length} recorded stage(s) in ${durationMs}ms. Latest: ${last.explanation}`;
}
