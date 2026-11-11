import { registerDiagnosticTapListener } from '../../lib/diagnosticTap';
import { settingsRegistrySnapshot } from './settingsSnapshotHelper';
import { attachRuntimeErrorAdapters } from './adapters/runtimeErrorAdapter';
import { attachStoreAndServiceAdapters } from './adapters/storeAdapter';
import { DiagnosticEngine } from './diagnosticEngine';
import { registerBuiltInInspectors } from './inspectors/index';
import { generateLiveSnapshotReport, generateReportFromSession } from './reportGenerator';
import { useWorkbenchStore } from '../../store/workbenchStore';
import type { DiagnosticSessionRecord, DualDiagnosticReport, RecordingPrivacyOptions } from './types';
import { fetchElectronRuntimeInfo } from './adapters/electronBridge';

let singletonEngine: DiagnosticEngine | null = null;
let initialized = false;
let cleanupCallbacks: Array<() => void> = [];
let cachedElectronInfo: Record<string, unknown> | null = null;

export function getSystemDiagnosticsEngine(): DiagnosticEngine {
  if (!singletonEngine) {
    singletonEngine = new DiagnosticEngine({
      maxBufferSize: 1000,
      maxEventsPerSession: 5000,
      flushIntervalMs: 250,
      contextProvider: () => {
        const st = useWorkbenchStore.getState();
        return {
          activeProjectId: st.activeFolderId,
          activeChapterId: st.activeChapterId,
          activePageId: st.activePageId,
        };
      },
    });
    registerBuiltInInspectors(singletonEngine);
  }
  return singletonEngine;
}

export function bootstrapSystemDiagnostics(): DiagnosticEngine {
  const engine = getSystemDiagnosticsEngine();
  if (initialized) return engine;
  initialized = true;

  const unsubTap = registerDiagnosticTapListener((tapEvent) => {
    engine.emit({
      subsystem: tapEvent.subsystem,
      component: tapEvent.component,
      operation: tapEvent.operation,
      eventType: tapEvent.eventType,
      severity: tapEvent.severity,
      status: tapEvent.status,
      durationMs: tapEvent.durationMs,
      correlationId: tapEvent.correlationId,
      parentEventId: tapEvent.parentEventId,
      identifiers: tapEvent.identifiers,
      payload: tapEvent.payload,
      explanation: tapEvent.explanation,
      error: tapEvent.error,
      timestamp: tapEvent.timestamp,
    });
  });

  const unsubStore = attachStoreAndServiceAdapters(engine);
  const unsubRuntime = attachRuntimeErrorAdapters(engine);
  cleanupCallbacks = [unsubTap, unsubStore, unsubRuntime];

  // Warm Electron runtime info asynchronously for report environment blocks (no-op in browser)
  void fetchElectronRuntimeInfo()
    .then((info) => {
      if (info) cachedElectronInfo = info as unknown as Record<string, unknown>;
    })
    .catch(() => {});

  // Recover any interrupted recording session left behind by an abrupt reload
  void engine.recorder.recoverInterruptedSession().then((recovered) => {
    if (recovered) {
      engine.emit({
        subsystem: 'app-core',
        component: 'SessionRecorder',
        operation: 'recoverSession',
        eventType: 'lifecycle',
        severity: 'warning',
        status: 'degraded',
        identifiers: { sessionId: recovered.metadata.sessionId },
        explanation: `Recovered an interrupted diagnostic session (${recovered.metadata.eventCount} event(s)) from local checkpoint.`,
      });
    }
  });

  engine.emit({
    subsystem: 'app-core',
    component: 'DiagnosticBootstrap',
    operation: 'initialize',
    eventType: 'lifecycle',
    severity: 'info',
    status: 'succeeded',
    explanation: 'System Diagnostics engine initialized with 10 registered subsystem inspectors (all initially Not Checked).',
  });

  return engine;
}

export function teardownSystemDiagnostics(): void {
  for (const fn of cleanupCallbacks) {
    try {
      fn();
    } catch {
      // Ignore cleanup errors
    }
  }
  cleanupCallbacks = [];
  initialized = false;
  if (singletonEngine) {
    singletonEngine.dispose();
    singletonEngine = null;
  }
}

export function getReportCollectors() {
  return {
    getSettingsSnapshot: () => settingsRegistrySnapshot(),
    getEnvironmentSnapshot: () => ({
      runtime: typeof window !== 'undefined' && (window as { folioScript?: unknown }).folioScript ? 'electron' : 'browser',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : null,
      viewport:
        typeof window !== 'undefined'
          ? { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio }
          : null,
      electron: cachedElectronInfo,
    }),
  };
}

export function buildDualReportForSession(session: DiagnosticSessionRecord): DualDiagnosticReport {
  return generateReportFromSession(getSystemDiagnosticsEngine(), session, getReportCollectors());
}

export function buildDualReportForLiveSnapshot(privacy: RecordingPrivacyOptions): DualDiagnosticReport {
  return generateLiveSnapshotReport(getSystemDiagnosticsEngine(), privacy, getReportCollectors());
}
