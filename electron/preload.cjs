const { contextBridge, ipcRenderer } = require('electron');

const isDev = process.env.NODE_ENV === 'development' || !process.resourcesPath?.includes('app.asar');

const trainingStudioBridge = isDev
  ? {
      selectFolder: () => ipcRenderer.invoke('training:selectFolder'),
      scanFolder: (folderPath) => ipcRenderer.invoke('training:scanFolder', folderPath),
      readImageFile: (filePath) => ipcRenderer.invoke('training:readImageFile', filePath),
    }
  : undefined;

const diagnosticsBridge = isDev
  ? {
      getRuntimeInfo: () => ipcRenderer.invoke('diagnostics:getRuntimeInfo'),
      inspectModelCache: () => ipcRenderer.invoke('diagnostics:inspectModelCache'),
      exportReportFile: (payload) => ipcRenderer.invoke('diagnostics:exportReportFile', payload),
    }
  : undefined;

const localModelsBridge = {
  getManifest: () => ipcRenderer.invoke('localModels:getManifest'),
  getStatus: (modelId) => ipcRenderer.invoke('localModels:getStatus', modelId),
  downloadModel: (modelId) => ipcRenderer.invoke('localModels:downloadModel', modelId),
  cancelDownload: (modelId) => ipcRenderer.invoke('localModels:cancelDownload', modelId),
  removeModel: (modelId) => ipcRenderer.invoke('localModels:removeModel', modelId),
  readModelAssets: (modelId) => ipcRenderer.invoke('localModels:readModelAssets', modelId),
  onDownloadProgress: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('localModels:progress', handler);
    return () => ipcRenderer.removeListener('localModels:progress', handler);
  },
};

const chapterSnatchBridge = {
  fetchMetadata: (url) => ipcRenderer.invoke('chapterSnatch:fetchMetadata', url),
  downloadPageImage: (imageUrl, referer) => ipcRenderer.invoke('chapterSnatch:downloadPageImage', { imageUrl, referer }),
  saveZip: (payload) => ipcRenderer.invoke('chapterSnatch:saveZip', payload),
};

const appBridge = {
  platform: process.platform,
  version: '1.0.0',
  isDev,
  trainingStudio: trainingStudioBridge,
  diagnostics: diagnosticsBridge,
  localModels: localModelsBridge,
  chapterSnatch: chapterSnatchBridge,
};

contextBridge.exposeInMainWorld('folioScript', appBridge);
