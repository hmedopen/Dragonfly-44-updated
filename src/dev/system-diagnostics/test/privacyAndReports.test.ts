import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticEngine } from '../diagnosticEngine.ts';
import { InMemoryDiagnosticStorageDriver } from '../diagnosticStorage.ts';
import {
  DEFAULT_RECORDING_PRIVACY_OPTIONS,
  redactEventForPrivacy,
  redactPayload,
  scrubSecretPatterns,
} from '../privacyRedactor.ts';
import { generateLiveSnapshotReport, generateReportFromSession } from '../reportGenerator.ts';
import { registerBuiltInInspectors } from '../inspectors/index.ts';

test('privacyRedactor: unconditionally scrubs API keys, Bearer tokens, and images', () => {
  const scrubbedUrl = scrubSecretPatterns(
    'POST https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=AIzaSyDummySecretValue123456'
  );
  assert.equal(scrubbedUrl.redacted, true);
  assert.equal(scrubbedUrl.value.includes('AIzaSyDummySecretValue123456'), false);

  const payload = {
    gemini_api_key: 'AIzaSySecretKeyInsideField99999',
    authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.token.sig',
    imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY=',
    sourceText: 'مرحبا بالعالم',
    requestPreview: '{"contents":[{"text":"debug"}]}',
    bubblesCount: 3,
  };

  const defaultResult = redactPayload(payload, DEFAULT_RECORDING_PRIVACY_OPTIONS);
  assert.equal(defaultResult.sanitized?.gemini_api_key, '[REDACTED_SECRET]');
  assert.equal(defaultResult.sanitized?.authorization, '[REDACTED_SECRET]');
  assert.match(String(defaultResult.sanitized?.imageData), /^\[OMITTED_IMAGE_DATA/);
  assert.match(String(defaultResult.sanitized?.sourceText), /^\[TEXT_REDACTED/);
  assert.match(String(defaultResult.sanitized?.requestPreview), /^\[DETAILED_PAYLOAD_OMITTED/);
  assert.equal(defaultResult.sanitized?.bubblesCount, 3);
  assert.ok(defaultResult.redactedFields.length >= 5);

  // Even when opt-in flags are enabled, secrets and images remain excluded
  const optInResult = redactPayload(payload, {
    includeExtractedText: true,
    includeDetailedPayloads: true,
  });
  assert.equal(optInResult.sanitized?.gemini_api_key, '[REDACTED_SECRET]');
  assert.match(String(optInResult.sanitized?.imageData), /^\[OMITTED_IMAGE_DATA/);
  assert.equal(optInResult.sanitized?.sourceText, 'مرحبا بالعالم');
  assert.equal(optInResult.sanitized?.requestPreview, '{"contents":[{"text":"debug"}]}');
});

test('reportGenerator: produces truthful dual human + technical JSON reports without false claims', async () => {
  const engine = new DiagnosticEngine({ storageDriver: new InMemoryDiagnosticStorageDriver() });
  registerBuiltInInspectors(engine);

  engine.startRecording({ label: 'Bug Repro Session' });
  const cid = 'corr-hybrid-99';

  engine.emit({
    subsystem: 'scanning-ocr',
    component: 'LocalOcrEngine',
    operation: 'localOcrInference',
    eventType: 'decision',
    severity: 'warning',
    status: 'degraded',
    correlationId: cid,
    identifiers: { pageId: 'page-2', modelId: 'manga-ocr' },
    payload: {
      sourceText: 'Confidential Manga Line',
      api_key: 'AIzaShouldNotLeak9999999999',
      rawCandidateCount: 0,
    },
    explanation: 'Gemini was used because local OCR returned no usable results.',
  });

  engine.emit({
    subsystem: 'data-storage',
    component: 'db.ts',
    operation: 'savePageBubbles',
    eventType: 'io',
    severity: 'healthy',
    status: 'succeeded',
    correlationId: cid,
    identifiers: { pageId: 'page-2', count: 4 },
    explanation: 'The database accepted the new records.',
  });

  const session = await engine.stopRecording();
  const dual = generateReportFromSession(engine, session, {
    getSettingsSnapshot: () => ({
      'general.gemini_api_key': '[REDACTED_SECRET]',
      'translation.model': 'gemini-3.8-flash',
    }),
    getEnvironmentSnapshot: () => ({ runtime: 'node-test' }),
  });

  // Privacy checks
  assert.equal(dual.technical.privacyManifest.apiKeysAndSecretsRedacted, true);
  assert.equal(dual.technical.privacyManifest.sourceImagesExcluded, true);
  const serializedTech = JSON.stringify(dual.technical);
  assert.equal(serializedTech.includes('AIzaShouldNotLeak'), false);
  assert.equal(serializedTech.includes('Confidential Manga Line'), false);

  // Human report checks
  assert.ok(dual.human.markdown.includes('Bug Repro Session'));
  assert.ok(dual.human.markdown.includes('LocalOcrEngine') || dual.human.markdown.includes('Gemini was used'));
  assert.ok(dual.human.markdown.includes('Coverage Breakdown') || dual.human.coverageNotes.length > 0);

  // Technical JSON checks
  assert.equal(dual.technical.schemaVersion, '1.0');
  assert.equal(dual.technical.reportType, 'folio_script_system_diagnostic_report');
  assert.equal(dual.technical.metadata.sessionId, session.metadata.sessionId);
  assert.ok(dual.technical.correlatedTraces.some((t) => t.correlationId === cid));
  assert.equal(dual.technical.instrumentationCoverage.length, 10);

  // Subsystems without checks remain not_checked rather than fabricated healthy
  const notCheckedRendering = dual.technical.systemHealth.find((s) => s.subsystem === 'rendering-ui');
  assert.equal(notCheckedRendering?.status, 'not_checked');

  const liveDual = generateLiveSnapshotReport(engine);
  assert.equal(liveDual.technical.metadata.sessionStatus, 'snapshot');

  const eventPrivacy = redactEventForPrivacy(session.events[0], DEFAULT_RECORDING_PRIVACY_OPTIONS);
  assert.ok(eventPrivacy.timestamp > 0);
  engine.dispose();
});
