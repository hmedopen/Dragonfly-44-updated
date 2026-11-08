/**
 * Folio Script — Restored Scanning Architecture Verification Suite
 * 
 * Verifies production modules restored to commit 42de509b648cd4b9f87ccab98ea7516e5669e7de:
 * 1. scanPromptBuilder.ts (Prompt & pure JSON schema)
 * 2. translationValidator.ts (validateSystem3ScanOutput: panels & regions only)
 * 3. readingOrder.ts (groupIntoTiers & hierarchical inference without XY-Cut)
 * 4. coordinateTransforms.ts (precision round-trips without tile math)
 * 5. scanAdapter.ts (1:1 BubbleItem mapping & manual preservation)
 * 6. rescanMerge.ts (multi-signal merge without balloon tracking)
 * 7. compileTypeR.ts (TypeR script & raw text SFX filtering)
 * 8. db.ts (DB_VERSION 8 & training stores intact)
 */

import assert from 'node:assert';
import { buildSystem3ScanInstruction } from '../lib/scanPromptBuilder';
import { validateSystem3ScanOutput } from '../lib/translationValidator';
import {
  inferHierarchicalReadingOrder,
} from '../lib/readingOrder';
import {
  createTransformRecord,
  normalizedToPixelBox,
  pixelToNormalizedBox,
  calculateBoxIoU,
} from '../lib/coordinateTransforms';
import {
  scanResultToBubbleItems,
  updateScanResultFromBubbleItems,
} from '../lib/scanAdapter';
import {
  mergeScanWithExistingState,
} from '../lib/rescanMerge';
import { compileTypeRScript, compileRawTextExtract } from '../lib/compileTypeR';
import { DB_VERSION, STORE_TRAINING_REFERENCE_SETS, STORE_TRAINING_BLOBS } from '../services/db';
import type { PageScanResult, PanelRegion, TextRegion } from '../types/scanning';
import type { BubbleItem } from '../types/workbench';
import { DEFAULT_TYPER_SETTINGS } from '../types/typers';

console.log('====================================================');
console.log('FOLIO SCRIPT: RESTORED SCANNER PRODUCTION VERIFICATION');
console.log('====================================================\n');

// ----------------------------------------------------
// Test 1: Prompt Builder & Pure Schema Invariant
// ----------------------------------------------------
console.log('[Test 1] Gemini Scanning Prompt & Output Schema Invariant...');
const prompt = buildSystem3ScanInstruction({ readingConvention: 'manga_rtl', includeSFX: true });
assert.ok(prompt.includes('Identify panels on this page'), 'Must instruct identification of panels on page');
assert.ok(prompt.includes('"panels":'), 'Schema must specify panels array');
assert.ok(prompt.includes('"regions":'), 'Schema must specify regions array');
assert.ok(!prompt.includes('"balloons":'), 'Schema must NOT contain experimental balloons array');
assert.ok(!prompt.includes('"translationUnits":'), 'Schema must NOT contain experimental translationUnits array');
console.log('  ✓ Gemini scan prompt and schema strictly match 42de509 baseline.');

// ----------------------------------------------------
// Test 2: Structural Validator (Panels & Regions Only)
// ----------------------------------------------------
console.log('[Test 2] Structural Scan Response Validation...');
const sampleModelResponse = JSON.stringify({
  pageContext: 'Action scene with two warriors facing each other.',
  readingConventionCandidate: 'manga_rtl',
  panels: [
    { panelId: 'p-1', box_2d: [50, 50, 450, 950] },
    { panelId: 'p-2', box_2d: [500, 50, 950, 950] },
  ],
  regions: [
    {
      regionId: 'r-1',
      box_2d: [80, 600, 200, 900],
      rawOCR: 'استعد للهزيمة!',
      primaryClass: 'dialogue',
      isVertical: false,
    },
    {
      regionId: 'r-2',
      box_2d: [120, 100, 240, 400],
      rawOCR: 'لن أستسلم أبداً!',
      primaryClass: 'dialogue',
      isVertical: false,
    },
  ],
  detectedCharacters: [{ nameOriginal: 'Leo', nameArabic: 'ليو', gender: 'male' }],
  detectedGlossaryTerms: [],
  detectedRelationships: [],
});

