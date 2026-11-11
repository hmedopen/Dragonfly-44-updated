import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticEngine } from '../diagnosticEngine.ts';
import { InMemoryDiagnosticStorageDriver } from '../diagnosticStorage.ts';
import { createAppCoreInspector } from '../inspectors/appCoreInspector.ts';
import { createScanningOcrInspector } from '../inspectors/scanningOcrInspector.ts';
import { createAiServicesInspector } from '../inspectors/aiServicesInspector.ts';
import { createTranslationInspector } from '../inspectors/translationInspector.ts';
import { createDataStorageInspector } from '../inspectors/dataStorageInspector.ts';
import { createAppStateInspector } from '../inspectors/appStateInspector.ts';
import { createRenderingUiInspector } from '../inspectors/renderingUiInspector.ts';
import { createModelsAssetsInspector } from '../inspectors/modelsAssetsInspector.ts';
import { createElectronFsInspector } from '../inspectors/electronFsInspector.ts';
import { createSettingsConfigInspector } from '../inspectors/settingsConfigInspector.ts';
import { SETTINGS_REGISTRY } from '../../../services/settings/settingsRegistry.ts';
import type { BubbleItem } from '../../../types/workbench.ts';

function makeFakeStoreState(overrides: Record<string, unknown> = {}) {
  return {
    currentView: 'workbench',
    activeFolderId: 'proj-1',
    activeChapterId: 'chap-1',
    activePageId: 'page-1',
    selectedBubbleId: 'b-1',
    isScanningActive: false,
    isScanningSinglePage: false,
    zoomLevel: 100,
    pageStatuses: { 'page-1': 'completed' },
    bubblesByPage: {
      'page-1': [
        {
          id: 'b-1',
          box_2d: [100, 100, 200, 200],
          sourceText: 'こんにちは',
          translatedText: 'Hello',
          typerPrefix: 'DLG:',
          type: 'dialogue',
        } as unknown as BubbleItem,
      ],
    },
    undoStack: [],
    redoStack: [],
    ...overrides,
  } as unknown as ReturnType<
    typeof import('../../../store/workbenchStore.ts').useWorkbenchStore.getState
  >;
}

function makeSettingResolver(overrides: Record<string, unknown> = {}) {
  return <T,>(id: string): { value: T; source: 'default'; isPending: boolean } => {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      return { value: overrides[id] as T, source: 'default', isPending: false };
    }
    const def = SETTINGS_REGISTRY[id];
    return {
      value: (def?.default_value ?? '') as T,
      source: 'default',
      isPending: false,
    };
  };
}

test('ScanningOcrInspector: detects queue page errors and executes real language router dry-run', async () => {
  const inspector = createScanningOcrInspector({
    getQueueState: () => ({
      errors: { 'page-3': 'Rate limit exhausted after 3 retries' },
      warnings: {},
      partialIds: [],
    }),
    getEffectiveSetting: makeSettingResolver({ 'scanning.source_language': 'auto' }) as never,
    getStoreState: () =>
      makeFakeStoreState({
        bubblesByPage: {
          'page-1': [
            {
              id: 'b-jp',
              box_2d: [50, 50, 120, 120],
              sourceText: 'おはようございます',
              translatedText: 'Good morning',
              type: 'dialogue',
            },
          ],
        },
      }),
  });

  const qRes = await inspector.runCheck('scan-queue-state', { now: Date.now(), recentEvents: [] });
  assert.equal(qRes.status, 'error');
  assert.equal(qRes.findings[0].code, 'SCAN_QUEUE_PAGE_ERROR');

  const routeRes = await inspector.runCheck('language-route-dry-run', {
    now: Date.now(),
    recentEvents: [],
    activePageId: 'page-1',
  });
  assert.equal(routeRes.status, 'healthy');
  assert.equal(routeRes.metrics?.effectiveLanguage, 'ja');
  assert.equal(routeRes.metrics?.routeId, 'ja_zh_ppocrv6_manga');
});

