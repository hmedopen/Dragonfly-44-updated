/**
 * Folio Script: System #6 — Settings, Workspace & Quality Benchmark Engine
 * Master Settings Service
 * 
 * Manages typed configuration, atomic persistence, schema migrations,
 * multi-scope resolution (Global > Project > Chapter > Operation),
 * immutable snapshotting, and runtime change propagation.
 */

import type {
  SettingScope,
  SettingsSnapshot,
  SettingMetadata,
  SettingsChangeEvent,
  SettingsValidationContext,
} from '../../types/settings';
import { SETTINGS_REGISTRY } from './settingsRegistry';
import { ENGINE_PRESETS } from './presets';

const STORAGE_KEY_V6 = 'dragonfly44_settings_v6';
const STORAGE_KEY_LKG = 'dragonfly44_settings_lkg_v6';
const SCHEMA_VERSION = '1.0';

type SettingsListener = (event: SettingsChangeEvent) => void;

export class SettingsService {
  private globalValues: Record<string, any> = {};
  private projectValues: Record<string, Record<string, any>> = {};
  private chapterValues: Record<string, Record<string, any>> = {};
  private pendingApplyKeys: Set<string> = new Set();
  private listeners: Set<SettingsListener> = new Set();
  private revision = 1;
  private isInitialized = false;

  constructor() {
    this.init();
  }

  private init() {
    if (this.isInitialized) return;
    this.loadPersistedSettings();
    this.isInitialized = true;
  }