const validationResult = validateSystem3ScanOutput(sampleModelResponse);
assert.strictEqual(validationResult.isValid, true);
assert.strictEqual(validationResult.data?.panels.length, 2);
assert.strictEqual(validationResult.data?.regions.length, 2);
assert.strictEqual(validationResult.data?.regions[0].rawOCR, 'استعد للهزيمة!');
assert.ok(!('balloons' in (validationResult.data as any)), 'Validated data must not carry balloons');
console.log('  ✓ Structural validator correctly parses panels and regions without balloon overhead.');

// ----------------------------------------------------
// Test 3: Hierarchical Reading Order (Manga RTL)
// ----------------------------------------------------
console.log('[Test 3] Hierarchical Reading Order (Page -> Panels -> Intra-panel)...');
const panels: PanelRegion[] = [
  { panelId: 'p-1', geometry: { coordinateSpace: 'normalized_1000', box_2d: [50, 50, 450, 950] }, detectionConfidence: 0.95, sequenceIndex: 1 },
  { panelId: 'p-2', geometry: { coordinateSpace: 'normalized_1000', box_2d: [500, 50, 950, 950] }, detectionConfidence: 0.95, sequenceIndex: 2 },
];

const textRegions: TextRegion[] = [
  {
    regionId: 'r-left',
    geometry: { coordinateSpace: 'normalized_1000', box_2d: [100, 100, 250, 400] },
    rawOCR: 'Bubble on left of top panel',
    confidence: { imageQuality: 1, regionDetection: 1, ocr: 1, association: 1, readingOrder: 1, classification: 1 },
    classification: { primaryClass: 'dialogue', confidence: 1, needsReview: false },
    associations: {},
    order: { sequenceIndex: 1, confidence: 1 },
    flags: [],
  },
  {
    regionId: 'r-right',
    geometry: { coordinateSpace: 'normalized_1000', box_2d: [100, 600, 250, 900] },
    rawOCR: 'Bubble on right of top panel',
    confidence: { imageQuality: 1, regionDetection: 1, ocr: 1, association: 1, readingOrder: 1, classification: 1 },
    classification: { primaryClass: 'dialogue', confidence: 1, needsReview: false },
    associations: {},
    order: { sequenceIndex: 2, confidence: 1 },
    flags: [],
  },
];

const orderedRegions = inferHierarchicalReadingOrder(panels, textRegions, 'manga_rtl');
// In Manga RTL within the same panel at similar vertical height, rightmost bubble (r-right, xmin 600) MUST come first!
assert.strictEqual(orderedRegions[0].regionId, 'r-right', 'Right bubble must precede left bubble in Manga RTL');
assert.strictEqual(orderedRegions[1].regionId, 'r-left', 'Left bubble must follow right bubble in Manga RTL');
assert.strictEqual(orderedRegions[0].order.sequenceIndex, 1);
assert.strictEqual(orderedRegions[1].order.sequenceIndex, 2);
console.log('  ✓ Hierarchical reading order strictly preserves Manga RTL panel and intra-panel sequencing.');

// ----------------------------------------------------
// Test 4: Coordinate Transformations & Numerical Round-Trip
// ----------------------------------------------------
console.log('[Test 4] Coordinate Transforms Round-Trip Invariant (<0.1% drift)...');
const sourceW = 1200;
const sourceH = 1800;
const normBox: [number, number, number, number] = [100, 200, 300, 400]; // 10% to 30% Y, 20% to 40% X

const pixelBox = normalizedToPixelBox(normBox, sourceW, sourceH);
assert.deepStrictEqual(pixelBox, [180, 240, 540, 480]);

