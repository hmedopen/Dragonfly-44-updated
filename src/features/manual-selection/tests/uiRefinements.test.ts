import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOverlayZoomCompensation,
  DEFAULT_SELECTION_OVERLAY_SIZE,
  normalizeSelectionOverlaySize,
  SELECTION_OVERLAY_METRICS,
} from '../selection/overlaySizing.ts';
import { SETTINGS_REGISTRY } from '../../../services/settings/settingsRegistry.ts';
import {
  DEFAULT_TYPERS,
  loadTyperSettings,
  saveTyperSettings,
} from '../../../types/typers.ts';
import { toggleTyperPin } from '../symbols/useTyperSettings.ts';

test('Selection overlay size defaults to Small and orders Small < Medium < Big below legacy size', () => {
  assert.equal(DEFAULT_SELECTION_OVERLAY_SIZE, 'small');
  assert.equal(normalizeSelectionOverlaySize('unknown'), 'small');
  assert.equal(normalizeSelectionOverlaySize('medium'), 'medium');
  assert.equal(normalizeSelectionOverlaySize('big'), 'big');

  const reg = SETTINGS_REGISTRY['workspace.selection_overlay_size'];
  assert.ok(reg, 'workspace.selection_overlay_size must be registered');
  assert.equal(reg.default_value, 'small');
  assert.deepEqual(reg.allowed_values, ['small', 'medium', 'big']);
  assert.equal(reg.category, 'workspace');
  assert.equal(reg.validation?.('medium').valid, true);
  assert.equal(reg.validation?.('xl').valid, false);
  assert.equal(reg.validation?.('xl').sanitizedValue, 'small');

  const s = SELECTION_OVERLAY_METRICS.small;
  const m = SELECTION_OVERLAY_METRICS.medium;
  const b = SELECTION_OVERLAY_METRICS.big;

  assert.ok(s.strokePx < m.strokePx && m.strokePx < b.strokePx);
  assert.ok(s.selectedStrokePx < m.selectedStrokePx && m.selectedStrokePx < b.selectedStrokePx);
  assert.ok(s.badge.fontSize < m.badge.fontSize && m.badge.fontSize < b.badge.fontSize);
  assert.ok(s.badge.symbolHeight < m.badge.symbolHeight && m.badge.symbolHeight < b.badge.symbolHeight);
  // Legacy badge had 20px symbol height (24px total). Even Big must remain much smaller.
  assert.ok(b.badge.symbolHeight <= 14);
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