  /**
   * Loads persisted settings from storage, applies migrations, recovers LKG if corrupt.
   */
  private loadPersistedSettings() {
    // 1. Initialize with defaults from SETTINGS_REGISTRY
    const defaults: Record<string, any> = {};
    for (const [id, def] of Object.entries(SETTINGS_REGISTRY)) {
      defaults[id] = def.default_value;
    }
    this.globalValues = { ...defaults };

    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY_V6);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // Version check / migration
          if (parsed.global && typeof parsed.global === 'object') {
            for (const [key, val] of Object.entries(parsed.global)) {
              if (SETTINGS_REGISTRY[key]) {
                const check = SETTINGS_REGISTRY[key].validation
                  ? SETTINGS_REGISTRY[key].validation!(val)
                  : { valid: true, sanitizedValue: val };
                if (check.valid && check.sanitizedValue !== undefined) {
                  this.globalValues[key] = check.sanitizedValue;
                }
              }
            }
          }
          if (parsed.projects && typeof parsed.projects === 'object') {
            this.projectValues = parsed.projects;
          }
          if (parsed.chapters && typeof parsed.chapters === 'object') {
            this.chapterValues = parsed.chapters;
          }
          if (typeof parsed.revision === 'number') {
            this.revision = parsed.revision;
          }
          // Save Last-Known-Good configuration
          this.saveLkgCopy();
          return;
        }
      }
    } catch (err) {
      console.warn('[SettingsService] Failed to load v6 settings, attempting LKG restore:', err);
      if (this.restoreFromLkg()) {
        return;
      }
    }

    // Fallback: migrate legacy localStorage keys if v6 does not exist
    this.migrateLegacySettings();
    this.savePersistedSettings();
  }

  /**
   * Migrates pre-v6 individual localStorage keys into structured v6 store.
   */
  private migrateLegacySettings() {
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      const legacyApiKey = localStorage.getItem('dragonfly44_gemini_api_key');
      if (legacyApiKey) this.globalValues['general.gemini_api_key'] = legacyApiKey;

      const legacyModel = localStorage.getItem('dragonfly44_selected_model');
      if (legacyModel) this.globalValues['translation.model'] = legacyModel;

      const legacyCustomModel = localStorage.getItem('dragonfly44_custom_model');
      if (legacyCustomModel) this.globalValues['translation.custom_model'] = legacyCustomModel;

      const legacyEloquence = localStorage.getItem('dragonfly44_eloquence_level');
      if (legacyEloquence) {
        const num = Number(legacyEloquence);
        if ([1, 2, 3].includes(num)) this.globalValues['translation.eloquence'] = num;
      }

      const legacyFidelity = localStorage.getItem('dragonfly44_translation_fidelity');
      if (legacyFidelity) this.globalValues['translation.fidelity'] = legacyFidelity;

      const legacyHumanizerEnabled = localStorage.getItem('dragonfly44_humanizer_enabled');
      if (legacyHumanizerEnabled !== null) {
        this.globalValues['translation.humanizer_enabled'] = legacyHumanizerEnabled !== 'false';
      }

      const legacyHumanizerIntensity = localStorage.getItem('dragonfly44_humanizer_intensity');
      if (legacyHumanizerIntensity) this.globalValues['translation.humanizer_intensity'] = legacyHumanizerIntensity;

      const legacyOrthography = localStorage.getItem('dragonfly44_orthography_mode');
      if (legacyOrthography) this.globalValues['translation.orthography_mode'] = legacyOrthography;

      const legacyMasterPrompt = localStorage.getItem('dragonfly44_master_prompt_override');
      if (legacyMasterPrompt) this.globalValues['translation.master_prompt_override'] = legacyMasterPrompt;

      const legacyMasterPromptActive = localStorage.getItem('dragonfly44_master_prompt_active');
      if (legacyMasterPromptActive !== null) {
        this.globalValues['translation.master_prompt_active'] = legacyMasterPromptActive !== 'false';
      }

      const legacySFX = localStorage.getItem('dragonfly44_include_sfx');
      if (legacySFX !== null) {
        this.globalValues['scanning.include_sfx'] = legacySFX === 'true';
      }

      const legacyReadingConvention = localStorage.getItem('dragonfly44_reading_convention');
      if (legacyReadingConvention) {
        this.globalValues['scanning.reading_convention'] = legacyReadingConvention;
      }
    } catch (e) {
      console.warn('[SettingsService] Legacy migration issue:', e);
    }
  }

  /**
   * Atomic save with rollback and Last-Known-Good preservation.
   */
  private savePersistedSettings(): boolean {
    if (typeof window === 'undefined' || !window.localStorage) return true;

    const payload = {
      schema_version: SCHEMA_VERSION,
      revision: this.revision,
      updated_at: Date.now(),
      global: this.globalValues,
      projects: this.projectValues,
      chapters: this.chapterValues,
    };

    try {
      const serialized = JSON.stringify(payload);
      localStorage.setItem(STORAGE_KEY_V6, serialized);
      this.saveLkgCopy();
      return true;
    } catch (err) {
      console.error('[SettingsService] Atomic persistence failed:', err);
      return false;
    }
  }

  private saveLkgCopy() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_V6);
      if (raw) localStorage.setItem(STORAGE_KEY_LKG, raw);
    } catch {}
  }

  private restoreFromLkg(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LKG);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.global) {
        this.globalValues = parsed.global;
        this.projectValues = parsed.projects || {};
        this.chapterValues = parsed.chapters || {};
        this.revision = (parsed.revision || 0) + 1;
        return true;
      }
    } catch {}
    return false;
  }

  /**
   * Resolves effective setting value using strict precedence:
   * 1. Safety/integrity rules (non-overridable)
   * 2. Operation override (if provided)
   * 3. Chapter scope (if provided)
   * 4. Project scope (if provided)
   * 5. Global user preference
   * 6. Application default
   */
  getEffectiveValue<T = any>(
    settingId: string,
    context?: {
      projectId?: string | null;
      chapterId?: string | null;
      operationOverrides?: Record<string, any>;
    }
  ): { value: T; effectiveScope: SettingScope; isOverridden: boolean } {
    const def = SETTINGS_REGISTRY[settingId];
    if (!def) {
      throw new Error(`[SettingsService] Unknown setting ID: ${settingId}`);
    }

    // 1. Safety constraint enforcement:
    // Review auto-correction must NEVER be true if review profile is conservative
    // or if safety gates are bypassed
    if (settingId === 'review.auto_correction_eligibility') {
      const effectiveProfile = this.getEffectiveValue<string>('review.profile', context).value;
      if (effectiveProfile === 'conservative') {
        return { value: false as unknown as T, effectiveScope: 'global', isOverridden: true };
      }
    }

    // 2. Operation Override
    if (context?.operationOverrides && settingId in context.operationOverrides) {
      const val = context.operationOverrides[settingId];
      const check = def.validation ? def.validation(val) : { valid: true, sanitizedValue: val };
      if (check.valid && check.sanitizedValue !== undefined) {
        return { value: check.sanitizedValue, effectiveScope: 'operation', isOverridden: true };
      }
    }

    // 3. Chapter Scope
    if (context?.chapterId && this.chapterValues[context.chapterId]) {
      const chMap = this.chapterValues[context.chapterId];
      if (settingId in chMap) {
        const val = chMap[settingId];
        const check = def.validation ? def.validation(val) : { valid: true, sanitizedValue: val };
        if (check.valid && check.sanitizedValue !== undefined) {
          return { value: check.sanitizedValue, effectiveScope: 'chapter', isOverridden: true };
        }
      }
    }

    // 4. Project Scope
    if (context?.projectId && this.projectValues[context.projectId]) {
      const prMap = this.projectValues[context.projectId];
      if (settingId in prMap) {
        const val = prMap[settingId];
        const check = def.validation ? def.validation(val) : { valid: true, sanitizedValue: val };
        if (check.valid && check.sanitizedValue !== undefined) {
          return { value: check.sanitizedValue, effectiveScope: 'project', isOverridden: true };
        }
      }
    }

    // 5. Global Scope
    if (settingId in this.globalValues) {
      const val = this.globalValues[settingId];
      const check = def.validation ? def.validation(val) : { valid: true, sanitizedValue: val };
      if (check.valid && check.sanitizedValue !== undefined) {
        return { value: check.sanitizedValue, effectiveScope: 'global', isOverridden: false };
      }
    }

    // 6. Application Default Fallback
    return { value: def.default_value, effectiveScope: 'global', isOverridden: false };
  }

  /**
   * Sets a setting value at a target scope (global, project, or chapter)
   * with validation and atomic persistence.
   */
  setSettingValue(
    settingId: string,
    newValue: any,
    options?: {
      scope?: SettingScope;
      projectId?: string | null;
      chapterId?: string | null;
    }
  ): { success: boolean; effectiveValue: any; error?: string } {
    const def = SETTINGS_REGISTRY[settingId];
    if (!def) {
      return { success: false, effectiveValue: null, error: `Unregistered setting: ${settingId}` };
    }

    const targetScope: SettingScope = options?.scope || 'global';
    if (!def.scope.includes(targetScope)) {
      return {
        success: false,
        effectiveValue: this.getEffectiveValue(settingId, options).value,
        error: `Setting "${settingId}" does not support scope: ${targetScope}`,
      };
    }

    // Validate proposed value
    const vCtx: SettingsValidationContext = {
      scope: targetScope,
      projectId: options?.projectId,
      chapterId: options?.chapterId,
    };
    const validation = def.validation ? def.validation(newValue, vCtx) : { valid: true, sanitizedValue: newValue };
    if (!validation.valid) {
      return {
        success: false,
        effectiveValue: this.getEffectiveValue(settingId, options).value,
        error: validation.error || 'Validation failed',
      };
    }

    const sanitized = validation.sanitizedValue !== undefined ? validation.sanitizedValue : newValue;
    const oldValue = this.getEffectiveValue(settingId, options).value;

    // Persist into appropriate scope bucket
    if (targetScope === 'global') {
      this.globalValues[settingId] = sanitized;
    } else if (targetScope === 'project') {
      if (!options?.projectId) {
        return { success: false, effectiveValue: oldValue, error: 'Project ID required for project scope' };
      }
      if (!this.projectValues[options.projectId]) {
        this.projectValues[options.projectId] = {};
      }
      this.projectValues[options.projectId][settingId] = sanitized;
    } else if (targetScope === 'chapter') {
      if (!options?.chapterId) {
        return { success: false, effectiveValue: oldValue, error: 'Chapter ID required for chapter scope' };
      }
      if (!this.chapterValues[options.chapterId]) {
        this.chapterValues[options.chapterId] = {};
      }
      this.chapterValues[options.chapterId][settingId] = sanitized;
    }

    this.revision++;

    // Mark pending apply if apply mode is not immediate
    if (def.apply_mode !== 'immediate') {
      this.pendingApplyKeys.add(settingId);
    } else {
      this.pendingApplyKeys.delete(settingId);
    }

    const saveOk = this.savePersistedSettings();
    if (!saveOk) {
      // Rollback memory modification on storage failure
      if (targetScope === 'global') {
        this.globalValues[settingId] = oldValue;
      } else if (targetScope === 'project' && options?.projectId && this.projectValues[options.projectId]) {
        this.projectValues[options.projectId][settingId] = oldValue;
      } else if (targetScope === 'chapter' && options?.chapterId && this.chapterValues[options.chapterId]) {
        this.chapterValues[options.chapterId][settingId] = oldValue;
      }
      return { success: false, effectiveValue: oldValue, error: 'Failed to persist setting to storage' };
    }

    // Sync legacy localStorage keys for backward-compatibility with external scripts
    this.syncLegacyKey(settingId, sanitized);

    const effective = this.getEffectiveValue(settingId, options).value;

    // Publish change event
    const event: SettingsChangeEvent = {
      setting_id: settingId,
      old_value: oldValue,
      new_value: sanitized,
      scope: targetScope,
      apply_mode: def.apply_mode,
      applied: def.apply_mode === 'immediate',
      reason: def.apply_mode !== 'immediate' ? `Applies on ${def.apply_mode}` : undefined,
      timestamp: Date.now(),
    };
    this.notifyListeners(event);

    return { success: true, effectiveValue: effective };
  }

  private syncLegacyKey(settingId: string, value: any) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      switch (settingId) {
        case 'general.gemini_api_key':
          localStorage.setItem('dragonfly44_gemini_api_key', String(value));
          break;
        case 'translation.model':
          localStorage.setItem('dragonfly44_selected_model', String(value));
          break;
        case 'translation.custom_model':
          localStorage.setItem('dragonfly44_custom_model', String(value));
          break;
        case 'translation.eloquence':
          localStorage.setItem('dragonfly44_eloquence_level', String(value));
          break;
        case 'translation.fidelity':
          localStorage.setItem('dragonfly44_translation_fidelity', String(value));
          break;
        case 'translation.humanizer_enabled':
          localStorage.setItem('dragonfly44_humanizer_enabled', String(value));
          break;
        case 'translation.humanizer_intensity':
          localStorage.setItem('dragonfly44_humanizer_intensity', String(value));
          break;
        case 'translation.orthography_mode':
          localStorage.setItem('dragonfly44_orthography_mode', String(value));
          break;
        case 'translation.master_prompt_override':
          localStorage.setItem('dragonfly44_master_prompt_override', String(value));
          break;
        case 'translation.master_prompt_active':
          localStorage.setItem('dragonfly44_master_prompt_active', String(value));
          break;
        case 'scanning.include_sfx':
          localStorage.setItem('dragonfly44_include_sfx', String(value));
          break;
        case 'scanning.reading_convention':
          localStorage.setItem('dragonfly44_reading_convention', String(value));
          break;
      }
    } catch {}
  }

  /**
   * Centralized Model Resolver (F-22).
   * Resolves custom model identifier when model === 'custom', or returns normalized model ID.
   */
  resolveEffectiveModel(context?: { projectId?: string | null; chapterId?: string | null }): string {
    const rawModel = this.getEffectiveValue<string>('translation.model', context).value;
    if (rawModel === 'custom') {
      const customModel = this.getEffectiveValue<string>('translation.custom_model', context).value;
      if (customModel && typeof customModel === 'string' && customModel.trim().length > 0) {
        return customModel.trim();
      }
      return 'gemini-3.8-flash';
    }
    return rawModel || 'gemini-3.8-flash';
  }

  /**
   * Applies a named preset atomically across targeted settings.
   * If any setting in the preset fails, rolls back all applied settings (F-23).
   */
  applyPreset(
    presetId: string,
    options?: { scope?: SettingScope; projectId?: string | null }
  ): { success: boolean; appliedCount: number; error?: string } {
    const preset = ENGINE_PRESETS[presetId];
    if (!preset) {
      return { success: false, appliedCount: 0, error: `Preset not found: ${presetId}` };
    }

    // Save initial state for rollback in case of partial failure
    const rollbackMap: Record<string, any> = {};
    for (const key of Object.keys(preset.values)) {
      rollbackMap[key] = this.getEffectiveValue(key, options).value;
    }

    let appliedCount = 0;
    const appliedKeys: string[] = [];

    for (const [key, val] of Object.entries(preset.values)) {
      const res = this.setSettingValue(key, val, options);
      if (res.success) {
        appliedCount++;
        appliedKeys.push(key);
      } else {
        // Rollback all previously applied keys in this preset
        for (const rolledKey of appliedKeys) {
          this.setSettingValue(rolledKey, rollbackMap[rolledKey], options);
        }
        return {
          success: false,
          appliedCount: 0,
          error: `Preset transaction aborted at ${key}: ${res.error || 'Failed to apply setting'}`,
        };
      }
    }

    return { success: true, appliedCount };
  }

  /**
   * Resets a setting to default (or inherits from higher scope).
   */
  resetSetting(
    settingId: string,
    options?: { scope?: SettingScope; projectId?: string | null; chapterId?: string | null }
  ): boolean {
    const targetScope = options?.scope || 'global';
    if (targetScope === 'global') {
      const def = SETTINGS_REGISTRY[settingId];
      if (!def) return false;
      this.globalValues[settingId] = def.default_value;
    } else if (targetScope === 'project' && options?.projectId) {
      if (this.projectValues[options.projectId]) {
        delete this.projectValues[options.projectId][settingId];
      }
    } else if (targetScope === 'chapter' && options?.chapterId) {
      if (this.chapterValues[options.chapterId]) {
        delete this.chapterValues[options.chapterId][settingId];
      }
    }

    this.revision++;
    this.pendingApplyKeys.delete(settingId);
    this.savePersistedSettings();
    const effective = this.getEffectiveValue(settingId, options).value;
    this.syncLegacyKey(settingId, effective);

    this.notifyListeners({
      setting_id: settingId,
      old_value: null,
      new_value: effective,
      scope: targetScope,
      apply_mode: 'immediate',
      applied: true,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * Resets an entire category or all settings at a scope.
   */
  resetCategory(
    category: string,
    options?: { scope?: SettingScope; projectId?: string | null }
  ): number {
    let count = 0;
    for (const [id, def] of Object.entries(SETTINGS_REGISTRY)) {
      if (def.category === category) {
        if (this.resetSetting(id, options)) count++;
      }
    }
    return count;
  }

  /**
   * Creates an immutable operation snapshot frozen at start of run.
   * Section 3.2: Each operation receives a resolved immutable snapshot.
   */
  createOperationSnapshot(options?: {
    projectId?: string | null;
    chapterId?: string | null;
    operationOverrides?: Record<string, any>;
  }): SettingsSnapshot {
    const values: Record<string, any> = {};
    const metadata: Record<string, SettingMetadata> = {};

    for (const [id, def] of Object.entries(SETTINGS_REGISTRY)) {
      const { value, effectiveScope, isOverridden } = this.getEffectiveValue(id, options);
      values[id] = value;
      metadata[id] = {
        revision: this.revision,
        updatedAt: Date.now(),
        scope: options?.operationOverrides && id in options.operationOverrides ? 'operation' : effectiveScope,
        effectiveScope,
        isOverridden,
        pendingApply: this.pendingApplyKeys.has(id),
        applyMode: def.apply_mode,
      };
    }

    // Acknowledge applied next_operation settings upon snapshot consumption
    for (const id of Array.from(this.pendingApplyKeys)) {
      this.pendingApplyKeys.delete(id);
    }

    const snapshot: SettingsSnapshot = {
      snapshot_id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      revision: this.revision,
      timestamp: Date.now(),
      scope: options?.operationOverrides ? 'operation' : (options?.chapterId ? 'chapter' : (options?.projectId ? 'project' : 'global')),
      projectId: options?.projectId,
      chapterId: options?.chapterId,
      values: Object.freeze(values),
      metadata: Object.freeze(metadata),
    };

    return Object.freeze(snapshot);
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(event: SettingsChangeEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[SettingsService] Listener threw error:', err);
      }
    }
  }

  isPending(settingId: string): boolean {
    return this.pendingApplyKeys.has(settingId);
  }

  getRevision(): number {
    return this.revision;
  }
}

export const settingsService = new SettingsService();
