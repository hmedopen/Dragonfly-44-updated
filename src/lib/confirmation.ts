/**
 * Folio Script: Unified Confirmation System
 * 
 * Central controller, React hooks, and event-flow handlers for critical / destructive actions:
 * - Delete operations (page, chapter, bubble, thumbnail)
 * - Navigation & Exit (return to hub / back navigation)
 * - Open Chapter interactions
 * - Inline Save & Revert transforms
 * 
 * Rules:
 * When confirmation is OFF:
 *   - 1 click executes the action immediately.
 *   - No second click is required.
 * When confirmation is ON:
 *   - 1st click arms the existing action button / target.
 *   - 2nd click executes the action.
 *   - Leaving the interaction area cancels the armed state.
 *   - The 1st click must NEVER execute the action.
 *   - Changes to the setting take effect immediately without application restart.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { settingsService } from '../services/settings/settingsService';

export const CONFIRMATION_SETTING_KEY = 'workspace.double_click_confirmation';

/**
 * Reads the current effective confirmation setting value (sync).
 */
export function getConfirmationSetting(projectId?: string | null): boolean {
  try {
    const effective = settingsService.getEffectiveValue<boolean>(CONFIRMATION_SETTING_KEY, { projectId });
    return effective.value ?? true;
  } catch {
    return true;
  }
}

/**
 * React hook that reactively subscribes to the global confirmation setting.
 * Triggers an immediate re-render when the setting is modified or applied.
 */
export function useConfirmationSetting(projectId?: string | null): boolean {
  const [isEnabled, setIsEnabled] = useState<boolean>(() => getConfirmationSetting(projectId));

  useEffect(() => {
    // Initial sync
    setIsEnabled(getConfirmationSetting(projectId));

    const unsubscribe = settingsService.subscribe((event) => {
      if (event.setting_id === CONFIRMATION_SETTING_KEY || !event.setting_id) {
        setIsEnabled(getConfirmationSetting(projectId));
      }
    });

    return () => unsubscribe();
  }, [projectId]);

  return isEnabled;
}

export interface ConfirmActionOptions<T = any> {
  onExecute: (arg?: T) => void;
  isConfirmationEnabled?: boolean | (() => boolean);
  projectId?: string | null;
  onArmedChange?: (isArmed: boolean, armedKey: string | null) => void;
}

/**
 * Headless behavioural controller for confirmable actions.
 * Testable in standard Node.js scripts without requiring a browser DOM.
 */
export class ConfirmActionController<T = any> {
  private isArmed = false;
  private armedKey: string | null = null;
  private options: ConfirmActionOptions<T>;

  constructor(options: ConfirmActionOptions<T>) {
    this.options = options;
  }

  public updateOptions(options: Partial<ConfirmActionOptions<T>>) {
    this.options = { ...this.options, ...options };
  }

  public isEnabled(): boolean {
    if (typeof this.options.isConfirmationEnabled === 'function') {
      return this.options.isConfirmationEnabled();
    }
    if (typeof this.options.isConfirmationEnabled === 'boolean') {
      return this.options.isConfirmationEnabled;
    }
    return getConfirmationSetting(this.options.projectId);
  }

  public getIsArmed(key?: string): boolean {
    if (!this.isArmed) return false;
    if (key !== undefined) return this.armedKey === key;
    return this.isArmed;
  }

  public getArmedKey(): string | null {
    return this.isArmed ? this.armedKey : null;
  }

  /**
   * Primary click handler.
   * - Setting OFF: executes immediately on first click.
   * - Setting ON: arms on first click; executes only on second click for the matching key.
   */
  public handleClick(key: string = 'default', arg?: T): { executed: boolean; armed: boolean } {
    const enabled = this.isEnabled();

    if (!enabled) {
      this.reset();
      this.options.onExecute(arg);
      return { executed: true, armed: false };
    }

    if (this.isArmed && this.armedKey === key) {
      // 2nd click while armed on this exact key: execute action and disarm
      this.reset();
      this.options.onExecute(arg);
      return { executed: true, armed: false };
    }

    // 1st click: arm this key
    this.isArmed = true;
    this.armedKey = key;
    this.options.onArmedChange?.(true, key);
    return { executed: false, armed: true };
  }

  /**
   * Pointer leave handler.
   * Immediately cancels armed state. Never executes the underlying action.
   */
  public handleMouseLeave(key?: string): { cancelled: boolean } {
    if (this.isArmed) {
      if (key === undefined || this.armedKey === key) {
        this.reset();
        return { cancelled: true };
      }
    }
    return { cancelled: false };
  }

  /**
   * Resets armed state unconditionally.
   */
  public reset(): void {
    if (this.isArmed || this.armedKey !== null) {
      this.isArmed = false;
      this.armedKey = null;
      this.options.onArmedChange?.(false, null);
    }
  }
}

/**
 * Reusable React Hook for confirmable single-target or keyed actions.
 */
export function useConfirmableAction<T = any>(
  onExecute: (arg?: T) => void,
  options?: {
    projectId?: string | null;
    isConfirmationEnabled?: boolean;
    defaultKey?: string;
  }
) {
  const isEnabledFromSettings = useConfirmationSetting(options?.projectId);
  const isConfirmationEnabled = options?.isConfirmationEnabled !== undefined
    ? options.isConfirmationEnabled
    : isEnabledFromSettings;

  const [armedKey, setArmedKey] = useState<string | null>(null);

  const controllerRef = useRef<ConfirmActionController<T>>(
    new ConfirmActionController<T>({
      onExecute,
      isConfirmationEnabled: () => isConfirmationEnabled,
      onArmedChange: (_isArmed, key) => setArmedKey(key),
    })
  );

  useEffect(() => {
    controllerRef.current.updateOptions({
      onExecute,
      isConfirmationEnabled: () => isConfirmationEnabled,
      onArmedChange: (_isArmed, key) => setArmedKey(key),
    });
  }, [onExecute, isConfirmationEnabled]);

  const trigger = useCallback((key?: string, arg?: T) => {
    const k = key || options?.defaultKey || 'default';
    return controllerRef.current.handleClick(k, arg);
  }, [options?.defaultKey]);

  const cancel = useCallback((key?: string) => {
    return controllerRef.current.handleMouseLeave(key);
  }, []);

  const reset = useCallback(() => {
    controllerRef.current.reset();
  }, []);

  const isArmed = useCallback((key?: string) => {
    const k = key || options?.defaultKey || 'default';
    return controllerRef.current.getIsArmed(k);
  }, [options?.defaultKey]);

  return {
    isArmed,
    armedKey,
    trigger,
    cancel,
    reset,
    isConfirmationEnabled,
  };
}
