/**
 * Folio Script: System #6 — Settings, Workspace & Quality Benchmark Engine
 * Canonical Settings Domain Contracts & Registry Schemas
 */

export type SettingOwnerSystem =
  | 'system_2'
  | 'system_3'
  | 'system_4'
  | 'system_5'
  | 'workspace'
  | 'quality'
  | 'general';

export type SettingType =
  | 'boolean'
  | 'integer'
  | 'decimal'
  | 'enum'
  | 'string'
  | 'structured'
  | 'preset';

export type SettingScope = 'global' | 'project' | 'chapter' | 'operation';

export type SettingApplyMode = 'immediate' | 'next_operation' | 'reload' | 'restart';

export type SettingVisibility = 'basic' | 'advanced' | 'developer-only' | 'internal';

export type SettingResetBehavior = 'default' | 'preset' | 'project_default' | 'inherited';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitizedValue?: any;
}

export interface SettingsValidationContext {
  scope: SettingScope;
  allSettings?: Record<string, any>;
  projectId?: string | null;
  chapterId?: string | null;
}

export interface SettingDefinition<T = any> {
  setting_id: string;
  owner_system: SettingOwnerSystem;
  type: SettingType;
  default_value: T;
  allowed_values?: T[];
  range?: { min: number; max: number; step?: number };
  validation?: (value: T, context?: SettingsValidationContext) => ValidationResult;
  apply_mode: SettingApplyMode;
  scope: SettingScope[];
  visibility: SettingVisibility;
  runtime_binding: string;
  schema_version: string;
  reset_behavior: SettingResetBehavior;
  label: string;
  description: string;
  unit?: string;
  category: 'general' | 'translation' | 'scanning' | 'review' | 'memory' | 'workspace' | 'quality' | 'general_tweaks';
}

export interface SettingMetadata {
  revision: number;
  updatedAt: number;
  scope: SettingScope;
  effectiveScope: SettingScope;
  isOverridden: boolean;
  pendingApply: boolean;
  applyMode: SettingApplyMode;
}

export interface SettingsSnapshot {
  snapshot_id: string;
  revision: number;
  timestamp: number;
  scope: SettingScope;
  projectId?: string | null;
  chapterId?: string | null;
  values: Record<string, any>;
  metadata: Record<string, SettingMetadata>;
}

export interface SettingsPreset {
  preset_id: string;
  name: string;
  description: string;
  target_systems: SettingOwnerSystem[];
  values: Record<string, any>;
  version: string;
}

export interface SettingsChangeEvent {
  setting_id: string;
  old_value: any;
  new_value: any;
  scope: SettingScope;
  apply_mode: SettingApplyMode;
  applied: boolean;
  reason?: string;
  timestamp: number;
}
