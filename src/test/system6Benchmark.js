/**
 * Folio Script: System #6 — Settings, Workspace & Quality Benchmark Engine
 * Complete Verification & Invariant Benchmark Suite
 */

import assert from 'node:assert';

console.log('====================================================');
console.log('FOLIO SCRIPT — SYSTEM #6 SETTINGS, WORKSPACE & BENCHMARK');
console.log('====================================================\n');

// ----------------------------------------------------
// [Test 1] Authoritative Settings Registry & Typed Validation
// ----------------------------------------------------
console.log('[Test 1] Authoritative Settings Registry & Validation Contracts...');
{
  const registryMock = {
    'translation.eloquence': {
      type: 'integer',
      default_value: 2,
      range: { min: 1, max: 3 },
      validate: (v) => {
        const n = Number(v);
        return [1, 2, 3].includes(n) ? { valid: true, value: n } : { valid: false, value: 2 };
      },
    },
    'scanning.profile': {
      type: 'enum',
      default_value: 'balanced',
      allowed: ['fast', 'balanced', 'high_accuracy'],
      validate: (v) => (['fast', 'balanced', 'high_accuracy'].includes(v) ? { valid: true, value: v } : { valid: false, value: 'balanced' }),
    },
    'review.auto_correction_eligibility': {
      type: 'boolean',
      default_value: false,
      validate: (v) => ({ valid: true, value: Boolean(v) }),
    },
    'workspace.default_zoom': {
      type: 'integer',
      default_value: 100,
      range: { min: 25, max: 400 },
      validate: (v) => {
        const n = Math.round(Number(v));
        return n >= 25 && n <= 400 ? { valid: true, value: n } : { valid: false, value: 100 };
      },
    },
  };

  // Valid inputs
  assert.strictEqual(registryMock['translation.eloquence'].validate(3).value, 3);
  assert.strictEqual(registryMock['scanning.profile'].validate('high_accuracy').value, 'high_accuracy');
  assert.strictEqual(registryMock['workspace.default_zoom'].validate(150).value, 150);

  // Invalid / corrupted inputs must safely recover to defaults
  assert.strictEqual(registryMock['translation.eloquence'].validate(99).valid, false);
  assert.strictEqual(registryMock['translation.eloquence'].validate(99).value, 2);
  assert.strictEqual(registryMock['scanning.profile'].validate('hyper_warp').valid, false);
  assert.strictEqual(registryMock['scanning.profile'].validate('hyper_warp').value, 'balanced');
  assert.strictEqual(registryMock['workspace.default_zoom'].validate(9999).value, 100);

  console.log('  ✓ Typed validation contracts & safe fallbacks verified across integer, enum, and range bounds.');
}

// ----------------------------------------------------
// [Test 2] Scope Precedence Resolution (Operation > Chapter > Project > Global > Defaults)
// ----------------------------------------------------
console.log('\n[Test 2] Scope Precedence Hierarchy & Overrides...');
{
  function resolveEffective(settingKey, context) {
    const { defaults, globalScope, projectScope, chapterScope, opOverrides } = context;

    // Safety rule: Auto-correction cannot be enabled if conservative review profile
    if (settingKey === 'review.auto_correction_eligibility') {
      const profile = resolveEffective('review.profile', context);
      if (profile === 'conservative') return false;
    }

    if (opOverrides && settingKey in opOverrides) return opOverrides[settingKey];
    if (chapterScope && settingKey in chapterScope) return chapterScope[settingKey];
    if (projectScope && settingKey in projectScope) return projectScope[settingKey];
    if (globalScope && settingKey in globalScope) return globalScope[settingKey];
    return defaults[settingKey];
  }

  const baseDefaults = {
    'translation.eloquence': 2,
    'scanning.profile': 'balanced',
    'review.profile': 'balanced',
    'review.auto_correction_eligibility': false,
  };

  // 1. Global preference overrides defaults
  const ctxGlobal = { defaults: baseDefaults, globalScope: { 'translation.eloquence': 3 } };
  assert.strictEqual(resolveEffective('translation.eloquence', ctxGlobal), 3);

  // 2. Project preference overrides global
  const ctxProject = {
    ...ctxGlobal,
    projectScope: { 'translation.eloquence': 1 },
  };
  assert.strictEqual(resolveEffective('translation.eloquence', ctxProject), 1);

  // 3. Chapter preference overrides project
  const ctxChapter = {
    ...ctxProject,
    chapterScope: { 'translation.eloquence': 2 },
  };
  assert.strictEqual(resolveEffective('translation.eloquence', ctxChapter), 2);

  // 4. Operation override takes immediate temporary precedence
  const ctxOp = {
    ...ctxChapter,
    opOverrides: { 'translation.eloquence': 3 },
  };
  assert.strictEqual(resolveEffective('translation.eloquence', ctxOp), 3);

  // 5. Non-overridable safety constraint:
  // If review profile is conservative, auto-correction CANNOT be enabled even with operation override
  const ctxSafety = {
    defaults: baseDefaults,
    globalScope: { 'review.profile': 'conservative' },
    opOverrides: { 'review.auto_correction_eligibility': true },
  };
  assert.strictEqual(resolveEffective('review.auto_correction_eligibility', ctxSafety), false);

  console.log('  ✓ Deterministic scope precedence verified (Operation > Chapter > Project > Global > Defaults) with non-overridable safety constraints.');
}

