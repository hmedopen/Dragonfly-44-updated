let dialog = null;
try {
  const electron = require('electron');
  dialog = electron?.dialog || null;
} catch {
  dialog = null;
}

const fs = require('fs');
const path = require('path');
const {
  fetchMetadata,
  downloadPageImage,
  createZipBuffer,
  createZipFromDisk,
  readPageFile,
  cleanupAcquisition,
  validateImageBuffer,
  isSsrfSafeUrl,
} = require('./chapterSnatchBackend.cjs');

function registerChapterSnatchIpc(ipcMain, getMainWindow) {
  // 1. Fetch Metadata IPC handler
  ipcMain.handle('chapterSnatch:fetchMetadata', async (_event, targetUrl) => {
    return await fetchMetadata(targetUrl);
  });

  // 2. Download Page Image IPC handler
  ipcMain.handle('chapterSnatch:downloadPageImage', async (_event, payload) => {
    const { imageUrl, referer, acquisitionId, filename } = payload || {};
    return await downloadPageImage(imageUrl, referer, { acquisitionId, filename });
  });

  // 3. Save as ZIP native file dialog IPC handler
  ipcMain.handle('chapterSnatch:saveZip', async (_event, payload) => {
    const { defaultFilename, entries, pageFiles } = payload || {};

    const rawName = typeof defaultFilename === 'string' ? defaultFilename : 'Chapter.zip';
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const fileNameWithExt = safeName.endsWith('.zip') ? safeName : `${safeName}.zip`;

    const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;

    if (!dialog) {
      throw new Error('Native file dialog is not available in this environment.');
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Chapter as ZIP',
      defaultPath: fileNameWithExt,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });

    if (result.canceled || !result.filePath) {
      return { saved: false, canceled: true };
    }

    // Disk-backed export path (streaming without Base64 memory overhead)
    if (pageFiles && Array.isArray(pageFiles) && pageFiles.length > 0) {
      const totalBytes = await createZipFromDisk(pageFiles, result.filePath);
      return {
        saved: true,
        canceled: false,
        filePath: result.filePath,
        totalBytes,
      };
    }

    // Fallback: In-memory Base64 entries
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      throw new Error('No entries provided for ZIP export.');
    }

    const decodedEntries = entries.map((e) => ({
      filename: path.basename(e.filename),
      data: Buffer.from(e.dataBase64, 'base64'),
    }));

    const zipBuffer = createZipBuffer(decodedEntries);
    await fs.promises.writeFile(result.filePath, zipBuffer);

    return {
      saved: true,
      canceled: false,
      filePath: result.filePath,
      totalBytes: zipBuffer.length,
    };
  });

  // 4. Read single page file for Workspace import on-demand
  ipcMain.handle('chapterSnatch:readPage', async (_event, payload) => {
    const { acquisitionId, filename } = payload || {};
    return await readPageFile(acquisitionId, filename);
  });

  // 5. Cleanup temporary acquisition files
  ipcMain.handle('chapterSnatch:cleanupAcquisition', async (_event, acquisitionId) => {
    await cleanupAcquisition(acquisitionId);
    return { success: true };
  });
}

module.exports = {
  registerChapterSnatchIpc,
  fetchMetadata,
  downloadPageImage,
  createZipBuffer,
  createZipFromDisk,
  readPageFile,
  cleanupAcquisition,
  validateImageBuffer,
  isSsrfSafeUrl,
};
