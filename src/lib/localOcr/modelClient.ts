import type {
  ModelAssetPayload,
  ModelDownloadProgress,
  ModelStatusInfo,
} from '../../types/localOcr.ts';
import type { LocalModelManifest } from './modelManifest.ts';

export interface LocalModelAssetProvider {
  getManifest: () => Promise<LocalModelManifest>;
  getStatus: (modelId?: string) => Promise<ModelStatusInfo | ModelStatusInfo[]>;
  downloadModel: (modelId: string) => Promise<ModelStatusInfo>;
  cancelDownload: (modelId: string) => Promise<boolean>;
  removeModel: (modelId: string) => Promise<ModelStatusInfo>;
  readModelAssets: (modelId: string) => Promise<ModelAssetPayload>;
  onDownloadProgress?: (listener: (progress: ModelDownloadProgress) => void) => () => void;
}

interface ElectronLocalModelsBridge {
  getManifest: () => Promise<LocalModelManifest>;
  getStatus: (modelId?: string) => Promise<ModelStatusInfo | ModelStatusInfo[]>;
  downloadModel: (modelId: string) => Promise<ModelStatusInfo>;
  cancelDownload: (modelId: string) => Promise<boolean>;
  removeModel: (modelId: string) => Promise<ModelStatusInfo>;
  readModelAssets: (modelId: string) => Promise<ModelAssetPayload>;
  onDownloadProgress: (listener: (progress: ModelDownloadProgress) => void) => () => void;
}

function getElectronBridge(): ElectronLocalModelsBridge | undefined {
  const g = globalThis as {
    window?: { folioScript?: { localModels?: ElectronLocalModelsBridge } };
  };
  return g.window?.folioScript?.localModels;
}

export function createElectronModelAssetProvider(): LocalModelAssetProvider {
  const bridge = getElectronBridge();
  if (!bridge) {
    throw new Error(
      'Local model management bridge (window.folioScript.localModels) is unavailable outside the Electron desktop runtime.'
    );
  }
  return {
    getManifest: () => bridge.getManifest(),
    getStatus: (modelId?: string) => bridge.getStatus(modelId),
    downloadModel: (modelId: string) => bridge.downloadModel(modelId),
    cancelDownload: (modelId: string) => bridge.cancelDownload(modelId),
    removeModel: (modelId: string) => bridge.removeModel(modelId),
    readModelAssets: (modelId: string) => bridge.readModelAssets(modelId),
    onDownloadProgress: (listener) => bridge.onDownloadProgress(listener),
  };
}

export function createDefaultModelAssetProvider(): LocalModelAssetProvider | null {
  const bridge = getElectronBridge();
  if (!bridge) return null;
  return createElectronModelAssetProvider();
}
