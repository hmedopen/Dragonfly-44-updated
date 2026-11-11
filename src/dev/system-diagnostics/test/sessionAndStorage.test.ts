import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticEngine } from '../diagnosticEngine.ts';
import { InMemoryDiagnosticStorageDriver } from '../diagnosticStorage.ts';

test('sessionRecorder: captures across workflows, enforces maxEventsCap, and marks truncated', async () => {
  const storage = new InMemoryDiagnosticStorageDriver();
  const engine = new DiagnosticEngine({
    storageDriver: storage,
    maxEventsPerSession: 10,
    flushIntervalMs: 500,
  });

  engine.startRecording({ label: 'Bounded Recording Test' });

  // Note: startRecording emits 1 lifecycle event; stopRecording emits 1 too
  for (let i = 0; i < 14; i++) {
    engine.emit({
      subsystem: i % 2 === 0 ? 'scanning-ocr' : 'translation',
      component: 'TestFlow',
      operation: `op-${i}`,
      eventType: 'io',
      severity: 'info',
      status: 'succeeded',
      identifiers: { pageId: `page-${i % 3}` },
      explanation: `Workflow step ${i}`,
    });
  }

  const session = await engine.stopRecording();
  assert.equal(session.events.length, 10);
  assert.equal(session.metadata.truncated, true);
  assert.ok(session.metadata.droppedEventCount > 0);
  assert.equal(session.metadata.maxEventsCap, 10);
  assert.ok(session.metadata.subsystemsSeen.includes('scanning-ocr'));
  assert.ok(session.metadata.subsystemsSeen.includes('translation'));

  const stored = await storage.getSession(session.metadata.sessionId);
  assert.ok(stored);
  assert.equal(stored.events.length, 10);
  engine.dispose();
});

test('sessionRecorder & storage: checkpoint recovery reconstructs interrupted session & 10-session retention prunes oldest', async () => {
  const storage = new InMemoryDiagnosticStorageDriver();
  const engine = new DiagnosticEngine({
    storageDriver: storage,
    flushIntervalMs: 30,
  });

  // Simulate active recording that flushes chunks & checkpoint, then "crashes" (recover on fresh engine)
  const meta = engine.startRecording({ label: 'Interrupted Session' });
  engine.emit({
    subsystem: 'ai-services',
    component: 'GeminiClient',
    operation: 'geminiCall',
    eventType: 'io',
    severity: 'warning',
    status: 'degraded',
    explanation: 'Slow response prior to crash',
  });
  await engine.recorder.flushAsync();

  const crashCheckpoint = await storage.getCheckpoint();
  assert.ok(crashCheckpoint);
  assert.equal(crashCheckpoint.metadata.sessionId, meta.sessionId);

  const recoveredEngine = new DiagnosticEngine({ storageDriver: storage });
  const recovered = await recoveredEngine.recorder.recoverInterruptedSession();
  assert.ok(recovered);
  assert.equal(recovered.metadata.status, 'recovered');
  assert.equal(recovered.metadata.sessionId, meta.sessionId);
  assert.ok(recovered.events.length >= 2);
  assert.equal(await storage.getCheckpoint(), null);

  // Retention test: saving 12 newer sessions keeps only latest 10
  const baseTs = recovered.metadata.startedAt + 1000;
  for (let i = 0; i < 12; i++) {
    await storage.saveSession({
      metadata: {
        ...recovered.metadata,
        sessionId: `sess-ret-${i}`,
        label: `Session ${i}`,
        startedAt: baseTs + i * 100,
      },
      events: [],
      systemSnapshots: [],
    });
  }

  const list = await storage.listSessions();
  assert.equal(list.length, 10);
  assert.equal(list[0].sessionId, 'sess-ret-11');
  assert.equal(list.some((s) => s.sessionId === 'sess-ret-0'), false);

  engine.dispose();
  recoveredEngine.dispose();
});

test('sessionRecorder: simulated storage failure never throws into host application', async () => {
  const storage = new InMemoryDiagnosticStorageDriver();
  storage.simulateFailure = true;

  const engine = new DiagnosticEngine({
    storageDriver: storage,
    flushIntervalMs: 25,
  });

  engine.startRecording({ label: 'Faulty Storage Session' });
  engine.emit({
    subsystem: 'data-storage',
    component: 'AppFlow',
    operation: 'savePage',
    eventType: 'io',
    severity: 'info',
    status: 'succeeded',
    explanation: 'App operation succeeded despite diagnostic storage failure.',
  });

  await engine.recorder.flushAsync();
  const record = await engine.stopRecording();

  assert.ok(record.events.length >= 2);
  assert.ok(engine.recorder.getStorageWriteErrors() >= 1);
  engine.dispose();
});