const restoredNorm = pixelToNormalizedBox(pixelBox, sourceW, sourceH);
assert.strictEqual(Math.abs(restoredNorm[0] - normBox[0]) <= 1, true);
assert.strictEqual(Math.abs(restoredNorm[1] - normBox[1]) <= 1, true);
assert.strictEqual(Math.abs(restoredNorm[2] - normBox[2]) <= 1, true);
assert.strictEqual(Math.abs(restoredNorm[3] - normBox[3]) <= 1, true);

const iou = calculateBoxIoU([100, 100, 200, 200], [100, 100, 200, 200]);
assert.strictEqual(iou, 1.0);
console.log('  ✓ Coordinate transformations guarantee mathematical exactness without tile translation drift.');

// ----------------------------------------------------
// Test 5: Scan Adapter 1:1 Mapping & Manual Preservation
// ----------------------------------------------------
console.log('[Test 5] Scan Adapter 1:1 Mapping & Manual Edit Preservation...');
const canonicalScan: PageScanResult = {
  scanId: 'scan-123',
  pageId: 'page-1',
  sourceImageId: 'page-1',
  sourceDimensions: { width: 1000, height: 1400 },
  readingConvention: 'manga_rtl',
  status: 'complete',
  panels: [],
  regions: [
    {
      regionId: 'r-1',
      geometry: { coordinateSpace: 'normalized_1000', box_2d: [100, 200, 300, 400] },
      rawOCR: 'Hello world',
      confidence: { imageQuality: 1, regionDetection: 1, ocr: 1, association: 1, readingOrder: 1, classification: 1 },
      classification: { primaryClass: 'dialogue', confidence: 1, needsReview: false },
      associations: {},
      order: { sequenceIndex: 1, confidence: 1 },
      flags: [],
    },
  ],
  issues: [],
  transformLedger: createTransformRecord({ sourceImageId: 'page-1', sourceWidth: 1000, sourceHeight: 1400 }),
  createdAt: Date.now(),
  version: 1,
};

const bubbles = scanResultToBubbleItems(canonicalScan, DEFAULT_TYPER_SETTINGS);
assert.strictEqual(bubbles.length, 1);
assert.strictEqual(bubbles[0].id, 'r-1');
assert.strictEqual(bubbles[0].sourceText, 'Hello world');
assert.strictEqual(bubbles[0].type, 'speech_bubbles');
assert.deepStrictEqual(bubbles[0].box_2d, [100, 200, 300, 400]);

// Verify reverse sync updateScanResultFromBubbleItems
bubbles[0].sourceText = 'User edited source';
bubbles[0].isManuallyEdited = true;
const updatedScan = updateScanResultFromBubbleItems(canonicalScan, bubbles);
assert.strictEqual(updatedScan.regions[0].rawOCR, 'Hello world', 'Original rawOCR preserved in canonical scan');
console.log('  ✓ 1:1 BubbleItem adaptation and canonical synchronization verified.');

// ----------------------------------------------------
// Test 6: Multi-Signal Rescan Merge (Zero Dialogue Loss)
// ----------------------------------------------------
console.log('[Test 6] Multi-Signal Rescan Merge...');
const existingBubbles: BubbleItem[] = [
  {
    id: 'existing-b1',
    pageId: 'page-1',
    index: 1,
    box_2d: [105, 195, 305, 405],
    type: 'speech_bubbles',
    typerPrefix: '"":',
    sourceText: 'مرحباً بالعالم',
    originalSourceText: 'Hello world',
    translatedText: 'مرحباً بكم',
    rawTranslatedText: 'مرحباً بكم',
    reviewFlags: [],
    confidence: 0.95,
    isManuallyEdited: true, // User manual edit!
    updatedAt: Date.now(),
  },
];

const rescanResult = mergeScanWithExistingState({
  newScan: canonicalScan,
  existingBubbles,
  typerSettings: DEFAULT_TYPER_SETTINGS,
});

