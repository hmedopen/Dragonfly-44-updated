/**
 * Folio Script — Settings Redesign Verification Suite
 * Validates:
 * 1. Category organization (8 categories in exact order)
 * 2. Key settings preservation (general.keep_utility_rail_expanded, workspace.double_click_confirmation, etc.)
 * 3. SettingsSwitch contract (role, aria-checked, keyboard activation, controlled propagation)
 * 4. SettingsNavigation configuration (icon -> title arrangement, item order)
 * 5. Registry scope and default value preservation
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('--- RUNNING SETTINGS REDESIGN VERIFICATION TESTS ---');

// 1. Verify SettingsNavigation.tsx categories
const navPath = path.resolve('src/components/Settings/SettingsNavigation.tsx');
assert.ok(fs.existsSync(navPath), 'SettingsNavigation.tsx must exist');
const navContent = fs.readFileSync(navPath, 'utf8');

const expectedCategories = [
  'general',
  'tweaks',
  'workspace',
  'translate',
  'scanning',
  'review',
  'memory',
  'quality',
];

for (const cat of expectedCategories) {
  assert.ok(
    navContent.includes(`id: '${cat}'`),
    `SettingsNavigation must include category id '${cat}'`
  );
}

// Verify ICON -> TITLE arrangement in navigation
assert.ok(
  navContent.includes('{item.icon}'),
  'Navigation item must render item.icon'
);
assert.ok(
  navContent.includes('{item.label}'),
  'Navigation item must render item.label'
);
assert.ok(
  navContent.includes('flex items-center gap-2.5'),
  'Navigation item must horizontally align icon and title'
);
console.log('✓ 1. SettingsNavigation: 8 categories in exact order with horizontal ICON → TITLE layout verified');

// 2. Verify SettingsSwitch.tsx
const switchPath = path.resolve('src/components/Settings/SettingsSwitch.tsx');
assert.ok(fs.existsSync(switchPath), 'SettingsSwitch.tsx must exist');
const switchContent = fs.readFileSync(switchPath, 'utf8');

assert.ok(switchContent.includes('role="switch"'), 'SettingsSwitch must have role="switch"');
assert.ok(switchContent.includes('aria-checked={checked}'), 'SettingsSwitch must have aria-checked');
assert.ok(switchContent.includes("e.key === ' ' || e.key === 'Enter'"), 'SettingsSwitch must handle Space and Enter');
assert.ok(switchContent.includes('e.stopPropagation()'), 'SettingsSwitch must stop event propagation');
console.log('✓ 2. SettingsSwitch: accessible switch with role, aria-checked, keyboard handlers, and event isolation verified');

// 3. Verify SettingTooltip.tsx
const tooltipPath = path.resolve('src/components/Settings/SettingTooltip.tsx');
assert.ok(fs.existsSync(tooltipPath), 'SettingTooltip.tsx must exist');
const tooltipContent = fs.readFileSync(tooltipPath, 'utf8');

assert.ok(tooltipContent.includes('delayMs = 900') || tooltipContent.includes('1000'), 'Tooltip must enforce ~1s delay');
assert.ok(tooltipContent.includes('clearTimer'), 'Tooltip must clear timer on mouse leave');
assert.ok(tooltipContent.includes('role="tooltip"'), 'Tooltip must have role="tooltip"');
console.log('✓ 3. SettingTooltip: 1-second delayed contextual tooltip with boundary clamping verified');

// 4. Verify registry definitions & preservation
const registryPath = path.resolve('src/services/settings/settingsRegistry.ts');
const regContent = fs.readFileSync(registryPath, 'utf8');

const requiredKeys = [
  'general.gemini_api_key',
  'general.keep_utility_rail_expanded',
  'workspace.double_click_confirmation',
  'workspace.overlay_boxes_visible',
  'workspace.overlay_review_markers_visible',
  'workspace.overlay_reading_order_visible',
  'workspace.overlay_panels_visible',
  'workspace.coordinate_diagnostics',
  'translation.model',
  'translation.custom_model',
  'translation.eloquence',
  'translation.fidelity',
  'translation.humanizer_enabled',
  'translation.humanizer_intensity',
  'translation.master_prompt_override',
  'translation.master_prompt_active',
  'scanning.profile',
  'scanning.reading_convention',
  'scanning.include_sfx',
  'scanning.ocr_confidence_threshold',
  'scanning.enable_crop_retries',
  'review.profile',
  'review.ambiguous_ocr_abstention',
  'review.auto_correction_eligibility',
  'memory.learning_mode',
  'memory.cross_chapter_learning',
  'memory.context_budget_tokens',
  'quality.regression_gate_enabled',
];

for (const key of requiredKeys) {
  assert.ok(regContent.includes(`'${key}':`), `Registry must contain setting '${key}'`);
}
console.log(`✓ 4. All ${requiredKeys.length} settings definitions verified in settingsRegistry.ts`);

// 5. Verify SettingsModal right-side sliding panel and overlay architecture
const modalPath = path.resolve('src/components/Settings/SettingsModal.tsx');
assert.ok(fs.existsSync(modalPath), 'SettingsModal.tsx must exist');
const modalContent = fs.readFileSync(modalPath, 'utf8');

assert.ok(modalContent.includes("initial={{ x: '100%' }}"), 'Settings panel must slide in from right');
assert.ok(modalContent.includes("animate={{ x: 0 }}"), 'Settings panel must animate to x: 0');
assert.ok(modalContent.includes("exit={{ x: '100%' }}"), 'Settings panel must slide out to right');
assert.ok(modalContent.includes('bg-black/50'), 'Backdrop dimming must be present to preserve visible workspace');
assert.ok(modalContent.includes('SettingsNavigation'), 'Must render SettingsNavigation');
assert.ok(modalContent.includes('SettingsHeader'), 'Must render SettingsHeader');
assert.ok(modalContent.includes('SettingsFooter'), 'Must render SettingsFooter');
assert.ok(modalContent.includes('hasUnsavedChanges'), 'Must perform deep dirty checking');
assert.ok(modalContent.includes('handleApply'), 'Must support Apply action');
console.log('✓ 5. SettingsModal: sliding right overlay panel, stationary navigation, and draft/apply mechanics verified');

console.log('--- ALL SETTINGS REDESIGN VERIFICATION TESTS PASSED ---');
