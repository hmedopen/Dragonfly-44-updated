const { isValidModelId } = require('./modelManager.cjs');

function assertValidModelIdArg(modelId, extraArgsCount) {
  if (extraArgsCount > 0) {
    throw new Error('Unexpected extra IPC arguments.');
  }
  if (!isValidModelId(modelId)) {
    throw new Error('Invalid modelId parameter.');
  }
}

/**
 * Registers allowlisted, main-process-validated local model management IPC handlers.
 * Never accepts arbitrary URLs, filesystem destinations, or manifest overrides from renderer IPC.
 */
function registerLocalModelIpcHandlers(ipcMain, getModelManager) {
  ipcMain.handle('localModels:getManifest', async (_event, ...args) => {
    if (args.length > 0) {
      throw new Error('Unexpected IPC arguments for localModels:getManifest.');
    }
    return getModelManager().getManifest();
  });

  ipcMain.handle('localModels:getStatus', async (_event, ...args) => {
    if (args.length > 1) {
      throw new Error('Unexpected extra IPC arguments.');
    }
    const modelId = args[0];
    if (modelId !== undefined && !isValidModelId(modelId)) {
      throw new Error('Invalid modelId parameter.');
    }
    return getModelManager().getModelStatus(modelId);
  });

  ipcMain.handle('localModels:downloadModel', async (event, modelId, ...extra) => {
    assertValidModelIdArg(modelId, extra.length);
    return getModelManager().downloadModel(modelId, (progress) => {
      if (event?.sender && typeof event.sender.isDestroyed === 'function' && !event.sender.isDestroyed()) {
        event.sender.send('localModels:progress', progress);
      }
    });
  });

  ipcMain.handle('localModels:cancelDownload', async (_event, modelId, ...extra) => {
    assertValidModelIdArg(modelId, extra.length);
    return getModelManager().cancelDownload(modelId);
  });

  ipcMain.handle('localModels:removeModel', async (_event, modelId, ...extra) => {
    assertValidModelIdArg(modelId, extra.length);
    return getModelManager().removeModel(modelId);
  });

  ipcMain.handle('localModels:readModelAssets', async (_event, modelId, ...extra) => {
    assertValidModelIdArg(modelId, extra.length);
    return getModelManager().readModelAssets(modelId);
  });
}

module.exports = {
  registerLocalModelIpcHandlers,
};
