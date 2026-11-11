import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignNextTyperColor,
  DEFAULT_TYPERS,
  formatTyperSymbol,
  getContrastForeground,
  loadTyperSettings,
  saveTyperSettings,
  resolveTyperVisual,
  TYPER_SETTINGS_STORAGE_KEY,
} from '../../../types/typers.ts';
import { mergeScanWithExistingState } from '../../../lib/rescanMerge.ts';
import type { BubbleItem } from '../../../types/workbench.ts';

function setupMockStorageAndDb(options?: {
  initialVersion?: number;
  seedStores?: Array<[string, { keyPath?: string; records?: Array<[string, any]> }]>;
}) {
  const lsStore = new Map<string, string>();
  const localStorageMock = {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => lsStore.set(k, String(v)),
    removeItem: (k: string) => lsStore.delete(k),
  };

  (globalThis as any).localStorage = localStorageMock;
  (globalThis as any).window = {
    localStorage: localStorageMock,
    innerWidth: 1280,
    innerHeight: 820,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const defaultStores: Array<[string, { keyPath?: string; records: Map<string, any> }]> = [
    ['page_blobs', { records: new Map([['page-blob:legacy-p1', { size: 42, type: 'image/png' }]]) }],
    [
      'page_bubbles',
      {
        records: new Map([
          [
            'page-bubbles:legacy-p1',
            [
              {
                id: 'legacy-auto-b1',
                pageId: 'legacy-p1',
                index: 1,
                box_2d: [10, 10, 80, 90],
                type: 'speech_bubbles',
                sourceText: 'Auto scanned line',
                originalSourceText: 'Auto scanned line',
                translatedText: 'سطر تلقائي',
                rawTranslatedText: 'سطر تلقائي',
                reviewFlags: [],
                isManuallyEdited: false,
              },
            ],
          ],
          [
            'page-bubbles:p2',
            [
              {
                id: 'p2-auto-1',
                pageId: 'p2',
                index: 1,
                box_2d: [20, 20, 90, 120],
                type: 'shouting',
                sourceText: 'Auto p2 line',
                originalSourceText: 'Auto p2 line',
                translatedText: 'تلقائي ص2',
                rawTranslatedText: 'تلقائي ص2',
                reviewFlags: [],
                isManuallyEdited: false,
              },
            ],
          ],
        ]),
      },
    ],
    ['page_scans', { records: new Map() }],
    ['project_lore', { records: new Map() }],
    ['chapter_intelligence', { records: new Map() }],
    ['projects', { keyPath: 'id', records: new Map([['proj-1', { id: 'proj-1', name: 'Legacy Series' }]]) }],
    ['chapters', { keyPath: 'id', records: new Map([['ch-1', { id: 'ch-1', projectId: 'proj-1' }]]) }],
    ['pages', { keyPath: 'id', records: new Map([['legacy-p1', { id: 'legacy-p1', chapterId: 'ch-1', index: 1 }]]) }],
    ['chapter_snapshots', { keyPath: 'id', records: new Map() }],
    ['migration_journal', { keyPath: 'key', records: new Map() }],
    ['review_findings', { keyPath: 'findingId', records: new Map() }],
    ['review_snapshots', { keyPath: 'snapshotId', records: new Map() }],
    ['review_audit', { keyPath: 'auditId', records: new Map() }],
    ['knowledge_records', { keyPath: 'record_id', records: new Map() }],
    ['knowledge_revisions', { keyPath: 'revision_id', records: new Map() }],
    ['knowledge_candidates', { keyPath: 'candidate_id', records: new Map() }],
    ['knowledge_audit', { keyPath: 'event_id', records: new Map() }],
    ['knowledge_quarantine', { keyPath: 'quarantine_id', records: new Map() }],
    ['knowledge_conflicts', { keyPath: 'conflict_id', records: new Map() }],
    ['knowledge_idempotency', { keyPath: 'key', records: new Map() }],
    ['memory_settings', { keyPath: 'project_id', records: new Map() }],
    ['training_reference_sets', { keyPath: 'id', records: new Map() }],
    ['training_blobs', { records: new Map() }],
  ];

  const backingStores = new Map<string, { keyPath?: string; records: Map<string, any> }>(
    options?.seedStores
      ? options.seedStores.map(([name, cfg]) => [
          name,
          { keyPath: cfg.keyPath, records: new Map(cfg.records || []) },
        ])
      : defaultStores
  );

  let currentVersion = options?.initialVersion ?? 8;

  const makeStoreNames = () => ({
    contains: (name: string) => backingStores.has(name),
    get length() {
      return backingStores.size;
    },
  });

  const makeDbObject = () => ({
    onversionchange: null as null | (() => void),
    close() {},
    get version() {
      return currentVersion;
    },
    get objectStoreNames() {
      return makeStoreNames();
    },
    createObjectStore(name: string, opts?: { keyPath?: string }) {
      if (!backingStores.has(name)) {
        backingStores.set(name, { keyPath: opts?.keyPath, records: new Map() });
      }
      return { createIndex: () => ({}) };
    },
    transaction(storeName: string | string[]) {
      const defaultStore = Array.isArray(storeName) ? storeName[0] : storeName;
      const tx: any = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore(targetName: string) {
          const entry = backingStores.get(targetName || defaultStore);
          if (!entry) throw new Error(`Missing objectStore: ${targetName}`);
          const finish = (cb: (() => void) | null) => {
            queueMicrotask(() => {
              cb?.();
              queueMicrotask(() => tx.oncomplete?.());
            });
          };
          return {
            get(key: string) {
              const req: any = { result: entry.records.get(key), error: null, onsuccess: null, onerror: null };
              finish(() => req.onsuccess?.());
              return req;
            },
            put(value: any, explicitKey?: string) {
              const k = explicitKey ?? (entry.keyPath ? value[entry.keyPath] : undefined);
              entry.records.set(String(k), structuredClone(value));
              const req: any = { result: k, error: null, onsuccess: null, onerror: null };
              finish(() => req.onsuccess?.());
              return req;
            },
            delete(key: string) {
              entry.records.delete(String(key));
              const req: any = { result: undefined, error: null, onsuccess: null, onerror: null };
              finish(() => req.onsuccess?.());
              return req;
            },
          };
        },
      };
      return tx;
    },
  });

  (globalThis as any).indexedDB = {
    open(_name: string, targetVersion?: number) {
      const req: any = {
        result: makeDbObject(),
        error: null,
        onupgradeneeded: null,
        onblocked: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        if (typeof targetVersion === 'number' && targetVersion < currentVersion) {
          req.error = Object.assign(
            new Error(`The requested version (${targetVersion}) is less than the existing version (${currentVersion}).`),
            { name: 'VersionError' }
          );
          req.onerror?.();
          return;
        }
        if (typeof targetVersion === 'number' && targetVersion > currentVersion) {
          currentVersion = targetVersion;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };

  return { lsStore, backingStores };
}

test('Shared Typer configuration synchronizes symbols, pins, contrast, and custom typer deletion safety across auto & manual records', () => {
  setupMockStorageAndDb();
  saveTyperSettings({
    includeTyperSymbols: true,
    prefixPosition: 'right',
    symbolPosition: 'start',
    textDirection: 'rtl',
    typers: DEFAULT_TYPERS.map((t) => ({ ...t })),
  });

  const initial = loadTyperSettings();
  assert.equal(initial.typers.length, DEFAULT_TYPERS.length);
  assert.equal(formatTyperSymbol('"":'), '""');
  assert.equal(formatTyperSymbol('T/N:'), 'T/N');
  assert.equal(getContrastForeground('#FACC15'), '#09090B');
  assert.equal(getContrastForeground('#2563EB'), '#FFFFFF');

  // Add a custom typer with a custom color & pin it, plus change Speech Bubbles color
  const nextColor = assignNextTyperColor(initial.typers);
  const customTyper = {
    id: 'custom_narration_box',
    prefix: 'NB:',
    name: 'Narration Box',
    instructions: 'Boxed scene narration',
    isDefault: false,
    color: nextColor,
    pinned: true,
  };
  const updatedTypers = [
    ...initial.typers.map((t) =>
      t.id === 'speech_bubbles' ? { ...t, color: '#059669' } : t
    ),
    customTyper,
  ];
  saveTyperSettings({ ...initial, typers: updatedTypers });

  const reloaded = loadTyperSettings();
  assert.ok(reloaded.typers.some((t) => t.id === 'custom_narration_box' && t.pinned === true));

  // Shared color update applies equally to BOTH auto-scanned and manual speech bubbles
  const autoVisual = resolveTyperVisual({ type: 'speech_bubbles', typerPrefix: '"":' }, reloaded.typers);
  const manualVisual = resolveTyperVisual({ type: 'speech_bubbles', typerPrefix: '"":' }, reloaded.typers);
  assert.equal(autoVisual.color, '#059669');
  assert.equal(manualVisual.color, '#059669');
  assert.equal(manualVisual.symbol, '""');

  // Remove custom typer -> existing record retains its symbol and solid color fallback safely without corruption
  saveTyperSettings({
    ...reloaded,
    typers: reloaded.typers.filter((t) => t.id !== 'custom_narration_box'),
  });
  const afterDelete = resolveTyperVisual(
    { type: 'custom_narration_box', typerPrefix: 'NB:', manualColorSnapshot: nextColor },
    loadTyperSettings().typers
  );
  assert.equal(afterDelete.isClassified, true);
  assert.equal(afterDelete.symbol, 'NB');
  assert.equal(afterDelete.color, nextColor);

  // Untyped fallback stays neutral without inventing a classification
  const untypedVisual = resolveTyperVisual({ type: 'none', typerPrefix: '' }, loadTyperSettings().typers);
  assert.equal(untypedVisual.isClassified, false);
  assert.equal(untypedVisual.symbol, '');

  assert.ok(localStorage.getItem(TYPER_SETTINGS_STORAGE_KEY));
});

test('Zero IDB migration (v8 preserved), WorkbenchStore immediate save/undo/redo/clear scoping, and rescan protection', async () => {
  setupMockStorageAndDb();
  const dbMod = await import('../../../services/db.ts');
  const storeMod = await import('../../../store/workbenchStore.ts');

  const db = await dbMod.getDatabase();
  try {
    assert.equal(dbMod.DB_VERSION, 8, 'Existing IndexedDB v8 schema must stay intact without unnecessary migration');
    assert.equal(db.version, 8);

  const wb = storeMod.useWorkbenchStore;
  await wb.getState().loadPageBubbles('legacy-p1');
  await wb.getState().loadPageBubbles('p2');

  const legacyBefore = wb.getState().bubblesByPage['legacy-p1'];
  assert.equal(legacyBefore.length, 1);
  assert.equal(legacyBefore[0].sourceText, 'Auto scanned line');

  // Draw an organic Bubble selection -> immediately persisted without waiting for OCR
  const createdBubble = wb.getState().addManualSelectionRecord('legacy-p1', {
    shape: 'bubble',
    box_2d: [200, 100, 420, 400],
    polygon: [
      [150, 210],
      [350, 215],
      [390, 310],
      [340, 410],
      [140, 405],
      [105, 310],
    ],
    typerId: 'thought_bubbles',
  });
  assert.equal(createdBubble.provenance, 'manual_selection');
  assert.equal(createdBubble.manualSelectionShape, 'bubble');
  assert.equal(createdBubble.type, 'thought_bubbles');
  assert.equal(createdBubble.typerPrefix, '():');

  // Verify IndexedDB page_bubbles received it cleanly on save and reload
  await wb.getState().loadPageBubbles('legacy-p1');
  const reloadedP1 = wb.getState().bubblesByPage['legacy-p1'];
  assert.equal(reloadedP1.length, 2);
  const persistedManual = reloadedP1.find((b) => b.id === createdBubble.id)!;
  assert.equal(persistedManual.provenance, 'manual_selection');
  assert.equal(persistedManual.manualSelectionShape, 'bubble');
  assert.equal(persistedManual.manualPolygon?.length, 6);

  // Add manual lasso on page 2 as well
  wb.getState().addManualSelectionRecord('p2', {
    shape: 'lasso',
    box_2d: [300, 200, 500, 500],
    polygon: [
      [200, 300],
      [500, 300],
      [450, 500],
      [210, 480],
    ],
    typerId: 'speech_bubbles',
  });

  // Geometry edit & Undo/Redo
  wb.getState().updateManualSelectionGeometry('legacy-p1', createdBubble.id, {
    box_2d: [220, 120, 440, 420],
    polygon: persistedManual.manualPolygon!.map(([x, y]) => [x + 20, y + 20]),
  });
  assert.equal(
    wb.getState().bubblesByPage['legacy-p1'].find((b) => b.id === createdBubble.id)?.box_2d[0],
    220
  );

  wb.getState().undoBubbleAction('legacy-p1');
  assert.equal(
    wb.getState().bubblesByPage['legacy-p1'].find((b) => b.id === createdBubble.id)?.box_2d[0],
    200
  );
  wb.getState().redoBubbleAction('legacy-p1');
  assert.equal(
    wb.getState().bubblesByPage['legacy-p1'].find((b) => b.id === createdBubble.id)?.box_2d[0],
    220
  );

  // Clear Page deletes ONLY manual selections on legacy-p1 while leaving auto-scan on p1 AND manual/auto on p2 untouched!
  const clearedPage = await wb.getState().clearManualSelections('page', 'legacy-p1', ['legacy-p1', 'p2']);
  assert.equal(clearedPage, 1);
  assert.equal(wb.getState().bubblesByPage['legacy-p1'].length, 1);
  assert.equal(wb.getState().bubblesByPage['legacy-p1'][0].id, 'legacy-auto-b1');
  assert.equal(wb.getState().bubblesByPage['p2'].length, 2, 'Clearing p1 must NOT affect p2');

  // Undo restores cleared manual selection on legacy-p1
  wb.getState().undoBubbleAction('legacy-p1');
  assert.equal(wb.getState().bubblesByPage['legacy-p1'].length, 2);

  // Automatic rescan merge must preserve manual_selection provenance records without overwriting
  const currentP1: BubbleItem[] = wb.getState().bubblesByPage['legacy-p1'];
  const mergeOutcome = mergeScanWithExistingState({
    newScan: {
      scanId: 'scan-1',
      pageId: 'legacy-p1',
      sourceImageId: 'legacy-p1',
      sourceDimensions: { width: 800, height: 1200 },
      readingConvention: 'manga_rtl',
      regions: [],
      status: 'complete',
      panels: [],
      issues: [],
      transformLedger: {
        transformId: 'tf-1',
        sourceImageId: 'legacy-p1',
        sourceWidth: 800,
        sourceHeight: 1200,
        workingWidth: 800,
        workingHeight: 1200,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        cropOriginX: 0,
        cropOriginY: 0,
        coordinateSpace: 'normalized_1000',
      },
      createdAt: Date.now(),
      version: 1,
    },
    existingBubbles: currentP1,
    typerSettings: loadTyperSettings(),
  });
  assert.ok(mergeOutcome.mergedBubbles.some((b) => b.id === createdBubble.id));

  // Clear All (chapter scope) removes manual selections across all chapter pages, preserving all auto-scanned records
  const clearedChapter = await wb.getState().clearManualSelections('chapter', 'legacy-p1', ['legacy-p1', 'p2']);
  assert.equal(clearedChapter, 2);
  assert.equal(wb.getState().bubblesByPage['legacy-p1'].length, 1);
  assert.equal(wb.getState().bubblesByPage['legacy-p1'][0].id, 'legacy-auto-b1');
    assert.equal(wb.getState().bubblesByPage['p2'].length, 1);
    assert.equal(wb.getState().bubblesByPage['p2'][0].id, 'p2-auto-1');
  } finally {
    (db as any).onversionchange?.({} as any);
  }
});

test('IndexedDB opens existing v9 database without VersionError and repairs missing core stores additively', async () => {
  const fullV9Stores: Array<[string, { keyPath?: string; records?: Array<[string, any]> }]> = [
    ['page_blobs', { records: [['page-blob:legacy-p1', { size: 128, type: 'image/png' }]] }],
    [
      'page_bubbles',
      {
        records: [
          [
            'page-bubbles:legacy-p1',
            [
              {
                id: 'b-v9',
                pageId: 'legacy-p1',
                index: 1,
                box_2d: [10, 20, 100, 200],
                type: 'speech_bubbles',
                sourceText: 'Preserved source text',
                translatedText: 'Preserved translation',
              },
            ],
          ],
        ],
      },
    ],
    ['page_scans', {}],
    ['project_lore', {}],
    ['chapter_intelligence', {}],
    ['projects', { keyPath: 'id', records: [['proj-v9', { id: 'proj-v9', name: 'Existing Series' }]] }],
    ['chapters', { keyPath: 'id', records: [['ch-v9', { id: 'ch-v9', projectId: 'proj-v9' }]] }],
    ['pages', { keyPath: 'id', records: [['legacy-p1', { id: 'legacy-p1', chapterId: 'ch-v9', index: 1 }]] }],
    ['chapter_snapshots', { keyPath: 'id' }],
    ['migration_journal', { keyPath: 'key' }],
    ['review_findings', { keyPath: 'findingId' }],
    ['review_snapshots', { keyPath: 'snapshotId' }],
    ['review_audit', { keyPath: 'auditId' }],
    ['knowledge_records', { keyPath: 'record_id' }],
    ['knowledge_revisions', { keyPath: 'revision_id' }],
    ['knowledge_candidates', { keyPath: 'candidate_id' }],
    ['knowledge_audit', { keyPath: 'event_id' }],
    ['knowledge_quarantine', { keyPath: 'quarantine_id' }],
    ['knowledge_conflicts', { keyPath: 'conflict_id' }],
    ['knowledge_idempotency', { keyPath: 'key' }],
    ['memory_settings', { keyPath: 'project_id' }],
    ['training_reference_sets', { keyPath: 'id' }],
    ['training_blobs', {}],
    ['manual_selection_regions', { keyPath: 'id', records: [['r-1', { id: 'r-1', pageId: 'legacy-p1' }]] }],
  ];

  // Case A: Complete v9 DB from earlier build opens cleanly at v9 without VersionError or losing records
  const { backingStores: v9Stores } = setupMockStorageAndDb({
    initialVersion: 9,
    seedStores: fullV9Stores,
  });
  const dbMod = await import('../../../services/db.ts');
  const dbV9 = await dbMod.getDatabase();
  assert.equal(dbV9.version, 9);
  assert.equal(v9Stores.has('manual_selection_regions'), true, 'Legacy v9 store must remain intact');

  const blob = await dbMod.getPageBlob('legacy-p1');
  assert.equal((blob as any)?.size, 128);
  const bubbles = await dbMod.getPageBubbles('legacy-p1');
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].sourceText, 'Preserved source text');
  assert.equal(bubbles[0].translatedText, 'Preserved translation');

  await dbMod.savePageBlob('page-new-1', { size: 256, type: 'image/png' } as any);
  const savedNew = await dbMod.getPageBlob('page-new-1');
  assert.equal((savedNew as any)?.size, 256);

  // Simulate connection reset before Case B
  (dbV9 as any).onversionchange?.({} as any);

  // Case B: Higher-version DB missing a required core store repairs additively at v10 without dropping data
  const incompleteV9 = fullV9Stores.filter(([name]) => name !== 'training_blobs');
  const { backingStores: repairedStores } = setupMockStorageAndDb({
    initialVersion: 9,
    seedStores: incompleteV9,
  });
  const dbRepaired = await dbMod.getDatabase();
  assert.equal(dbRepaired.version, 10);
  assert.equal(repairedStores.has('training_blobs'), true);
  assert.equal((await dbMod.getPageBlob('legacy-p1') as any)?.size, 128);
  (dbRepaired as any).onversionchange?.({} as any);
});
