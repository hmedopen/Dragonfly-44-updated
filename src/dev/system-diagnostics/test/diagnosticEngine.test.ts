import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticEngine } from '../diagnosticEngine.ts';
import { InMemoryDiagnosticStorageDriver } from '../diagnosticStorage.ts';
import type { SubsystemInspector } from '../types.ts';

function createCustomInspector(id: string, overrides?: Partial<SubsystemInspector>): SubsystemInspector {
  return {
    id,
    name: `Custom ${id}`,
    description: 'Test inspector plugin',
    coverageLevel: 'full',
    capabilities: [{ capability: 'Test probe', tier: 'read_only_check', notes: 'Test plugin' }],
    checks: [
      {
        checkId: 'safe-probe',
        name: 'Safe Probe',
        description: 'Read-only check',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'controlled-probe',
        name: 'Controlled Probe',
        description: 'Controlled test',
        safety: 'controlled_test',
        defaultEnabled: false,
      },
      {
        checkId: 'mutating-probe',
        name: 'Mutating Probe',
        description: 'Should never run by default',
        safety: 'potentially_modifying',
        defaultEnabled: false,
      },
    ],
    async runCheck(checkId) {
      return {
        checkId,
        subsystem: id,
        name: checkId,
        safety:
          checkId === 'safe-probe'
            ? 'read_only'
            : checkId === 'controlled-probe'
            ? 'controlled_test'
            : 'potentially_modifying',
        status: 'healthy',
        durationMs: 2,
        timestamp: Date.now(),
        summary: `${checkId} passed.`,
        findings: [],
      };
    },
    ...overrides,
  };
}

test('DiagnosticEngine: subsystems start as not_checked without evidence (no false green)', () => {
  const engine = new DiagnosticEngine({ storageDriver: new InMemoryDiagnosticStorageDriver() });
  engine.registerInspector(createCustomInspector('app-core'));
  engine.registerInspector(createCustomInspector('scanning-ocr'));

  const snapshots = engine.getAllSubsystemSnapshots();
  assert.equal(snapshots.length, 2);
  for (const snap of snapshots) {
    assert.equal(snap.status, 'not_checked');
    assert.equal(snap.hasEvidence, false);
  }
  assert.equal(engine.getOverallHealthStatus(snapshots), 'not_checked');
  engine.dispose();
});

test('DiagnosticEngine: domain-agnostic inspector plugin extensibility & default read-only check gating', async () => {
  const engine = new DiagnosticEngine({ storageDriver: new InMemoryDiagnosticStorageDriver() });
  const executedChecks: string[] = [];

  engine.registerInspector(
    createCustomInspector('custom-hardware-bus', {
      async runCheck(checkId) {
        executedChecks.push(checkId);
        return {
          checkId,
          subsystem: 'custom-hardware-bus',
          name: checkId,
          safety: checkId === 'safe-probe' ? 'read_only' : 'potentially_modifying',
          status: 'healthy',
          durationMs: 1,
          timestamp: Date.now(),
          summary: 'Checked custom plugin cleanly.',
          findings: [
            {
              findingId: `f-${checkId}`,
              subsystem: 'custom-hardware-bus',
              checkId,
              code: 'CUSTOM_NOTE',
              severity: 'info',
              title: 'Informational telemetry recorded',
              explanation: 'Individual findings remain preserved even when overall check passes.',
              timestamp: Date.now(),
            },
          ],
        };
      },
    })
  );

  await engine.runAllDiagnostics();
  assert.deepEqual(executedChecks, ['safe-probe']);

  const snap = engine.getSubsystemSnapshot('custom-hardware-bus');
  assert.equal(snap.status, 'healthy');
  assert.equal(snap.hasEvidence, true);
  assert.equal(snap.findings.length, 1);
  assert.equal(snap.findings[0].code, 'CUSTOM_NOTE');

  engine.dispose();
});

