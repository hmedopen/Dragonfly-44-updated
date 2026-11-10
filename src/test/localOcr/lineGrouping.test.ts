import test from 'node:test';
import assert from 'node:assert/strict';
import type { AssociatedTextCandidate, RawOcrLineDetection } from '../../types/localOcr.ts';
import {
  groupLinesToTextRegions,
  joinLinesByScript,
} from '../../lib/localOcr/lineGrouping.ts';

test('script-aware line joining handles English, Korean, Japanese, and Chinese properly', () => {
  assert.equal(
    joinLinesByScript(['All right,', "that's", 'fixed!'], 'en'),
    "All right, that's fixed!"
  );
  assert.equal(
    joinLinesByScript(['unbe-', 'lievable'], 'en'),
    'unbelievable'
  );

  // Korean MUST preserve word spaces across line breaks (do not concatenate Hangul lines!)
  assert.equal(
    joinLinesByScript(['이건 정말', '대단한 일이야'], 'ko'),
    '이건 정말 대단한 일이야'
  );

  // Japanese & Chinese wrapped lines join without inserting spurious spaces
  assert.equal(
    joinLinesByScript(['そんな', 'バカな'], 'ja'),
    'そんなバカな'
  );
  assert.equal(
    joinLinesByScript(['这真是', '太不可思议了'], 'zh'),
    '这真是太不可思议了'
  );
});

test('multi-line bubble produces 1 logical TextRegion preserving line-level geometry and real scores', () => {
  const candidates: AssociatedTextCandidate[] = [
    {
      candidateId: 'text_bubble-1',
      kind: 'text_bubble',
      pixelBox: [80, 100, 220, 280],
      normalizedBox: [80, 100, 220, 280],
      rawScore: 0.91,
      sourceTileIds: ['tile_r0_c0'],
      boundaryUncertain: false,
      flags: [],
      associatedBubbleId: 'bubble-1',
      associationConfidence: 0.97,
    },
    {
      candidateId: 'text_bubble-2',
      kind: 'text_bubble',
      pixelBox: [300, 100, 380, 240],
      normalizedBox: [300, 100, 380, 240],
      rawScore: 0.84,
      sourceTileIds: ['tile_r0_c0'],
      boundaryUncertain: false,
      flags: [],
      associatedBubbleId: 'bubble-2',
      associationConfidence: 0.95,
    },
  ];

  const linesByCandidate = new Map<string, RawOcrLineDetection[]>([
    [
      'text_bubble-1',
      [
        {
          lineId: 'l2',
          candidateId: 'text_bubble-1',
          text: '여기였어',
          rawRecognitionScore: 0.87,
          pixelPolygon: [[110, 150], [260, 150], [260, 190], [110, 190]],
          pixelBox: [150, 110, 190, 260],
          normalizedBox: [150, 110, 190, 260],
          isVertical: false,
        },
        {
          lineId: 'l1',
          candidateId: 'text_bubble-1',
          text: '설마',
          rawRecognitionScore: 0.91,
          pixelPolygon: [[120, 90], [240, 90], [240, 130], [120, 130]],
          pixelBox: [90, 120, 130, 240],
          normalizedBox: [90, 120, 130, 240],
          isVertical: false,
        },
      ],
    ],
    [
      'text_bubble-2',
      [
        {
          lineId: 'l3',
          candidateId: 'text_bubble-2',
          text: '...',
          rawRecognitionScore: 0.72,
          pixelPolygon: [[120, 310], [180, 310], [180, 350], [120, 350]],
          pixelBox: [310, 120, 350, 180],
          normalizedBox: [310, 120, 350, 180],
          isVertical: false,
        },
      ],
    ],
  ]);

  const { textRegions, allLineSegments } = groupLinesToTextRegions(candidates, linesByCandidate, {
    language: 'ko',
    sourceWidth: 1000,
    sourceHeight: 1000,
  });

  // Two separate physical bubbles remain two logical TextRegions (multi-line bubble 1 is NOT split!)
  assert.equal(textRegions.length, 2);
  assert.equal(allLineSegments.length, 3);

  const first = textRegions[0];
  assert.equal(first.rawOCR, '설마 여기였어'); // Sorted top-to-bottom + space preserved
  assert.equal(first.associations.bubbleId, 'bubble-1');
  assert.equal(first.lineSegments?.length, 2);
  assert.ok(Math.abs(first.confidence.ocr - 0.89) < 1e-6, 'Must aggregate real recognizer scores, not 0.95');
  assert.equal(first.confidence.regionDetection, 0.91);

  // Punctuation-only bubble MUST NOT be discarded automatically
  const second = textRegions[1];
  assert.equal(second.rawOCR, '...');
  assert.equal(second.associations.bubbleId, 'bubble-2');
  assert.equal(second.confidence.ocr, 0.72);
});
