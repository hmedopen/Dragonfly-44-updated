import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web';
import {
  RECOGNIZER_OUTPUT_FORMAT_BY_ROUTE,
  computeStableSoftmaxArgmax,
  decodeCtcOutput,
  isProbabilityDistributionRow,
} from '../../lib/localOcr/ocrRunner.ts';

test('P0.3: decodes raw logits with numerically stable softmax and preserves raw vs probability distinction', () => {
  // dict: ['A', 'B'] -> blank=0, 'A'=1, 'B'=2, trailing space=' '=3 (classes=4)
  const dict = ['A', 'B', ' '];
  // 2 timesteps of raw logits: [0, 3.0, 0, 0], [0, 0, 4.0, 0]
  const logits = new Float32Array([
    0.0, 3.0, 0.0, 0.0,
    0.0, 0.0, 4.0, 0.0,
  ]);

  const res = decodeCtcOutput(logits, 2, 4, dict, { outputFormat: 'logits' });
  assert.equal(res.text, 'AB');
  assert.equal(res.outputFormatUsed, 'logits');
  assert.equal(res.confidenceCalibrated, false);
  assert.equal(res.rawScoreMean, 3.5);

  const p0 = Math.exp(3.0) / (Math.exp(3.0) + 3);
  const p1 = Math.exp(4.0) / (Math.exp(4.0) + 3);
  const expectedScore = (p0 + p1) / 2;

  assert.equal(res.tokenProbabilities.length, 2);
  assert.ok(Math.abs(res.tokenProbabilities[0] - p0) < 1e-6);
  assert.ok(Math.abs(res.tokenProbabilities[1] - p1) < 1e-6);
  assert.ok(Math.abs(res.score - expectedScore) < 1e-6);
  assert.ok(res.score > 0 && res.score < 1, 'Probabilities must lie in (0, 1)');
});

test('P0.3: decodes probability outputs directly without double-softmax', () => {
  const dict = ['A', 'B', ' '];
  const probs = new Float32Array([
    0.02, 0.92, 0.04, 0.02,
    0.03, 0.04, 0.88, 0.05,
  ]);

  const res = decodeCtcOutput(probs, 2, 4, dict, { outputFormat: 'probabilities' });
  assert.equal(res.text, 'AB');
  assert.equal(res.outputFormatUsed, 'probabilities');
  assert.equal(res.confidenceCalibrated, false);
  assert.deepEqual(
    res.tokenProbabilities.map((v) => Number(v.toFixed(4))),
    [0.92, 0.88]
  );
  assert.ok(Math.abs(res.score - 0.9) < 1e-6, 'Must NOT apply double-softmax to probability outputs');

  // Auto-detection must also detect probability distribution and avoid double-softmax
  const autoRes = decodeCtcOutput(probs, 2, 4, dict, { outputFormat: 'auto' });
  assert.equal(autoRes.outputFormatUsed, 'probabilities');
  assert.ok(Math.abs(autoRes.score - 0.9) < 1e-6);
});

test('P0.3: numerically extreme logits do not overflow or underflow', () => {
  const dict = ['X', 'Y', ' '];
  // Very large positive logits & very large negative logits + -Infinity masked logits
  const extremeLogits = new Float32Array([
    1e6 - 2, 1e6, 1e6 - 10, -Infinity,
    -1e6 - 5, -1e6 - 10, -1e6, -Infinity,
  ]);

  const sm0 = computeStableSoftmaxArgmax(extremeLogits, 0, 4);
  const sm1 = computeStableSoftmaxArgmax(extremeLogits, 4, 4);
  assert.ok(sm0 && Number.isFinite(sm0.prob) && sm0.prob > 0.8 && sm0.prob < 1);
  assert.ok(sm1 && Number.isFinite(sm1.prob) && sm1.prob > 0.99 && sm1.prob <= 1);

  const decoded = decodeCtcOutput(extremeLogits, 2, 4, dict, { outputFormat: 'logits' });
  assert.equal(decoded.text, 'XY');
  assert.ok(Number.isFinite(decoded.score) && decoded.score > 0.85 && decoded.score <= 1);
});

test('P0.3: handles repeated CTC characters and blank tokens accurately', () => {
  // 'BOOK' -> B(2), B(2), blank(0), O(15), blank(0), O(15), K(11)
  const dict = ['A', 'B', 'K', 'O', ' ']; // 1=A, 2=B, 3=K, 4=O, 5=' '
  const classes = 6;
  const steps: Array<[number, number]> = [
    [2, 0.90], // B -> emitted
    [2, 0.80], // B (adjacent duplicate without blank -> collapsed!)
    [0, 0.99], // blank
    [4, 0.86], // O -> emitted
    [0, 0.99], // blank separates repeated O
    [4, 0.84], // O -> emitted
    [3, 0.88], // K -> emitted
  ];

  const data = new Float32Array(steps.length * classes);
  steps.forEach(([winner, prob], t) => {
    const rest = (1 - prob) / (classes - 1);
    for (let c = 0; c < classes; c++) {
      data[t * classes + c] = c === winner ? prob : rest;
    }
  });

  const decoded = decodeCtcOutput(data, steps.length, classes, dict, { outputFormat: 'probabilities' });
  assert.equal(decoded.text, 'BOOK');
  assert.equal(decoded.tokenProbabilities.length, 4);
  assert.ok(Math.abs(decoded.score - (0.9 + 0.86 + 0.84 + 0.88) / 4) < 1e-5);

  // All-blank output
  const allBlank = new Float32Array([0.95, 0.05, 0.98, 0.02]);
  const blankRes = decodeCtcOutput(allBlank, 2, 2, ['A'], { outputFormat: 'probabilities' });
  assert.equal(blankRes.text, '');
  assert.equal(blankRes.score, 0);
  assert.deepEqual(blankRes.tokenProbabilities, []);
});

