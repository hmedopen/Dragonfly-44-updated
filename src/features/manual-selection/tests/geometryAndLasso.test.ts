import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGeometrySignature,
  deriveBoundingBoxFromPolygon,
  finalizeBubblePolygon,
  finalizeLassoPolygon,
  finalizeTwoPointBox,
  getMinNormalizedSpan,
  hasPolygonSelfIntersection,
  isPointInEllipse,
  isPointInPolygon,
  normalizedBoxToOriginalPixels,
  normalizedPointToRendered,
  originalPixelBoxToNormalized,
  renderedPointToNormalized,
  resizeBoxFromHandle,
  scalePolygonFromBox,
  translateSelectionGeometry,
} from '../selection/geometry.ts';

test('Geometry round-trip stays within sub-pixel tolerance across zoom levels, window sizes, and long-strip images', () => {
  const sourceWidth = 800;
  const sourceHeight = 6400; // Ultra-tall long-strip manhwa

  const originalPixelBox: [number, number, number, number] = [3120, 140, 3260, 520];
  const normBox = originalPixelBoxToNormalized(originalPixelBox, sourceWidth, sourceHeight);
  const backToPixels = normalizedBoxToOriginalPixels(normBox, sourceWidth, sourceHeight);

  assert.ok(Math.abs(backToPixels[0] - originalPixelBox[0]) <= 1);
  assert.ok(Math.abs(backToPixels[1] - originalPixelBox[1]) <= 1);
  assert.ok(Math.abs(backToPixels[2] - originalPixelBox[2]) <= 1);
  assert.ok(Math.abs(backToPixels[3] - originalPixelBox[3]) <= 1);

  for (const zoomScale of [0.5, 1.0, 2.5, 4.0]) {
    const renderedW = sourceWidth * zoomScale;
    const renderedH = sourceHeight * zoomScale;
    const imageRect = { left: 40, top: -180, width: renderedW, height: renderedH };

    const renderedPt = normalizedPointToRendered(normBox[1], normBox[0], renderedW, renderedH);
    const clientX = imageRect.left + renderedPt.x;
    const clientY = imageRect.top + renderedPt.y;

    const recoveredNorm = renderedPointToNormalized(clientX, clientY, imageRect);
    assert.ok(recoveredNorm !== null);
    assert.ok(Math.abs(recoveredNorm[0] - normBox[1]) < 0.05);
    assert.ok(Math.abs(recoveredNorm[1] - normBox[0]) < 0.05);
  }

  const { minSpanY } = getMinNormalizedSpan(sourceWidth, sourceHeight, 8);
  assert.ok(minSpanY < 2, `Tall strip vertical minSpanY should be fine-grained, got ${minSpanY}`);
});

test('Box resize and move respect bounds and minimum dimensions without inversion', () => {
  const box: [number, number, number, number] = [200, 300, 400, 600];

  const shrunk = resizeBoxFromHandle(box, 'nw', 900, 900, 20, 20);
  assert.ok(shrunk[2] - shrunk[0] >= 20);
  assert.ok(shrunk[3] - shrunk[1] >= 20);
  assert.equal(shrunk[2], 400);
  assert.equal(shrunk[3], 600);

  const moved = translateSelectionGeometry({ box_2d: box }, 700, 750);
  assert.deepEqual(moved.box_2d, [800, 700, 1000, 1000]);
});

test('Bubble mode smooths noisy freehand egg/irregular contour into organic closed outline without forcing circle or rect', () => {
  // Hand-drawn egg/pear contour: noticeably narrower at top (y=200) than bottom belly (y=520)
  // plus intentional sinusoidal pointer jitter to simulate real mouse tremor
  const rawEggWithJitter: Array<[number, number]> = [];
  const totalSteps = 44;
  for (let i = 0; i < totalSteps; i++) {
    const theta = (i / totalSteps) * Math.PI * 2;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    // Egg taper factor: narrower on top half (sinT < 0), wider on bottom belly (sinT > 0)
    const eggWidthScale = sinT < 0 ? 110 : 185;
    const jitterX = (i % 2 === 0 ? 1 : -1) * 4.5;
    const jitterY = (i % 3 === 0 ? 1 : -1) * 4.0;
    const x = 420 + cosT * eggWidthScale + jitterX;
    const y = 360 + sinT * 170 + jitterY;
    rawEggWithJitter.push([x, y]);
  }

  const bubble = finalizeBubblePolygon(rawEggWithJitter, 1000, 1400);
  assert.equal(bubble.valid, true, bubble.reason);
  assert.equal(hasPolygonSelfIntersection(bubble.polygon), false);

  // Check horizontal span in upper third vs lower third -> must preserve egg asymmetry, NOT a symmetric circle or rect!
  const topBand = bubble.polygon.filter(([, y]) => y >= 240 && y <= 310);
  const bottomBand = bubble.polygon.filter(([, y]) => y >= 410 && y <= 490);
  const topWidth =
    Math.max(...topBand.map(([x]) => x)) - Math.min(...topBand.map(([x]) => x));
  const bottomWidth =
    Math.max(...bottomBand.map(([x]) => x)) - Math.min(...bottomBand.map(([x]) => x));

  assert.ok(
    bottomWidth - topWidth > 45,
    `Bubble must preserve egg asymmetry rather than forcing circle/rect (top=${topWidth}, bottom=${bottomWidth})`
  );

  // Exterior corner of derived bounding box must be outside the rounded bubble curve
  const [ymin, xmin] = bubble.box_2d;
  assert.equal(isPointInPolygon(xmin + 1, ymin + 1, bubble.polygon), false);
  assert.equal(isPointInPolygon(420, 360, bubble.polygon), true);

  // Resizing Bubble via bounding box scales smoothly without collapsing contour
  const scaled = scalePolygonFromBox(bubble.polygon, bubble.box_2d, [ymin, xmin, bubble.box_2d[2] + 80, bubble.box_2d[3] + 50]);
  const scaledBox = deriveBoundingBoxFromPolygon(scaled);
  assert.ok(scaledBox[2] > bubble.box_2d[2] + 70);
  assert.ok(scaledBox[3] > bubble.box_2d[3] + 40);
});

