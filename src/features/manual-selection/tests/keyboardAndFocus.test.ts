import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandleWorkspaceShortcut } from '../selection/shortcuts.ts';
import { clampFloatingGeometry, loadFloatingGeometry } from '../../../components/Tools/floatingWindowGeometry.ts';

test('Shortcuts are suppressed during IME composition (JA/KO/ZH) and inside text inputs', () => {
  // Active Japanese/Korean/Chinese IME composition must never fire shortcuts
  assert.equal(
    shouldHandleWorkspaceShortcut({ isComposing: true, target: null }),
    false
  );
  assert.equal(
    shouldHandleWorkspaceShortcut({ keyCode: 229, target: null }),
    false
  );

  // Typing inside TEXTAREA, INPUT, SELECT, or contenteditable must never trigger shortcuts
  assert.equal(
    shouldHandleWorkspaceShortcut({ target: { tagName: 'TEXTAREA' } as unknown as EventTarget }),
    false
  );
  assert.equal(
    shouldHandleWorkspaceShortcut({ target: { tagName: 'INPUT' } as unknown as EventTarget }),
    false
  );
  assert.equal(
    shouldHandleWorkspaceShortcut({ target: { tagName: 'SELECT' } as unknown as EventTarget }),
    false
  );
  assert.equal(
    shouldHandleWorkspaceShortcut({ target: { isContentEditable: true } as unknown as EventTarget }),
    false
  );

  // Outside inputs with modifier-free key presses -> allowed
  assert.equal(
    shouldHandleWorkspaceShortcut({ target: { tagName: 'DIV' } as unknown as EventTarget }),
    true
  );
  assert.equal(
    shouldHandleWorkspaceShortcut({ target: { tagName: 'CANVAS' } as unknown as EventTarget }),
    true
  );

  // Modifier combinations are not intercepted as plain shortcuts
  assert.equal(
    shouldHandleWorkspaceShortcut({ ctrlKey: true, target: { tagName: 'DIV' } as unknown as EventTarget }),
    false
  );
});

test('FloatingWindow clamping keeps VirtualKeyboard and ManualSelectionPanel onscreen across resize/monitor changes', () => {
  // Simulate saved out-of-bounds VirtualKeyboard geometry (e.g. from wider secondary monitor)
  const store = new Map<string, string>();
  store.set(
    'dragonfly44_keyboard_geom',
    JSON.stringify({ x: 2400, y: 1400, width: 620, height: 320 })
  );
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
  };
  (globalThis as any).window = {
    innerWidth: 1024,
    innerHeight: 720,
    localStorage: (globalThis as any).localStorage,
  };

  const loadedKb = loadFloatingGeometry(
    'dragonfly44_keyboard_geom',
    { x: 300, y: 340, width: 620, height: 320 },
    480,
    230
  );
  assert.ok(loadedKb.x + loadedKb.width <= 1024 - 12);
  assert.ok(loadedKb.y + loadedKb.height <= 720 - 12);
  assert.ok(loadedKb.x >= 12 && loadedKb.y >= 12);

  // Extreme shrink viewport clamp preserves min usable bounds safely without negative origins
  const tight = clampFloatingGeometry({ x: 500, y: 500, width: 340, height: 420 }, 640, 480, 296, 330);
  assert.ok(tight.x >= 12 && tight.x + tight.width <= 628);
  assert.ok(tight.y >= 12 && tight.y + tight.height <= 468);
});
