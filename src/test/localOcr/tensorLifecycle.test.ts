import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';
import { createComicDetectorSession } from '../../lib/localOcr/comicDetector.ts';
import { createOrtWebOcrAdapter, getOpenCvRuntime } from '../../lib/localOcr/ocrRunner.ts';
import {
  executeLocalPageOcrPipeline,
  type PipelineRuntimeState,
} from '../../lib/localOcr/ocrWorker.ts';
import { planAdaptivePageTiles } from '../../lib/localOcr/tilePlanner.ts';
import { disposeOrtTensors } from '../../lib/localOcr/ortTensorUtils.ts';
import type { ModelAssetPayload } from '../../types/localOcr.ts';

class TrackedTensor {
  public readonly id: string;
  public readonly type: string;
  public readonly data: any;
  public readonly dims: number[];
  public disposeCount = 0;
  private readonly registry: Set<TrackedTensor>;

  constructor(
    id: string,
    type: string,
    data: any,
    dims: number[],
    registry: Set<TrackedTensor>
  ) {
    this.id = id;
    this.type = type;
    this.data = data;
    this.dims = dims;
    this.registry = registry;
    this.registry.add(this);
  }

  dispose(): void {
    this.disposeCount++;
    this.registry.delete(this);
  }
}

function makeTestOcrAssets(): ModelAssetPayload {
  return {
    modelId: 'ppocr-v6-small-en',
    revisionLabel: 'testrev123456',
    files: {
      'det/inference.onnx': new Uint8Array([1]),
      'det/inference.yml': new TextEncoder().encode(
        'PreProcess:\n  transform_ops:\n    - DetResizeForTest:\n        resize_long: 64\nPostProcess:\n  thresh: 0.3\n  box_thresh: 0.5\n  max_candidates: 10\n  unclip_ratio: 1.5\n'
      ),
      'rec/inference.onnx': new Uint8Array([1]),
      'rec/inference.yml': new TextEncoder().encode(
        'PreProcess:\n  transform_ops:\n    - RecResizeImg:\n        image_shape: [3, 48, 160]\nPostProcess:\n  character_dict:\n    - a\n    - b\n'
      ),
    },
  };
}

test('P0.2: disposeOrtTensors handles shared/aliased references once and ignores throwing dispose', () => {
  const live = new Set<TrackedTensor>();
  const shared = new TrackedTensor('shared', 'float32', new Float32Array(4), [1, 4], live);
  const throwing = {
    dispose() {
      throw new Error('dispose error');
    },
  };
  const extra = new TrackedTensor('extra', 'float32', new Float32Array(4), [1, 4], live);

  disposeOrtTensors({ a: shared, b: shared, bad: throwing }, [shared, extra]);

  assert.equal(shared.disposeCount, 1);
  assert.equal(extra.disposeCount, 1);
  assert.equal(live.size, 0);
});

