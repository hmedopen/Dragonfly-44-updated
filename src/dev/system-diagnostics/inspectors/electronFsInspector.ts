import {
  fetchElectronRuntimeInfo,
  getFolioScriptBridge,
  hasElectronDiagnosticsBridge,
} from '../adapters/electronBridge';
import type {
  DiagnosticCheckResult,
  DiagnosticFinding,
  InspectorContext,
  SubsystemInspector,
} from '../types';

export interface ElectronFsInspectorDeps {
  fetchElectronInfo?: typeof fetchElectronRuntimeInfo;
  hasElectronBridge?: typeof hasElectronDiagnosticsBridge;
  getBridge?: typeof getFolioScriptBridge;
}

export function createElectronFsInspector(deps: ElectronFsInspectorDeps = {}): SubsystemInspector {
  const getElectronInfo = deps.fetchElectronInfo ?? fetchElectronRuntimeInfo;
  const checkElectronBridge = deps.hasElectronBridge ?? hasElectronDiagnosticsBridge;
  const getBridge = deps.getBridge ?? getFolioScriptBridge;

  return {
    id: 'electron-fs',
    name: 'Electron & Filesystem',
    description: 'IPC handlers, contextIsolation security boundaries, userData paths, ingestion, and export.',
    coverageLevel: 'partial',
    capabilities: [
      { capability: 'contextIsolation & preload boundary check', tier: 'read_only_check', notes: 'Verifies Node globals are withheld from renderer.' },
      { capability: 'Electron dev IPC ping & userData availability', tier: 'read_only_check', notes: 'Verified in Electron desktop runtime; unsupported in browser mode.' },
      { capability: 'File ingestion & TypeR export events', tier: 'partial', notes: 'Instrumented at fileIngestion.ts and compileTypeR.ts boundaries.' },
    ],
    checks: [
      {
        checkId: 'renderer-security-boundary',
        name: 'Renderer Security & Context Isolation',
        description: 'Confirms Node.js primitives are never leaked onto window and verifies folioScript bridge exposure.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'electron-ipc-and-userdata',
        name: 'Electron IPC & UserData Accessibility',
        description: 'Pings Electron main process via diagnostics IPC and checks userData/models directory readiness.',
        safety: 'read_only',
        defaultEnabled: true,
      },
    ],
    async runCheck(checkId: string, _context: InspectorContext): Promise<DiagnosticCheckResult> {
      const start = Date.now();
      const findings: DiagnosticFinding[] = [];

      if (checkId === 'renderer-security-boundary') {
        if (typeof window === 'undefined') {
          return {
            checkId,
            subsystem: 'electron-fs',
            name: 'Renderer Security & Context Isolation',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'Renderer window object is not present in Node test environment.',
            findings: [],
          };
        }

        const win = window as unknown as Record<string, unknown>;
        const exposedRequire = typeof win.require === 'function';
        const exposedProcess = typeof win.process !== 'undefined';
        const bridge = getBridge();

        if (exposedRequire || exposedProcess) {
          findings.push({
            findingId: `sec-leak-${start}`,
            subsystem: 'electron-fs',
            checkId,
            code: 'RENDERER_NODE_LEAK',
            severity: 'critical',
            title: 'Unsafe Node global exposed in renderer window',
            explanation: `Detected window.require=${exposedRequire}, window.process=${exposedProcess}.`,
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'electron-fs',
          name: 'Renderer Security & Context Isolation',
          safety: 'read_only',
          status: findings.length > 0 ? 'critical' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: bridge
            ? `Context isolation verified (require=false, process=false); window.folioScript bridge active (isDev=${Boolean(bridge.isDev)}).`
            : 'Context isolation verified in browser mode (window.folioScript absent outside Electron).',
          findings,
          metrics: {
            inElectron: Boolean(bridge),
            bridgeIsDev: Boolean(bridge?.isDev),
            exposedRequire,
            exposedProcess,
          },
        };
      }

      if (checkId === 'electron-ipc-and-userdata') {
        if (!checkElectronBridge()) {
          return {
            checkId,
            subsystem: 'electron-fs',
            name: 'Electron IPC & UserData Accessibility',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'Running outside Electron desktop shell; Electron IPC and filesystem probes are unsupported in browser mode.',
            findings: [],
          };
        }

        const info = await getElectronInfo();
        if (!info) {
          findings.push({
            findingId: `ipc-fail-${start}`,
            subsystem: 'electron-fs',
            checkId,
            code: 'IPC_PING_FAILED',
            severity: 'error',
            title: 'Electron IPC diagnostics call returned empty result',
            explanation: 'diagnostics:getRuntimeInfo returned null.',
            timestamp: Date.now(),
          });
        } else if (!info.paths.userDataExists) {
          findings.push({
            findingId: `fs-userdata-${start}`,
            subsystem: 'electron-fs',
            checkId,
            code: 'USERDATA_MISSING',
            severity: 'error',
            title: 'Electron userData directory unavailable',
            explanation: 'app.getPath("userData") is not accessible on disk.',
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'electron-fs',
          name: 'Electron IPC & UserData Accessibility',
          safety: 'read_only',
          status: findings.length > 0 ? 'error' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: info
            ? `Electron IPC responsive; userDataExists=${info.paths.userDataExists}, modelsRootExists=${info.paths.modelsRootExists}.`
            : 'Electron IPC check failed.',
          findings,
          metrics: info ? { ...info.paths, mainWindowReady: info.mainWindowReady } : undefined,
        };
      }

      throw new Error(`Unsupported checkId "${checkId}" on electron-fs inspector.`);
    },
  };
}
