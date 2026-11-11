import { fetchElectronRuntimeInfo, hasElectronDiagnosticsBridge } from '../adapters/electronBridge';
import type {
  DiagnosticCheckResult,
  DiagnosticFinding,
  InspectorContext,
  SubsystemInspector,
} from '../types';

export interface AppCoreInspectorDeps {
  fetchElectronInfo?: typeof fetchElectronRuntimeInfo;
  hasElectronBridge?: typeof hasElectronDiagnosticsBridge;
}

export function createAppCoreInspector(deps: AppCoreInspectorDeps = {}): SubsystemInspector {
  const getElectronInfo = deps.fetchElectronInfo ?? fetchElectronRuntimeInfo;
  const checkElectronBridge = deps.hasElectronBridge ?? hasElectronDiagnosticsBridge;

  return {
    id: 'app-core',
    name: 'Application Core',
    description: 'Runtime capabilities, main/renderer health, unhandled errors, and memory metrics.',
    coverageLevel: 'partial',
    capabilities: [
      { capability: 'Web Worker / OffscreenCanvas / WASM SIMD probes', tier: 'read_only_check', notes: 'Verified in browser/Electron renderer.' },
      { capability: 'Uncaught errors & unhandled promise rejections', tier: 'full', notes: 'Captured via window error listeners and dev ErrorBoundary.' },
      { capability: 'Main & renderer process metrics', tier: 'read_only_check', notes: 'Available in Electron dev mode; unsupported in plain browser.' },
    ],
    checks: [
      {
        checkId: 'runtime-capabilities',
        name: 'Renderer Runtime Capabilities',
        description: 'Verifies Web Worker, OffscreenCanvas, IndexedDB, WebAssembly SIMD, and online connectivity.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'electron-process-health',
        name: 'Main & Renderer Process Metrics',
        description: 'Queries Electron main process uptime, memory usage, and window metrics via dev IPC.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'recent-uncaught-exceptions',
        name: 'Uncaught Exception Ledger',
        description: 'Audits whether uncaught runtime exceptions or unhandled promise rejections occurred recently.',
        safety: 'read_only',
        defaultEnabled: true,
      },
    ],
    async runCheck(checkId: string, context: InspectorContext): Promise<DiagnosticCheckResult> {
      const start = Date.now();
      const findings: DiagnosticFinding[] = [];

      if (checkId === 'runtime-capabilities') {
        const hasWorker = typeof Worker === 'function';
        const hasOffscreenCanvas = typeof OffscreenCanvas === 'function';
        const hasIndexedDb = typeof indexedDB !== 'undefined';
        const hasCrypto = typeof crypto !== 'undefined';
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

        let simdSupported = false;
        try {
          const probe = new Uint8Array([
            0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
            0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
            0x03, 0x02, 0x01, 0x00,
            0x0a, 0x16, 0x01, 0x14, 0x00,
            0xfd, 0x0c,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x0b,
          ]);
          simdSupported = typeof WebAssembly !== 'undefined' && WebAssembly.validate(probe);
        } catch {
          simdSupported = false;
        }

        const isBrowser = typeof window !== 'undefined';
        if (isBrowser && !hasWorker) {
          findings.push({
            findingId: `core-no-worker-${start}`,
            subsystem: 'app-core',
            checkId,
            code: 'NO_WEB_WORKER',
            severity: 'error',
            title: 'Web Worker runtime unavailable',
            explanation: 'Local OCR requires Web Workers and refuses UI-thread fallback.',
            timestamp: Date.now(),
          });
        }
        if (isBrowser && !hasIndexedDb) {
          findings.push({
            findingId: `core-no-idb-${start}`,
            subsystem: 'app-core',
            checkId,
            code: 'NO_INDEXEDDB',
            severity: 'critical',
            title: 'IndexedDB unavailable',
            explanation: 'Pages, bubbles, and project memory cannot persist without IndexedDB.',
            timestamp: Date.now(),
          });
        }
        if (isBrowser && !isOnline) {
          findings.push({
            findingId: `core-offline-${start}`,
            subsystem: 'app-core',
            checkId,
            code: 'NETWORK_OFFLINE',
            severity: 'warning',
            title: 'Browser reports offline status',
            explanation: 'Gemini scanning, translation, and model downloads require network connectivity.',
            timestamp: Date.now(),
          });
        }

        const perfMem = (typeof performance !== 'undefined'
          ? (performance as Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory
          : undefined);

        return {
          checkId,
          subsystem: 'app-core',
          name: 'Renderer Runtime Capabilities',
          safety: 'read_only',
          status: findings.some((f) => f.severity === 'critical')
            ? 'critical'
            : findings.some((f) => f.severity === 'error')
            ? 'error'
            : findings.length > 0
            ? 'warning'
            : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: isBrowser
            ? `Renderer primitives verified (Worker: ${hasWorker}, OffscreenCanvas: ${hasOffscreenCanvas}, WASM SIMD: ${simdSupported}, Online: ${isOnline}).`
            : 'Running in non-browser Node runtime; browser renderer primitives skipped.',
          findings,
          metrics: {
            isBrowser,
            hasWorker,
            hasOffscreenCanvas,
            hasIndexedDb,
            hasCrypto,
            simdSupported,
            isOnline,
            usedJSHeapMB: perfMem?.usedJSHeapSize ? Math.round(perfMem.usedJSHeapSize / (1024 * 1024)) : null,
          },
        };
      }

      if (checkId === 'electron-process-health') {
        if (!checkElectronBridge()) {
          return {
            checkId,
            subsystem: 'app-core',
            name: 'Main & Renderer Process Metrics',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'Electron diagnostics IPC is unavailable in browser dev mode; main-process metrics are unsupported here.',
            findings: [],
          };
        }

        const info = await getElectronInfo();
        if (!info) {
          return {
            checkId,
            subsystem: 'app-core',
            name: 'Main & Renderer Process Metrics',
            safety: 'read_only',
            status: 'error',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'Electron diagnostics IPC returned no data.',
            findings: [
              {
                findingId: `core-ipc-empty-${start}`,
                subsystem: 'app-core',
                checkId,
                code: 'ELECTRON_IPC_EMPTY',
                severity: 'error',
                title: 'Electron runtime telemetry returned null',
                explanation: 'The diagnostics:getRuntimeInfo handler did not return process details.',
                timestamp: Date.now(),
              },
            ],
          };
        }

        return {
          checkId,
          subsystem: 'app-core',
          name: 'Main & Renderer Process Metrics',
          safety: 'read_only',
          status: info.mainWindowReady ? 'healthy' : 'warning',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `Electron ${info.electronVersion} (${info.platform}/${info.arch}) main process healthy; uptime ${info.uptimeSec}s, RSS ${Math.round(info.mainMemory.rss / (1024 * 1024))} MB across ${info.appMetrics.length} process(es).`,
          findings: [],
          metrics: {
            electronVersion: info.electronVersion,
            nodeVersion: info.nodeVersion,
            uptimeSec: info.uptimeSec,
            mainRssMB: Math.round(info.mainMemory.rss / (1024 * 1024)),
            processCount: info.appMetrics.length,
          },
        };
      }

      if (checkId === 'recent-uncaught-exceptions') {
        const uncaught = context.recentEvents.filter(
          (e) =>
            e.subsystem === 'app-core' &&
            (e.operation === 'uncaughtError' || e.operation === 'unhandledRejection' || e.operation === 'reactErrorBoundary')
        );
        for (const errEvt of uncaught) {
          findings.push({
            findingId: `core-exc-${errEvt.eventId}`,
            subsystem: 'app-core',
            checkId,
            code: 'UNCAUGHT_EXCEPTION_OBSERVED',
            severity: 'error',
            title: `${errEvt.component}: ${errEvt.operation}`,
            explanation: errEvt.explanation,
            correlationId: errEvt.correlationId,
            timestamp: errEvt.timestamp,
          });
        }
        return {
          checkId,
          subsystem: 'app-core',
          name: 'Uncaught Exception Ledger',
          safety: 'read_only',
          status: uncaught.length > 0 ? 'error' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary:
            uncaught.length > 0
              ? `Detected ${uncaught.length} uncaught runtime exception(s) in the current diagnostic buffer.`
              : 'Zero uncaught window errors or unhandled promise rejections recorded in the current buffer.',
          findings,
          metrics: { uncaughtCount: uncaught.length },
        };
      }

      throw new Error(`Unsupported checkId "${checkId}" on app-core inspector.`);
    },
  };
}
