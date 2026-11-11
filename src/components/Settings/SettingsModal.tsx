import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { settingsService } from '../../services/settings/settingsService';
import { useWorkbenchStore } from '../../store/workbenchStore';
import { ENGINE_PRESETS } from '../../services/settings/presets';
import { SETTINGS_REGISTRY } from '../../services/settings/settingsRegistry';
import { loadTyperSettings, saveTyperSettings, DEFAULT_TYPERS, type TyperSettings } from '../../types/typers';

import { SettingsHeader } from './SettingsHeader';
import { SettingsFooter } from './SettingsFooter';
import { SettingsNavigation, type SettingsNavCategory, SETTINGS_NAV_ITEMS } from './SettingsNavigation';

import { GeneralView } from './views/GeneralView';
import { TweaksView } from './views/TweaksView';
import { WorkspaceView } from './views/WorkspaceView';
import { TranslateView } from './views/TranslateView';
import { ScanningView } from './views/ScanningView';
import { ReviewView } from './views/ReviewView';
import { MemoryView } from './views/MemoryView';
import { QualityView } from './views/QualityView';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenBenchmark?: () => void;
  projectId?: string | null;
}

const getInitialSettingsValues = (projectId: string | null) => {
  const vals: Record<string, any> = {};
  for (const key of Object.keys(SETTINGS_REGISTRY)) {
    vals[key] = settingsService.getEffectiveValue(key, { projectId }).value;
  }
  return vals;
};

