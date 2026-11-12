const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  fetchMetadata,
  downloadPageImage,
  createZipBuffer,
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
    const { imageUrl, referer } = payload || {};
    return await downloadPageImage(imageUrl, referer);
  });

  // 3. Save as ZIP native file dialog IPC handler
  ipcMain.handle('chapterSnatch:saveZip', async (_event, payload) => {
    const { defaultFilename, entries } = payload || {};
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      throw new Error('No entries provided for ZIP export.');
    }

    const rawName = typeof defaultFilename === 'string' ? defaultFilename : 'Chapter.zip';
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const fileNameWithExt = safeName.endsWith('.zip') ? safeName : `${safeName}.zip`;

    const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Chapter as ZIP',
      defaultPath: fileNameWithExt,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });

    if (result.canceled || !result.filePath) {
      return { saved: false, canceled: true };
    }

    // Decode entries from Base64
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
}

module.exports = {
  registerChapterSnatchIpc,
  isSsrfSafeUrl,
  createZipBuffer,
  validateImageBuffer,
};
