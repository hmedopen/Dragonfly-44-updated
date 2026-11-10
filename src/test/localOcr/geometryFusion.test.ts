import test from 'node:test';
import assert from 'node:assert/strict';
import type { RawComicDetection } from '../../types/localOcr.ts';
import {
  associateTextCandidatesToBubbles,
  fuseTiledComicDetections,
} from '../../lib/localOcr/geometryFusion.ts';
import { originalPixelsToNormalized1000 } from '../../lib/localOcr/coordinateMapping.ts';
import { planAdaptivePageTiles } from '../../lib/localOcr/tilePlanner.ts';

function makeDet(
  id: string,
  cls: 'bubble' | 'text_bubble' | 'text_free',
  pixelBox: [number, number, number, number],
  tileId: string,
  rawScore: number,
  w: number,
  h: number,
  edges: Partial<{
    left: boolean;
    top: boolean;
    right: boolean;
    bottom: boolean;
  }> = {}
): RawComicDetection {
  return {
    detectionId: id,
    classLabel: cls,
    classId: cls === 'bubble' ? 0 : cls === 'text_bubble' ? 1 : 2,
    pixelBox,
    normalizedBox: originalPixelsToNormalized1000(pixelBox, w, h, 1),
    rawScore,
    tileId,
    touchesTileInnerLeft: Boolean(edges.left),
    touchesTileInnerTop: Boolean(edges.top),
    touchesTileInnerRight: Boolean(edges.right),
    touchesTileInnerBottom: Boolean(edges.bottom),
  };
}

test('merges duplicate detections across overlapping tiles without collapsing adjacent balloons', () => {
  const w = 640;
  const h = 1100;
  const tiles = planAdaptivePageTiles(w, h); // tile_r0_c0 [0..640], tile_r1_c0 [460..1100]
  assert.equal(tiles.length, 2);

  const raw: RawComicDetection[] = [
    // Duplicate of same balloon in overlap band [480..600]
    makeDet('d1', 'bubble', [480, 100, 600, 300], 'tile_r0_c0', 0.91, w, h),
    makeDet('d2', 'bubble', [484, 102, 598, 298], 'tile_r1_c0', 0.88, w, h),
    // Two touching adjacent balloons in the SAME tile (must remain separate!)
    makeDet('adj1', 'bubble', [100, 50, 260, 250], 'tile_r0_c0', 0.89, w, h),
    makeDet('adj2', 'bubble', [100, 250, 260, 450], 'tile_r0_c0', 0.87, w, h),
  ];

  const fused = fuseTiledComicDetections(raw, tiles, w, h);
  const bubbles = fused.filter((f) => f.classLabel === 'bubble');
  assert.equal(bubbles.length, 3, 'Expected 1 merged overlap bubble + 2 separate adjacent balloons');
});

test('reconstructs a large bubble crossing a horizontal tile boundary and flags un-reconstructed edge clips', () => {
  const w = 640;
  const h = 1100;
  const tiles = planAdaptivePageTiles(w, h); // row0 [0..640], row1 [460..1100]

  const raw: RawComicDetection[] = [
    // Top piece of a large bubble clipped at bottom edge of tile_r0_c0
    makeDet('b_top', 'bubble', [400, 120, 640, 380], 'tile_r0_c0', 0.86, w, h, { bottom: true }),
    // Bottom piece of the same bubble clipped at top edge of tile_r1_c0
    makeDet('b_bot', 'bubble', [460, 125, 760, 378], 'tile_r1_c0', 0.84, w, h, { top: true }),
    // Orphan edge-clipped bubble in tile_r1_c0 with no counterpart in tile_r0_c0
    makeDet('b_orphan', 'bubble', [460, 440, 560, 580], 'tile_r1_c0', 0.72, w, h, { top: true }),
  ];

  const fused = fuseTiledComicDetections(raw, tiles, w, h);
  assert.equal(fused.length, 2);

  const reconstructed = fused.find((r) => r.sourceTileIds.length === 2);
  assert.ok(reconstructed, 'Split bubble across boundary should fuse into 1 region');
  assert.deepEqual(reconstructed.pixelBox, [400, 120, 760, 380]);
  assert.equal(reconstructed.boundaryUncertain, false);

  const uncertain = fused.find((r) => r.sourceTileIds.length === 1);
  assert.ok(uncertain);
  assert.equal(uncertain.boundaryUncertain, true);
  assert.ok(uncertain.flags.includes('REGION_BOUNDARY_UNCERTAIN'));
});

test('associates text_bubble to enclosing bubble, keeps text_free unassociated, and flags ambiguous overlap', () => {
  const w = 800;
  const h = 800;
  const tiles = planAdaptivePageTiles(w, h);

  const raw: RawComicDetection[] = [
    makeDet('b1', 'bubble', [50, 50, 260, 260], 'tile_r0_c0', 0.92, w, h),
    makeDet('b2', 'bubble', [50, 240, 260, 450], 'tile_r0_c0', 0.90, w, h),
    // Clear text inside b1
    makeDet('tb1', 'text_bubble', [90, 80, 210, 200], 'tile_r0_c0', 0.93, w, h),
    // Ambiguous text spanning equally across b1 & b2 intersection [240..260]
    makeDet('tb_ambig', 'text_bubble', [100, 210, 200, 290], 'tile_r0_c0', 0.81, w, h),
    // Text outside any bubble
    makeDet('tf1', 'text_free', [400, 100, 480, 300], 'tile_r0_c0', 0.85, w, h),
  ];

  const fused = fuseTiledComicDetections(raw, tiles, w, h);
  const { bubbles, textCandidates } = associateTextCandidatesToBubbles(fused);

  assert.equal(bubbles.length, 2);
  assert.equal(textCandidates.length, 3);

  const clearText = textCandidates.find((t) => Math.abs(t.rawScore - 0.93) < 1e-4)!;
  assert.ok(clearText.associatedBubbleId !== null);
  assert.equal(clearText.flags.includes('BUBBLE_ASSOCIATION_AMBIGUOUS'), false);

  const ambigText = textCandidates.find((t) => Math.abs(t.rawScore - 0.81) < 1e-4)!;
  assert.ok(ambigText.flags.includes('BUBBLE_ASSOCIATION_AMBIGUOUS'));

  const freeText = textCandidates.find((t) => t.kind === 'text_free')!;
  assert.equal(freeText.associatedBubbleId, null);
});

test('deduplicates cross-label text_bubble and text_free predictions on the same text box', () => {
  const w = 600;
  const h = 600;
  const tiles = planAdaptivePageTiles(w, h);
  const raw: RawComicDetection[] = [
    makeDet('b1', 'bubble', [40, 40, 260, 260], 'tile_r0_c0', 0.9, w, h),
    makeDet('tb', 'text_bubble', [80, 75, 210, 225], 'tile_r0_c0', 0.73, w, h),
    makeDet('tf', 'text_free', [82, 75, 210, 223], 'tile_r0_c0', 0.72, w, h),
  ];

  const fused = fuseTiledComicDetections(raw, tiles, w, h);
  const { bubbles, textCandidates } = associateTextCandidatesToBubbles(fused);
  assert.equal(bubbles.length, 1);
  assert.equal(textCandidates.length, 1);
  assert.equal(textCandidates[0].kind, 'text_bubble');
  assert.equal(textCandidates[0].associatedBubbleId, bubbles[0].id);
});