/**
 * SettingsModal — Master Settings Slide-Out Panel.
 *
 * Requirements:
 * - Slides in from the RIGHT edge of the screen
 * - Occupies ~50% of the available application width (responsive on smaller windows)
 * - Overlays the existing workspace; the workspace behind remains visible and retains dimensions
 * - Left edge has a subtle controlled shadow for depth separation
 * - Structure:
 *   1. Settings header (stable at top)
 *   2. Content area (scrolls independently, immediately to the left of navigation)
 *   3. Navigation sidebar (fixed to FAR RIGHT edge, stationary during content scroll)
 *   4. Settings footer (stable at bottom, contains Apply & Close)
 * - Preserves all existing setting IDs, scopes, defaults, and persistence semantics
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenBenchmark,
  projectId = null,
}) => {
  const [activeCategory, setActiveCategory] = useState<SettingsNavCategory>('translate');
  const [revision, setRevision] = useState(() => settingsService.getRevision());

  // Hardware Telemetry state
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle');
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isKeyVisible, setIsKeyVisible] = useState(false);

  // Staged Draft & Applied Snapshot State for Unsaved Changes Protection
  const appliedSnapshotRef = useRef<{
    values: Record<string, any>;
    typers: TyperSettings;
  }>({
    values: getInitialSettingsValues(projectId),
    typers: JSON.parse(JSON.stringify(loadTyperSettings())),
  });

  const [draftValues, setDraftValues] = useState<Record<string, any>>(() => appliedSnapshotRef.current.values);
  const [typerSettings, setTyperSettings] = useState<TyperSettings>(() => appliedSnapshotRef.current.typers);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Sync draft and applied snapshot when panel opens or projectId changes
  useEffect(() => {
    if (isOpen) {
      const vals = getInitialSettingsValues(projectId);
      const typers = loadTyperSettings();
      appliedSnapshotRef.current = {
        values: vals,
        typers: JSON.parse(JSON.stringify(typers)),
      };
      setDraftValues(vals);
      setTyperSettings(typers);
      setShowDiscardConfirm(false);
    }
  }, [isOpen, projectId]);

  // Deep comparison to track actual differences between draft and last applied settings
  const hasUnsavedChanges = useCallback((): boolean => {
    const appliedVals = appliedSnapshotRef.current.values;
    for (const key of Object.keys(draftValues)) {
      const draftVal = draftValues[key];
      const appliedVal = appliedVals[key];
      if (JSON.stringify(draftVal) !== JSON.stringify(appliedVal)) {
        return true;
      }
    }
    const appliedTypers = appliedSnapshotRef.current.typers;
    if (JSON.stringify(typerSettings) !== JSON.stringify(appliedTypers)) {
      return true;
    }
    return false;
  }, [draftValues, typerSettings]);

  const handleRequestClose = useCallback(() => {
    if (!hasUnsavedChanges()) {
      onClose();
    } else {
      setShowDiscardConfirm(true);
    }
  }, [hasUnsavedChanges, onClose]);

  // Keyboard shortcut: Esc to close (guarded with unsaved changes confirmation)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (showDiscardConfirm) {
          setShowDiscardConfirm(false);
        } else {
          handleRequestClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showDiscardConfirm, handleRequestClose]);

  useEffect(() => {
    const unsub = settingsService.subscribe(() => {
      setRevision(settingsService.getRevision());
    });
    return () => unsub();
  }, []);

  const getVal = <T,>(key: string): T => {
    if (key in draftValues) {
      return draftValues[key] as T;
    }
    return settingsService.getEffectiveValue<T>(key, { projectId }).value;
  };

  const setVal = (key: string, val: any) => {
    setDraftValues((prev) => ({
      ...prev,
      [key]: val,
    }));
  };

  const handleResetCategory = () => {
    if (activeCategory === 'workspace') {
      if (window.confirm('Reset all workspace settings and typers back to defaults?')) {
        setTyperSettings((prev) => ({ ...prev, typers: DEFAULT_TYPERS }));
        const resetVals: Record<string, any> = {};
        for (const [key, def] of Object.entries(SETTINGS_REGISTRY)) {
          if (def.category === 'workspace') {
            resetVals[key] = def.default_value;
          }
        }
        setDraftValues((prev) => ({ ...prev, ...resetVals }));
      }
      return;
    }

    const categoryMap: Record<SettingsNavCategory, string> = {
      general: 'general',
      tweaks: 'general_tweaks',
      workspace: 'workspace',
      translate: 'translation',
      scanning: 'scanning',
      review: 'review',
      memory: 'memory',
      quality: 'quality',
    };

    const targetCat = categoryMap[activeCategory];
    if (window.confirm(`Reset all settings in "${activeCategory}" to default?`)) {
      const resetVals: Record<string, any> = {};
      for (const [key, def] of Object.entries(SETTINGS_REGISTRY)) {
        if (def.category === targetCat) {
          resetVals[key] = def.default_value;
        }
      }
      setDraftValues((prev) => ({ ...prev, ...resetVals }));
    }
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = ENGINE_PRESETS[presetId];
    if (preset && preset.values) {
      setDraftValues((prev) => ({
        ...prev,
        ...preset.values,
      }));
    }
  };

  const handleApply = () => {
    try {
      const appliedVals = appliedSnapshotRef.current.values;
      let sfxChanged = false;
      let newSfxVal = false;

      for (const [key, val] of Object.entries(draftValues)) {
        if (JSON.stringify(val) !== JSON.stringify(appliedVals[key])) {
          const def = SETTINGS_REGISTRY[key];
          const isProjectScope = Boolean(projectId && def?.scope?.includes('project'));
          settingsService.setSettingValue(key, val, {
            projectId: isProjectScope ? projectId : undefined,
            scope: isProjectScope ? 'project' : 'global',
          });
          if (key === 'scanning.include_sfx') {
            sfxChanged = true;
            newSfxVal = Boolean(val);
          }
        }
      }

      if (sfxChanged) {
        useWorkbenchStore.getState().reconcileActiveSFXState(newSfxVal);
      }

      if (JSON.stringify(typerSettings) !== JSON.stringify(appliedSnapshotRef.current.typers)) {
        saveTyperSettings(typerSettings);
      }

      appliedSnapshotRef.current = {
        values: { ...draftValues },
        typers: JSON.parse(JSON.stringify(typerSettings)),
      };

      setRevision(settingsService.getRevision());
    } catch (err) {
      console.error('Failed to apply settings:', err);
      alert(`Failed to apply settings: ${err}`);
    }
  };

  // Telemetry Ping test
  const handleTestConnection = async () => {
    const apiKey = getVal<string>('general.gemini_api_key');
    if (!apiKey || !apiKey.trim()) {
      setConnectionStatus('failed');
      setErrorMessage('API key is empty');
      return;
    }

    setConnectionStatus('testing');
    setErrorMessage(null);

    const model = getVal<string>('translation.model') || 'gemini-3.8-flash';
    const customModel = getVal<string>('translation.custom_model');
    const effectiveModel = model === 'custom' && customModel && customModel.trim() ? customModel.trim() : model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}?key=${apiKey.trim()}`;

    const start = performance.now();
    try {
      const res = await fetch(url);
      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        setPingMs(latency);
        setConnectionStatus('connected');
      } else {
        const errorData = await res.json().catch(() => null);
        setConnectionStatus('failed');
        setErrorMessage(errorData?.error?.message || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      setConnectionStatus('failed');
      setErrorMessage(err?.message || 'Network request failed');
    }
  };

  const currentNavItem = SETTINGS_NAV_ITEMS.find((c) => c.id === activeCategory) || SETTINGS_NAV_ITEMS[0];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[55] overflow-hidden flex justify-end">
          {/* 1. Backdrop Dimming (Subtle, preserves visible underlying workspace) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleRequestClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-[2px] cursor-pointer"
            aria-hidden="true"
          />

          {/* 2. Sliding Settings Panel from Right */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="relative z-10 w-full sm:w-[85vw] md:w-[65vw] lg:w-[50vw] min-w-[480px] max-w-[800px] h-full bg-[#0b0c10] border-l border-white/[0.08] shadow-[-20px_0_40px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden text-zinc-100 font-sans select-none"
          >
            {/* 2.1 Settings Header (Stable) */}
            <SettingsHeader
              revision={revision}
              onClose={handleRequestClose}
              onApplyPreset={handleApplyPreset}
              onResetCategory={handleResetCategory}
              categoryLabel={currentNavItem.label}
            />

            {/* 2.2 Content Area (Left) + Navigation Sidebar (Far Right) */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Settings Content Area (Left, Scrolls independently) */}
              <main className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-[#0b0c10]">
                {activeCategory === 'general' && (
                  <GeneralView
                    getVal={getVal}
                    setVal={setVal}
                    isKeyVisible={isKeyVisible}
                    setIsKeyVisible={setIsKeyVisible}
                    connectionStatus={connectionStatus}
                    pingMs={pingMs}
                    errorMessage={errorMessage}
                    onTestConnection={handleTestConnection}
                  />
                )}

                {activeCategory === 'tweaks' && (
                  <TweaksView getVal={getVal} setVal={setVal} />
                )}

                {activeCategory === 'workspace' && (
                  <WorkspaceView
                    getVal={getVal}
                    setVal={setVal}
                    typerSettings={typerSettings}
                    setTyperSettings={setTyperSettings}
                  />
                )}

                {activeCategory === 'translate' && (
                  <TranslateView getVal={getVal} setVal={setVal} />
                )}

                {activeCategory === 'scanning' && (
                  <ScanningView getVal={getVal} setVal={setVal} />
                )}

                {activeCategory === 'review' && (
                  <ReviewView getVal={getVal} setVal={setVal} />
                )}

                {activeCategory === 'memory' && (
                  <MemoryView getVal={getVal} setVal={setVal} />
                )}

                {activeCategory === 'quality' && (
                  <QualityView
                    getVal={getVal}
                    setVal={setVal}
                    onOpenBenchmark={onOpenBenchmark}
                    onCloseSettings={onClose}
                  />
                )}
              </main>

              {/* Navigation Sidebar (Fixed to Far Right) */}
              <SettingsNavigation
                activeCategory={activeCategory}
                onSelectCategory={setActiveCategory}
              />
            </div>

            {/* 2.3 Settings Footer (Stable) */}
            <SettingsFooter
              hasUnsavedChanges={hasUnsavedChanges()}
              onClose={handleRequestClose}
              onApply={handleApply}
            />
          </motion.div>

          {/* Unsaved Changes Confirmation Dialog */}
          {showDiscardConfirm && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-100">
              <div className="w-full max-w-md bg-[#12131a] border border-white/[0.14] rounded-xl p-5 shadow-2xl space-y-4">
                <div className="space-y-1.5">
                  <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
                    Unsaved Settings Changes
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    You have modified settings that have not yet been applied. If you close now, these changes will be discarded.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowDiscardConfirm(false)}
                    className="px-3.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs font-medium cursor-pointer transition-colors"
                  >
                    Keep Editing
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDiscardConfirm(false);
                      setDraftValues({ ...appliedSnapshotRef.current.values });
                      setTyperSettings(JSON.parse(JSON.stringify(appliedSnapshotRef.current.typers)));
                      onClose();
                    }}
                    className="px-3.5 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-mono text-xs font-semibold cursor-pointer transition-colors shadow-sm"
                  >
                    Discard Changes & Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </AnimatePresence>
  );
};