test('DiagnosticEngine: isolates throwing inspector checks and turns exception into structured finding', async () => {
  const engine = new DiagnosticEngine({ storageDriver: new InMemoryDiagnosticStorageDriver() });
  engine.registerInspector(
    createCustomInspector('app-core', {
      async runCheck() {
        throw new Error('Simulated inspector crash');
      },
    })
  );

  const result = await engine.runCheck('app-core', 'safe-probe');
  assert.equal(result.status, 'error');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, 'CHECK_EXECUTION_ERROR');

  const snap = engine.getSubsystemSnapshot('app-core');
  assert.equal(snap.status, 'error');
  engine.dispose();
});

test('DiagnosticEngine: ring-buffer eviction tracks droppedLiveEvents and keeps monotonic seq', () => {
  const engine = new DiagnosticEngine({
    storageDriver: new InMemoryDiagnosticStorageDriver(),
    maxBufferSize: 50,
  });

  const seqs: number[] = [];
  for (let i = 0; i < 60; i++) {
    const ev = engine.emit({
      subsystem: 'scanning-ocr',
      component: 'Queue',
      operation: 'step',
      eventType: 'metric',
      severity: 'info',
      status: 'succeeded',
      explanation: `Event ${i}`,
    });
    seqs.push(ev.seq);
  }

  assert.equal(seqs[0], 1);
  assert.equal(seqs[59], 60);
  assert.equal(engine.eventBus.getEvents().length, 50);
  assert.equal(engine.eventBus.getDroppedLiveEventsCount(), 10);
  engine.dispose();
});

test('DiagnosticEngine: reconstructs cross-subsystem async trace and identifies root cause via correlationId', () => {
  const engine = new DiagnosticEngine({ storageDriver: new InMemoryDiagnosticStorageDriver() });
  engine.registerInspector(createCustomInspector('scanning-ocr'));
  engine.registerInspector(createCustomInspector('ai-services'));
  engine.registerInspector(createCustomInspector('app-state'));

  const cid = 'scan-trace-42';
  engine.emit({
    subsystem: 'scanning-ocr',
    component: 'ScanQueue',
    operation: 'scanPage',
    eventType: 'lifecycle',
    severity: 'info',
    status: 'running',
    correlationId: cid,
    identifiers: { pageId: 'p-4' },
    explanation: 'Scan started for page 4.',
  });
  engine.emit({
    subsystem: 'ai-services',
    component: 'GeminiClient',
    operation: 'geminiRequest',
    eventType: 'error',
    severity: 'error',
    status: 'failed',
    correlationId: cid,
    error: new Error('HTTP 429 Too Many Requests'),
    explanation: 'Gemini request failed with HTTP 429.',
  });
  engine.emit({
    subsystem: 'app-state',
    component: 'ScanQueue',
    operation: 'queueStopped',
    eventType: 'state_transition',
    severity: 'warning',
    status: 'degraded',
    correlationId: cid,
    explanation: 'The scanning queue stopped because page 4 failed.',
  });

  // Running operation should have been cleared once terminal state occurred on other events,
  // or check active ops after completion
  engine.emit({
    subsystem: 'scanning-ocr',
    component: 'ScanQueue',
    operation: 'scanPage',
    eventType: 'lifecycle',
    severity: 'error',
    status: 'failed',
    correlationId: cid,
    explanation: 'Page 4 scan aborted.',
  });

  assert.equal(engine.getActiveOperations().length, 0);

  const traces = engine.reconstructCorrelatedTraces();
  assert.equal(traces.length, 1);
  assert.equal(traces[0].correlationId, cid);
  assert.equal(traces[0].outcome, 'failed');
  assert.deepEqual(traces[0].subsystemsInvolved, ['scanning-ocr', 'ai-services', 'app-state']);
  assert.ok(traces[0].rootCauseSummary?.includes('GeminiClient'));
  assert.ok(traces[0].rootCauseSummary?.includes('429'));
  engine.dispose();
});