test('AiServicesInspector: validates missing API key warning and mock controlled endpoint ping without printing secret', async () => {
  const secretKey = 'AIzaTestFakeSecretKey987654321';
  const inspectorMissingKey = createAiServicesInspector({
    getEffectiveSetting: makeSettingResolver({ 'general.gemini_api_key': '' }) as never,
    resolveModel: () => 'gemini-3.8-flash',
  });
  const missingRes = await inspectorMissingKey.runCheck('gemini-config-readiness', {
    now: Date.now(),
    recentEvents: [],
  });
  assert.equal(missingRes.status, 'warning');
  assert.equal(missingRes.findings[0].code, 'MISSING_GEMINI_API_KEY');

  const inspectorWithKey = createAiServicesInspector({
    getEffectiveSetting: makeSettingResolver({ 'general.gemini_api_key': secretKey }) as never,
    resolveModel: () => 'gemini-3.8-flash',
    fetchImpl: async () =>
      new Response(JSON.stringify({ name: 'models/gemini-3.8-flash' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
  const pingRes = await inspectorWithKey.runCheck('gemini-endpoint-ping', {
    now: Date.now(),
    recentEvents: [],
  });
  assert.equal(pingRes.status, 'healthy');
  assert.equal(JSON.stringify(pingRes).includes(secretKey), false);
});

test('TranslationInspector: compiles instructions and flags missing dialogue translations', async () => {
  const inspector = createTranslationInspector({
    getEffectiveSetting: makeSettingResolver() as never,
    getStoreState: () =>
      makeFakeStoreState({
        bubblesByPage: {
          'page-1': [
            {
              id: 'b-miss',
              box_2d: [10, 10, 90, 90],
              sourceText: 'テスト',
              translatedText: '',
              type: 'dialogue',
            },
          ],
        },
      }),
  });

  const compilerRes = await inspector.runCheck('instruction-compiler-check', {
    now: Date.now(),
    recentEvents: [],
  });
  assert.equal(compilerRes.status, 'healthy');
  assert.ok(Number(compilerRes.metrics?.instructionLength) > 50);

  const covRes = await inspector.runCheck('page-translation-coverage', {
    now: Date.now(),
    recentEvents: [],
    activePageId: 'page-1',
  });
  assert.equal(covRes.status, 'warning');
  assert.equal(covRes.findings[0].code, 'UNTRANSLATED_BUBBLES_PRESENT');
});

test('DataStorageInspector: runs read-only memory integrity check without mutating repository or calling saveAuditEvent', async () => {
  let writeAttempted = false;
  const inspector = createDataStorageInspector({
    getStoreState: () => makeFakeStoreState({ activeFolderId: 'proj-mem-1' }),
    getMemoryDriver: () =>
      ({
        async getRecordsByProject() {
          return [
            {
              record_id: 'r1',
              project_id: 'proj-mem-1',
              canonical_key: 'hero_name',
              status: 'approved',
              trust_class: 'auto_inferred',
              provenance: [],
            },
          ];
        },
        async getCandidatesByProject() {
          return [];
        },
        async getConflictsByProject() {
          return [{ conflict_id: 'c1', status: 'unresolved' }];
        },
        async saveAuditEvent() {
          writeAttempted = true;
        },
      }) as never,
  });

  const memRes = await inspector.runCheck('memory-integrity-readonly', {
    now: Date.now(),
    recentEvents: [],
    activeProjectId: 'proj-mem-1',
  });
  assert.equal(writeAttempted, false);
  assert.equal(memRes.safety, 'read_only');
  assert.equal(memRes.status, 'error');
  assert.ok(memRes.findings.some((f) => f.code === 'MEMORY_MISSING_PROVENANCE'));
  assert.ok(memRes.findings.some((f) => f.code === 'MEMORY_UNRESOLVED_CONFLICTS'));

  const nodeIdbRes = await inspector.runCheck('indexeddb-schema-health', {
    now: Date.now(),
    recentEvents: [],
  });
  assert.equal(nodeIdbRes.status, 'unsupported');
});

test('AppStateInspector & RenderingUiInspector: detect state orphans, validate transforms, and flag NaN boxes', async () => {
  const stateInspector = createAppStateInspector({
    getStoreState: () =>
      makeFakeStoreState({
        currentView: 'workbench',
        activeChapterId: null,
        selectedBubbleId: 'missing-bubble',
      }),
  });
  const stateRes = await stateInspector.runCheck('zustand-state-invariants', {
    now: Date.now(),
    recentEvents: [],
  });
  assert.equal(stateRes.status, 'warning');
  assert.ok(stateRes.findings.some((f) => f.code === 'WORKBENCH_MISSING_CHAPTER_ID'));
  assert.ok(stateRes.findings.some((f) => f.code === 'ORPHAN_SELECTED_BUBBLE_ID'));

  const renderInspector = createRenderingUiInspector({
    getStoreState: () =>
      makeFakeStoreState({
        bubblesByPage: {
          'page-1': [{ id: 'b-bad', box_2d: [NaN, 10, 50, 50] }],
        },
      }),
  });
  const transformRes = await renderInspector.runCheck('coordinate-transform-invariants', {
    now: Date.now(),
    recentEvents: [],
  });
  assert.equal(transformRes.status, 'healthy');

  const boxRes = await renderInspector.runCheck('active-page-box-geometry', {
    now: Date.now(),
    recentEvents: [],
    activePageId: 'page-1',
  });
  assert.equal(boxRes.status, 'warning');
  assert.equal(boxRes.findings[0].code, 'INVALID_CANONICAL_BOX');
});

test('ModelsAssetsInspector, AppCoreInspector, ElectronFsInspector, & SettingsConfigInspector: cover healthy, error, and unsupported modes', async () => {
  const modelsInspector = createModelsAssetsInspector({
    getBridge: () => undefined,
  });
  const manifestRes = await modelsInspector.runCheck('model-manifest-validation', {
    now: Date.now(),
    recentEvents: [],
  });
  assert.equal(manifestRes.status, 'healthy');
  assert.ok(Number(manifestRes.metrics?.modelCount) >= 1);

  const cacheUnsupported = await modelsInspector.runCheck('local-model-cache-status', {
    now: Date.now(),
    recentEvents: [],
  });
  assert.equal(cacheUnsupported.status, 'unsupported');

  const appCore = createAppCoreInspector({ hasElectronBridge: () => false });
  const ipcUnsupported = await appCore.runCheck('electron-process-health', {
    now: Date.now(),
    recentEvents: [],
  });
  assert.equal(ipcUnsupported.status, 'unsupported');

  const electronFs = createElectronFsInspector({
    hasElectronBridge: () => true,
    fetchElectronInfo: async () => ({
      isDev: true,
      isPackaged: false,
      appName: 'Folio Script',
      appVersion: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      nodeVersion: '22.0',
      electronVersion: '45.2.0',
      chromeVersion: '136.0',
      uptimeSec: 12,
      mainMemory: { rss: 1000, heapUsed: 500, heapTotal: 800, external: 100 },
      appMetrics: [],
      paths: {
        userDataExists: false,
        modelsRootExists: false,
      },
      mainWindowReady: true,
      mainWindowBounds: { x: 0, y: 0, width: 1200, height: 800 },
      timestamp: Date.now(),
    }),
  });
  const fsErr = await electronFs.runCheck('electron-ipc-and-userdata', {
    now: Date.now(),
    recentEvents: [],
  });
  assert.equal(fsErr.status, 'error');
  assert.equal(fsErr.findings[0].code, 'USERDATA_MISSING');

  const settingsInspector = createSettingsConfigInspector({
    getEffectiveValue: makeSettingResolver() as never,
    isPending: () => false,
    getRevision: () => 4,
    loadTypers: () => ({
      typers: [{ id: 'dlg', prefix: 'DLG:', label: 'Dialogue', color: '#fff', enabled: true }],
      includeTyperSymbols: true,
      symbolPosition: 'start',
      textDirection: 'ltr',
    }) as never,
  });
  const cfgRes = await settingsInspector.runCheck('settings-registry-and-persistence', {
    now: Date.now(),
    recentEvents: [],
  });
  assert.equal(cfgRes.status, 'healthy');

  // Smoke run engine with multiple mock-free checks
  const engine = new DiagnosticEngine({ storageDriver: new InMemoryDiagnosticStorageDriver() });
  engine.registerInspector(modelsInspector);
  engine.registerInspector(settingsInspector);
  await engine.runAllDiagnostics({ allowedSafety: ['read_only'] });
  assert.equal(engine.getSubsystemSnapshot('models-assets').status, 'healthy');
  assert.equal(engine.getSubsystemSnapshot('settings-config').status, 'healthy');
  engine.dispose();
});
