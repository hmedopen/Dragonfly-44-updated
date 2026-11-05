const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('dragonfly', {
  platform: process.platform,
  version: '0.5.0',
});
