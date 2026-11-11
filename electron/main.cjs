const { app, BrowserWindow, ipcMain, dialog, nativeTheme } = require('electron');
nativeTheme.themeSource = 'dark';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createModelManager } = require('./modelManager.cjs');
const { registerLocalModelIpcHandlers } = require('./localModelIpc.cjs');

app.name = 'Folio Script';

const isProduction = Boolean(app.isPackaged) || process.env.NODE_ENV === 'production';
const isDev = !isProduction;

let mainWindow;
let modelManager;

function getModelManager() {
  if (!modelManager) {
    modelManager = createModelManager({
      userDataDir: app.getPath('userData'),
      isProduction,
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

  if (isDev) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Development Feature: Training Studio IPC Handlers

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

  // Development Feature: System Diagnostics Read-Only Telemetry & Safe Export IPC
  ipcMain.handle('diagnostics:getRuntimeInfo', async () => {
    if (!isDev) {
      throw new Error('System Diagnostics is strictly restricted to development builds.');
    }
    const userDataDir = app.getPath('userData');
    const modelsRoot = path.join(userDataDir, 'folio-models');
    let modelsRootExists = false;
    try {
      await fs.promises.access(modelsRoot, fs.constants.R_OK);
      modelsRootExists = true;
    } catch {
      modelsRootExists = false;
    }

    const memory = process.memoryUsage();
    const metrics = typeof app.getAppMetrics === 'function'
      ? app.getAppMetrics().map((m) => ({
          pid: m.pid,
          type: m.type,
          name: m.name || m.serviceName || m.type,
          cpuPercent: typeof m.cpu?.percentCPUUsage === 'number' ? Number(m.cpu.percentCPUUsage.toFixed(2)) : null,
          workingSetSizeKB: m.memory?.workingSetSize ?? null,
          privateBytesKB: m.memory?.privateBytes ?? null,
        }))
      : [];

    return {
      isDev,
      isPackaged: Boolean(app.isPackaged),
      appName: app.name,
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      uptimeSec: Math.round(process.uptime()),
      mainMemory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
      },
      appMetrics: metrics,
      paths: {
        userDataExists: fs.existsSync(userDataDir),
        modelsRootExists,
      },
      mainWindowReady: Boolean(mainWindow && !mainWindow.isDestroyed()),
      mainWindowBounds: mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null,
      timestamp: Date.now(),
    };
  });

  ipcMain.handle('diagnostics:inspectModelCache', async () => {
    if (!isDev) {
      throw new Error('System Diagnostics is strictly restricted to development builds.');
    }
    const mgr = getModelManager();
    const manifest = mgr.getManifest();
    const statuses = await mgr.getModelStatus();
    return {
      isProduction: mgr.isProduction,
      modelsRootExists: fs.existsSync(mgr.modelsRoot),
      manifestVersion: manifest.manifestVersion,
      statuses,
      timestamp: Date.now(),
    };
  });

  ipcMain.handle('diagnostics:exportReportFile', async (_event, payload) => {
    if (!isDev) {
      throw new Error('System Diagnostics is strictly restricted to development builds.');
    }
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid export payload.');
    }
    const content = typeof payload.content === 'string' ? payload.content : '';
    const format = payload.format === 'markdown' ? 'markdown' : 'json';
    const rawDefaultName = typeof payload.defaultName === 'string' ? payload.defaultName : 'folio-diagnostics-report';
    const safeName = rawDefaultName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const ext = format === 'markdown' ? 'md' : 'json';

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Diagnostic Report',
      defaultPath: `${safeName}.${ext}`,
      filters:
        format === 'markdown'
          ? [{ name: 'Markdown Report', extensions: ['md', 'txt'] }]
          : [{ name: 'JSON Technical Report', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) {
      return { saved: false, canceled: true };
    }

    await fs.promises.writeFile(result.filePath, content, 'utf8');
    return {
      saved: true,
      canceled: false,
      fileName: path.basename(result.filePath),
      bytesWritten: Buffer.byteLength(content, 'utf8'),
    };
  });
}

// Allowlisted Local OCR Model Management IPC Handlers
registerLocalModelIpcHandlers(ipcMain, getModelManager);

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