test('P0.2: comicDetector disposes all input and output tensors on success, post-process error, and run error', async () => {
  const live = new Set<TrackedTensor>();
  let mode: 'ok' | 'parse_throws' | 'run_throws' | 'missing_output' | 'aliased' = 'ok';
  let seq = 0;

  const session = await createComicDetectorSession(new Uint8Array([1]), {
    createSession: async () => ({
      inputNames: ['images', 'orig_target_sizes'],
      async run() {
        if (mode === 'run_throws') {
          throw new Error('Simulated RT-DETR session.run failure');
        }
        if (mode === 'missing_output') {
          return {
            labels: new TrackedTensor('lbl', 'int64', BigInt64Array.from([0n]), [1], live),
          };
        }
        if (mode === 'aliased') {
          const shared = new TrackedTensor(
            'shared_f32',
            'float32',
            new Float32Array([10, 10, 100, 100]),
            [1, 4],
            live
          );
          return {
            labels: new TrackedTensor('lbl', 'int64', BigInt64Array.from([0n]), [1], live),
            boxes: shared,
            scores: shared,
          };
        }
        return {
          labels: new TrackedTensor('lbl', 'int64', BigInt64Array.from([0n]), [1], live),
          boxes: new TrackedTensor('box', 'float32', new Float32Array([10, 10, 100, 100]), [1, 4], live),
          scores: new TrackedTensor('scr', 'float32', new Float32Array([0.92]), [1], live),
          extra_debug: new TrackedTensor('dbg', 'float32', new Float32Array([1]), [1], live),
        };
      },
      async release() {},
    }),
    createTensor: (type, data, dims) => new TrackedTensor(`in_${++seq}`, type, data, dims, live),
    parseOutputs: (opts) => {
      if (mode === 'parse_throws') {
        throw new Error('Simulated post-process throw');
      }
      return [
        {
          detectionId: 'd1',
          classLabel: 'bubble',
          classId: 0,
          pixelBox: [10, 10, 100, 100],
          normalizedBox: [10, 10, 100, 100],
          rawScore: Number(opts.scores[0]),
          tileId: opts.tile.tileId,
          touchesTileInnerLeft: false,
          touchesTileInnerTop: false,
          touchesTileInnerRight: false,
          touchesTileInnerBottom: false,
        },
      ];
    },
  });

  const rgba = { width: 320, height: 320, data: new Uint8ClampedArray(320 * 320 * 4) };
  const tile = planAdaptivePageTiles(320, 320)[0];

  // 1. Success
  mode = 'ok';
  const dets = await session.runTile(rgba, tile);
  assert.equal(dets.length, 1);
  assert.equal(live.size, 0, 'All input and output tensors must be disposed after success');

  // 2. Post-process throws
  mode = 'parse_throws';
  await assert.rejects(() => session.runTile(rgba, tile), /post-process throw/i);
  assert.equal(live.size, 0, 'All tensors must be disposed when post-processing throws');

  // 3. session.run throws
  mode = 'run_throws';
  await assert.rejects(() => session.runTile(rgba, tile), /session\.run failure/i);
  assert.equal(live.size, 0, 'Input tensors must be disposed on inference failure');

  // 4. Missing output tensor
  mode = 'missing_output';
  await assert.rejects(() => session.runTile(rgba, tile), /missing expected tensors/i);
  assert.equal(live.size, 0, 'Partial output tensors must be disposed on validation error');

  // 5. Aliased output tensors
  mode = 'aliased';
  await session.runTile(rgba, tile);
  assert.equal(live.size, 0, 'Aliased output tensors must dispose cleanly');

  await session.dispose();
});

