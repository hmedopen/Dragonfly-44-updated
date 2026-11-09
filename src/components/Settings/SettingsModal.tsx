import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Eye,
  EyeOff,
  Activity,
  Terminal,
  ShieldCheck,
  Cpu,
  RotateCcw,
  Plus,
  Trash2,
  Type,
  BookOpen,
  Sliders,
  Scan,
  Database,
  Layers,
} from 'lucide-react';
import { settingsService } from '../../services/settings/settingsService';
import { useWorkbenchStore } from '../../store/workbenchStore';
import { ENGINE_PRESETS } from '../../services/settings/presets';
import { SETTINGS_REGISTRY } from '../../services/settings/settingsRegistry';
import { GEMINI_MODEL_PROFILES, type GeminiModelKey } from '../../types/workbench';
import { isTrainingStudioEnabled } from '../../lib/training/env';
import { TrainingStudioScreen } from '../Training/TrainingStudioScreen';
import { Sparkles } from 'lucide-react';
import {
  loadTyperSettings,
  saveTyperSettings,
  DEFAULT_TYPERS,
  type CustomTyperConfig,
  type ExtractedTextDirection,
  type TyperSettings,
  type TyperSymbolPosition,
} from '../../types/typers';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenBenchmark?: () => void;
  projectId?: string | null;
}

type SettingsCategory =
  | 'general'
  | 'translation'
  | 'scanning'
  | 'review'
  | 'memory'
  | 'workspace'
  | 'quality'
  | 'typers'
  | 'training';

const PROMPT_PRESETS = [
  {
    label: '[Murim / Cultivation]',
    snippet:
      'Adopt ancient martial arts terminology. Render internal energy as طاقة داخلية / تشي, martial sects as طوائف, dantian as دانتيان, cultivation realms with solemn classical weight.',
  },
  {
    label: '[Modern Action]',
    snippet:
      'Keep dialogue punchy, realistic, and street-level. Avoid archaic expressions. Translate modern military and slang with contemporary Arabic equivalents fit for fast visual pacing.',
  },
  {
    label: '[Recruitment Test / Hints Mode]',
    snippet:
      'Strict adherence to official scanlation test conventions: do not summarize or omit text. Provide full context notes for puns or cultural references, and flag any ambiguous reading orders.',
  },
];