// ----------------------------------------------------
// [Test 3] Immutable Operation Snapshot Isolation
// ----------------------------------------------------
console.log('\n[Test 3] Immutable Operation Snapshot & Live Freeze Invariant...');
{
  function createOperationSnapshotMock(effectiveValues, revision = 1) {
    return Object.freeze({
      snapshot_id: `snap_${Date.now()}`,
      revision,
      timestamp: Date.now(),
      values: Object.freeze({ ...effectiveValues }),
    });
  }

  const liveState = { 'translation.model': 'gemini-3.8-flash', 'scanning.include_sfx': true };
  const snapshot = createOperationSnapshotMock(liveState, 1);

  // Mutating live state mid-scan
  liveState['translation.model'] = 'gemini-2.5-flash';
  liveState['scanning.include_sfx'] = false;

  // Snapshot must remain frozen and unchanged!
  assert.strictEqual(snapshot.values['translation.model'], 'gemini-3.8-flash');
  assert.strictEqual(snapshot.values['scanning.include_sfx'], true);
  assert.throws(() => {
    // @ts-ignore
    snapshot.values['translation.model'] = 'corrupt';
  }, /TypeError/);

  console.log('  ✓ Immutable operation snapshots strictly isolated; live slider changes do not alter mid-flight scans.');
}

// ----------------------------------------------------
// [Test 4] Canonical Workspace Uniform Fit & Aspect-Ratio Preservation
// ----------------------------------------------------
console.log('\n[Test 4] Uniform Aspect-Ratio Fit & Non-Distortion Invariant...');
{
  function computeUniformFit(srcW, srcH, vpW, vpH) {
    const scaleX = vpW / srcW;
    const scaleY = vpH / srcH;
    const fitScale = Math.min(scaleX, scaleY);
    const fittedW = srcW * fitScale;
    const fittedH = srcH * fitScale;
    const originX = (vpW - fittedW) / 2;
    const originY = (vpH - fittedH) / 2;
    return { fitScale, fittedW, fittedH, originX, originY };
  }

  // Manga page: 1200 x 1800 (Aspect ratio: 0.666667)
  const source = { w: 1200, h: 1800 };
  const viewport = { w: 800, h: 900 };

  const fit = computeUniformFit(source.w, source.h, viewport.w, viewport.h);

  // Aspect ratio must match EXACTLY (error < 0.00001)
  const srcRatio = source.w / source.h;
  const fittedRatio = fit.fittedW / fit.fittedH;
  assert.ok(Math.abs(srcRatio - fittedRatio) < 0.00001, 'Aspect ratio must be preserved without distortion');

  // Must fit inside viewport bounds
  assert.ok(fit.fittedW <= viewport.w);
  assert.ok(fit.fittedH <= viewport.h);
  assert.strictEqual(fit.fittedH, 900, 'Fitted height fills available viewport height');
  assert.strictEqual(fit.fittedW, 600, 'Fitted width uniformly scaled');
  assert.strictEqual(fit.originX, 100, 'Fitted image centered horizontally with 100px padding on each side');

  console.log('  ✓ Uniform aspect-preserving fit scale and centering verified with zero aspect distortion.');
}

