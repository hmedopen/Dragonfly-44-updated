import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createDiagnosticCorrelationId,
  emitDiagnosticBoundary,
  isSystemDiagnosticsEnabled,
  registerDiagnosticTapListener,
} from '../../../lib/diagnosticTap.ts';

const REPO_ROOT = process.cwd();

test('diagnosticTap: listener isolation prevents diagnostic crashes from propagating into production flows', () => {
  const received: string[] = [];
  const unsubThrowing = registerDiagnosticTapListener(() => {
    throw new Error('Diagnostic listener bug');
  });
  const unsubHealthy = registerDiagnosticTapListener((evt) => {
    received.push(`${evt.subsystem}:${evt.operation}:${evt.correlationId || ''}`);
  });

  const cid = createDiagnosticCorrelationId('test');
  assert.doesNotThrow(() => {
    emitDiagnosticBoundary({
      subsystem: 'scanning-ocr',
      component: 'TestProducer',
      operation: 'boundaryCall',
      eventType: 'io',
      severity: 'info',
      status: 'succeeded',
      correlationId: cid,
      explanation: 'Producer boundary reached cleanly.',
    });
  });

  assert.deepEqual(received, [`scanning-ocr:boundaryCall:${cid}`]);
  unsubThrowing();
  unsubHealthy();
});

test('dev-only gating & architectural isolation: production bundles never statically import dev diagnostics', () => {
  const diagnosticTapSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'src/lib/diagnosticTap.ts'),
    'utf8'
  );
  assert.equal(
    diagnosticTapSrc.includes('system-diagnostics'),
    false,
    'src/lib/diagnosticTap.ts must have zero references to src/dev/system-diagnostics'
  );

  const appSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes('isSystemDiagnosticsEnabled'));
  assert.ok(appSrc.includes('import.meta.glob'));
  assert.equal(
    /^import\s+.*from\s+['"]\.\/dev\/system-diagnostics/m.test(appSrc),
    false,
    'src/App.tsx must not statically import src/dev/system-diagnostics'
  );

  const workbenchSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'src/components/Workbench/Workbench.tsx'),
    'utf8'
  );
  assert.ok(workbenchSrc.includes('isSystemDiagnosticsEnabled'));
  assert.equal(
    /from\s+['"].*dev\/system-diagnostics/.test(workbenchSrc),
    false,
    'Workbench.tsx must not import src/dev/system-diagnostics'
  );

  // Verify runtime gating behavior across Electron packaged vs dev vs server.cjs vs remote web
  const prevWindow = (globalThis as Record<string, unknown>).window;
  try {
    (globalThis as Record<string, unknown>).window = {
      folioScript: { isDev: false },
      location: { protocol: 'file:', hostname: '' },
    };
    assert.equal(isSystemDiagnosticsEnabled(), false, 'Packaged Electron build must disable diagnostics');

    (globalThis as Record<string, unknown>).window = {
      folioScript: { isDev: true },
      location: { protocol: 'http:', hostname: 'localhost' },
    };
    assert.equal(isSystemDiagnosticsEnabled(), true, 'Unpacked Electron dev build must enable diagnostics');

    (globalThis as Record<string, unknown>).window = {
      location: { protocol: 'http:', hostname: '127.0.0.1' },
    };
    assert.equal(isSystemDiagnosticsEnabled(), true, 'Localhost server.cjs launcher must enable diagnostics');

    (globalThis as Record<string, unknown>).window = {
      location: { protocol: 'https:', hostname: 'app.folioscript.example' },
    };
    assert.equal(isSystemDiagnosticsEnabled(), false, 'Remote web origin must disable diagnostics');
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  }

  const mainCjs = fs.readFileSync(path.join(REPO_ROOT, 'electron/main.cjs'), 'utf8');
  assert.ok(mainCjs.includes('if (isDev)'));
  const devBlockStart = mainCjs.indexOf('if (isDev)');
  const diagHandlerIdx = mainCjs.indexOf("ipcMain.handle('diagnostics:getRuntimeInfo'");
  assert.ok(devBlockStart >= 0 && diagHandlerIdx > devBlockStart);

  const preloadCjs = fs.readFileSync(path.join(REPO_ROOT, 'electron/preload.cjs'), 'utf8');
  assert.ok(preloadCjs.includes('const diagnosticsBridge = isDev'));
  assert.ok(preloadCjs.includes('diagnostics: diagnosticsBridge'));

  const diagStorageSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'src/dev/system-diagnostics/diagnosticStorage.ts'),
    'utf8'
  );
  assert.ok(diagStorageSrc.includes('folio_dev_diagnostics_db'));
  assert.equal(diagStorageSrc.includes('dragonfly44_db'), false);
});

test('REMOVAL.md exists and documents clean removal across integration points', () => {
  const removalPath = path.join(REPO_ROOT, 'src/dev/system-diagnostics/REMOVAL.md');
  assert.equal(fs.existsSync(removalPath), true);
  const removalMd = fs.readFileSync(removalPath, 'utf8');

  const requiredRefs = [
    'src/dev/system-diagnostics/',
    'src/lib/diagnosticTap.ts',
    'src/App.tsx',
    'src/components/Workbench/Workbench.tsx',
    'electron/main.cjs',
    'electron/preload.cjs',
    'folio_dev_diagnostics_db',
  ];
  for (const ref of requiredRefs) {
    assert.ok(removalMd.includes(ref), `REMOVAL.md should document ${ref}`);
  }
});