const getInitialSettingsValues = (projectId: string | null) => {
  const vals: Record<string, any> = {};
  for (const key of Object.keys(SETTINGS_REGISTRY)) {
    vals[key] = settingsService.getEffectiveValue(key, { projectId }).value;
  }
  return vals;
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenBenchmark,
  projectId = null,
}) => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('translation');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [revision, setRevision] = useState(() => settingsService.getRevision());

  // Hardware Telemetry state
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle');
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isKeyVisible, setIsKeyVisible] = useState(false);

  // Staged Draft & Applied Snapshot State for Unsaved Changes Protection (Req #9)
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

  // Sync draft and applied snapshot when modal opens or projectId changes
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

  if (!isOpen) return null;

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
    if (activeCategory === 'typers') {
      if (window.confirm('Reset all typers back to initial 9 manga defaults?')) {
        setTyperSettings((prev) => ({ ...prev, typers: DEFAULT_TYPERS }));
      }
      return;
    }
    if (window.confirm(`Reset all settings in "${activeCategory}" to default?`)) {
      const resetVals: Record<string, any> = {};
      for (const [key, def] of Object.entries(SETTINGS_REGISTRY)) {
        if (def.category === activeCategory) {
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
          settingsService.setSettingValue(key, val, {
            projectId,
            scope: projectId ? 'project' : 'global',
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

    const model = getVal<string>('translation.model');
    const customModel = getVal<string>('translation.custom_model');
    const effectiveModel = model === 'custom' && customModel.trim() ? customModel.trim() : model;
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

  // Typer handlers
  const handleToggleIncludeTyperSymbols = (checked: boolean) => {
    setTyperSettings((prev) => ({ ...prev, includeTyperSymbols: checked }));
  };

  const handleSetSymbolPosition = (position: TyperSymbolPosition) => {
    setTyperSettings((prev) => ({ ...prev, symbolPosition: position }));
  };

  const handleSetTextDirection = (direction: ExtractedTextDirection) => {
    setTyperSettings((prev) => ({ ...prev, textDirection: direction }));
  };

  const handleUpdateTyper = (id: string, patch: Partial<CustomTyperConfig>) => {
    setTyperSettings((prev) => ({
      ...prev,
      typers: prev.typers.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };

  const handleDeleteTyper = (id: string) => {
    setTyperSettings((prev) => ({
      ...prev,
      typers: prev.typers.filter((t) => t.id !== id),
    }));
  };

  const handleAddTyper = () => {
    const newId = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newTyper: CustomTyperConfig = {
      id: newId,
      prefix: '',
      name: 'New Custom Typer',
      instructions: '',
      isDefault: false,
    };
    setTyperSettings((prev) => ({
      ...prev,
      typers: [...prev.typers, newTyper],
    }));
  };

  const categories: { id: SettingsCategory; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'translation', label: 'Translation & Voice', icon: <BookOpen className="w-4 h-4" />, desc: 'System #2: Models, Eloquence, Fidelity, Arabic Humanizer, and Master Directives.' },
    { id: 'scanning', label: 'Scanning & OCR', icon: <Scan className="w-4 h-4" />, desc: 'System #3: Profiles, Reading Direction, SFX filters, OCR thresholds, and Crop Retries.' },
    { id: 'review', label: 'Review & Quality Control', icon: <ShieldCheck className="w-4 h-4" />, desc: 'System #4: QC strictness, ambiguous OCR gate, and auto-correction safety.' },
    { id: 'memory', label: 'Project Memory', icon: <Database className="w-4 h-4" />, desc: 'System #5: Knowledge learning mode, candidate approval, and context budgets.' },
    { id: 'workspace', label: 'Workspace & Presentation', icon: <Layers className="w-4 h-4" />, desc: 'Workspace canvas scale, reading navigation, overlays, and coordinate diagnostics.' },
    { id: 'typers', label: 'Typers & Tags', icon: <Type className="w-4 h-4" />, desc: 'Tag prefixes, Arabic RTL positioning, and AI functional classification rules.' },
    { id: 'quality', label: 'Benchmarks & Release Gates', icon: <Activity className="w-4 h-4" />, desc: 'System #6: Benchmark regression gates, CER ceilings, and quality qualifications.' },
    ...(isTrainingStudioEnabled()
      ? [
          {
            id: 'training' as SettingsCategory,
            label: 'Training Studio',
            icon: <Sparkles className="w-4 h-4 text-amber-400" />,
            desc: 'Development Studio: Multimodal Reference Sets, ground-truth visual annotations, and Gemini prompt training.',
          },
        ]
      : []),
    { id: 'general', label: 'General & API Vault', icon: <Cpu className="w-4 h-4" />, desc: 'Gemini API keys, hardware telemetry latency, and global credentials.' },
  ];

  const currentCat = categories.find((c) => c.id === activeCategory)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-5xl h-[86vh] bg-[#0c0d12] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans">
        {/* 1. Modal Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold tracking-wider uppercase text-zinc-100">
                  FOLIO SCRIPT // SETTINGS & ENGINE CONFIGURATION
                </span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-zinc-800 text-zinc-400 border border-white/[0.06]">
                  rev {revision}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Authoritative configuration layer powering Systems #2 through #6.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded border border-white/[0.06]">
              Ctrl+,
            </span>
            <button
              type="button"
              onClick={handleRequestClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. Preset & Scope Bar */}
        <div className="px-6 py-2.5 bg-[#09090d] border-b border-white/[0.06] flex items-center justify-between shrink-0 gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider font-semibold">
              Engine Preset:
            </span>
            <div className="flex items-center gap-1">
              {Object.entries(ENGINE_PRESETS).map(([id, p]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleApplyPreset(id)}
                  className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[10px] font-mono text-zinc-300 hover:text-white transition-colors cursor-pointer"
                  title={p.description}
                >
                  {p.name.split(' (')[0]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-mono text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showAdvanced}
                onChange={(e) => setShowAdvanced(e.target.checked)}
                className="rounded bg-zinc-900 border-zinc-700 text-amber-500 focus:ring-0"
              />
              <span>Show Advanced Controls</span>
            </label>

            <button
              type="button"
              onClick={handleResetCategory}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[10px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              title="Reset current category to safe defaults"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Category</span>
            </button>
          </div>
        </div>

        {/* 3. Main Split View: Categories on Left, Controls on Right */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Category Navigation Bar */}
          <div className="w-60 bg-[#090a0e] border-r border-white/[0.08] flex flex-col p-3 gap-1 overflow-y-auto custom-scrollbar shrink-0">
            {categories.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`w-full px-3 py-2.5 rounded-xl font-mono text-xs flex items-center gap-2.5 text-left transition-all cursor-pointer ${
                    isActive
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  <div className={`shrink-0 ${isActive ? 'text-amber-400' : 'text-zinc-500'}`}>
                    {cat.icon}
                  </div>
                  <span className="truncate">{cat.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right Controls Panel */}
          <div className={activeCategory === 'training' ? "flex-1 flex flex-col overflow-hidden p-0" : "flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6"}>
            {/* Category Header Banner */}
            <div className="pb-3 border-b border-white/[0.06]">
              <h2 className="text-sm font-mono uppercase font-bold tracking-wider text-zinc-100 flex items-center gap-2">
                {currentCat.icon}
                <span>{currentCat.label}</span>
              </h2>
              <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                {currentCat.desc}
              </p>
            </div>

            {/* CATEGORY 1: TRANSLATION & HUMANIZER (SYSTEM #2) */}
            {activeCategory === 'translation' && (
              <div className="space-y-4">
                {/* Vision Model Selector */}
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-mono uppercase font-semibold text-zinc-300">
                      Gemini Multimodal Model
                    </label>
                    <span className="text-[10px] font-mono text-zinc-500">
                      Applies on next operation
                    </span>
                  </div>
                  <select
                    value={getVal<string>('translation.model')}
                    onChange={(e) => setVal('translation.model', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#050508] border border-white/[0.12] text-zinc-200 text-xs font-mono focus:outline-none focus:border-amber-500/50"
                  >
                    {Object.keys(GEMINI_MODEL_PROFILES).map((key) => {
                      const profile = GEMINI_MODEL_PROFILES[key as GeminiModelKey];
                      return (
                        <option key={key} value={key}>
                          {profile.name} — {profile.description}
                        </option>
                      );
                    })}
                  </select>

                  {getVal<string>('translation.model') === 'custom' && (
                    <input
                      type="text"
                      placeholder="Enter custom endpoint (e.g. gemini-3.8-pro-preview)..."
                      value={getVal<string>('translation.custom_model')}
                      onChange={(e) => setVal('translation.custom_model', e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#050508] border border-white/[0.10] text-zinc-200 text-xs font-mono mt-2"
                    />
                  )}
                </div>

                {/* Arabic Eloquence Level */}
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-mono uppercase font-semibold text-zinc-300">
                      Arabic Eloquence Standard
                    </label>
                    <span className="text-xs font-mono text-amber-400 font-bold">
                      {getVal<number>('translation.eloquence') === 1 ? 'Casual Modern' : getVal<number>('translation.eloquence') === 2 ? 'Standard Literary' : 'High Classical'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { level: 1, label: 'Casual Modern', sub: 'فصحى مبسطة وعفوية' },
                      { level: 2, label: 'Standard Literary', sub: 'فصحى معيارية أدبية' },
                      { level: 3, label: 'High Classical', sub: 'فصحى جزلة وبليغة' },
                    ].map((item) => {
                      const active = getVal<number>('translation.eloquence') === item.level;
                      return (
                        <button
                          key={item.level}
                          type="button"
                          onClick={() => setVal('translation.eloquence', item.level)}
                          className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                            active
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                              : 'bg-zinc-900/60 border-white/[0.06] text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          <div className="text-xs font-mono">{item.label}</div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">{item.sub}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Translation Fidelity */}
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-2">
                  <label className="text-xs font-mono uppercase font-semibold text-zinc-300">
                    Translation Fidelity Mode
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'faithful', name: 'Faithful', desc: 'Close semantic alignment' },
                      { id: 'localized', name: 'Localized', desc: 'Natural scanlation idioms' },
                      { id: 'expressive', name: 'Expressive', desc: 'Heightened emotional punch' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setVal('translation.fidelity', f.id)}
                        className={`p-2 rounded-lg border text-left font-mono text-xs cursor-pointer ${
                          getVal<string>('translation.fidelity') === f.id
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                            : 'bg-zinc-900/60 border-white/[0.06] text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <div>{f.name}</div>
                        <div className="text-[10px] text-zinc-500">{f.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Arabic Humanizer Engine */}
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-mono uppercase font-semibold text-zinc-300">
                        Arabic Humanizer Engine
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        Strips synthetic AI templates and restores scanlator cadence.
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={getVal<boolean>('translation.humanizer_enabled')}
                        onChange={(e) => setVal('translation.humanizer_enabled', e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600 peer-checked:after:bg-white" />
                    </label>
                  </div>

                  {getVal<boolean>('translation.humanizer_enabled') && (
                    <div className="pt-2 border-t border-white/[0.06] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase text-zinc-400">
                          Intensity Profile
                        </span>
                        <span className="text-xs font-mono text-amber-400 font-bold uppercase">
                          {getVal<string>('translation.humanizer_intensity')}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {['light', 'balanced', 'strong', 'maximum'].map((int) => (
                          <button
                            key={int}
                            type="button"
                            onClick={() => setVal('translation.humanizer_intensity', int)}
                            className={`py-1.5 px-2 rounded font-mono text-xs capitalize cursor-pointer text-center ${
                              getVal<string>('translation.humanizer_intensity') === int
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                                : 'bg-zinc-900 border border-white/[0.06] text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {int}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Master Prompt Override Terminal */}
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Terminal className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-mono uppercase font-semibold text-zinc-300">
                        Master Prompt Directive (Unconditional Priority)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVal('translation.master_prompt_active', !getVal<boolean>('translation.master_prompt_active'))}
                      className={`px-2.5 py-0.5 rounded font-mono text-[10px] font-bold border transition-all cursor-pointer ${
                        getVal<boolean>('translation.master_prompt_active')
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                      }`}
                    >
                      {getVal<boolean>('translation.master_prompt_active') ? '● ARMED' : '○ DISARMED'}
                    </button>
                  </div>

                  <textarea
                    rows={4}
                    value={getVal<string>('translation.master_prompt_override')}
                    onChange={(e) => setVal('translation.master_prompt_override', e.target.value)}
                    placeholder="Enter highest-priority directive injected into model prompt..."
                    className="w-full p-2.5 rounded-lg bg-[#050508] border border-white/[0.10] text-zinc-200 font-mono text-xs focus:outline-none focus:border-amber-500/50 resize-y"
                  />

                  <div className="flex flex-wrap items-center gap-1.5">
                    {PROMPT_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          const curr = getVal<string>('translation.master_prompt_override');
                          setVal('translation.master_prompt_override', curr ? `${curr}\n\n${p.snippet}` : p.snippet);
                        }}
                        className="px-2 py-1 rounded bg-zinc-900 border border-white/[0.06] text-[10px] font-mono text-zinc-400 hover:text-zinc-200"
                      >
                        {p.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setVal('translation.master_prompt_override', '')}
                      className="ml-auto px-2 py-1 rounded bg-red-950/40 border border-red-800/40 text-[10px] font-mono text-red-400 hover:bg-red-900/60"
                    >
                      [CLEAR]
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* CATEGORY 2: SCANNING & OCR (SYSTEM #3) */}
            {activeCategory === 'scanning' && (
              <div className="space-y-4">
                {/* Profile */}
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-2">
                  <label className="text-xs font-mono uppercase font-semibold text-zinc-300">
                    Scanning Speed & Accuracy Profile
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'fast', name: 'Fast (Single Pass)', desc: 'High throughput, skips crop retries' },
                      { id: 'balanced', name: 'Balanced', desc: 'Standard scan + targeted crop verification' },
                      { id: 'high_accuracy', name: 'High Accuracy', desc: 'Exhaustive verification on all small text' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setVal('scanning.profile', p.id)}
                        className={`p-2.5 rounded-lg border text-left font-mono text-xs cursor-pointer ${
                          getVal<string>('scanning.profile') === p.id
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                            : 'bg-zinc-900/60 border-white/[0.06] text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <div>{p.name}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reading Convention */}
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-2">
                  <label className="text-xs font-mono uppercase font-semibold text-zinc-300">
                    Reading Order Convention
                  </label>
                  <select
                    value={getVal<string>('scanning.reading_convention')}
                    onChange={(e) => setVal('scanning.reading_convention', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#050508] border border-white/[0.12] text-zinc-200 text-xs font-mono focus:outline-none"
                  >
                    <option value="auto">Auto-detect from page layout</option>
                    <option value="manga_rtl">Manga Right-to-Left (RTL)</option>
                    <option value="webtoon_v">Webtoon Vertical Scroll</option>
                    <option value="ltr">Western Left-to-Right (LTR)</option>
                  </select>
                </div>

                {/* SFX Extraction */}
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-mono uppercase font-semibold text-zinc-300">
                      Extract In-Art Sound Effects (SFX)
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Include sound elements and vocalizations in the dialogue stream.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={getVal<boolean>('scanning.include_sfx')}
                    onChange={(e) => setVal('scanning.include_sfx', e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500"
                  />
                </div>

                {/* Advanced OCR tuning */}
                {showAdvanced && (
                  <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-3">
                    <span className="text-xs font-mono uppercase text-amber-400 font-semibold block">
                      Advanced Scanning & OCR Tuning
                    </span>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-mono text-zinc-400">
                        <span>OCR Confidence Threshold</span>
                        <span className="text-amber-400">{getVal<number>('scanning.ocr_confidence_threshold')}</span>
                      </div>
                      <input
                        type="range"
                        min={0.2}
                        max={0.95}
                        step={0.05}
                        value={getVal<number>('scanning.ocr_confidence_threshold')}
                        onChange={(e) => setVal('scanning.ocr_confidence_threshold', Number(e.target.value))}
                        className="w-full accent-amber-500"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                      <span className="text-xs font-mono text-zinc-400">Targeted High-Res Crop Retries</span>
                      <input
                        type="checkbox"
                        checked={getVal<boolean>('scanning.enable_crop_retries')}
                        onChange={(e) => setVal('scanning.enable_crop_retries', e.target.checked)}
                        className="w-4 h-4 rounded text-amber-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* CATEGORY 3: REVIEW & QC (SYSTEM #4) */}
            {activeCategory === 'review' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-2">
                  <label className="text-xs font-mono uppercase font-semibold text-zinc-300">
                    Review Strictness Profile
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'conservative', name: 'Conservative', desc: 'Critical blockers only' },
                      { id: 'balanced', name: 'Balanced', desc: 'Standard scanlation QC audit' },
                      { id: 'thorough', name: 'Thorough', desc: 'Deep grammatical & stylistic audit' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setVal('review.profile', p.id)}
                        className={`p-2.5 rounded-lg border text-left font-mono text-xs cursor-pointer ${
                          getVal<string>('review.profile') === p.id
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                            : 'bg-zinc-900/60 border-white/[0.06] text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <div>{p.name}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-mono uppercase font-semibold text-zinc-300">
                      Source Reliability Gate (Abstain on Ambiguous OCR)
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Strictly abstains from speculative error flags when source artwork OCR is low-confidence.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={getVal<boolean>('review.ambiguous_ocr_abstention')}
                    onChange={(e) => setVal('review.ambiguous_ocr_abstention', e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500"
                  />
                </div>

                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-mono uppercase font-semibold text-zinc-300">
                      Permit Automated Correction Batching
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Allows verified mechanical corrections (e.g. whitespace, punctuation) without 1-by-1 clicks.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={getVal<boolean>('review.auto_correction_eligibility')}
                    onChange={(e) => setVal('review.auto_correction_eligibility', e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500"
                  />
                </div>
              </div>
            )}

            {/* CATEGORY 4: PROJECT MEMORY (SYSTEM #5) */}
            {activeCategory === 'memory' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-2">
                  <label className="text-xs font-mono uppercase font-semibold text-zinc-300">
                    Knowledge Learning Mode
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'candidate_only', name: 'Candidate Only', desc: 'Operator must explicitly approve all lore' },
                      { id: 'autonomous_observed', name: 'Autonomous', desc: 'Auto-accepts high-confidence lore' },
                      { id: 'disabled', name: 'Disabled', desc: 'No lore extraction or memory intake' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setVal('memory.learning_mode', m.id)}
                        className={`p-2.5 rounded-lg border text-left font-mono text-xs cursor-pointer ${
                          getVal<string>('memory.learning_mode') === m.id
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                            : 'bg-zinc-900/60 border-white/[0.06] text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <div>{m.name}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-mono uppercase font-semibold text-zinc-300">
                      Cross-Chapter Knowledge Propagation
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Propagate approved characters, glossary terms, and relationships across all chapters.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={getVal<boolean>('memory.cross_chapter_learning')}
                    onChange={(e) => setVal('memory.cross_chapter_learning', e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500"
                  />
                </div>

                {showAdvanced && (
                  <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-3">
                    <span className="text-xs font-mono uppercase text-amber-400 font-semibold block">
                      Memory Budget & Merge Policy
                    </span>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-mono text-zinc-400">
                        <span>Context Token Budget Cap</span>
                        <span className="text-amber-400">{getVal<number>('memory.context_budget_tokens')} tokens</span>
                      </div>
                      <input
                        type="range"
                        min={500}
                        max={6000}
                        step={250}
                        value={getVal<number>('memory.context_budget_tokens')}
                        onChange={(e) => setVal('memory.context_budget_tokens', Number(e.target.value))}
                        className="w-full accent-amber-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* CATEGORY 5: WORKSPACE & PRESENTATION */}
            {activeCategory === 'workspace' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-3">
                  <span className="text-xs font-mono uppercase font-semibold text-zinc-300 block">
                    Overlay Visibility Layers
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-white/[0.06] text-xs font-mono cursor-pointer">
                      <span>Dialogue Bounding Boxes</span>
                      <input
                        type="checkbox"
                        checked={getVal<boolean>('workspace.overlay_boxes_visible')}
                        onChange={(e) => setVal('workspace.overlay_boxes_visible', e.target.checked)}
                        className="rounded text-amber-500"
                      />
                    </label>
                    <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-white/[0.06] text-xs font-mono cursor-pointer">
                      <span>Review Flag Markers</span>
                      <input
                        type="checkbox"
                        checked={getVal<boolean>('workspace.overlay_review_markers_visible')}
                        onChange={(e) => setVal('workspace.overlay_review_markers_visible', e.target.checked)}
                        className="rounded text-amber-500"
                      />
                    </label>
                    <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-white/[0.06] text-xs font-mono cursor-pointer">
                      <span>Reading Order Flow Arrows</span>
                      <input
                        type="checkbox"
                        checked={getVal<boolean>('workspace.overlay_reading_order_visible')}
                        onChange={(e) => setVal('workspace.overlay_reading_order_visible', e.target.checked)}
                        className="rounded text-amber-500"
                      />
                    </label>
                    <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-white/[0.06] text-xs font-mono cursor-pointer">
                      <span>Panel Boundaries</span>
                      <input
                        type="checkbox"
                        checked={getVal<boolean>('workspace.overlay_panels_visible')}
                        onChange={(e) => setVal('workspace.overlay_panels_visible', e.target.checked)}
                        className="rounded text-amber-500"
                      />
                    </label>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-mono uppercase font-semibold text-zinc-300">
                      Coordinate Diagnostics HUD
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Section 10.3: Displays real-time transform matrices, screen/source round-trip coordinates, and frame timings.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={getVal<boolean>('workspace.coordinate_diagnostics')}
                    onChange={(e) => setVal('workspace.coordinate_diagnostics', e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500"
                  />
                </div>

                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-mono uppercase font-semibold text-zinc-300">
                      Double-Click Confirmation for Critical Actions
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Requires a deliberate double-click to confirm actions like Save Order or page deletions.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={getVal<boolean>('workspace.double_click_confirmation') ?? true}
                    onChange={(e) => setVal('workspace.double_click_confirmation', e.target.checked)}
                    className="w-4 h-4 rounded text-sky-500 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* CATEGORY 6: TYPERS & PREFIXES */}
            {activeCategory === 'typers' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase font-semibold text-zinc-300">
                      Include Typer Symbols in Exports
                    </span>
                    <input
                      type="checkbox"
                      checked={typerSettings.includeTyperSymbols}
                      onChange={(e) => handleToggleIncludeTyperSymbols(e.target.checked)}
                      className="w-4 h-4 rounded text-amber-500"
                    />
                  </div>
                  <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-mono text-zinc-400">Typer Symbol Position</span>
                      <div className="flex items-center gap-1 bg-zinc-900 border border-white/[0.08] rounded p-0.5 text-xs font-mono">
                        {(['start', 'end'] as const).map((position) => (
                          <button
                            key={position}
                            type="button"
                            onClick={() => handleSetSymbolPosition(position)}
                            className={`px-2.5 py-0.5 rounded cursor-pointer ${
                              typerSettings.symbolPosition === position ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-zinc-400'
                            }`}
                          >
                            {position === 'start' ? 'Start' : 'End'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-mono text-zinc-400">Extracted Text Direction</span>
                      <div className="flex items-center gap-1 bg-zinc-900 border border-white/[0.08] rounded p-0.5 text-xs font-mono">
                        {(['rtl', 'ltr'] as const).map((direction) => (
                          <button
                            key={direction}
                            type="button"
                            onClick={() => handleSetTextDirection(direction)}
                            className={`px-2.5 py-0.5 rounded cursor-pointer ${
                              typerSettings.textDirection === direction ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-zinc-400'
                            }`}
                          >
                            {direction === 'rtl' ? 'Right to Left (RTL)' : 'Left to Right (LTR)'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Typers list */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase text-zinc-400 font-semibold">
                      Configured Typers ({typerSettings.typers.length})
                    </span>
                    <button
                      type="button"
                      onClick={handleAddTyper}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 text-xs font-mono cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Typer</span>
                    </button>
                  </div>

                  {typerSettings.typers.map((t) => (
                    <div key={t.id} className="p-3 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={t.prefix}
                          placeholder='Tag e.g. "":'
                          onChange={(e) => handleUpdateTyper(t.id, { prefix: e.target.value })}
                          className="w-20 px-2 py-1 rounded bg-[#050508] border border-white/[0.10] text-zinc-200 font-mono text-xs"
                        />
                        <input
                          type="text"
                          value={t.name}
                          placeholder="Typer Name"
                          onChange={(e) => handleUpdateTyper(t.id, { name: e.target.value })}
                          className="flex-1 px-2.5 py-1 rounded bg-[#050508] border border-white/[0.10] text-zinc-200 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => handleDeleteTyper(t.id)}
                          className="p-1 rounded text-zinc-500 hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <textarea
                        rows={1}
                        value={t.instructions}
                        placeholder="AI functional classification rules (leave empty for manual only)..."
                        onChange={(e) => handleUpdateTyper(t.id, { instructions: e.target.value })}
                        className="w-full p-2 rounded bg-[#050508] border border-white/[0.08] text-zinc-300 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CATEGORY 7: QUALITY BENCHMARKS & GATES */}
            {activeCategory === 'quality' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#0a0b10] border border-amber-500/30 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-mono font-bold text-amber-300 uppercase block">
                      Quality Benchmark Framework
                    </span>
                    <p className="text-xs text-zinc-400 mt-1">
                      Execute automated qualification runs, verify non-overridable hard gates, and inspect regressions.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenBenchmark?.();
                    }}
                    className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-mono text-xs font-bold transition-all cursor-pointer shadow-md"
                  >
                    Open Benchmark Screen
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-mono uppercase font-semibold text-zinc-300">
                      Enforce Hard Release Gates
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Blocks release approval if any critical safety or integrity invariant fails.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={getVal<boolean>('quality.regression_gate_enabled')}
                    onChange={(e) => setVal('quality.regression_gate_enabled', e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500"
                  />
                </div>
              </div>
            )}

            {/* CATEGORY: TRAINING STUDIO (DEV ONLY) */}
            {activeCategory === 'training' && isTrainingStudioEnabled() && (
              <TrainingStudioScreen />
            )}

            {/* CATEGORY 8: GENERAL & API VAULT */}
            {activeCategory === 'general' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-mono uppercase font-semibold text-zinc-300 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Gemini API Key Vault</span>
                    </label>
                  </div>
                  <div className="relative flex items-center">
                    <input
                      type={isKeyVisible ? 'text' : 'password'}
                      value={getVal<string>('general.gemini_api_key')}
                      onChange={(e) => setVal('general.gemini_api_key', e.target.value)}
                      placeholder="Enter Gemini API key (AIzaSy...)"
                      className="w-full pl-3 pr-10 py-2 rounded-lg bg-[#050508] border border-white/[0.12] text-zinc-100 font-mono text-xs focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setIsKeyVisible((prev) => !prev)}
                      className="absolute right-2.5 p-1 text-zinc-400 hover:text-zinc-200"
                    >
                      {isKeyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Diagnostics Telemetry */}
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase font-semibold text-zinc-300 flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-sky-400" />
                      <span>Hardware Handshake & Latency Telemetry</span>
                    </span>
                    {connectionStatus !== 'idle' && (
                      <span className={`text-xs font-mono font-bold ${connectionStatus === 'connected' ? 'text-emerald-400' : connectionStatus === 'testing' ? 'text-amber-400' : 'text-rose-400'}`}>
                        {connectionStatus === 'connected' ? `● CONNECTED (${pingMs}ms)` : connectionStatus === 'testing' ? '● TESTING...' : `● FAILED: ${errorMessage || 'Error'}`}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={connectionStatus === 'testing'}
                    className="w-full py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-mono font-bold transition-all cursor-pointer"
                  >
                    [ TEST CONNECTION ]
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 4. Modal Footer: Separate Apply and Close buttons (Req #9) */}
        <div className="h-12 px-6 border-t border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-mono text-zinc-500">
              FOLIO SCRIPT // SYSTEM #6 ACTIVE
            </span>
            {hasUnsavedChanges() && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span>UNSAVED CHANGES</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-5">
            {/* Separate Close control: placed directly on existing background without button container, white text by default, turns red on hover */}
            <button
              type="button"
              onClick={handleRequestClose}
              className="text-zinc-200 hover:text-red-400 font-mono text-xs font-semibold cursor-pointer transition-colors bg-transparent border-none p-0 outline-none select-none"
            >
              Close
            </button>
            {/* Apply button: retains existing white button styling, saves and applies all pending changes, keeps window open */}
            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-mono text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95 select-none"
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* Unsaved Changes Confirmation Dialog (Req #9) */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-100">
          <div className="w-full max-w-md bg-[#12131a] border border-white/[0.16] rounded-xl p-5 shadow-2xl space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
                Unapplied Changes
              </h3>
              <p className="text-xs text-zinc-400">
                You have unsaved changes that have not been applied. If you close now, these changes will be lost.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs font-semibold cursor-pointer transition-colors"
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
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-mono text-xs font-bold cursor-pointer transition-colors shadow-sm"
              >
                Discard Changes & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