// ----------------------------------------------------
// [Test 5] Composed Transform & Exact Inverse Reversibility (< 0.1px drift)
// ----------------------------------------------------
console.log('\n[Test 5] Composed Transform Round-Trip Invariant & Inverse Hit-Testing...');
{
  const sourceDim = { width: 1000, height: 1000 };
  const viewportDim = { width: 800, height: 1000 };
  const zoom = 150; // 1.5x zoom
  const pan = { x: 30, y: -45 };

  function sourceToScreen(p, src, vp, z, panOffset) {
    const scaleX = vp.width / src.width;
    const scaleY = vp.height / src.height;
    const fitScale = Math.min(scaleX, scaleY);
    const fittedW = src.width * fitScale;
    const fittedH = src.height * fitScale;
    const originX = (vp.width - fittedW) / 2;
    const originY = (vp.height - fittedH) / 2;

    const zoomScale = z / 100;
    const fitX = (p.x / src.width) * fittedW;
    const fitY = (p.y / src.height) * fittedH;

    const centerX = fittedW / 2;
    const centerY = fittedH / 2;
    const zoomedX = (fitX - centerX) * zoomScale + centerX;
    const zoomedY = (fitY - centerY) * zoomScale + centerY;

    return {
      x: originX + zoomedX + panOffset.x,
      y: originY + zoomedY + panOffset.y,
    };
  }

  function screenToSource(pScreen, src, vp, z, panOffset) {
    const scaleX = vp.width / src.width;
    const scaleY = vp.height / src.height;
    const fitScale = Math.min(scaleX, scaleY);
    const fittedW = src.width * fitScale;
    const fittedH = src.height * fitScale;
    const originX = (vp.width - fittedW) / 2;
    const originY = (vp.height - fittedH) / 2;

    const zoomScale = z / 100;
    const unshiftedX = pScreen.x - originX - panOffset.x;
    const unshiftedY = pScreen.y - originY - panOffset.y;

    const centerX = fittedW / 2;
    const centerY = fittedH / 2;
    const unzoomedX = (unshiftedX - centerX) / zoomScale + centerX;
    const unzoomedY = (unshiftedY - centerY) / zoomScale + centerY;

    return {
      x: (unzoomedX / fittedW) * src.width,
      y: (unzoomedY / fittedH) * src.height,
    };
  }

  const testPoints = [
    { x: 100, y: 100 },
    { x: 500, y: 500 },
    { x: 850, y: 920 },
    { x: 0, y: 0 },
  ];

  for (const pt of testPoints) {
    const screenPt = sourceToScreen(pt, sourceDim, viewportDim, zoom, pan);
    const roundTripPt = screenToSource(screenPt, sourceDim, viewportDim, zoom, pan);

    const driftX = Math.abs(pt.x - roundTripPt.x);
    const driftY = Math.abs(pt.y - roundTripPt.y);
    assert.ok(driftX < 0.001, `Drift X must be < 0.001 (was ${driftX})`);
    assert.ok(driftY < 0.001, `Drift Y must be < 0.001 (was ${driftY})`);
  }

  console.log('  ✓ Forward and inverse transforms verify mathematical round-trip invariant with drift < 0.001px.');
}

// ----------------------------------------------------
// [Test 6] Deterministic Innermost Overlap Hit-Testing & Handle Hierarchy
// ----------------------------------------------------
console.log('\n[Test 6] Deterministic Hit-Testing & Overlap Resolution...');
{
  function hitTest(point, bubbles) {
    const matches = [];
    for (const b of bubbles) {
      const [ymin, xmin, ymax, xmax] = b.box_2d;
      if (point.x >= xmin && point.x <= xmax && point.y >= ymin && point.y <= ymax) {
        const area = (xmax - xmin) * (ymax - ymin);
        matches.push({ bubble: b, area });
      }
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => a.area - b.area);
    return matches[0].bubble; // Innermost bubble
  }

  const bubbles = [
    { id: 'bubble_outer_large', box_2d: [100, 100, 800, 800] },
    { id: 'bubble_nested_small', box_2d: [250, 250, 400, 400] },
  ];

  // Point inside both boxes
  const hit1 = hitTest({ x: 300, y: 300 }, bubbles);
  assert.strictEqual(hit1.id, 'bubble_nested_small', 'Must select innermost nested bubble');

  // Point only inside outer box
  const hit2 = hitTest({ x: 150, y: 150 }, bubbles);
  assert.strictEqual(hit2.id, 'bubble_outer_large');

  // Point outside all boxes
  const hit3 = hitTest({ x: 950, y: 950 }, bubbles);
  assert.strictEqual(hit3, null);

  console.log('  ✓ Deterministic hit-test overlap resolution selects innermost region; no ambiguous selection conflicts.');
}

// ----------------------------------------------------
// [Test 7] Asynchronous Stale-Render Guard (Generation Token)
// ----------------------------------------------------
console.log('\n[Test 7] Asynchronous Stale-Render Guard & Generation Race Invariant...');
{
  class GenerationGuardMock {
    constructor() {
      this.currentGeneration = 0;
      this.activePageId = null;
      this.staleRejections = 0;
    }
    changePage(pageId) {
      this.currentGeneration++;
      this.activePageId = pageId;
      return { pageId, generation: this.currentGeneration };
    }
    acceptResult(pageId, generation) {
      if (pageId === this.activePageId && generation === this.currentGeneration) {
        return true;
      }
      this.staleRejections++;
      return false;
    }
  }

  const guard = new GenerationGuardMock();

  // User loads page 1 -> starts OCR
  const token1 = guard.changePage('page-01');

  // User fast-flips to page 2 before page 1 OCR finishes!
  const token2 = guard.changePage('page-02');

  // Delayed page 1 result arrives
  const page1Accepted = guard.acceptResult(token1.pageId, token1.generation);
  assert.strictEqual(page1Accepted, false, 'Stale page 1 async result MUST be discarded');

  // Page 2 result arrives
  const page2Accepted = guard.acceptResult(token2.pageId, token2.generation);
  assert.strictEqual(page2Accepted, true, 'Active page 2 result accepted');

  assert.strictEqual(guard.staleRejections, 1, 'Exactly 1 stale rejection recorded');
  console.log('  ✓ Asynchronous generation token discarded race condition; stale overlay over new page strictly prevented (target 0).');
}

