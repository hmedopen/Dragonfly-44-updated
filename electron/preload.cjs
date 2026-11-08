const { contextBridge, ipcRenderer } = require('electron');

const isDev = process.env.NODE_ENV === 'development' || !process.resourcesPath?.includes('app.asar');

const trainingStudioBridge = isDev
  ? {
      selectFolder: () => ipcRenderer.invoke('training:selectFolder'),
      scanFolder: (folderPath) => ipcRenderer.invoke('training:scanFolder', folderPath),
      readImageFile: (filePath) => ipcRenderer.invoke('training:readImageFile', filePath),
    }
  : undefined;

const appBridge = {
  platform: process.platform,
  version: '1.0.0',
  isDev,
  trainingStudio: trainingStudioBridge,
};

contextBridge.exposeInMainWorld('folioScript', appBridge);
contextBridge.exposeInMainWorld('dragonfly', appBridge);
