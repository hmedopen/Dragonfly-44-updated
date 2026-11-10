import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  LOCAL_OCR_MODEL_MANIFEST,
  getModelManifestEntry,
  getRequiredModelIdsForRoute,
  validatePinnedManifestEntry,
} from '../../lib/localOcr/modelManifest.ts';

const require = createRequire(import.meta.url);
const { createModelManager } = require('../../../electron/modelManager.cjs');

function sha256Hex(buf: Uint8Array | Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'folio-mm-test-'));
}

function buildTestManifest(contentA: Buffer, contentB: Buffer) {
  const rev = 'a'.repeat(40);
  return {
    manifestVersion: 1,
    models: [
      {
        modelId: 'test-model',
        displayName: 'Test Model',
        role: 'ocr_pipeline',
        languagesOrTask: ['en'],
        upstreamRepositories: ['org/test-repo'],
        pinnedRevisions: { 'org/test-repo': rev },
        files: [
          {
            role: 'model',
            relativePath: 'det/model.bin',
            upstreamRepo: 'org/test-repo',
            revision: rev,
            url: `https://example.invalid/org/test-repo/resolve/${rev}/det/model.bin`,
            sizeBytes: contentA.byteLength,
            sha256: sha256Hex(contentA),
          },
          {
            role: 'config',
            relativePath: 'det/config.yml',
            upstreamRepo: 'org/test-repo',
            revision: rev,
            url: `https://example.invalid/org/test-repo/resolve/${rev}/det/config.yml`,
            sizeBytes: contentB.byteLength,
            sha256: sha256Hex(contentB),
          },
        ],
        modelCardUrl: 'https://example.invalid/card',
        declaredLicense: 'Apache-2.0',
        trainingDataProvenanceNotes: 'Test fixture',
        redistributionStatus: 'dev_only_unverified_provenance',
        runtimeCompatibility: {
          sdkSupported: true,
          requiresCustomUstarArchive: false,
          requiresOrtAdapterFallback: false,
          executionProviders: ['wasm'],
          notes: 'Test',
        },
      },
    ],
  };
}

test('production manifest resolves all required routes with pinned revisions and checksums', () => {
  assert.ok(LOCAL_OCR_MODEL_MANIFEST.models.length >= 4);
  for (const entry of LOCAL_OCR_MODEL_MANIFEST.models) {
    const errors = validatePinnedManifestEntry(entry);
    assert.deepEqual(errors, [], `Manifest errors for ${entry.modelId}: ${errors.join('; ')}`);
    assert.notEqual(
      entry.redistributionStatus,
      'approved_for_redistribution',
      `${entry.modelId} must not claim commercial redistribution clearance without dataset provenance`
    );
  }

  assert.deepEqual(getRequiredModelIdsForRoute('en_ppocrv6_small'), [
    'comic-detector-v4-s-int8',
    'ppocr-v6-small-en',
  ]);
  assert.deepEqual(getRequiredModelIdsForRoute('ja_zh_ppocrv6_manga'), [
    'comic-detector-v4-s-int8',
    'ppocr-v6-manga-v0.3',
  ]);
  assert.deepEqual(getRequiredModelIdsForRoute('ko_ppocrv5_mobile'), [
    'comic-detector-v4-s-int8',
    'ppocr-v5-mobile-ko',
  ]);
  assert.ok(getModelManifestEntry('comic-detector-v4-s-int8'));
});

