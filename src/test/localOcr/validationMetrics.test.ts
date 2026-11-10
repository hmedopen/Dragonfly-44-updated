import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCharEditStats,
  computeWordEditStats,
  evaluatePagePredictions,
  type GroundTruthPageFixture,
} from './validationMetrics.ts';
import type { BubbleRegion, TextRegion } from '../../types/scanning.ts';

function makePredRegion(
  id: string,
  box: [number, number, number, number],
  text: string,
  lines: string[],
  seq: number
): TextRegion {
  return {
    regionId: id,
    geometry: { coordinateSpace: 'normalized_1000', box_2d: box },
    rawOCR: text,
    normalizedText: text,
    lineSegments: lines.map((l, idx) => ({
      lineId: `${id}_l${idx}`,
      geometry: { coordinateSpace: 'normalized_1000', box_2d: box },
      text: l,
      recognitionConfidence: 0.9,
    })),
    confidence: {
      imageQuality: 1,
      regionDetection: 0.9,
      ocr: 0.9,
      association: 1,
      readingOrder: 1,
      classification: 0.9,
    },
    classification: {
      primaryClass: 'dialogue',
      confidence: 0.9,
      needsReview: false,
    },
    associations: { bubbleId: 'b1' },
    order: { sequenceIndex: seq, confidence: 1 },
    flags: [],
  };
}

test('P1.3 metrics: computes CER, WER, detection recall/precision, grouping, and reading order accurately', () => {
  const c1 = computeCharEditStats('Hello world', 'Hello world');
  assert.equal(c1.cer, 0);
  const c2 = computeCharEditStats('Helo', 'Hello');
  assert.ok(Math.abs(c2.cer - 0.2) < 1e-6);

  const w1 = computeWordEditStats('Here you are', 'Here we are');
  assert.ok(Math.abs(w1.wer - 1 / 3) < 1e-6);

  const fixture: GroundTruthPageFixture = {
    fixtureId: 'unit-sample',
    language: 'en',
    routeId: 'en_ppocrv6_small',
    readingConvention: 'ltr',
    localFileName: 'sample.jpg',
    pngFileName: 'sample.png',
    sourceUrl: 'https://example.invalid/sample.jpg',
    sha256: '0'.repeat(64),
    width: 1000,
    height: 1000,
    license: 'CC-BY-4.0',
    attribution: 'Test',
    regions: [
      {
        id: 'gt1',
        readingOrder: 1,
        box_2d: [100, 100, 200, 300],
        text: 'Line one Line two',
        lines: ['Line one', 'Line two'],
        hasBubble: true,
      },
      {
        id: 'gt2',
        readingOrder: 2,
        box_2d: [400, 400, 500, 600],
        text: 'Missing bubble',
        lines: ['Missing bubble'],
        hasBubble: true,
      },
    ],
  };

  const preds: TextRegion[] = [
    makePredRegion('p1', [100, 100, 200, 300], 'Line one Line two', ['Line one', 'Line two'], 1),
    // Duplicate sub-crop inside gt1 -> lowers precision, increments duplicateOverlapCount
    makePredRegion('p1_dup', [150, 110, 195, 290], 'Line two', ['Line two'], 2),
  ];
  const bubbles: BubbleRegion[] = [
    {
      bubbleId: 'b1',
      geometry: { coordinateSpace: 'normalized_1000', box_2d: [90, 90, 210, 310] },
      detectionConfidence: 0.9,
    },
  ];

  const metrics = evaluatePagePredictions(fixture, preds, bubbles);
  assert.equal(metrics.matchedRegionCount, 1);
  assert.equal(metrics.detectionRecall, 0.5);
  assert.equal(metrics.detectionPrecision, 0.5);
  assert.equal(metrics.duplicateOverlapCount, 1);
  assert.equal(metrics.bubbleRecall, 0.5);
  assert.equal(metrics.matchedCer, 0);
  assert.ok(metrics.endToEndCer > 0.3, 'End-to-end CER must penalize missed GT regions');
  assert.equal(metrics.multilineGtCount, 1);
  // Multi-line GT overlapped by an extra split detection -> groupedCleanly = false
  assert.equal(metrics.multilineGroupedCount, 0);
});
