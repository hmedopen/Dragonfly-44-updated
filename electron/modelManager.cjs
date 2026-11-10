const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MANIFEST_PATH = path.join(__dirname, '../src/lib/localOcr/modelManifest.json');

const MODEL_ID_RE = /^[a-zA-Z0-9._-]+$/;
const ALLOWED_REDISTRIBUTION_STATUSES = new Set([
  'dev_only_unverified_provenance',
  'dev_only_noncommercial_dataset',
  'approved_for_redistribution',
]);

function isValidModelId(modelId) {
  return typeof modelId === 'string' && MODEL_ID_RE.test(modelId) && !modelId.includes('..');
}

function loadDefaultManifest() {
  const raw = fs.readFileSync(DEFAULT_MANIFEST_PATH, 'utf8');
  return JSON.parse(raw);
}

function getRevisionKey(entry) {
  const revs = Object.values(entry.pinnedRevisions || {});
  if (revs.length === 0) {
    throw new Error(`Model "${entry.modelId}" has no pinned revisions.`);
  }
  return revs.map((r) => String(r).slice(0, 12)).join('_');
}

function evaluateModelPolicy(entry, options = {}) {
  const isProduction = options.isProduction !== undefined ? Boolean(options.isProduction) : true;
  const status = entry && entry.redistributionStatus;
  const validStatus = ALLOWED_REDISTRIBUTION_STATUSES.has(status);

  // Keep all five distribution/provenance statuses explicitly distinct and fail-closed
  const provenanceUnresolved =
    !validStatus ||
    status === 'dev_only_unverified_provenance' ||
    entry.provenanceUnresolved === true;
  const developmentOnly =
    !validStatus ||
    status !== 'approved_for_redistribution' ||
    entry.developmentOnly === true;
  const redistributionApproved =
    validStatus &&
    status === 'approved_for_redistribution' &&
    entry.redistributionApproved !== false &&
    !developmentOnly;
  const commercialDistributionCleared =
    redistributionApproved &&
    !provenanceUnresolved &&
    entry.commercialDistributionCleared === true;

  const productionEligible =
    validStatus &&
    !developmentOnly &&
    redistributionApproved &&
    !provenanceUnresolved &&
    entry.downloadPermitted !== false;

  const downloadPermitted = isProduction
    ? productionEligible
    : validStatus && entry.downloadPermitted !== false;
  const activationPermitted = isProduction ? productionEligible : validStatus;

  let rejectionReason = null;
  if (!validStatus) {
    rejectionReason = `Model "${entry?.modelId || 'unknown'}" has invalid or missing redistributionStatus "${String(status)}".`;
  } else if (isProduction && !productionEligible) {
    rejectionReason = `Model "${entry.modelId}" is not eligible in production builds (redistributionStatus="${status}", developmentOnly=${developmentOnly}, provenanceUnresolved=${provenanceUnresolved}).`;
  }

  return {
    developmentOnly,
    downloadPermitted,
    activationPermitted,
    redistributionApproved,
    commercialDistributionCleared,
    provenanceUnresolved,
    rejectionReason,
  };
}