test('P0.2: ORT OCR adapter disposes det & rec tensors and releases partial session on init failure', async () => {
  // 1. Partial session creation failure must release the already-created session
  let releasedDet = false;
  await assert.rejects(
    () =>
      createOrtWebOcrAdapter('en_ppocrv6_small', makeTestOcrAssets(), {
        createSession: async (bytes) => {
          if (bytes === makeTestOcrAssets().files['det/inference.onnx']) {
            // unused branch check
          }
          if (!releasedDet && Math.random() >= 0) {
            // Distinguish det vs rec by call order
          }
          return {
            inputNames: ['x'],
            outputNames: ['out'],
            async run() {
              return {};
            },
            async release() {
              releasedDet = true;
            },
          };
        },
      }).catch((e) => {
        throw e;
      }),
    () => false
  ).catch(() => {});

  // Clean deterministic call-order test for partial session load failure
  let callCount = 0;
  let detReleasedOnRecFail = false;
  await assert.rejects(
    () =>
      createOrtWebOcrAdapter('en_ppocrv6_small', makeTestOcrAssets(), {
        createSession: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              inputNames: ['x'],
              outputNames: ['out'],
              async run() {
                return {};
              },
              async release() {
                detReleasedOnRecFail = true;
              },
            };
          }
          throw new Error('Recognizer ONNX failed to load');
        },
      }),
    /Recognizer ONNX failed to load/
  );
  assert.equal(detReleasedOnRecFail, true, 'Loaded detSession must be released if recSession fails');

  // 2. Successful and failing predictCrop disposes all input/output tensors and OpenCV Mats
  const { cv } = await getOpenCvRuntime();
  const live = new Set<TrackedTensor>();
  let recBehavior: 'ok' | 'malformed_dims' | 'rec_throws' = 'ok';
  let detBehavior: 'ok' | 'det_throws' = 'ok';
  let sessionIndex = 0;
  let seq = 0;

  const adapter = await createOrtWebOcrAdapter('en_ppocrv6_small', makeTestOcrAssets(), {
    cv,
    createTensor: (type, data, dims) => new TrackedTensor(`ocr_${++seq}`, type, data, dims, live),
    createSession: async () => {
      const idx = ++sessionIndex;
      if (idx === 1) {
        // det session
        return {
          inputNames: ['x'],
          outputNames: ['det_out'],
          async run() {
            if (detBehavior === 'det_throws') {
              throw new Error('Det run crashed');
            }
            // Emit a 64x64 probability map with a bright rectangle [10..54, 15..35]
            const w = 64;
            const h = 64;
            const map = new Float32Array(w * h);
            for (let y = 15; y < 35; y++) {
              for (let x = 10; x < 54; x++) {
                map[y * w + x] = 0.9;
              }
            }
            return {
              det_out: new TrackedTensor('det_out', 'float32', map, [1, 1, h, w], live),
            };
          },
          async release() {},
        };
      }
      // rec session
      return {
        inputNames: ['x'],
        outputNames: ['rec_out'],
        async run() {
          if (recBehavior === 'rec_throws') {
            throw new Error('Rec run crashed');
          }
          if (recBehavior === 'malformed_dims') {
            return {
              rec_out: new TrackedTensor('rec_bad', 'float32', new Float32Array(4), [1, 4], live),
            };
          }
          // [1, 2, 4] -> blank=0, 'a'=1, 'b'=2, ' '=3
          const recData = new Float32Array([
            0.05, 0.9, 0.03, 0.02,
            0.05, 0.02, 0.91, 0.02,
          ]);
          return {
            rec_out: new TrackedTensor('rec_out', 'float32', recData, [1, 2, 4], live),
          };
        },
        async release() {},
      };
    },
  });

  const crop = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) };

  const lines = await adapter.predictCrop(crop);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'ab');
  assert.equal(live.size, 0, 'All det and rec tensors must be disposed on success');

  recBehavior = 'malformed_dims';
  await assert.rejects(() => adapter.predictCrop(crop), /missing expected 3D tensor/i);
  assert.equal(live.size, 0, 'Tensors must be disposed when rec post-processing throws');

  recBehavior = 'rec_throws';
  await assert.rejects(() => adapter.predictCrop(crop), /Rec run crashed/i);
  assert.equal(live.size, 0, 'Tensors must be disposed when recSession.run throws');

  detBehavior = 'det_throws';
  await assert.rejects(() => adapter.predictCrop(crop), /Det run crashed/i);
  assert.equal(live.size, 0, 'Det input tensor must be disposed when detSession.run throws');

  await adapter.dispose();
});

test('P0.2: cancellation during pipeline leaves zero job-owned tensors retained', async () => {
  const live = new Set<TrackedTensor>();
  let seq = 0;
  let cancelled = false;
  let tileCalls = 0;

  const state: PipelineRuntimeState = {
    detectorKey: null,
    detectorSession: null,
    ocrKey: null,
    ocrAdapter: null,
  };

  await assert.rejects(
    () =>
      executeLocalPageOcrPipeline(
        {
          jobId: 'cancel-tensor-check',
          pageId: 'p-tall',
          imageBytes: new ArrayBuffer(16),
          mimeType: 'image/png',
          languageHint: 'en',
          resolvedRoute: 'en_ppocrv6_small',
          readingConvention: 'ltr',
          detectorAssets: {
            modelId: 'comic-detector-v4-s-int8',
            revisionLabel: 'rev1',
            files: { 'detector-v4-s_int8.onnx': new Uint8Array([1]) },
          },
          ocrAssets: makeTestOcrAssets(),
          wasmPaths: './ort/',
        },
        state,
        () => cancelled,
        {
          decodeImage: async () => ({
            width: 640,
            height: 1200,
            data: new Uint8ClampedArray(640 * 1200 * 4),
          }),
          createDetector: () =>
            createComicDetectorSession(new Uint8Array([1]), {
              createSession: async () => ({
                inputNames: ['images', 'orig_target_sizes'],
                async run() {
                  tileCalls++;
                  if (tileCalls === 1) {
                    cancelled = true;
                  }
                  return {
                    labels: new TrackedTensor('l', 'int64', BigInt64Array.from([0n]), [1], live),
                    boxes: new TrackedTensor('b', 'float32', new Float32Array([0, 0, 10, 10]), [1, 4], live),
                    scores: new TrackedTensor('s', 'float32', new Float32Array([0.1]), [1], live),
                  };
                },
                async release() {},
              }),
              createTensor: (type, data, dims) => new TrackedTensor(`t_${++seq}`, type, data, dims, live),
            }),
          createOcrAdapter: async () => ({
            runtimeUsed: 'ort_web_adapter',
            async predictCrop() {
              return [];
            },
            async dispose() {},
          }),
        }
      ),
    (err: Error) => err.name === 'AbortError'
  );

  assert.equal(live.size, 0, 'Cancellation must leave zero retained tensors');
  if (state.detectorSession) await state.detectorSession.dispose();
  if (state.ocrAdapter) await state.ocrAdapter.dispose();
});