test('Lasso validation preserves sharp angular freeform path, derives tight bbox, and untangles self-intersections', () => {
  const bowtie: Array<[number, number]> = [
    [100, 100],
    [300, 300],
    [300, 100],
    [100, 300],
  ];

  const result = finalizeLassoPolygon(bowtie, 1000, 1200);
  assert.equal(result.valid, true);
  assert.equal(result.wasUntangled, true);
  assert.equal(hasPolygonSelfIntersection(result.polygon), false);
  assert.equal(isPointInPolygon(200, 200, result.polygon), true);
  assert.equal(isPointInPolygon(50, 50, result.polygon), false);

  const bbox = deriveBoundingBoxFromPolygon(result.polygon);
  assert.deepEqual(result.box_2d, bbox);

  // Sharp L-shaped lasso keeps its concave interior vertex instead of smoothing into an oval
  const lLasso = finalizeLassoPolygon(
    [
      [100, 100],
      [400, 100],
      [400, 220],
      [220, 220],
      [220, 420],
      [100, 420],
    ],
    1000,
    1000
  );
  assert.equal(lLasso.valid, true);
  assert.equal(isPointInPolygon(350, 350, lLasso.polygon), false);
  assert.equal(isPointInPolygon(150, 150, lLasso.polygon), true);

  const moved = translateSelectionGeometry({ box_2d: lLasso.box_2d, polygon: lLasso.polygon }, 15, 25);
  assert.notEqual(
    computeGeometrySignature(lLasso.box_2d, lLasso.polygon),
    computeGeometrySignature(moved.box_2d, moved.polygon)
  );
});

test('Two-point ellipse geometry handles all drag directions, aspect ratios, long strips, and elliptical hit-testing', () => {
  // All four drag directions between opposite corners produce the exact same bounding box
  const se = finalizeTwoPointBox([120, 200], [420, 380], 1000, 1400);
  const nw = finalizeTwoPointBox([420, 380], [120, 200], 1000, 1400);
  const ne = finalizeTwoPointBox([120, 380], [420, 200], 1000, 1400);
  const sw = finalizeTwoPointBox([420, 200], [120, 380], 1000, 1400);
  assert.deepEqual(se, [200, 120, 380, 420]);
  assert.deepEqual(nw, se);
  assert.deepEqual(ne, se);
  assert.deepEqual(sw, se);

  // Supports wide horizontal, narrow vertical oval, and circular bounds
  const wide = finalizeTwoPointBox([100, 100], [700, 220], 1000, 1000);
  const tall = finalizeTwoPointBox([200, 100], [320, 700], 1000, 1000);
  const circle = finalizeTwoPointBox([400, 400], [600, 600], 1000, 1000);
  assert.deepEqual(wide, [100, 100, 220, 700]);
  assert.deepEqual(tall, [100, 200, 700, 320]);
  assert.deepEqual(circle, [400, 400, 600, 600]);

  // Long-strip 800x4000 allows compact vertical spans that are >= 6px on source strip
  const longStripCompact = finalizeTwoPointBox([100, 200], [220, 203], 800, 4000);
  assert.deepEqual(longStripCompact, [200, 100, 203, 220]);

  // Accidental micro-clicks smaller than minimum pixels are rejected
  assert.equal(finalizeTwoPointBox([300, 300], [302, 302], 1000, 1000), null);

  // Elliptical hit-testing excludes bounding-box corner points outside the inscribed oval
  assert.equal(isPointInEllipse(500, 500, [400, 400, 600, 600]), true);
  assert.equal(isPointInEllipse(565, 565, [400, 400, 600, 600]), true);
  assert.equal(isPointInEllipse(405, 405, [400, 400, 600, 600]), false);
  assert.equal(isPointInEllipse(595, 595, [400, 400, 600, 600]), false);
});
