export interface ElectronRuntimeInfo {
  isDev: boolean;
  isPackaged: boolean;
  appName: string;
  appVersion: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  electronVersion: string;
  chromeVersion: string;
  uptimeSec: number;
  mainMemory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  appMetrics: Array<{
    pid: number;
    type: string;
    name: string;
    cpuPercent: number | null;
    workingSetSizeKB: number | null;
    privateBytesKB: number | null;
  }>;
  paths: {
    userDataExists: boolean;
    modelsRootExists: boolean;
  };
  mainWindowReady: boolean;
  mainWindowBounds: { x: number; y: number; width: number; height: number } | null;
  timestamp: number;
}

export interface ElectronModelCacheInspection {
  isProduction: boolean;
  modelsRootExists: boolean;
  manifestVersion: number;
  statuses: Array<{
    modelId: string;
    state: string;
    installedRevision: string | null;
    verifiedBytes: number;
    expectedBytes: number;
    missingFiles: string[];
    corruptFiles: string[];
    error?: string;
    policy?: Record<string, unknown>;
  }>;
  timestamp: number;
}

interface FolioScriptWindowBridge {
  platform?: string;
  version?: string;
  isDev?: boolean;
  localModels?: {
    getManifest: () => Promise<unknown>;
    getStatus: (modelId?: string) => Promise<unknown>;
  };
  diagnostics?: {
    getRuntimeInfo: () => Promise<ElectronRuntimeInfo>;
    inspectModelCache: () => Promise<ElectronModelCacheInspection>;
    exportReportFile: (payload: {
      content: string;
      format: 'json' | 'markdown';
      defaultName: string;
    }) => Promise<{ saved: boolean; canceled: boolean; fileName?: string; bytesWritten?: number }>;
  };
}

export function getFolioScriptBridge(): FolioScriptWindowBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { folioScript?: FolioScriptWindowBridge }).folioScript;
}

export function hasElectronDiagnosticsBridge(): boolean {
  const bridge = getFolioScriptBridge();
  return Boolean(bridge && bridge.diagnostics && typeof bridge.diagnostics.getRuntimeInfo === 'function');
}

export async function fetchElectronRuntimeInfo(): Promise<ElectronRuntimeInfo | null> {
  const bridge = getFolioScriptBridge();
  if (!bridge?.diagnostics?.getRuntimeInfo) return null;
  return await bridge.diagnostics.getRuntimeInfo();
}

export async function fetchElectronModelCacheInspection(): Promise<ElectronModelCacheInspection | null> {
  const bridge = getFolioScriptBridge();
  if (!bridge?.diagnostics?.inspectModelCache) return null;
  return await bridge.diagnostics.inspectModelCache();
}

export async function saveDiagnosticFileViaElectron(payload: {
  content: string;
  format: 'json' | 'markdown';
  defaultName: string;
}): Promise<{ saved: boolean; canceled: boolean; fileName?: string; bytesWritten?: number } | null> {
  const bridge = getFolioScriptBridge();
  if (!bridge?.diagnostics?.exportReportFile) return null;
  return await bridge.diagnostics.exportReportFile(payload);
}
