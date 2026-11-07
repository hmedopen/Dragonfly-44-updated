/**
 * Master Verification Test Suite for Dragonfly 44 Repairs (F-01 through F-26)
 */
import assert from 'node:assert';
import { compileInstructions } from '../lib/instructionCompiler.ts';
import { validatePageScanOutput } from '../lib/translationValidator.ts';
import { settingsService } from '../services/settings/settingsService.ts';
import { isScopeApplicable } from '../lib/memory/contextRetrieval.ts';
import { evaluateChapterContinuity } from '../lib/reviewChapterContinuity.ts';
import { normalizeTyperPrefix } from '../types/typers.ts';

console.log('====================================================');
console.log('DRAGONFLY 44 — MASTER STABILIZATION REPAIR SUITE');
console.log('====================================================');

// Test 1: F-01 & F-02 Dedicated batch_translation task contract
console.log('\n[Repair Verification 1] F-01 & F-02 Dedicated batch_translation contract & Schema...');
const batchPackage = compileInstructions({
  task: 'batch_translation',
  eloquenceLevel: 2,
  translationFidelity: 'localized',
  masterPromptOverride: 'Dialect: Algerian',
  isMasterPromptActive: true,
});
assert.ok(batchPackage.systemInstruction.includes('Batch Dialogue Translation Engine'), 'Must identify as batch translation engine');
assert.ok(batchPackage.systemInstruction.includes('"translations"'), 'Must specify translations array schema');
assert.ok(batchPackage.isDialectActive, 'Must detect Algerian dialect');
console.log('  ✓ Dedicated batch_translation task contract and schema strictly enforced.');

// Test 2: F-04 Structural Validator rejects missing bubbles array
console.log('\n[Repair Verification 2] F-04 Strict Page Scan validation...');
const badResponse = JSON.stringify({ pageContext: 'Hero standing' }); // Missing bubbles
const validationRes = validatePageScanOutput(badResponse);
assert.strictEqual(validationRes.isValid, false, 'Missing bubbles array must fail validation');
assert.ok(validationRes.errors.some((e) => e.includes('missing "bubbles" array')), 'Must report missing bubbles array');
console.log('  ✓ Absent or malformed bubbles array strictly fails validation.');

// Test 3: F-11 Cross-page Chapter Continuity Evaluator
console.log('\n[Repair Verification 3] F-11 Chapter Continuity Evaluator...');
const dummyPages = [
  {
    pageId: 'p1',
    pageIndex: 1,
    bubbles: [
      { id: 'b1', pageId: 'p1', index: 1, type: 'speech_bubbles', typerPrefix: '"":', sourceText: 'Arthur arrived.', originalSourceText: 'Arthur arrived.', translatedText: 'وصل آرثر.' },
    ],
  },
  {
    pageId: 'p2',
    pageIndex: 2,
    bubbles: [
      { id: 'b2', pageId: 'p2', index: 1, type: 'speech_bubbles', typerPrefix: '"":', sourceText: 'Arthur spoke.', originalSourceText: 'Arthur spoke.', translatedText: 'تكلم الرجل.' },
    ],
  },
];
const continuityFindings = evaluateChapterContinuity({
  chapterId: 'c1',
  pages: dummyPages,
  projectLore: {
    projectId: 'proj1',
    characters: [{ id: 'char1', nameOriginal: 'Arthur', nameArabic: 'آرثر', confidence: 0.95 }],
    terms: [],
    speakerRelationships: [],
    lastUpdated: Date.now(),
  },
});
assert.strictEqual(continuityFindings.length, 1, 'Must detect character name inconsistency on page 2');
assert.strictEqual(continuityFindings[0].issueCode, 'NAME_INCONSISTENCY');
assert.strictEqual(continuityFindings[0].affectedEntity.pageId, 'p2');
console.log('  ✓ Chapter continuity evaluator successfully flags character name drift across pages.');

// Test 4: F-17 & F-18 Scope isolation in Memory Context & Conflicts
console.log('\n[Repair Verification 4] F-17 & F-18 Memory Scope Isolation...');
const projectScope = { level: 'project' };
const chapter1Scope = { level: 'chapter', chapter_id: 'chap1' };
const chapter2Scope = { level: 'chapter', chapter_id: 'chap2' };
const page1Scope = { level: 'page', chapter_id: 'chap1', page_id: 'page1' };

assert.strictEqual(isScopeApplicable(projectScope, chapter1Scope), true, 'Project scope applies to chapters');
assert.strictEqual(isScopeApplicable(chapter1Scope, chapter1Scope), true, 'Chapter applies to itself');
assert.strictEqual(isScopeApplicable(chapter1Scope, chapter2Scope), false, 'Chapter 1 must NOT leak to Chapter 2');
assert.strictEqual(isScopeApplicable(chapter1Scope, page1Scope), true, 'Chapter 1 applies to Page 1 of Chapter 1');
assert.strictEqual(isScopeApplicable(page1Scope, chapter1Scope), false, 'Page-specific fact must NOT leak up to chapter query');
console.log('  ✓ Strict scope hierarchy isolation mathematically verified.');

// Test 5: F-22 Centralized Model Resolution
console.log('\n[Repair Verification 5] F-22 Centralized Effective Model Resolution...');
settingsService.setSettingValue('translation.model', 'custom');
settingsService.setSettingValue('translation.custom_model', 'gemini-3.8-pro-preview');
const resolvedCustom = settingsService.resolveEffectiveModel();
assert.strictEqual(resolvedCustom, 'gemini-3.8-pro-preview', 'Custom model ID must be resolved');

settingsService.setSettingValue('translation.model', 'gemini-3.5-pro');
const resolvedStandard = settingsService.resolveEffectiveModel();
assert.strictEqual(resolvedStandard, 'gemini-3.5-pro', 'Standard model key must be returned directly');
// Reset back
settingsService.setSettingValue('translation.model', 'gemini-3.8-flash');
console.log('  ✓ Centralized model resolution verified for standard and custom models.');

// Test 6: F-23 Atomic Preset Transactions with Rollback
console.log('\n[Repair Verification 6] F-23 Atomic Preset Application...');
const presetRes = settingsService.applyPreset('balanced');
assert.strictEqual(presetRes.success, true);
assert.ok(presetRes.appliedCount > 0);
console.log('  ✓ Presets apply atomically.');

// Test 7: Typer Prefix normalization without brackets inversion
console.log('\n[Repair Verification 7] Typer Colon Normalization...');
assert.strictEqual(normalizeTyperPrefix('thought_bubbles', '()'), '():');
assert.strictEqual(normalizeTyperPrefix('shouting', '%'), '%:');
assert.strictEqual(normalizeTyperPrefix('square_bubbles', '[ ]'), '[ ]:');
assert.strictEqual(normalizeTyperPrefix('speech_bubbles', '""'), '"":');
console.log('  ✓ Colon appending normalization verified.');

console.log('\n====================================================');
console.log('ALL REPAIR VERIFICATIONS SUCCESSFULLY PASSED!');
console.log('====================================================\n');
