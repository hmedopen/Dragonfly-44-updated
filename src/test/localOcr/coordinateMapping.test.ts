import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePaddedPixelCrop,
  cropPolygonToOriginalPixels,
  normalized1000ToOriginalPixels,
  originalPixelsToNormalized1000,
  tileInputBoxToOriginalPixels,
} from '../../lib/localOcr/coordinateMapping.ts';
import { planAdaptivePageTiles } from '../../lib/localOcr/tilePlanner.ts';

test('tile-local coordinates map back to exact original page pixels on tall non-square pages', () => {
  const width = 800;
  const height = 3200;
  const tiles = planAdaptivePageTiles(width, height);
  const bottomRightTile = tiles[tiles.length - 1];

  // Tile box [ymin=100, xmin=50, ymax=220, xmax=300] inside bottomRightTile
  const pixelBox = tileInputBoxToOriginalPixels(
    [100, 50, 220, 300],
    bottomRightTile,
    width,
    height
  );

  assert.deepEqual(pixelBox, [
    bottomRightTile.originY + 100,
    bottomRightTile.originX + 50,
    bottomRightTile.originY + 220,
    bottomRightTile.originX + 300,
  ]);

  const normBox = originalPixelsToNormalized1000(pixelBox, width, height);
  const roundTrip = normalized1000ToOriginalPixels(normBox, width, height);

  // Quantization error on 0-1000 grid for 3200px tall page is <= Math.ceil(3200/1000/2) = 2px
  for (let i = 0; i < 4; i++) {
    assert.ok(
      Math.abs(roundTrip[i] - pixelBox[i]) <= 2,
      `Round-trip coord[${i}] drifted: ${roundTrip[i]} vs ${pixelBox[i]}`
    );
  }
});

test('edge clipping clamps out-of-bounds detector predictions to valid padded crop / page bounds', () => {
  const width = 500;
  const height = 900;
  const tiles = planAdaptivePageTiles(width, height);
  const tile = tiles[0]; // origin (0,0), cropWidth=500, padRight=140

  const clipped = tileInputBoxToOriginalPixels([-15, -20, 680, 610], tile, width, height);
  assert.deepEqual(clipped, [0, 0, 640, 500]);
});

test('crop polygon coordinates map accurately back to original page pixels', () => {
  const width = 1000;
  const height = 1600;
  const crop = computePaddedPixelCrop([400, 300, 520, 480], width, height, 14);
  assert.deepEqual(crop, { x: 286, y: 386, width: 208, height: 148 });

  const originalPoly = cropPolygonToOriginalPixels(
    [
      [14, 14],
      [194, 14],
      [194, 134],
      [14, 134],
    ],
    crop.x,
    crop.y,
    width,
    height
  );
  assert.deepEqual(originalPoly, [
    [300, 400],
    [480, 400],
    [480, 520],
    [300, 520],
  ]);
});