test('modelManager rejects unpinned moving branch URLs', async () => {
  const dir = makeTempDir();
  try {
    const bufA = Buffer.from('hello-model');
    const badManifest = buildTestManifest(bufA, Buffer.from('cfg'));
    badManifest.models[0].files[0].url = 'https://example.invalid/org/repo/resolve/main/model.bin';
    const mgr = createModelManager({ userDataDir: dir, manifest: badManifest });
    await assert.rejects(() => mgr.getModelStatus('test-model'), /moving branch/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('modelManager handles missing model status and read error clearly', async () => {
  const dir = makeTempDir();
  try {
    const manifest = buildTestManifest(Buffer.from('abc'), Buffer.from('def'));
    const mgr = createModelManager({ userDataDir: dir, manifest });
    const status = await mgr.getModelStatus('test-model');
    assert.equal(status.state, 'not_installed');
    assert.equal(status.missingFiles.length, 2);
    await assert.rejects(() => mgr.readModelAssets('test-model'), /not installed/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('modelManager installs atomically with SHA-256 verification and reads verified assets', async () => {
  const dir = makeTempDir();
  try {
    const fileA = Buffer.from('model-bytes-payload-123456');
    const fileB = Buffer.from('Global:\n  model_name: test\n');
    const manifest = buildTestManifest(fileA, fileB);
    const progressEvents: number[] = [];

    const mgr = createModelManager({
      userDataDir: dir,
      manifest,
      fetchImpl: async (url: string) => {
        const body = url.endsWith('model.bin') ? fileA : fileB;
        return new Response(body, { status: 200 });
      },
    });

    const installed = await mgr.downloadModel('test-model', (p: { percent: number }) => {
      progressEvents.push(p.percent);
    });
    assert.equal(installed.state, 'installed');
    assert.equal(installed.verifiedBytes, fileA.byteLength + fileB.byteLength);
    assert.ok(progressEvents.includes(100));

    const assets = await mgr.readModelAssets('test-model');
    assert.equal(Buffer.from(assets.files['det/model.bin']).toString(), fileA.toString());
    assert.equal(Buffer.from(assets.files['det/config.yml']).toString(), fileB.toString());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('modelManager rejects corrupt downloads and recovers from interrupted downloads', async () => {
  const dir = makeTempDir();
  try {
    const fileA = Buffer.from('expected-valid-model-data');
    const fileB = Buffer.from('expected-valid-config');
    const manifest = buildTestManifest(fileA, fileB);

    const corruptMgr = createModelManager({
      userDataDir: dir,
      manifest,
      fetchImpl: async (url: string) => {
        if (url.endsWith('model.bin')) {
          // Same byte length as fileA (25 bytes) so SHA-256 mismatch is specifically exercised
          return new Response(Buffer.from('CORRUPTED-valid-model-dat'), { status: 200 });
        }
        return new Response(fileB, { status: 200 });
      },
    });

    await assert.rejects(() => corruptMgr.downloadModel('test-model'), /SHA-256 verification failed/i);
    const afterCorrupt = await corruptMgr.getModelStatus('test-model');
    assert.equal(afterCorrupt.state, 'not_installed');

    // Simulate partially installed / interrupted bundle (one valid file + orphaned .tmp + corrupted file)
    const revDir = path.join(dir, 'folio-models', 'test-model', 'aaaaaaaaaaaa', 'det');
    fs.mkdirSync(revDir, { recursive: true });
    fs.writeFileSync(path.join(revDir, 'model.bin'), Buffer.from('tampered'));
    fs.writeFileSync(path.join(revDir, 'config.yml.part.123.tmp'), Buffer.from('half-written'));

    const corruptStatus = await corruptMgr.getModelStatus('test-model');
    assert.equal(corruptStatus.state, 'corrupt');
    assert.ok(corruptStatus.corruptFiles.includes('det/model.bin'));

    // Recovery via valid fetch
    const healthyMgr = createModelManager({
      userDataDir: dir,
      manifest,
      fetchImpl: async (url: string) => {
        return new Response(url.endsWith('model.bin') ? fileA : fileB, { status: 200 });
      },
    });
    const recovered = await healthyMgr.downloadModel('test-model');
    assert.equal(recovered.state, 'installed');
    assert.equal(fs.existsSync(path.join(revDir, 'config.yml.part.123.tmp')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('modelManager supports download cancellation without leaving partial artifacts', async () => {
  const dir = makeTempDir();
  try {
    const fileA = Buffer.alloc(64 * 1024, 7);
    const fileB = Buffer.from('cfg');
    const manifest = buildTestManifest(fileA, fileB);

    const mgr = createModelManager({
      userDataDir: dir,
      manifest,
      fetchImpl: (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    });

    const downloadPromise = mgr.downloadModel('test-model');
    const cancelled = mgr.cancelDownload('test-model');
    assert.equal(cancelled, true);

    await assert.rejects(() => downloadPromise, (err: Error) => err.name === 'AbortError');
    const status = await mgr.getModelStatus('test-model');
    assert.equal(status.state, 'not_installed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
