import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DETECTOR_TARGET_SIZE,
  planAdaptivePageTiles,
  verifyTileCoverage,
} from '../../lib/localOcr/tilePlanner.ts';

test('single tile when page fits within 640x640 (no redundant tiles)', () => {
  const tiles = planAdaptivePageTiles(554, 640);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].tileId, 'tile_r0_c0');
  assert.equal(tiles[0].originX, 0);
  assert.equal(tiles[0].originY, 0);
  assert.equal(tiles[0].cropWidth, 554);
  assert.equal(tiles[0].cropHeight, 640);
  assert.equal(tiles[0].padRight, 86);
  assert.equal(tiles[0].padBottom, 0);
  assert.equal(verifyTileCoverage(tiles, 554, 640), true);
});

test('ordinary portrait manga page covers all pixels without shrinking or excess tiles', () => {
  const width = 900;
  const height = 1300;
  const tiles = planAdaptivePageTiles(width, height);
  assert.equal(tiles.length, 6); // 2 cols x 3 rows
  assert.equal(verifyTileCoverage(tiles, width, height), true);

  for (const t of tiles) {
    assert.equal(t.scaleX, 1);
    assert.equal(t.scaleY, 1);
    assert.equal(t.cropWidth, DETECTOR_TARGET_SIZE);
    assert.equal(t.cropHeight, DETECTOR_TARGET_SIZE);
  }
});

test('very tall Korean webtoon preserves native resolution across vertical strips', () => {
  const width = 800;
  const height = 12000;
  const tiles = planAdaptivePageTiles(width, height);

  // Must not shrink whole webtoon into 1 tile; expects >= 23 vertical steps * 2 horizontal cols
  assert.ok(tiles.length >= 46, `Expected >= 46 tiles for 800x12000 webtoon, got ${tiles.length}`);
  assert.equal(verifyTileCoverage(tiles, width, height), true);

  // Verify adjacent vertical rows overlap by >= 20% (128px)
  const col0 = tiles.filter((t) => t.col === 0).sort((a, b) => a.row - b.row);
  for (let i = 1; i < col0.length; i++) {
    const prevEnd = col0[i - 1].originY + col0[i - 1].cropHeight;
    const overlap = prevEnd - col0[i].originY;
    assert.ok(overlap >= 128, `Vertical overlap ${overlap}px must be >= 128px (20%)`);
  }

  // Final tile reaches exact bottom edge
  const last = col0[col0.length - 1];
  assert.equal(last.originY + last.cropHeight, height);
  assert.equal(last.touchesPageBottom, true);
});

test('wide page (> 640px wide) tiles horizontally with >= 20% overlap and covers right edge', () => {
  const width = 1800;
  const height = 1000;
  const tiles = planAdaptivePageTiles(width, height);
  assert.equal(verifyTileCoverage(tiles, width, height), true);

  const row0 = tiles.filter((t) => t.row === 0).sort((a, b) => a.col - b.col);
  assert.ok(row0.length >= 3);
  for (let i = 1; i < row0.length; i++) {
    const overlap = row0[i - 1].originX + row0[i - 1].cropWidth - row0[i].originX;
    assert.ok(overlap >= 128, `Horizontal overlap ${overlap}px must be >= 128px`);
  }
  assert.equal(row0[row0.length - 1].originX + row0[row0.length - 1].cropWidth, width);
});

test('partial final tile edge case (641x641) covers final 1px border cleanly', () => {
  const tiles = planAdaptivePageTiles(641, 641);
  assert.equal(tiles.length, 4);
  assert.equal(verifyTileCoverage(tiles, 641, 641), true);
  assert.equal(tiles[tiles.length - 1].originX, 1);
  assert.equal(tiles[tiles.length - 1].originY, 1);
});
