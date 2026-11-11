import { DiagnosticEventBus } from './eventBus';
import { explainSubsystemSnapshot } from './humanExplainer';
import { SessionRecorder } from './sessionRecorder';
import { createDefaultDiagnosticStorageDriver, type IDiagnosticStorageDriver } from './diagnosticStorage';
import { SystemRegistry } from './systemRegistry';
import type {
  ActiveOperationRecord,
  CheckSafetyLevel,
  CorrelatedTrace,
  DiagnosticCheckResult,
  DiagnosticEvent,
  DiagnosticEventInput,
  DiagnosticFinding,
  DiagnosticHealthStatus,
  DiagnosticSessionMetadata,
  DiagnosticSessionRecord,
  InspectorContext,
  InstrumentationCoverageEntry,
  RecordingPrivacyOptions,
  SubsystemHealthSnapshot,
  SubsystemId,
  SubsystemInspector,
} from './types';
import { describeTraceOutcome } from './humanExplainer';

export interface DiagnosticEngineOptions {
  maxBufferSize?: number;
  maxEventsPerSession?: number;
  flushIntervalMs?: number;
  storageDriver?: IDiagnosticStorageDriver;
  contextProvider?: () => Partial<InspectorContext>;
}

export type EngineStateListener = () => void;

export class DiagnosticEngine {
  public readonly registry: SystemRegistry;
  public readonly eventBus: DiagnosticEventBus;
  public readonly storage: IDiagnosticStorageDriver;
  public readonly recorder: SessionRecorder;