function validateManifestEntry(entry) {
  if (!entry || !isValidModelId(entry.modelId)) {
    throw new Error('Manifest entry is missing a valid modelId.');
  }
  if (typeof entry.declaredLicense !== 'string' || !entry.declaredLicense.trim()) {
    throw new Error(`Model "${entry.modelId}" is missing declaredLicense.`);
  }
  if (typeof entry.modelCardUrl !== 'string' || !entry.modelCardUrl.startsWith('https://')) {
    throw new Error(`Model "${entry.modelId}" must define an HTTPS modelCardUrl.`);
  }
  if (!ALLOWED_REDISTRIBUTION_STATUSES.has(entry.redistributionStatus)) {
    throw new Error(
      `Model "${entry.modelId}" has invalid redistributionStatus "${String(entry.redistributionStatus)}".`
    );
  }
  if (!Array.isArray(entry.files) || entry.files.length === 0) {
    throw new Error(`Model "${entry.modelId}" defines no files.`);
  }
  const pinnedEntries = Object.entries(entry.pinnedRevisions || {});
  if (pinnedEntries.length === 0) {
    throw new Error(`Model "${entry.modelId}" has no pinnedRevisions.`);
  }
  for (const [repo, rev] of pinnedEntries) {
    if (!/^[0-9a-f]{40}$/i.test(String(rev))) {
      throw new Error(`Model "${entry.modelId}" revision for "${repo}" is not a pinned 40-char commit SHA.`);
    }
  }
  for (const file of entry.files) {
    if (
      typeof file.relativePath !== 'string' ||
      !file.relativePath ||
      file.relativePath.includes('..') ||
      file.relativePath.includes('\0') ||
      path.isAbsolute(file.relativePath) ||
      file.relativePath.startsWith('/') ||
      file.relativePath.startsWith('\\')
    ) {
      throw new Error(`Model "${entry.modelId}" defines an unsafe relativePath "${String(file.relativePath)}".`);
    }
    const pinnedRepoRev = entry.pinnedRevisions && entry.pinnedRevisions[file.upstreamRepo];
    if (!pinnedRepoRev || pinnedRepoRev !== file.revision) {
      throw new Error(
        `File "${file.relativePath}" in "${entry.modelId}" revision does not match pinnedRevisions["${String(file.upstreamRepo)}"].`
      );
    }
    if (!/^[0-9a-f]{40}$/i.test(String(file.revision || ''))) {
      throw new Error(`File "${file.relativePath}" in "${entry.modelId}" is missing a pinned 40-char commit SHA.`);
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(String(file.url || ''));
    } catch {
      throw new Error(`File "${file.relativePath}" in "${entry.modelId}" has an invalid URL.`);
    }
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
      throw new Error(`File "${file.relativePath}" in "${entry.modelId}" must use clean HTTPS.`);
    }
    if (/\/(main|master|latest)\//i.test(String(file.url || ''))) {
      throw new Error(`File "${file.relativePath}" in "${entry.modelId}" uses a moving branch or latest URL.`);
    }
    if (!String(file.url || '').includes(String(file.revision))) {
      throw new Error(`File "${file.relativePath}" in "${entry.modelId}" URL does not reference its pinned revision.`);
    }
    if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0) {
      throw new Error(`File "${file.relativePath}" in "${entry.modelId}" has invalid sizeBytes.`);
    }
    if (!/^[0-9a-f]{64}$/i.test(String(file.sha256 || ''))) {
      throw new Error(`File "${file.relativePath}" in "${entry.modelId}" is missing a valid SHA-256 checksum.`);
    }
  }
}

async function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function safeUnlink(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
}

