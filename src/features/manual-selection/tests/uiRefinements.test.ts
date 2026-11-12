import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOverlayZoomCompensation,
  DEFAULT_SELECTION_OVERLAY_SIZE,
  DEFAULT_SELECTION_OUTLINE_SIZE,
  DEFAULT_BADGE_SIZE,
  normalizeSelectionOverlaySize,
  normalizeSelectionOutlineSize,
  normalizeBadgeSize,
  SELECTION_OVERLAY_METRICS,
  SELECTION_OUTLINE_METRICS,
  BADGE_METRICS,
} from '../selection/overlaySizing.ts';
import { SETTINGS_REGISTRY } from '../../../services/settings/settingsRegistry.ts';
import {
  DEFAULT_TYPERS,
  loadTyperSettings,
  saveTyperSettings,
} from '../../../types/typers.ts';
import { toggleTyperPin } from '../symbols/useTyperSettings.ts';

test('Selection outline size defaults to Medium and badge size defaults to Small (former Big)', () => {
  assert.equal(DEFAULT_SELECTION_OVERLAY_SIZE, 'medium');
  assert.equal(DEFAULT_SELECTION_OUTLINE_SIZE, 'medium');
  assert.equal(DEFAULT_BADGE_SIZE, 'small');
  assert.equal(normalizeSelectionOverlaySize('unknown'), 'medium');
  assert.equal(normalizeSelectionOutlineSize('unknown'), 'medium');
  assert.equal(normalizeBadgeSize('unknown'), 'small');
  assert.equal(normalizeBadgeSize('medium'), 'medium');
  assert.equal(normalizeBadgeSize('big'), 'big');

  const regOutline = SETTINGS_REGISTRY['workspace.selection_overlay_size'];
  assert.ok(regOutline, 'workspace.selection_overlay_size must be registered');
  assert.equal(regOutline.default_value, 'medium');
  assert.deepEqual(regOutline.allowed_values, ['small', 'medium', 'big']);
  assert.equal(regOutline.category, 'workspace');
  assert.equal(regOutline.validation?.('medium').valid, true);
  assert.equal(regOutline.validation?.('xl').valid, false);
  assert.equal(regOutline.validation?.('xl').sanitizedValue, 'medium');

  const regBadge = SETTINGS_REGISTRY['workspace.badge_size'];
  assert.ok(regBadge, 'workspace.badge_size must be registered');
  assert.equal(regBadge.default_value, 'small');
  assert.deepEqual(regBadge.allowed_values, ['small', 'medium', 'big']);
  assert.equal(regBadge.category, 'workspace');
  assert.equal(regBadge.validation?.('small').valid, true);
  assert.equal(regBadge.validation?.('invalid').valid, false);
  assert.equal(regBadge.validation?.('invalid').sanitizedValue, 'small');

  const sOutline = SELECTION_OUTLINE_METRICS.small;
  const mOutline = SELECTION_OUTLINE_METRICS.medium;
  const bOutline = SELECTION_OUTLINE_METRICS.big;

  assert.ok(sOutline.strokePx < mOutline.strokePx && mOutline.strokePx < bOutline.strokePx);
  assert.ok(sOutline.selectedStrokePx < mOutline.selectedStrokePx && mOutline.selectedStrokePx < bOutline.selectedStrokePx);

  const sBadge = BADGE_METRICS.small;
  const mBadge = BADGE_METRICS.medium;
  const bBadge = BADGE_METRICS.big;

  assert.ok(sBadge.fontSize < mBadge.fontSize && mBadge.fontSize < bBadge.fontSize);
  assert.ok(sBadge.symbolHeight < mBadge.symbolHeight && mBadge.symbolHeight < bBadge.symbolHeight);
  // Big badge stays well under legacy 20px symbol height
  assert.ok(bBadge.symbolHeight <= 18);
  assert.equal(SELECTION_OVERLAY_METRICS.medium.strokePx, mOutline.strokePx);
  assert.equal(SELECTION_OVERLAY_METRICS.medium.badge.fontSize, mBadge.fontSize);
});

test('Zoom compensation holds screen footprint constant from 100% to 1000% without mutating coordinates', () => {
  const z100 = computeOverlayZoomCompensation(100);
  const z200 = computeOverlayZoomCompensation(200);
  const z400 = computeOverlayZoomCompensation(400);
  const z50 = computeOverlayZoomCompensation(50);

  assert.equal(z100.badgeTransformScale * z100.zoomScale, 1);
  assert.equal(z200.badgeTransformScale * z200.zoomScale, 1);
  assert.equal(z400.badgeTransformScale * z400.zoomScale, 1);
  assert.ok(Math.abs(z50.badgeTransformScale * z50.zoomScale - 0.55) < 0.001);
  assert.equal(z400.strokeDivisor, 4);
});

test('toggleTyperPin toggles pin state in place while preserving custom typers and colors', () => {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
  };
  (globalThis as any).localStorage = ls;
  (globalThis as any).window = {
    localStorage: ls,
    dispatchEvent: () => true,
  };

  saveTyperSettings({
    includeTyperSymbols: true,
    prefixPosition: 'right',
    symbolPosition: 'start',
    textDirection: 'rtl',
    typers: [
      ...DEFAULT_TYPERS.map((t) => ({ ...t })),
      {
        id: 'custom_sfx',
        prefix: 'CS:',
        name: 'Custom Sound',
        instructions: 'Custom test',
        color: '#059669',
        pinned: false,
      },
    ],
  });

  const pinnedOnce = toggleTyperPin('custom_sfx');
  const customAfterPin = pinnedOnce.typers.find((t) => t.id === 'custom_sfx');
  assert.equal(customAfterPin?.pinned, true);
  assert.equal(customAfterPin?.color, '#059669');
  assert.equal(customAfterPin?.prefix, 'CS:');

  const unpinnedDefault = toggleTyperPin('speech_bubbles');
  assert.equal(unpinnedDefault.typers.find((t) => t.id === 'speech_bubbles')?.pinned, false);

  const reloaded = loadTyperSettings();
  assert.equal(reloaded.typers.find((t) => t.id === 'custom_sfx')?.pinned, true);
  assert.equal(reloaded.typers.find((t) => t.id === 'speech_bubbles')?.pinned, false);
});
