const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

app.name = 'Folio Script';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Folio Script',
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#000000',
      symbolColor: '#a1a1aa',
      height: 40,
    },
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
          hash,
        });
      } catch (err) {
        console.warn(`[TrainingStudio] Could not read candidate image: ${fullPath}`, err);
      }
    }

    // Natural alphanumeric sort by filename
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    candidates.sort((a, b) => collator.compare(a.fileName, b.fileName));

    return {
      folderPath,
      candidates,
      ignoredCount,
    };
  });

  // 3. Read specific image file into base64 for safe managed import
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
    return {
      filePath,
      base64: fileBuffer.toString('base64'),
      mimeType,
      size: fileBuffer.length,
    };
  });
} else {
  // In production builds, explicitly reject any call to training IPC channels
  ipcMain.handle('training:selectFolder', () => {
    throw new Error('Training Studio is strictly restricted to development builds.');
  });
  ipcMain.handle('training:scanFolder', () => {
    throw new Error('Training Studio is strictly restricted to development builds.');
  });
  ipcMain.handle('training:readImageFile', () => {
    throw new Error('Training Studio is strictly restricted to development builds.');
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