function createModelManager(options) {
  const {
    userDataDir,
    manifest = loadDefaultManifest(),
    fetchImpl = globalThis.fetch,
    isProduction = true,
  } = options || {};

  if (!userDataDir || typeof userDataDir !== 'string') {
    throw new Error('createModelManager requires a valid userDataDir.');
  }

  const productionMode = Boolean(isProduction);
  const modelsRoot = path.join(userDataDir, 'folio-models');
  const activeDownloads = new Map(); // modelId -> { controller: AbortController, promise: Promise }

  function resolveEntry(modelId) {
    if (!isValidModelId(modelId)) {
      throw new Error(`Invalid model ID: "${String(modelId)}".`);
    }
    const entry = (manifest.models || []).find((m) => m.modelId === modelId);
    if (!entry) {
      throw new Error(`Unknown model ID: "${modelId}".`);
    }
    validateManifestEntry(entry);
    return entry;
  }

  function getPolicyForEntry(entry) {
    return evaluateModelPolicy(entry, { isProduction: productionMode });
  }

  function getModelDir(entry) {
    // Sanitize segments to prevent path traversal
    const safeId = entry.modelId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const revKey = getRevisionKey(entry).replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(modelsRoot, safeId, revKey);
  }

  function resolveSafeFilePath(modelDir, relativePath) {
    const normalized = path.normalize(relativePath).replace(/^([/\\])+/, '');
    const resolved = path.resolve(modelDir, normalized);
    const rootResolved = path.resolve(modelDir);
    if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
      throw new Error(`Unsafe relative path "${relativePath}" in manifest.`);
    }
    return resolved;
  }

  function getManifest() {
    return manifest;
  }

  async function getModelStatus(modelId) {
    if (!modelId) {
      const statuses = [];
      for (const entry of manifest.models || []) {
        statuses.push(await getModelStatus(entry.modelId));
      }
      return statuses;
    }

    const entry = resolveEntry(modelId);
    const policy = getPolicyForEntry(entry);
    const modelDir = getModelDir(entry);
    const expectedBytes = entry.files.reduce((sum, f) => sum + Number(f.sizeBytes || 0), 0);

    if (!policy.activationPermitted) {
      return {
        modelId,
        state: 'unsupported',
        installedRevision: null,
        verifiedBytes: 0,
        expectedBytes,
        missingFiles: [],
        corruptFiles: [],
        error: policy.rejectionReason,
        policy,
      };
    }

    if (activeDownloads.has(modelId)) {
      return {
        modelId,
        state: 'downloading',
        installedRevision: null,
        verifiedBytes: 0,
        expectedBytes,
        missingFiles: [],
        corruptFiles: [],
        policy,
      };
    }

    const missingFiles = [];
    const corruptFiles = [];
    let verifiedBytes = 0;

    for (const fileSpec of entry.files) {
      const targetPath = resolveSafeFilePath(modelDir, fileSpec.relativePath);
      try {
        const stat = await fs.promises.stat(targetPath);
        if (!stat.isFile()) {
          missingFiles.push(fileSpec.relativePath);
          continue;
        }
        if (stat.size !== fileSpec.sizeBytes) {
          corruptFiles.push(fileSpec.relativePath);
          continue;
        }
        const actualHash = await computeFileSha256(targetPath);
        if (actualHash.toLowerCase() !== fileSpec.sha256.toLowerCase()) {
          corruptFiles.push(fileSpec.relativePath);
          continue;
        }
        verifiedBytes += stat.size;
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          missingFiles.push(fileSpec.relativePath);
        } else {
          corruptFiles.push(fileSpec.relativePath);
        }
      }
    }

    let state = 'not_installed';
    if (corruptFiles.length > 0) {
      state = 'corrupt';
    } else if (missingFiles.length === 0) {
      state = 'installed';
    } else if (missingFiles.length < entry.files.length) {
      state = 'corrupt';
    }

    return {
      modelId,
      state,
      installedRevision: state === 'installed' ? getRevisionKey(entry) : null,
      verifiedBytes,
      expectedBytes,
      missingFiles,
      corruptFiles,
      policy,
    };
  }

  async function downloadSingleFileToTemp({
    fileSpec,
    tempPath,
    signal,
    onChunk,
  }) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('No fetch implementation available for model download.');
    }
    if (signal && signal.aborted) {
      throw Object.assign(new Error('Download cancelled.'), { name: 'AbortError' });
    }

    await fs.promises.mkdir(path.dirname(tempPath), { recursive: true });
    const response = await fetchImpl(fileSpec.url, { signal });
    if (!response.ok) {
      throw new Error(
        `Failed to download ${fileSpec.relativePath} (HTTP ${response.status} ${response.statusText || ''}).`
      );
    }

    const hash = crypto.createHash('sha256');
    let downloadedBytes = 0;
    const writeStream = fs.createWriteStream(tempPath);

    const writeChunk = (buf) =>
      new Promise((resolve, reject) => {
        if (!writeStream.write(buf)) {
          const onDrain = () => {
            writeStream.removeListener('error', onError);
            resolve();
          };
          const onError = (err) => {
            writeStream.removeListener('drain', onDrain);
            reject(err);
          };
          writeStream.once('drain', onDrain);
          writeStream.once('error', onError);
        } else {
          resolve();
        }
      });

    try {
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        while (true) {
          if (signal.aborted) {
            throw Object.assign(new Error('Download cancelled.'), { name: 'AbortError' });
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
            hash.update(buf);
            downloadedBytes += buf.byteLength;
            await writeChunk(buf);
            onChunk(buf.byteLength);
          }
        }
      } else {
        const arrBuf = await response.arrayBuffer();
        if (signal.aborted) {
          throw Object.assign(new Error('Download cancelled.'), { name: 'AbortError' });
        }
        const buf = Buffer.from(arrBuf);
        hash.update(buf);
        downloadedBytes = buf.byteLength;
        await writeChunk(buf);
        onChunk(buf.byteLength);
      }

      await new Promise((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.on('error', reject);
      });
    } catch (err) {
      writeStream.destroy();
      await safeUnlink(tempPath);
      throw err;
    }

    if (downloadedBytes !== fileSpec.sizeBytes) {
      await safeUnlink(tempPath);
      throw new Error(
        `Size mismatch for "${fileSpec.relativePath}": expected ${fileSpec.sizeBytes} bytes, got ${downloadedBytes}.`
      );
    }

    const actualSha256 = hash.digest('hex');
    if (actualSha256.toLowerCase() !== fileSpec.sha256.toLowerCase()) {
      await safeUnlink(tempPath);
      throw new Error(
        `SHA-256 verification failed for "${fileSpec.relativePath}": expected ${fileSpec.sha256}, got ${actualSha256}.`
      );
    }
  }

  async function downloadModel(modelId, onProgress) {
    const entry = resolveEntry(modelId);
    const policy = getPolicyForEntry(entry);
    if (!policy.downloadPermitted) {
      throw new Error(
        policy.rejectionReason || `Download of model "${modelId}" is prohibited by distribution policy.`
      );
    }
    if (activeDownloads.has(modelId)) {
      return activeDownloads.get(modelId).promise;
    }

    const controller = new AbortController();
    const modelDir = getModelDir(entry);
    const totalBytes = entry.files.reduce((sum, f) => sum + Number(f.sizeBytes || 0), 0);
    const stagedTempPairs = [];

    const run = (async () => {
      await fs.promises.mkdir(modelDir, { recursive: true });

      // Remove any leftover orphaned .tmp files from interrupted runs
      const cleanupStaleTemps = async (dir) => {
        let entries = [];
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const item of entries) {
          const full = path.join(dir, item.name);
          if (item.isDirectory()) {
            await cleanupStaleTemps(full);
          } else if (item.isFile() && item.name.includes('.part.') && item.name.endsWith('.tmp')) {
            await safeUnlink(full);
          }
        }
      };
      await cleanupStaleTemps(modelDir);

      let cumulativeBytes = 0;

      try {
        for (let i = 0; i < entry.files.length; i++) {
          const fileSpec = entry.files[i];
          const targetPath = resolveSafeFilePath(modelDir, fileSpec.relativePath);
          const tempPath = `${targetPath}.part.${crypto.randomUUID()}.tmp`;
          stagedTempPairs.push({ targetPath, tempPath, fileSpec });

          // Skip re-downloading if already valid on disk (recovery of partially completed bundles)
          let alreadyValid = false;
          try {
            const stat = await fs.promises.stat(targetPath);
            if (stat.isFile() && stat.size === fileSpec.sizeBytes) {
              const hash = await computeFileSha256(targetPath);
              if (hash.toLowerCase() === fileSpec.sha256.toLowerCase()) {
                alreadyValid = true;
                cumulativeBytes += stat.size;
                stagedTempPairs.pop();
                if (typeof onProgress === 'function') {
                  onProgress({
                    modelId,
                    currentFile: fileSpec.relativePath,
                    fileIndex: i + 1,
                    fileCount: entry.files.length,
                    bytesDownloaded: cumulativeBytes,
                    totalBytes,
                    percent: totalBytes > 0 ? Math.min(100, Math.round((cumulativeBytes / totalBytes) * 100)) : 100,
                  });
                }
              }
            }
          } catch {
            // File missing or unreadable -> download to tempPath
          }

          if (alreadyValid) continue;

          await downloadSingleFileToTemp({
            fileSpec,
            tempPath,
            signal: controller.signal,
            onChunk: (chunkLen) => {
              cumulativeBytes += chunkLen;
              if (typeof onProgress === 'function') {
                onProgress({
                  modelId,
                  currentFile: fileSpec.relativePath,
                  fileIndex: i + 1,
                  fileCount: entry.files.length,
                  bytesDownloaded: cumulativeBytes,
                  totalBytes,
                  percent: totalBytes > 0 ? Math.min(100, Math.round((cumulativeBytes / totalBytes) * 100)) : 100,
                });
              }
            },
          });
        }

        // Atomic installation: rename verified temp files into final destinations
        for (const pair of stagedTempPairs) {
          await fs.promises.mkdir(path.dirname(pair.targetPath), { recursive: true });
          await fs.promises.rename(pair.tempPath, pair.targetPath);
        }

        const lockPath = path.join(modelDir, '.verified.json');
        const lockTmp = `${lockPath}.part.${crypto.randomUUID()}.tmp`;
        await fs.promises.writeFile(
          lockTmp,
          JSON.stringify(
            {
              modelId: entry.modelId,
              pinnedRevisions: entry.pinnedRevisions,
              installedAt: new Date().toISOString(),
              files: entry.files.map((f) => ({
                relativePath: f.relativePath,
                sizeBytes: f.sizeBytes,
                sha256: f.sha256,
              })),
            },
            null,
            2
          ),
          'utf8'
        );
        await fs.promises.rename(lockTmp, lockPath);

        activeDownloads.delete(modelId);
        return await getModelStatus(modelId);
      } catch (err) {
        for (const pair of stagedTempPairs) {
          await safeUnlink(pair.tempPath);
        }
        throw err;
      } finally {
        activeDownloads.delete(modelId);
      }
    })();

    activeDownloads.set(modelId, { controller, promise: run });
    return run;
  }

  function cancelDownload(modelId) {
    resolveEntry(modelId);
    const active = activeDownloads.get(modelId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  async function removeModel(modelId) {
    const entry = resolveEntry(modelId);
    if (activeDownloads.has(modelId)) {
      cancelDownload(modelId);
      try {
        await activeDownloads.get(modelId)?.promise;
      } catch {
        // Ignore cancellation error during removal
      }
    }
    const modelDir = getModelDir(entry);
    await fs.promises.rm(modelDir, { recursive: true, force: true });
    return await getModelStatus(modelId);
  }

  async function readModelAssets(modelId) {
    const entry = resolveEntry(modelId);
    const policy = getPolicyForEntry(entry);
    if (!policy.activationPermitted) {
      throw new Error(
        policy.rejectionReason || `Activation of model "${modelId}" is prohibited in production builds.`
      );
    }
    const status = await getModelStatus(modelId);
    if (status.state !== 'installed') {
      throw new Error(
        `Model "${modelId}" is not installed or failed integrity verification (state=${status.state}, missing=[${status.missingFiles.join(', ')}], corrupt=[${status.corruptFiles.join(', ')}]).`
      );
    }

    const modelDir = getModelDir(entry);
    const files = {};
    for (const fileSpec of entry.files) {
      const targetPath = resolveSafeFilePath(modelDir, fileSpec.relativePath);
      const buf = await fs.promises.readFile(targetPath);
      // Copy out of Node Buffer slab pool so small files never share a backing ArrayBuffer
      files[fileSpec.relativePath] = new Uint8Array(buf);
    }

    return {
      modelId: entry.modelId,
      revisionLabel: getRevisionKey(entry),
      files,
    };
  }

  return {
    isProduction: productionMode,
    modelsRoot,
    getManifest,
    getModelStatus,
    downloadModel,
    cancelDownload,
    removeModel,
    readModelAssets,
  };
}

module.exports = {
  createModelManager,
  evaluateModelPolicy,
  isValidModelId,
  loadDefaultManifest,
  validateManifestEntry,
};