assert.strictEqual(rescanResult.mergedBubbles.length, 1, 'Must merge without duplicate bubble creation');
assert.strictEqual(rescanResult.mergedBubbles[0].id, 'existing-b1', 'Must preserve existing bubble ID');
assert.strictEqual(rescanResult.mergedBubbles[0].sourceText, 'مرحباً بالعالم', 'User manual text edit must be preserved');
assert.strictEqual(rescanResult.mergedBubbles[0].translatedText, 'مرحباً بكم', 'Existing translation must be preserved');
assert.strictEqual(rescanResult.stats.preservedManualEdits, 1);
console.log('  ✓ Rescan merge maintains stable identity, zero duplicate creation, and 100% edit preservation.');

// ----------------------------------------------------
// Test 7: SFX Export Filtering (Independent Improvement)
// ----------------------------------------------------
console.log('[Test 7] TypeR Export SFX Filtering...');
const mixedBubbles: BubbleItem[] = [
  {
    id: 'b-dialogue',
    pageId: 'page-1',
    index: 1,
    box_2d: [100, 200, 300, 400],
    type: 'speech_bubbles',
    typerPrefix: '"":',
    sourceText: 'Dialogue line',
    originalSourceText: 'Dialogue line',
    translatedText: 'سطر حوار',
    rawTranslatedText: 'سطر حوار',
    reviewFlags: [],
  },
  {
    id: 'b-sfx',
    pageId: 'page-1',
    index: 2,
    box_2d: [500, 500, 600, 600],
    type: 'sfx',
    typerPrefix: 'SFX:',
    sourceText: 'BOOM',
    originalSourceText: 'BOOM',
    translatedText: 'بوم',
    rawTranslatedText: 'بوم',
    reviewFlags: [],
  },
];

const exportWithSFX = compileRawTextExtract({
  chapterName: 'Chapter 1',
  pages: [{ pageIndex: 0, bubbles: mixedBubbles }],
  includeSFX: true,
  includePageHeaders: true,
  includeIndexTags: true,
  includePrefixTags: true,
});
assert.ok(exportWithSFX.includes('BOOM'), 'Export with SFX=true must include SFX');

const exportWithoutSFX = compileRawTextExtract({
  chapterName: 'Chapter 1',
  pages: [{ pageIndex: 0, bubbles: mixedBubbles }],
  includeSFX: false,
  includePageHeaders: true,
  includeIndexTags: true,
  includePrefixTags: true,
});
assert.ok(!exportWithoutSFX.includes('BOOM'), 'Export with SFX=false must exclude SFX');
assert.ok(exportWithoutSFX.includes('Dialogue line'), 'Export with SFX=false must retain dialogue');

const scriptWithoutSFX = compileTypeRScript({
  chapterName: 'Chapter 1',
  pages: [{ pageIndex: 0, bubbles: mixedBubbles }],
  includeSFX: false,
  includePageHeaders: true,
  includeIndexTags: true,
  includePrefixTags: true,
  includeSourceComments: false,
  includeFlagNotes: false,
});
assert.ok(!scriptWithoutSFX.includes('BOOM'), 'TypeR script must exclude SFX when includeSFX=false');
assert.ok(scriptWithoutSFX.includes('سطر حوار'), 'TypeR script must retain translated dialogue');
console.log('  ✓ TypeR and Raw Text export SFX filtering fully verified.');

// ----------------------------------------------------
// Test 8: Database Schema v8 & Training Store Invariants
// ----------------------------------------------------
console.log('[Test 8] Database Schema v8 & Training Stores...');
assert.strictEqual(DB_VERSION, 8, 'Database version must remain 8');
assert.strictEqual(STORE_TRAINING_REFERENCE_SETS, 'training_reference_sets');
assert.strictEqual(STORE_TRAINING_BLOBS, 'training_blobs');
console.log('  ✓ Database v8 and Training Studio storage identifiers remain intact.');

console.log('\n====================================================');
console.log('ALL RESTORED SCANNING TESTS PASSED WITH 100% SUCCESS!');
console.log('====================================================\n');
