import type { ScanIssueFlag } from '../../types/scanning.ts';
import type {
  AssociatedTextCandidate,
  ComicDetectorClass,
  FusedComicRegion,
  RawComicDetection,
  TileTransformRecord,
} from '../../types/localOcr.ts';
import { calculateBoxIoU, computeBoxArea } from '../coordinateTransforms.ts';
import { originalPixelsToNormalized1000 } from './coordinateMapping.ts';

function computeIntersectionArea(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const y1 = Math.max(a[0], b[0]);
  const x1 = Math.max(a[1], b[1]);
  const y2 = Math.min(a[2], b[2]);
  const x2 = Math.min(a[3], b[3]);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function computeIoMin(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const inter = computeIntersectionArea(a, b);
  if (inter <= 0) return 0;
  const minArea = Math.min(computeBoxArea(a), computeBoxArea(b));
  return minArea > 0 ? inter / minArea : 0;
}

function unionPixelBoxes(
  a: [number, number, number, number],
  b: [number, number, number, number]
): [number, number, number, number] {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

function touchesInternalTileBoundary(
  det: RawComicDetection,
  tile: TileTransformRecord | undefined
): boolean {
  if (!tile) return false;
  return (
    (det.touchesTileInnerLeft && !tile.touchesPageLeft) ||
    (det.touchesTileInnerTop && !tile.touchesPageTop) ||
    (det.touchesTileInnerRight && !tile.touchesPageRight) ||
    (det.touchesTileInnerBottom && !tile.touchesPageBottom)
  );
}

function areCrossTileBoundarySplitPieces(
  a: RawComicDetection,
  b: RawComicDetection,
  tileMap: Map<string, TileTransformRecord>
): boolean {
  if (a.tileId === b.tileId) return false;
  const tA = tileMap.get(a.tileId);
  const tB = tileMap.get(b.tileId);
  if (!tA || !tB) return false;

  const [ay1, ax1, ay2, ax2] = a.pixelBox;
  const [by1, bx1, by2, bx2] = b.pixelBox;

  // Check if A & B meet/overlap along a vertical boundary (horizontally adjacent tiles)
  if (tA.row === tB.row && Math.abs(tA.col - tB.col) === 1) {
    const left = tA.col < tB.col ? a : b;
    const right = tA.col < tB.col ? b : a;
    const yOverlap = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    const minH = Math.max(1, Math.min(ay2 - ay1, by2 - by1));
    const yOverlapRatio = yOverlap / minH;
    const touchesSharedEdge =
      (left.touchesTileInnerRight || right.touchesTileInnerLeft) &&
      right.pixelBox[1] <= left.pixelBox[3] + 16;
    if (yOverlapRatio >= 0.55 && touchesSharedEdge) return true;
  }

  // Check if A & B meet/overlap along a horizontal boundary (vertically adjacent webtoon tiles)
  if (tA.col === tB.col && Math.abs(tA.row - tB.row) === 1) {
    const top = tA.row < tB.row ? a : b;
    const bottom = tA.row < tB.row ? b : a;
    const xOverlap = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
    const minW = Math.max(1, Math.min(ax2 - ax1, bx2 - bx1));
    const xOverlapRatio = xOverlap / minW;
    const touchesSharedEdge =
      (top.touchesTileInnerBottom || bottom.touchesTileInnerTop) &&
      bottom.pixelBox[0] <= top.pixelBox[2] + 16;
    if (xOverlapRatio >= 0.55 && touchesSharedEdge) return true;
  }

  return false;
}

/**
 * Class-aware duplicate suppression and cross-tile boundary reconstruction.
 * - Never collapses two separate balloons detected in the same tile.
 * - Reconstructs bubbles split across overlapping tiles.
 * - Flags detections clipped at an un-reconstructed internal tile boundary.
 */
export function fuseTiledComicDetections(
  rawDetections: RawComicDetection[],
  tiles: TileTransformRecord[],
  sourceWidth: number,
  sourceHeight: number
): FusedComicRegion[] {
  const tileMap = new Map(tiles.map((t) => [t.tileId, t]));
  const classes: ComicDetectorClass[] = ['bubble', 'text_bubble', 'text_free'];
  const fusedAll: FusedComicRegion[] = [];

  for (const cls of classes) {
    const items = rawDetections
      .filter((d) => d.classLabel === cls)
      .sort((a, b) => b.rawScore - a.rawScore);

    interface Cluster {
      members: RawComicDetection[];
      pixelBox: [number, number, number, number];
      reconstructedCrossBoundary: boolean;
    }

    const clusters: Cluster[] = [];

    for (const det of items) {
      let matchedCluster: Cluster | null = null;
      let matchedViaBoundarySplit = false;

      for (const cluster of clusters) {
        // Never collapse two adjacent balloons detected inside the SAME tile
        const sharesTile = cluster.members.some((m) => m.tileId === det.tileId);
        if (sharesTile) continue;

        const detTile = tileMap.get(det.tileId);
        const detTouchesInner = touchesInternalTileBoundary(det, detTile);

        for (const member of cluster.members) {
          const iou = calculateBoxIoU(det.pixelBox, member.pixelBox);
          const ioMin = computeIoMin(det.pixelBox, member.pixelBox);
          const memberTouchesInner = touchesInternalTileBoundary(member, tileMap.get(member.tileId));

          if (areCrossTileBoundarySplitPieces(det, member, tileMap)) {
            matchedCluster = cluster;
            matchedViaBoundarySplit = true;
            break;
          }

          if (iou >= 0.45) {
            matchedCluster = cluster;
            break;
          }

          // One piece clipped at tile edge and mostly contained inside full piece in neighbor tile
          if ((detTouchesInner || memberTouchesInner) && ioMin >= 0.7) {
            matchedCluster = cluster;
            break;
          }
        }

        if (matchedCluster) break;
      }

      if (!matchedCluster) {
        clusters.push({
          members: [det],
          pixelBox: [...det.pixelBox],
          reconstructedCrossBoundary: false,
        });
      } else {
        matchedCluster.members.push(det);
        if (matchedViaBoundarySplit) {
          matchedCluster.reconstructedCrossBoundary = true;
          matchedCluster.pixelBox = unionPixelBoxes(matchedCluster.pixelBox, det.pixelBox);
        } else {
          // Prefer member that does not touch an internal tile boundary, else highest confidence
          const bestNonClipped = matchedCluster.members
            .filter((m) => !touchesInternalTileBoundary(m, tileMap.get(m.tileId)))
            .sort((a, b) => b.rawScore - a.rawScore)[0];
          if (bestNonClipped) {
            matchedCluster.pixelBox = [...bestNonClipped.pixelBox];
          } else {
            matchedCluster.pixelBox = unionPixelBoxes(matchedCluster.pixelBox, det.pixelBox);
          }
        }
      }
    }

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const topMember = [...cluster.members].sort((a, b) => b.rawScore - a.rawScore)[0];
      const sourceTileIds = Array.from(new Set(cluster.members.map((m) => m.tileId)));

      // Check if ALL members are clipped at an internal tile boundary and were NOT reconstructed
      const allClippedAtInner = cluster.members.every((m) =>
        touchesInternalTileBoundary(m, tileMap.get(m.tileId))
      );
      const boundaryUncertain = allClippedAtInner && !cluster.reconstructedCrossBoundary;
      const flags: ScanIssueFlag[] = boundaryUncertain ? ['REGION_BOUNDARY_UNCERTAIN'] : [];

      fusedAll.push({
        id: `${cls}-${i + 1}`,
        classLabel: cls,
        pixelBox: cluster.pixelBox,
        normalizedBox: originalPixelsToNormalized1000(
          cluster.pixelBox,
          sourceWidth,
          sourceHeight,
          1
        ),
        rawScore: topMember.rawScore,
        sourceTileIds,
        boundaryUncertain,
        flags,
      });
    }
  }

  return fusedAll;
}

/**
 * Resolves cross-label duplicates between `text_bubble` and `text_free` when RT-DETR-v2
 * multi-label queries emit both classes for the exact same text region (high IoU >= 0.65).
 * Physical `bubble` regions are never suppressed against text regions.
 */
function deduplicateOverlappingTextClasses(
  bubbles: FusedComicRegion[],
  textRegions: FusedComicRegion[]
): FusedComicRegion[] {
  const sorted = [...textRegions].sort((a, b) => {
    // Slightly prefer text_bubble when inside an actual bubble and scores are close
    const aInBubble = bubbles.some((bu) => computeIoMin(a.pixelBox, bu.pixelBox) >= 0.6);
    const bInBubble = bubbles.some((bu) => computeIoMin(b.pixelBox, bu.pixelBox) >= 0.6);
    const aBonus = a.classLabel === 'text_bubble' && aInBubble ? 0.08 : 0;
    const bBonus = b.classLabel === 'text_bubble' && bInBubble ? 0.08 : 0;
    return b.rawScore + bBonus - (a.rawScore + aBonus);
  });

  const kept: FusedComicRegion[] = [];
  for (const candidate of sorted) {
    const duplicateOf = kept.find(
      (k) => calculateBoxIoU(k.pixelBox, candidate.pixelBox) >= 0.65
    );
    if (!duplicateOf) {
      kept.push(candidate);
    }
  }
  return kept;
}

/**
 * Associates detected text_bubble regions with physical bubble boundaries while keeping
 * text_free regions unassociated (bubbleId = null) and flagging ambiguous associations.
 */
export function associateTextCandidatesToBubbles(
  fusedRegions: FusedComicRegion[]
): {
  bubbles: FusedComicRegion[];
  textCandidates: AssociatedTextCandidate[];
} {
  const bubbles = fusedRegions.filter((r) => r.classLabel === 'bubble');
  const rawTextRegions = fusedRegions.filter(
    (r) => r.classLabel === 'text_bubble' || r.classLabel === 'text_free'
  );
  const textRegions = deduplicateOverlappingTextClasses(bubbles, rawTextRegions);

  const textCandidates: AssociatedTextCandidate[] = textRegions.map((tr) => {
    const flags: ScanIssueFlag[] = [...tr.flags];

    if (tr.classLabel === 'text_free') {
      return {
        candidateId: tr.id,
        kind: 'text_free',
        pixelBox: tr.pixelBox,
        normalizedBox: tr.normalizedBox,
        rawScore: tr.rawScore,
        sourceTileIds: tr.sourceTileIds,
        boundaryUncertain: tr.boundaryUncertain,
        flags,
        associatedBubbleId: null,
        associationConfidence: 1,
      };
    }

    const textArea = Math.max(1, computeBoxArea(tr.pixelBox));
    const tCy = (tr.pixelBox[0] + tr.pixelBox[2]) / 2;
    const tCx = (tr.pixelBox[1] + tr.pixelBox[3]) / 2;

    const scored = bubbles
      .map((b) => {
        const interArea = computeIntersectionArea(tr.pixelBox, b.pixelBox);
        const containment = interArea / textArea;
        const iou = calculateBoxIoU(tr.pixelBox, b.pixelBox);
        const centroidInside =
          tCy >= b.pixelBox[0] &&
          tCy <= b.pixelBox[2] &&
          tCx >= b.pixelBox[1] &&
          tCx <= b.pixelBox[3];
        const score = containment * 0.7 + iou * 0.2 + (centroidInside ? 0.1 : 0);
        return { bubble: b, containment, iou, centroidInside, score };
      })
      .filter((s) => s.containment > 0.15 || s.centroidInside)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      if (!flags.includes('BUBBLE_ASSOCIATION_AMBIGUOUS')) {
        flags.push('BUBBLE_ASSOCIATION_AMBIGUOUS');
      }
      return {
        candidateId: tr.id,
        kind: 'text_bubble',
        pixelBox: tr.pixelBox,
        normalizedBox: tr.normalizedBox,
        rawScore: tr.rawScore,
        sourceTileIds: tr.sourceTileIds,
        boundaryUncertain: tr.boundaryUncertain,
        flags,
        associatedBubbleId: null,
        associationConfidence: 0,
      };
    }

    const best = scored[0];
    const second = scored[1];
    const isAmbiguous =
      Boolean(second) &&
      second.containment >= 0.35 &&
      Math.abs(best.score - second.score) < 0.15;

    if (isAmbiguous && !flags.includes('BUBBLE_ASSOCIATION_AMBIGUOUS')) {
      flags.push('BUBBLE_ASSOCIATION_AMBIGUOUS');
    }

    return {
      candidateId: tr.id,
      kind: 'text_bubble',
      pixelBox: tr.pixelBox,
      normalizedBox: tr.normalizedBox,
      rawScore: tr.rawScore,
      sourceTileIds: tr.sourceTileIds,
      boundaryUncertain: tr.boundaryUncertain,
      flags,
      associatedBubbleId: best.bubble.id,
      associationConfidence: Math.min(1, Math.max(0, best.containment)),
      candidateBubbleIds: scored.map((s) => s.bubble.id),
    };
  });

  return { bubbles, textCandidates };
}