test('P0.3: handles empty, truncated, NaN, Infinity, and malformed probability outputs safely', () => {
  const dict = ['A', 'B', ' '];

  // Empty & truncated
  assert.equal(decodeCtcOutput(new Float32Array(0), 0, 4, dict).text, '');
  assert.equal(decodeCtcOutput(new Float32Array(0), 2, 4, dict).score, 0);
  assert.equal(decodeCtcOutput(new Float32Array([0.5, 0.5]), 2, 4, dict).text, '');

  // NaN / +Infinity in probability row -> skipped safely without NaN confidence
  const badProbs = new Float32Array([
    0.05, NaN, 0.90, 0.05,
    0.05, 0.90, 0.03, 0.02,
    0.05, 0.02, Infinity, 0.02,
  ]);
  const resBadProb = decodeCtcOutput(badProbs, 3, 4, dict, { outputFormat: 'probabilities' });
  assert.equal(resBadProb.text, 'A');
  assert.ok(Math.abs(resBadProb.score - 0.9) < 1e-6);
  assert.equal(Number.isFinite(resBadProb.score), true);

  // Malformed out-of-range values (> 1 or < 0) in probability mode -> rejected safely
  const unnormalizedInProbMode = new Float32Array([
    0.1, 12.5, -3.0, 0.2,
    0.05, 0.05, 0.85, 0.05,
  ]);
  const resMalformed = decodeCtcOutput(unnormalizedInProbMode, 2, 4, dict, {
    outputFormat: 'probabilities',
  });
  assert.equal(resMalformed.text, 'B');
  assert.ok(resMalformed.score >= 0 && resMalformed.score <= 1);
  assert.ok(Math.abs(resMalformed.score - 0.85) < 1e-6);

  // NaN / +Infinity in logit mode -> skipped safely
  const badLogits = new Float32Array([
    0, Infinity, 1, 0,
    0, 0, 2, 0,
  ]);
  const resBadLogit = decodeCtcOutput(badLogits, 2, 4, dict, { outputFormat: 'logits' });
  assert.equal(resBadLogit.text, 'B');
  assert.equal(Number.isFinite(resBadLogit.score), true);
  assert.ok(resBadLogit.score > 0 && resBadLogit.score < 1);
});

test('P0.3: pinned ONNX recognizer models match configured output format (probabilities, not raw logits)', async (t) => {
  const cacheRoot = path.join(
    process.env.FOLIO_OCR_CACHE_DIR || path.join(os.tmpdir(), 'folio-script-ocr-cache'),
    'folio-models'
  );
  const models: Array<{
    route: keyof typeof RECOGNIZER_OUTPUT_FORMAT_BY_ROUTE;
    filePath: string;
  }> = [
    {
      route: 'en_ppocrv6_small',
      filePath: path.join(cacheRoot, 'ppocr-v6-small-en', '28fe5895c24f_b8f84f0b80c5', 'rec/inference.onnx'),
    },
    {
      route: 'ja_zh_ppocrv6_manga',
      filePath: path.join(cacheRoot, 'ppocr-v6-manga-v0.3', 'd65838996a00', 'rec/manga_rec.onnx'),
    },
    {
      route: 'ko_ppocrv5_mobile',
      filePath: path.join(cacheRoot, 'ppocr-v5-mobile-ko', 'e6f4fa85f00e_5c6f574b8e22', 'rec/inference.onnx'),
    },
  ];

  if (models.some((m) => !fs.existsSync(m.filePath))) {
    t.skip('Cached recognizer ONNX models not present; skipping real-model output format verification.');
    return;
  }

  const prevWasmPaths = ort.env.wasm.wasmPaths;
  ort.env.wasm.wasmPaths = pathToFileURL(path.resolve('node_modules/onnxruntime-web/dist') + path.sep).href;

  const inputArr = new Float32Array(1 * 3 * 48 * 160);
  for (let i = 0; i < inputArr.length; i++) {
    inputArr[i] = ((i * 73) % 255) / 127.5 - 1.0;
  }

  try {
    for (const m of models) {
      assert.equal(RECOGNIZER_OUTPUT_FORMAT_BY_ROUTE[m.route], 'probabilities');
      const sess = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(m.filePath)), {
        executionProviders: ['wasm'],
      });
      const tIn = new ort.Tensor('float32', inputArr, [1, 3, 48, 160]);
      let out: Record<string, ort.Tensor> | null = null;
      try {
        out = await sess.run({ [sess.inputNames[0]]: tIn });
        const tOut = out[sess.outputNames[0]];
        const data = tOut.data as Float32Array;
        const timeSteps = Number(tOut.dims[1]);
        const classes = Number(tOut.dims[2]);
        for (let step = 0; step < timeSteps; step++) {
          assert.equal(
            isProbabilityDistributionRow(data, step * classes, classes),
            true,
            `${m.route} timestep ${step} must output a valid probability distribution`
          );
        }
      } finally {
        if (out) {
          for (const tensor of Object.values(out)) tensor.dispose();
        }
        tIn.dispose();
        await sess.release();
      }
    }
  } finally {
    ort.env.wasm.wasmPaths = prevWasmPaths;
  }
});
