import test from 'node:test';
import assert from 'node:assert/strict';
import { getOpenCvRuntime, scorePolygonMask } from '../../lib/localOcr/ocrRunner.ts';

function naiveAabbMean(
  predMap: Float32Array,
  w: number,
  h: number,
  poly: Array<[number, number]>
): number {
  let xmin = w - 1;
  let xmax = 0;
  let ymin = h - 1;
  let ymax = 0;
  for (const [px, py] of poly) {
    xmin = Math.min(xmin, Math.max(0, Math.floor(px)));
    xmax = Math.max(xmax, Math.min(w - 1, Math.ceil(px)));
    ymin = Math.min(ymin, Math.max(0, Math.floor(py)));
    ymax = Math.max(ymax, Math.min(h - 1, Math.ceil(py)));
  }
  let sum = 0;
  let count = 0;
  for (let y = ymin; y <= ymax; y++) {
    for (let x = xmin; x <= xmax; x++) {
      sum += predMap[y * w + x];
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function referenceOpenCvFillPolyScore(
  cv: any,
  predMap: Float32Array,
  w: number,
  h: number,
  poly: Array<[number, number]>
): number {
  const predMat = cv.matFromArray(h, w, cv.CV_32FC1, predMap);
  let minX = w - 1;
  let maxX = 0;
  let minY = h - 1;
  let maxY = 0;
  for (const [px, py] of poly) {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  minX = Math.max(0, Math.min(w - 1, Math.floor(minX)));
  maxX = Math.max(0, Math.min(w - 1, Math.ceil(maxX)));
  minY = Math.max(0, Math.min(h - 1, Math.floor(minY)));
  maxY = Math.max(0, Math.min(h - 1, Math.ceil(maxY)));
  const rw = Math.max(1, maxX - minX + 1);
  const rh = Math.max(1, maxY - minY + 1);
  const roi = predMat.roi(new cv.Rect(minX, minY, rw, rh));
  const mask = cv.Mat.zeros(rh, rw, cv.CV_8UC1);
  const flat: number[] = [];
  for (const [px, py] of poly) {
    flat.push(Math.round(px - minX), Math.round(py - minY));
  }
  const pts = cv.matFromArray(poly.length, 1, cv.CV_32SC2, flat);
  const vec = new cv.MatVector();
  vec.push_back(pts);
  cv.fillPoly(mask, vec, new cv.Scalar(1));
  const mean = cv.mean(roi, mask)[0];
  predMat.delete();
  roi.delete();
  mask.delete();
  pts.delete();
  vec.delete();
  return mean;
}

test('P1.2: polygon scoring accurately scores rotated and narrow text while excluding AABB background pixels', async () => {
  const { cv } = await getOpenCvRuntime();
  const W = 128;
  const H = 128;

  // 1. 45-degree rotated narrow text stroke: foreground pixels inside rotated quad have 0.90, AABB background is 0.0
  const rotMap = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.abs(y - x) <= 4 && x + y >= 40 && x + y <= 200) {
        rotMap[y * W + x] = 0.9;
      }
    }
  }
  const rotatedPoly: Array<[number, number]> = [
    [22, 18],
    [102, 98],
    [98, 102],
    [18, 22],
  ];

  const polyScore = scorePolygonMask(rotMap, W, H, rotatedPoly);
  const cvRef = referenceOpenCvFillPolyScore(cv, rotMap, W, H, rotatedPoly);
  const aabbScore = naiveAabbMean(rotMap, W, H, rotatedPoly);

  assert.ok(
    aabbScore < 0.2,
    `Expected AABB approximation to fail on rotated text (<0.2), got ${aabbScore.toFixed(4)}`
  );
  assert.ok(
    polyScore > 0.75,
    `Expected polygon scoring to retain rotated text (>0.75), got ${polyScore.toFixed(4)}`
  );
  assert.ok(
    Math.abs(polyScore - cvRef) < 0.05,
    `Polygon score ${polyScore.toFixed(4)} drifted from OpenCV reference ${cvRef.toFixed(4)}`
  );

  // 2. Narrow 2px tall text region
  const narrowMap = new Float32Array(W * H);
  for (let y = 40; y <= 41; y++) {
    for (let x = 15; x <= 95; x++) {
      narrowMap[y * W + x] = 0.88;
    }
  }
  const narrowPoly: Array<[number, number]> = [
    [15, 40],
    [95, 40],
    [95, 41],
    [15, 41],
  ];
  const narrowScore = scorePolygonMask(narrowMap, W, H, narrowPoly);
  const narrowCvRef = referenceOpenCvFillPolyScore(cv, narrowMap, W, H, narrowPoly);
  assert.ok(Math.abs(narrowScore - 0.88) < 1e-4);
  assert.ok(Math.abs(narrowScore - narrowCvRef) < 1e-4);
});

test('P1.2: irregular concave polygon excludes empty AABB cavity and matches OpenCV reference', async () => {
  const { cv } = await getOpenCvRuntime();
  const W = 100;
  const H = 100;
  const map = new Float32Array(W * H);

  // L-shaped region filled with 0.92; empty top-right quadrant inside AABB stays 0.0
  for (let y = 10; y <= 60; y++) {
    for (let x = 10; x <= 22; x++) map[y * W + x] = 0.92;
  }
  for (let y = 48; y <= 60; y++) {
    for (let x = 10; x <= 70; x++) map[y * W + x] = 0.92;
  }

  const lPoly: Array<[number, number]> = [
    [10, 10],
    [22, 10],
    [22, 48],
    [70, 48],
    [70, 60],
    [10, 60],
  ];

  const polyScore = scorePolygonMask(map, W, H, lPoly);
  const cvRef = referenceOpenCvFillPolyScore(cv, map, W, H, lPoly);
  const aabbScore = naiveAabbMean(map, W, H, lPoly);

  assert.ok(aabbScore < 0.45);
  assert.ok(Math.abs(polyScore - 0.92) < 1e-4);
  assert.ok(Math.abs(polyScore - cvRef) < 1e-4);
});

test('P1.2: handles partially clipped polygons and degenerate/invalid polygons safely', () => {
  const W = 50;
  const H = 50;
  const map = new Float32Array(W * H).fill(0.8);

  // Partially clipped polygon extending outside negative and > W/H bounds (including extreme coords)
  const clippedPoly: Array<[number, number]> = [
    [-20, 10],
    [20, 10],
    [20, 30],
    [-20, 30],
  ];
  const clippedScore = scorePolygonMask(map, W, H, clippedPoly);
  assert.ok(Math.abs(clippedScore - 0.8) < 1e-5);

  const farClippedPoly: Array<[number, number]> = [
    [-1e7, -1e7],
    [15, -1e7],
    [15, 15],
    [-1e7, 15],
  ];
  assert.ok(Math.abs(scorePolygonMask(map, W, H, farClippedPoly) - 0.8) < 1e-5);

  // Completely out-of-bounds polygon -> 0
  assert.equal(
    scorePolygonMask(map, W, H, [
      [100, 100],
      [120, 100],
      [120, 120],
    ]),
    0
  );

  // Degenerate polygons: <3 pts, collinear zero area, NaN/Infinity coords, empty map
  assert.equal(scorePolygonMask(map, W, H, []), 0);
  assert.equal(scorePolygonMask(map, W, H, [[0, 0], [10, 10]]), 0);
  assert.equal(
    scorePolygonMask(map, W, H, [
      [10, 10],
      [20, 20],
      [30, 30],
    ]),
    0
  );
  assert.equal(
    scorePolygonMask(map, W, H, [
      [NaN, 10],
      [20, 10],
      [20, 20],
    ]),
    0
  );
  assert.equal(
    scorePolygonMask(new Float32Array(0), W, H, [
      [0, 0],
      [10, 0],
      [10, 10],
    ]),
    0
  );
});