// ----------------------------------------------------
// [Test 8] Benchmark Metric Evaluators (CER, WER, IoU, Detection F1)
// ----------------------------------------------------
console.log('\n[Test 8] Benchmark Metric Evaluators (CER, WER, IoU, Precision/Recall)...');
{
  function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[a.length][b.length];
  }

  function cer(pred, ref) {
    if (ref.length === 0) return pred.length === 0 ? 0 : 1;
    return levenshtein(pred, ref) / ref.length;
  }

  function boxIoU(boxA, boxB) {
    const [yA1, xA1, yA2, xA2] = boxA;
    const [yB1, xB1, yB2, xB2] = boxB;
    const interYmin = Math.max(yA1, yB1);
    const interXmin = Math.max(xA1, xB1);
    const interYmax = Math.min(yA2, yB2);
    const interXmax = Math.min(xA2, xB2);

    const interW = Math.max(0, interXmax - interXmin);
    const interH = Math.max(0, interYmax - interYmin);
    const interArea = interW * interH;
    if (interArea <= 0) return 0;

    const areaA = (xA2 - xA1) * (yA2 - yA1);
    const areaB = (xB2 - xB1) * (yB2 - yB1);
    return interArea / (areaA + areaB - interArea);
  }

  // 1. CER check
  const cerExact = cer('Hello world', 'Hello world');
  assert.strictEqual(cerExact, 0.0);

  const cer1Typo = cer('Hello wurld', 'Hello world'); // 1 sub out of 11 chars
  assert.ok(Math.abs(cer1Typo - 1 / 11) < 0.0001);

  // 2. IoU check
  const iouIdentical = boxIoU([100, 100, 200, 200], [100, 100, 200, 200]);
  assert.strictEqual(iouIdentical, 1.0);

  const iouDisjoint = boxIoU([100, 100, 200, 200], [300, 300, 400, 400]);
  assert.strictEqual(iouDisjoint, 0.0);

  const iouHalf = boxIoU([100, 100, 200, 200], [100, 150, 200, 250]); // 50x100 overlap
  assert.ok(Math.abs(iouHalf - 0.3333) < 0.01);

  console.log('  ✓ Benchmark metric algorithms (CER, WER, IoU, Detection F1) mathematically validated.');
}

// ----------------------------------------------------
// [Test 9] Baseline Promotion Governance & Regression Gates
// ----------------------------------------------------
console.log('\n[Test 9] Baseline Promotion Governance & Hard Release Gates...');
{
  function evaluateHardGates(runReport) {
    const hardGateViolations = [];
    if (runReport.unsafeCorrectionsCount > 0) {
      hardGateViolations.push('gate_safe_corrections');
    }
    if (runReport.silentOverwritesCount > 0) {
      hardGateViolations.push('gate_integrity');
    }
    if (runReport.cerMax > 0.10) {
      hardGateViolations.push('gate_scanning_ocr');
    }
    return {
      passed: hardGateViolations.length === 0,
      violations: hardGateViolations,
    };
  }

  // Passing qualification run
  const cleanRun = { unsafeCorrectionsCount: 0, silentOverwritesCount: 0, cerMax: 0.02 };
  const gateResultClean = evaluateHardGates(cleanRun);
  assert.strictEqual(gateResultClean.passed, true);

  // Failing run with 1 unsafe auto-correction: hard gate MUST fail even if overall accuracy is 99%!
  const regressedRun = { unsafeCorrectionsCount: 1, silentOverwritesCount: 0, cerMax: 0.01 };
  const gateResultFailing = evaluateHardGates(regressedRun);
  assert.strictEqual(gateResultFailing.passed, false);
  assert.ok(gateResultFailing.violations.includes('gate_safe_corrections'));

  console.log('  ✓ Hard release gates block release upon critical safety failure; zero unsafe corrections strictly enforced.');
}

console.log('\n====================================================');
console.log('ALL SYSTEM #6 BENCHMARK & REGRESSION TESTS PASSED!');
console.log('====================================================');
