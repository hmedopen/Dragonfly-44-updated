const { app, BrowserWindow, ipcMain, dialog, nativeTheme } = require('electron');
nativeTheme.themeSource = 'dark';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createModelManager } = require('./modelManager.cjs');

app.name = 'Folio Script';

let mainWindow;
let modelManager;

function getModelManager() {
  if (!modelManager) {
    modelManager = createModelManager({
      userDataDir: app.getPath('userData'),
    });
  }
  return modelManager;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Folio Script',
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#000000',
    icon: path.join(__dirname, '../public/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const devUrl = 'http://localhost:5173';
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Development Feature: Training Studio IPC Handlers
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

if (isDev) {
  // 1. Select Folder via Native Dialog
  ipcMain.handle('training:selectFolder', async () => {
    if (!isDev) {
      throw new Error('Training Studio is strictly restricted to development builds.');
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Screenshot Training Folder',
      properties: ['openDirectory', 'dontAddToRecent'],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // 2. Scan Folder for Supported Images (.png, .jpg, .jpeg, .webp)
  ipcMain.handle('training:scanFolder', async (_event, folderPath) => {
    if (!isDev) {
      throw new Error('Training Studio is strictly restricted to development builds.');
    }
    if (!folderPath || typeof folderPath !== 'string') {
      throw new Error('Invalid folder path provided.');
    }

    const supportedExts = new Set(['.png', '.jpg', '.jpeg', '.webp']);
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    const candidates = [];
    let ignoredCount = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!supportedExts.has(ext)) {
        ignoredCount++;
        continue;
      }

      const fullPath = path.join(folderPath, entry.name);
      try {
        const stats = await fs.promises.stat(fullPath);
        // Compute SHA-256 hash for duplicate detection
        const fileBuffer = await fs.promises.readFile(fullPath);
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        let mimeType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        else if (ext === '.webp') mimeType = 'image/webp';

        candidates.push({
          fileName: entry.name,
          filePath: fullPath,
          fileSize: stats.size,
          modifiedTime: stats.mtimeMs,
          mimeType,
          sha256: hash,
        });
      } catch (e) {
        console.warn(`[TrainingStudio] Failed reading candidate: ${entry.name}`, e);
      }
    }

    // Sort naturally by filename
    candidates.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }));

    return {
      candidates,
      ignoredCount,
      totalScanned: entries.length,
    };
  });

  // 3. Read image as Data URL
  ipcMain.handle('training:readImageFile', async (_event, filePath) => {
    if (!isDev) {
      throw new Error('Training Studio is strictly restricted to development builds.');
    }
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path provided.');
    }

    const ext = path.extname(filePath).toLowerCase();
    let mimeType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';

    const fileBuffer = await fs.promises.readFile(filePath);
    const base64 = fileBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  });
}

// Allowlisted Local OCR Model Management IPC Handlers
ipcMain.handle('localModels:getManifest', async () => {
  return getModelManager().getManifest();
});

ipcMain.handle('localModels:getStatus', async (_event, modelId) => {
  if (modelId !== undefined && typeof modelId !== 'string') {
    throw new Error('Invalid modelId parameter.');
  }
  return getModelManager().getModelStatus(modelId);
});

ipcMain.handle('localModels:downloadModel', async (event, modelId) => {
  if (typeof modelId !== 'string' || !modelId) {
    throw new Error('Invalid modelId parameter.');
  }
  return getModelManager().downloadModel(modelId, (progress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('localModels:progress', progress);
    }
  });
});

ipcMain.handle('localModels:cancelDownload', async (_event, modelId) => {
  if (typeof modelId !== 'string' || !modelId) {
    throw new Error('Invalid modelId parameter.');
  }
  return getModelManager().cancelDownload(modelId);
});

ipcMain.handle('localModels:removeModel', async (_event, modelId) => {
  if (typeof modelId !== 'string' || !modelId) {
    throw new Error('Invalid modelId parameter.');
  }
  return getModelManager().removeModel(modelId);
});

ipcMain.handle('localModels:readModelAssets', async (_event, modelId) => {
  if (typeof modelId !== 'string' || !modelId) {
    throw new Error('Invalid modelId parameter.');
  }
  return getModelManager().readModelAssets(modelId);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