  private readonly contextProvider?: () => Partial<InspectorContext>;
  private readonly checkResultsBySubsystem = new Map<SubsystemId, Map<string, DiagnosticCheckResult>>();
  private readonly findingsBySubsystem = new Map<SubsystemId, DiagnosticFinding[]>();
  private readonly activeOperations = new Map<string, ActiveOperationRecord>();
  private readonly stateListeners = new Set<EngineStateListener>();
  private lastDiagnosticRunAt: number | null = null;
  private busUnsubscribe: (() => void) | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: DiagnosticEngineOptions = {}) {
    this.registry = new SystemRegistry();
    this.storage = options.storageDriver ?? createDefaultDiagnosticStorageDriver();
    this.contextProvider = options.contextProvider;

    this.eventBus = new DiagnosticEventBus({
      maxBufferSize: options.maxBufferSize ?? 1000,
      onInternalDrop: () => {
        this.scheduleStateNotify();
      },
    });

    this.recorder = new SessionRecorder({
      storage: this.storage,
      maxEventsPerSession: options.maxEventsPerSession ?? 5000,
      flushIntervalMs: options.flushIntervalMs ?? 250,
      getSystemSnapshots: () => this.getAllSubsystemSnapshots(),
      onRecorderWarning: (message, err) => {
        this.eventBus.record({
          subsystem: 'app-core',
          component: 'SessionRecorder',
          operation: 'recorderFlush',
          eventType: 'error',
          severity: 'warning',
          status: 'degraded',
          explanation: message,
          error: err,
        });
      },
    });

    this.busUnsubscribe = this.eventBus.subscribe((event) => {
      this.handleBusEvent(event);
    });
  }

  public dispose(): void {
    if (this.busUnsubscribe) {
      this.busUnsubscribe();
      this.busUnsubscribe = null;
    }
    if (this.notifyTimer !== null) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.stateListeners.clear();
  }

  public subscribeState(listener: EngineStateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private scheduleStateNotify(): void {
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const listener of this.stateListeners) {
        try {
          listener();
        } catch {
          // Isolate UI listener errors
        }
      }
    }, 50);
  }

  public notifyStateImmediate(): void {
    for (const listener of this.stateListeners) {
      try {
        listener();
      } catch {
        // Isolate listener error
      }
    }
  }

  public registerInspector(inspector: SubsystemInspector): void {
    this.registry.register(inspector);
    this.scheduleStateNotify();
  }

  public emit(input: DiagnosticEventInput): DiagnosticEvent {
    const event = this.eventBus.record(input);
    // Forward synchronously to active session recorder so no events are lost on quick stop/crash
    if (this.recorder.isRecording()) {
      this.recorder.recordEvent(event);
    }
    this.updateActiveOperations(event);
    this.recordRuntimeFailureAsFinding(event);
    this.scheduleStateNotify();
    return event;
  }

  private handleBusEvent(_event: DiagnosticEvent): void {
    this.scheduleStateNotify();
  }

  private updateActiveOperations(event: DiagnosticEvent): void {
    const key = event.correlationId || `${event.subsystem}:${event.component}:${event.operation}`;
    if (event.status === 'running') {
      this.activeOperations.set(key, {
        correlationId: key,
        subsystem: event.subsystem,
        component: event.component,
        operation: event.operation,
        startedAt: event.timestamp,
        lastUpdatedAt: event.timestamp,
        identifiers: event.identifiers,
        explanation: event.explanation,
      });
    } else if (
      event.status === 'succeeded' ||
      event.status === 'failed' ||
      event.status === 'cancelled' ||
      event.status === 'degraded'
    ) {
      if (event.correlationId) {
        this.activeOperations.delete(event.correlationId);
      } else {
        this.activeOperations.delete(key);
      }
    }
  }

  private recordRuntimeFailureAsFinding(event: DiagnosticEvent): void {
    if (event.eventType === 'check') return;
    if (event.severity !== 'warning' && event.severity !== 'error' && event.severity !== 'critical') {
      return;
    }

    const list = this.findingsBySubsystem.get(event.subsystem) || [];
    const finding: DiagnosticFinding = {
      findingId: `rt-${event.eventId}`,
      subsystem: event.subsystem,
      code: `${event.subsystem.toUpperCase()}_${event.operation.toUpperCase()}`,
      severity: event.severity,
      title: `${event.component}: ${event.operation}`,
      explanation: event.explanation,
      evidence: {
        status: event.status,
        ...(event.identifiers || {}),
        ...(event.error ? { error: event.error.message } : {}),
      },
      correlationId: event.correlationId,
      timestamp: event.timestamp,
    };

    list.unshift(finding);
    if (list.length > 50) {
      list.pop();
    }
    this.findingsBySubsystem.set(event.subsystem, list);
  }

  public getActiveOperations(): ActiveOperationRecord[] {
    return Array.from(this.activeOperations.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  public getLastDiagnosticRunAt(): number | null {
    return this.lastDiagnosticRunAt;
  }

  public startRecording(options?: {
    label?: string;
    privacyOptions?: RecordingPrivacyOptions;
  }): DiagnosticSessionMetadata {
    const meta = this.recorder.startSession(options);
    this.eventBus.setActiveSessionId(meta.sessionId);
    this.eventBus.setPrivacyOptions(meta.privacyOptions);
    this.emit({
      subsystem: 'app-core',
      component: 'DiagnosticEngine',
      operation: 'recordingSession',
      eventType: 'lifecycle',
      severity: 'info',
      status: 'succeeded',
      identifiers: { sessionId: meta.sessionId },
      payload: {
        includeExtractedText: meta.privacyOptions.includeExtractedText,
        includeDetailedPayloads: meta.privacyOptions.includeDetailedPayloads,
      },
      explanation: `Started diagnostic recording session "${meta.label}".`,
    });
    this.notifyStateImmediate();
    return meta;
  }

  public async stopRecording(): Promise<DiagnosticSessionRecord> {
    const active = this.recorder.getActiveMetadata();
    if (active) {
      this.emit({
        subsystem: 'app-core',
        component: 'DiagnosticEngine',
        operation: 'recordingSession',
        eventType: 'lifecycle',
        severity: 'info',
        status: 'succeeded',
        identifiers: { sessionId: active.sessionId },
        explanation: `Stopped diagnostic recording session "${active.label}".`,
      });
    }
    this.eventBus.flushPendingNotifications();
    const record = await this.recorder.stopSession();
    this.eventBus.setActiveSessionId(null);
    this.notifyStateImmediate();
    return record;
  }

  private buildInspectorContext(): InspectorContext {
    const extra = this.contextProvider ? this.contextProvider() : {};
    return {
      now: Date.now(),
      recentEvents: this.eventBus.getEvents(),
      ...extra,
    };
  }

  public async runCheck(
    subsystemId: SubsystemId,
    checkId: string
  ): Promise<DiagnosticCheckResult> {
    const inspector = this.registry.get(subsystemId);
    if (!inspector) {
      throw new Error(`Unknown diagnostic subsystem: ${subsystemId}`);
    }
    const def = inspector.checks.find((c) => c.checkId === checkId);
    if (!def) {
      throw new Error(`Unknown check "${checkId}" for subsystem "${subsystemId}".`);
    }

    const start = Date.now();
    const correlationId = `chk-${subsystemId}-${checkId}-${start}`;

    let result: DiagnosticCheckResult;
    try {
      const ctx = this.buildInspectorContext();
      result = await inspector.runCheck(checkId, ctx);
    } catch (err) {
      const durationMs = Math.max(0, Date.now() - start);
      const msg = err instanceof Error ? err.message : String(err);
      result = {
        checkId: def.checkId,
        subsystem: subsystemId,
        name: def.name,
        safety: def.safety,
        status: 'error',
        durationMs,
        timestamp: Date.now(),
        summary: `Diagnostic check "${def.name}" threw an unhandled exception: ${msg}`,
        findings: [
          {
            findingId: `chk-err-${correlationId}`,
            subsystem: subsystemId,
            checkId: def.checkId,
            code: 'CHECK_EXECUTION_ERROR',
            severity: 'error',
            title: `${def.name} failed`,
            explanation: `The diagnostic check encountered an error during execution: ${msg}`,
            timestamp: Date.now(),
          },
        ],
      };
    }

    let checkMap = this.checkResultsBySubsystem.get(subsystemId);
    if (!checkMap) {
      checkMap = new Map();
      this.checkResultsBySubsystem.set(subsystemId, checkMap);
    }
    checkMap.set(checkId, result);
    this.lastDiagnosticRunAt = Date.now();

    // Merge check findings while preserving non-check runtime findings
    const existing = (this.findingsBySubsystem.get(subsystemId) || []).filter(
      (f) => f.checkId !== checkId
    );
    this.findingsBySubsystem.set(subsystemId, [...result.findings, ...existing].slice(0, 80));

    this.emit({
      subsystem: subsystemId,
      component: inspector.name,
      operation: `check:${checkId}`,
      eventType: 'check',
      severity:
        result.status === 'critical'
          ? 'critical'
          : result.status === 'error'
          ? 'error'
          : result.status === 'warning'
          ? 'warning'
          : result.status === 'healthy'
          ? 'healthy'
          : 'info',
      status:
        result.status === 'unsupported'
          ? 'unsupported'
          : result.status === 'error' || result.status === 'critical'
          ? 'failed'
          : result.status === 'warning'
          ? 'degraded'
          : 'succeeded',
      durationMs: result.durationMs,
      correlationId,
      identifiers: { checkId: result.checkId, safety: result.safety },
      payload: {
        safety: result.safety,
        findingsCount: result.findings.length,
        metrics: result.metrics,
      },
      explanation: result.summary,
    });

    this.notifyStateImmediate();
    return result;
  }

  public async runSubsystemDiagnostics(
    subsystemId: SubsystemId,
    options?: {
      allowedSafety?: CheckSafetyLevel[];
      includeOptionalTests?: boolean;
    }
  ): Promise<DiagnosticCheckResult[]> {
    const inspector = this.registry.get(subsystemId);
    if (!inspector) {
      throw new Error(`Unknown diagnostic subsystem: ${subsystemId}`);
    }

    const allowed = new Set<CheckSafetyLevel>(
      options?.allowedSafety ?? (options?.includeOptionalTests ? ['read_only', 'controlled_test'] : ['read_only'])
    );

    const targets = inspector.checks.filter(
      (c) => allowed.has(c.safety) && (options?.includeOptionalTests || c.defaultEnabled)
    );

    const results: DiagnosticCheckResult[] = [];
    for (const check of targets) {
      results.push(await this.runCheck(subsystemId, check.checkId));
    }
    return results;
  }

  public async runAllDiagnostics(options?: {
    allowedSafety?: CheckSafetyLevel[];
    includeOptionalTests?: boolean;
  }): Promise<DiagnosticCheckResult[]> {
    const results: DiagnosticCheckResult[] = [];
    for (const inspector of this.registry.list()) {
      const subResults = await this.runSubsystemDiagnostics(inspector.id, options);
      results.push(...subResults);
    }
    return results;
  }

  public getSubsystemSnapshot(subsystemId: SubsystemId): SubsystemHealthSnapshot {
    const inspector = this.registry.get(subsystemId);
    if (!inspector) {
      throw new Error(`Unknown diagnostic subsystem: ${subsystemId}`);
    }

    const events = this.eventBus.getEvents().filter((e) => e.subsystem === subsystemId);
    const checkMap = this.checkResultsBySubsystem.get(subsystemId);
    const checkResults = checkMap ? Array.from(checkMap.values()) : [];
    const findings = [...(this.findingsBySubsystem.get(subsystemId) || [])];
    const activeOpsCount = Array.from(this.activeOperations.values()).filter(
      (op) => op.subsystem === subsystemId
    ).length;

    if (inspector.evaluateHealth) {
      return inspector.evaluateHealth({
        recentEvents: events,
        lastCheckResults: checkResults,
        activeOperationsCount: activeOpsCount,
      });
    }

    const hasCheckEvidence = checkResults.length > 0;
    const verifiedSuccessEvents = events.some(
      (e) => e.status === 'succeeded' && (e.severity === 'healthy' || e.severity === 'info')
    );
    const hasEvidence = hasCheckEvidence || events.length > 0;

    let status: DiagnosticHealthStatus = 'not_checked';

    const hasCritical =
      checkResults.some((c) => c.status === 'critical') ||
      findings.some((f) => f.severity === 'critical');
    const hasError =
      checkResults.some((c) => c.status === 'error') ||
      findings.some((f) => f.severity === 'error');
    const hasWarning =
      checkResults.some((c) => c.status === 'warning') ||
      findings.some((f) => f.severity === 'warning');

    if (hasCritical) {
      status = 'critical';
    } else if (hasError) {
      status = 'error';
    } else if (hasWarning) {
      status = 'warning';
    } else if (activeOpsCount > 0) {
      status = 'running';
    } else if (
      hasCheckEvidence &&
      checkResults.every((c) => c.status === 'unsupported')
    ) {
      status = 'unsupported';
    } else if (
      checkResults.some((c) => c.status === 'healthy') ||
      verifiedSuccessEvents
    ) {
      status = 'healthy';
    } else {
      status = 'not_checked';
    }

    const lastCheckedAt =
      checkResults.length > 0
        ? Math.max(...checkResults.map((c) => c.timestamp))
        : null;

    const base: SubsystemHealthSnapshot = {
      subsystem: inspector.id,
      name: inspector.name,
      description: inspector.description,
      coverageLevel: inspector.coverageLevel,
      status,
      hasEvidence,
      lastCheckedAt,
      activeOperationsCount: activeOpsCount,
      findings,
      checkResults,
      recentEventCount: events.length,
      summary: '',
    };
    base.summary = explainSubsystemSnapshot(base);
    return base;
  }

  public getAllSubsystemSnapshots(): SubsystemHealthSnapshot[] {
    return this.registry.list().map((ins) => this.getSubsystemSnapshot(ins.id));
  }

  public getOverallHealthStatus(snapshots = this.getAllSubsystemSnapshots()): DiagnosticHealthStatus {
    if (snapshots.some((s) => s.status === 'critical')) return 'critical';
    if (snapshots.some((s) => s.status === 'error')) return 'error';
    if (snapshots.some((s) => s.status === 'warning')) return 'warning';
    if (snapshots.some((s) => s.status === 'running')) return 'running';
    if (snapshots.some((s) => s.status === 'healthy')) return 'healthy';
    if (snapshots.length > 0 && snapshots.every((s) => s.status === 'unsupported')) return 'unsupported';
    return 'not_checked';
  }

  public getAllFindings(): DiagnosticFinding[] {
    const all: DiagnosticFinding[] = [];
    for (const list of this.findingsBySubsystem.values()) {
      all.push(...list);
    }
    return all.sort((a, b) => b.timestamp - a.timestamp);
  }

  public clearRuntimeFindings(): void {
    this.findingsBySubsystem.clear();
    this.checkResultsBySubsystem.clear();
    this.activeOperations.clear();
    this.lastDiagnosticRunAt = null;
    this.eventBus.clearBuffer();
    this.notifyStateImmediate();
  }

  public getInstrumentationCoverage(): InstrumentationCoverageEntry[] {
    return this.registry.list().map((ins) => ({
      subsystem: ins.id,
      name: ins.name,
      tier: ins.coverageLevel,
      capabilities: ins.capabilities,
    }));
  }

  public reconstructCorrelatedTraces(events = this.eventBus.getEvents()): CorrelatedTrace[] {
    const groups = new Map<string, DiagnosticEvent[]>();
    for (const evt of events) {
      if (!evt.correlationId) continue;
      const list = groups.get(evt.correlationId) || [];
      list.push(evt);
      groups.set(evt.correlationId, list);
    }

    const traces: CorrelatedTrace[] = [];
    for (const [correlationId, groupEvents] of groups.entries()) {
      const sorted = [...groupEvents].sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const failedEvt = sorted.find(
        (e) => e.status === 'failed' || e.severity === 'error' || e.severity === 'critical'
      );
      const degradedEvt = sorted.find((e) => e.status === 'degraded' || e.severity === 'warning');
      const cancelledEvt = sorted.find((e) => e.status === 'cancelled');
      const runningOnly = sorted.every((e) => e.status === 'running');

      const outcome: CorrelatedTrace['outcome'] = failedEvt
        ? 'failed'
        : cancelledEvt
        ? 'cancelled'
        : degradedEvt
        ? 'degraded'
        : runningOnly
        ? 'running'
        : 'succeeded';

      const subsystemsInvolved = Array.from(new Set(sorted.map((e) => e.subsystem)));
      const affectedComponents = Array.from(new Set(sorted.map((e) => `${e.subsystem}/${e.component}`)));

      traces.push({
        correlationId,
        rootSubsystem: first.subsystem,
        rootOperation: first.operation,
        startedAt: first.timestamp,
        endedAt: last.timestamp,
        durationMs: Math.max(0, last.timestamp - first.timestamp),
        outcome,
        subsystemsInvolved,
        events: sorted,
        ...(failedEvt
          ? {
              rootCauseEventId: failedEvt.eventId,
              rootCauseSummary: `${failedEvt.component} (${failedEvt.operation}): ${failedEvt.explanation}${
                failedEvt.error?.message ? ` — ${failedEvt.error.message}` : ''
              }`,
            }
          : {}),
        affectedComponents,
        summary: describeTraceOutcome(sorted),
      });
    }

    return traces.sort((a, b) => b.startedAt - a.startedAt);
  }
}