test('P0.2: real ORT tensor disposal + repeated inference stress test when cached models are installed', async (t) => {
  // Always test real ort.Tensor disposal contract
  const tReal = new ort.Tensor('float32', new Float32Array(1024), [1, 32, 32]);
  assert.equal(tReal.data.length, 1024);
  tReal.dispose();
  assert.throws(() => tReal.data, /disposed/i);

  const cacheRoot = path.join(
    process.env.FOLIO_OCR_CACHE_DIR || path.join(os.tmpdir(), 'folio-script-ocr-cache'),
    'folio-models'
  );
  const detPath = path.join(cacheRoot, 'comic-detector-v4-s-int8', '16e8a622f91f', 'detector-v4-s_int8.onnx');
  const enRoot = path.join(cacheRoot, 'ppocr-v6-small-en', '28fe5895c24f_b8f84f0b80c5');
  if (!fs.existsSync(detPath) || !fs.existsSync(path.join(enRoot, 'rec/inference.onnx'))) {
    t.skip('Cached real ONNX models not present in temp cache; skipping real-model stress run.');
    return;
  }

  const prevWasmPaths = ort.env.wasm.wasmPaths;
  ort.env.wasm.wasmPaths = pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist') + path.sep).href;

  const detBytes = new Uint8Array(fs.readFileSync(detPath));
  const detSession = await createComicDetectorSession(detBytes);
  const ocrAssets: ModelAssetPayload = {
    modelId: 'ppocr-v6-small-en',
    revisionLabel: '28fe5895c24f_b8f84f0b80c5',
    files: {
      'det/inference.onnx': new Uint8Array(fs.readFileSync(path.join(enRoot, 'det/inference.onnx'))),
      'det/inference.yml': new Uint8Array(fs.readFileSync(path.join(enRoot, 'det/inference.yml'))),
      'rec/inference.onnx': new Uint8Array(fs.readFileSync(path.join(enRoot, 'rec/inference.onnx'))),
      'rec/inference.yml': new Uint8Array(fs.readFileSync(path.join(enRoot, 'rec/inference.yml'))),
    },
  };
  const ocrAdapter = await createOrtWebOcrAdapter('en_ppocrv6_small', ocrAssets);

  const syntheticPage = {
    width: 640,
    height: 640,
    data: new Uint8ClampedArray(640 * 640 * 4).fill(255),
  };
  const tile = planAdaptivePageTiles(640, 640)[0];
  const syntheticCrop = {
    width: 160,
    height: 48,
    data: new Uint8ClampedArray(160 * 48 * 4).fill(255),
  };

  try {
    // Warm up 2 runs before measuring heap stability over 12 repeated tiles & 20 crops
    await detSession.runTile(syntheticPage, tile, 0.35);
    await ocrAdapter.predictCrop(syntheticCrop);

    const heapSamples: number[] = [];
    for (let i = 0; i < 12; i++) {
      await detSession.runTile(syntheticPage, tile, 0.35);
      await ocrAdapter.predictCrop(syntheticCrop);
      await ocrAdapter.predictCrop(syntheticCrop);
      if (i % 3 === 0) {
        heapSamples.push(process.memoryUsage().heapUsed);
      }
    }

    assert.equal(heapSamples.length, 4);
    const heapGrowthBytes = heapSamples[heapSamples.length - 1] - heapSamples[0];
    // Note: onnxruntime-web does not expose WASM-allocator retained tensor count directly;
    // JS heap delta over 12 detector tiles + 24 OCR crops stays bounded without runaway JS object retention.
    assert.ok(
      heapGrowthBytes < 32 * 1024 * 1024,
      `Unexpected JS heap growth during repeated inference stress test: ${(heapGrowthBytes / 1048576).toFixed(2)} MB`
    );
  } finally {
    await detSession.dispose();
    await ocrAdapter.dispose();
    ort.env.wasm.wasmPaths = prevWasmPaths;
  }
});
