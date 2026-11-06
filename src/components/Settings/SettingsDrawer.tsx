import React, { useState, useEffect } from 'react';
import { 
  X, 
  Eye, 
  EyeOff, 
  Activity, 
  Terminal, 
  ShieldCheck, 
  ChevronDown, 
  Check, 
  Cpu, 
  RotateCcw,
  Plus,
  Trash2,
  Type
} from 'lucide-react';
import type { GeminiModelKey, EloquenceLevel } from '../../types/workbench';
import { GEMINI_MODEL_PROFILES } from '../../types/workbench';
import type { CustomTyperConfig, PrefixPosition, TyperSettings } from '../../types/typers';
import { loadTyperSettings, saveTyperSettings, DEFAULT_TYPERS } from '../../types/typers';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const PROMPT_PRESETS = [
  {
    label: '[Murim / Cultivation]',
    snippet:
      'Adopt ancient martial arts terminology. Render qi/internal energy as تشي / طاقة داخلية, martial sects as طوائف, dantian as دانتيان, cultivation realms with solemn classical weight. Surnames and clan titles must remain strictly consistent across speakers.',
  },
  {
    label: '[Modern Action]',
    snippet:
      'Keep dialogue punchy, realistic, and street-level. Avoid archaic expressions. Translate modern military, police, and slang with contemporary Arabic equivalents fit for fast visual pacing.',
  },
  {
    label: '[Recruitment Test / Hints Mode]',
    snippet:
      'Strict adherence to official scanlation test conventions: do not summarize or omit text. Provide full context notes for puns or cultural references, and flag any ambiguous reading orders or gender pronouns.',
  },
];

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ isOpen, onClose }) => {
  // 1. API Key Vault (Strictly from client localStorage, zero hardcoding)
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem('dragonfly44_gemini_api_key') || '';
  });
  const [isKeyVisible, setIsKeyVisible] = useState(false);

  // 2. Telemetry & Connection State
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'testing' | 'connected' | 'failed'
  >('idle');
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 3. Model Selector
  const [selectedModel, setSelectedModel] = useState<GeminiModelKey>(() => {
    return (localStorage.getItem('dragonfly44_selected_model') as GeminiModelKey) || 'gemini-3.1-flash-lite';
  });
  const [customModel, setCustomModel] = useState(() => {
    return localStorage.getItem('dragonfly44_custom_model') || '';
  });
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

  // 4. Eloquence & SFX
  const [eloquenceLevel, setEloquenceLevel] = useState<EloquenceLevel>(() => {
    const saved = localStorage.getItem('dragonfly44_eloquence_level');
    return saved ? (Number(saved) as EloquenceLevel) : 2;
  });
  const [includeSFX, setIncludeSFX] = useState<boolean>(() => {
    return localStorage.getItem('dragonfly44_include_sfx') === 'true';
  });

  // 5. Master Prompt Override Terminal
  const [masterPromptOverride, setMasterPromptOverride] = useState(() => {
    return localStorage.getItem('dragonfly44_master_prompt_override') || '';
  });
  const [isMasterPromptActive, setIsMasterPromptActive] = useState<boolean>(() => {
    return localStorage.getItem('dragonfly44_master_prompt_active') !== 'false';
  });

  // 6. Custom Typers & Prefix Settings
  const [typerSettings, setTyperSettings] = useState<TyperSettings>(() => loadTyperSettings());

  // Save settings on change
  useEffect(() => {
    localStorage.setItem('dragonfly44_gemini_api_key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem('dragonfly44_selected_model', selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem('dragonfly44_custom_model', customModel);
  }, [customModel]);

  useEffect(() => {
    localStorage.setItem('dragonfly44_eloquence_level', String(eloquenceLevel));
  }, [eloquenceLevel]);

  useEffect(() => {
    localStorage.setItem('dragonfly44_include_sfx', String(includeSFX));
  }, [includeSFX]);

  useEffect(() => {
    localStorage.setItem('dragonfly44_master_prompt_override', masterPromptOverride);
  }, [masterPromptOverride]);

  useEffect(() => {
    localStorage.setItem('dragonfly44_master_prompt_active', String(isMasterPromptActive));
  }, [isMasterPromptActive]);

  useEffect(() => {
    saveTyperSettings(typerSettings);
  }, [typerSettings]);

  // Typer handlers
  const handleToggleIncludeTyperSymbols = (checked: boolean) => {
    setTyperSettings((prev) => ({
      ...prev,
      includeTyperSymbols: checked,
    }));
  };

  const handleSetPrefixPosition = (position: PrefixPosition) => {
    setTyperSettings((prev) => ({
      ...prev,
      prefixPosition: position,
    }));
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
      instructions: '', // Important: must start with empty instructions field
      isDefault: false,
    };
    setTyperSettings((prev) => ({
      ...prev,
      typers: [...prev.typers, newTyper],
    }));
  };

  const handleResetDefaultTypers = () => {
    if (window.confirm('Reset all typers back to initial 9 manga defaults? Any custom added typers will be removed.')) {
      setTyperSettings((prev) => ({
        ...prev,
        typers: DEFAULT_TYPERS,
      }));
    }
  };

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Genuine handshake request to measure latency
  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setConnectionStatus('failed');
      setErrorMessage('API key is empty');
      return;
    }

    setConnectionStatus('testing');
    setErrorMessage(null);

    const effectiveModel = selectedModel === 'custom' && customModel.trim() ? customModel.trim() : selectedModel;
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

  const handleAddPreset = (snippet: string) => {
    setMasterPromptOverride((prev) => (prev ? `${prev}\n\n${snippet}` : snippet));
  };

  if (!isOpen) return null;

  const currentProfile = GEMINI_MODEL_PROFILES[selectedModel] || GEMINI_MODEL_PROFILES['gemini-3.1-flash-lite'];
  const isOverrideArmed = isMasterPromptActive && masterPromptOverride.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-200">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity" 
        onClick={onClose} 
      />

      {/* Drawer Surface */}
      <div className="relative w-full max-w-[480px] h-full bg-[#0d0d11] border-l border-[#27272a] shadow-2xl flex flex-col z-10 select-none animate-in slide-in-from-right duration-200">
        {/* 1. Header */}
        <div className="h-12 min-h-[48px] px-5 border-b border-[#27272a] bg-[#09090b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-amber-400" />
            <span className="font-mono text-xs font-semibold tracking-wider text-zinc-100 uppercase">
              HARDWARE SETTINGS // HUD
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded border border-white/[0.06]">
              Ctrl+,
            </span>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. Scrollable Settings Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 flex flex-col gap-5 text-zinc-200">
          {/* Section 1: Gemini API Key Vault */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Gemini API Key Vault</span>
              </label>
            </div>
            <div className="relative flex items-center">
              <input
                type={isKeyVisible ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter Gemini API key (AIzaSy...)"
                className="w-full pl-3 pr-10 py-2 rounded-lg bg-[#070709] border border-white/[0.10] text-zinc-100 placeholder-zinc-600 font-mono text-xs focus:outline-none focus:border-white/[0.25] transition-colors"
              />
              <button
                type="button"
                onClick={() => setIsKeyVisible((prev) => !prev)}
                className="absolute right-2.5 p-1 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                title={isKeyVisible ? 'Hide Key' : 'Reveal Key'}
              >
                {isKeyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Section 2: Diagnostic Telemetry HUD */}
          <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-[#09090c] border border-white/[0.08]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-400" />
                <span>Diagnostic Telemetry HUD</span>
              </span>
              {connectionStatus !== 'idle' && (
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      connectionStatus === 'connected'
                        ? 'bg-emerald-500 animate-pulse'
                        : connectionStatus === 'testing'
                        ? 'bg-amber-500 animate-ping'
                        : 'bg-red-500'
                    }`}
                  />
                  <span
                    className={
                      connectionStatus === 'connected'
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }
                  >
                    {connectionStatus === 'connected'
                      ? `● CONNECTED (${pingMs}ms)`
                      : connectionStatus === 'testing'
                      ? '● TESTING HANDSHAKE...'
                      : `● FAILED: ${errorMessage || 'Invalid Key'}`}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-1">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={connectionStatus === 'testing'}
                className="w-full py-1.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-white/[0.10] font-mono text-xs font-medium transition-all cursor-pointer active:scale-95 disabled:opacity-50 text-center"
              >
                [ TEST CONNECTION ]
              </button>
            </div>
          </div>

          {/* Section 3: Complete Gemini 3+ Model Selector */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                Gemini 3+ Vision Model
              </label>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setIsModelDropdownOpen((prev) => !prev)}
                className="w-full px-3 py-2 rounded-lg bg-[#070709] border border-white/[0.10] hover:border-white/[0.20] text-zinc-100 font-mono text-xs flex items-center justify-between transition-colors cursor-pointer"
              >
                <div className="flex flex-col text-left">
                  <span className="text-amber-300 font-medium">
                    {selectedModel === 'custom' ? (customModel || 'Custom Model') : currentProfile.name}
                  </span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0 ml-2" />
              </button>

              {isModelDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 rounded-lg bg-[#14141a] border border-white/[0.14] shadow-2xl z-50 py-1 overflow-hidden max-h-60 overflow-y-auto custom-scrollbar">
                  {(Object.keys(GEMINI_MODEL_PROFILES) as GeminiModelKey[]).map((key) => {
                    const profile = GEMINI_MODEL_PROFILES[key];
                    const isCurrent = selectedModel === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSelectedModel(key);
                          setIsModelDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left font-mono text-xs flex items-center justify-between transition-colors cursor-pointer ${
                          isCurrent
                            ? 'bg-amber-500/15 text-amber-300 font-semibold'
                            : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                        }`}
                      >
                        <div className="flex flex-col">
                          <span>{profile.name}</span>
                          <span className="text-[10px] text-zinc-500">{profile.description}</span>
                        </div>
                        {isCurrent && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Custom Model String Fallback */}
            {selectedModel === 'custom' && (
              <div className="mt-1 flex flex-col gap-1">
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="Enter custom preview endpoint (e.g. gemini-3.8-pro-preview)..."
                  className="w-full px-3 py-1.5 rounded-lg bg-[#070709] border border-white/[0.10] text-zinc-100 font-mono text-xs focus:outline-none focus:border-white/[0.25]"
                />
              </div>
            )}
          </div>

          {/* Section 4: 3-Level Arabic Eloquence Slider */}
          <div className="flex flex-col gap-2.5 p-3.5 rounded-xl bg-[#09090c] border border-white/[0.08]">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                Arabic Eloquence
              </label>
            </div>

            <div className="relative pt-2 pb-1 px-2">
              <input
                type="range"
                min={1}
                max={3}
                step={1}
                value={eloquenceLevel}
                onChange={(e) => setEloquenceLevel(Number(e.target.value) as EloquenceLevel)}
                className="w-full accent-amber-500 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between mt-2 font-mono text-[10px] text-zinc-500">
                <span
                  onClick={() => setEloquenceLevel(1)}
                  className={`cursor-pointer ${eloquenceLevel === 1 ? 'text-amber-400 font-semibold' : 'hover:text-zinc-300'}`}
                >
                  ● Level 1: Casual
                </span>
                <span
                  onClick={() => setEloquenceLevel(2)}
                  className={`cursor-pointer ${eloquenceLevel === 2 ? 'text-amber-400 font-semibold' : 'hover:text-zinc-300'}`}
                >
                  ● Level 2: Literary
                </span>
                <span
                  onClick={() => setEloquenceLevel(3)}
                  className={`cursor-pointer ${eloquenceLevel === 3 ? 'text-amber-400 font-semibold' : 'hover:text-zinc-300'}`}
                >
                  ● Level 3: Classical
                </span>
              </div>
            </div>
          </div>

          {/* Section 5: SFX vs. In-Art Vocalization Filter */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#09090c] border border-white/[0.08]">
            <div className="flex flex-col gap-0.5 max-w-[340px]">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-300 font-semibold">
                SFX Scan & Translation Filter
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={includeSFX}
                onChange={(e) => setIncludeSFX(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600 peer-checked:after:bg-white" />
            </label>
          </div>

          {/* Section 6: Master Prompt Override Terminal */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-amber-400" />
                <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                  Master Prompt Terminal
                </label>
              </div>

              {/* [ ARMED ] Status Badge */}
              {isOverrideArmed && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsMasterPromptActive((prev) => !prev)}
                    className="px-2 py-0.5 rounded font-mono text-[10px] font-bold border transition-colors cursor-pointer bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse"
                  >
                    ● OVERRIDE ARMED
                  </button>
                </div>
              )}
            </div>

            {/* Sunken Monospace Textarea */}
            <textarea
              rows={5}
              value={masterPromptOverride}
              onChange={(e) => setMasterPromptOverride(e.target.value)}
              className="w-full p-3 rounded-lg bg-[#050508] border border-white/[0.10] text-zinc-200 font-mono text-xs leading-relaxed focus:outline-none focus:border-amber-500/50 resize-y custom-scrollbar"
              placeholder="Enter master directive taking unconditional priority over all baseline rules..."
            />

            {/* Quick-Insert Preset Chips & Clear */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleAddPreset(preset.snippet)}
                  className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-white/[0.06] text-[10px] font-mono transition-colors cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMasterPromptOverride('')}
                className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-800/40 text-[10px] font-mono transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>[CLEAR]</span>
              </button>
            </div>
          </div>

          {/* Section 7: Typers / Prefixes Configuration */}
          <div className="flex flex-col gap-4 pt-4 border-t border-white/[0.08]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Type className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-mono uppercase tracking-wider text-zinc-200 font-semibold">
                  Typers / Prefixes Configuration
                </span>
              </div>
              <button
                type="button"
                onClick={handleResetDefaultTypers}
                className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-white/[0.08] text-[10px] font-mono transition-colors cursor-pointer"
                title="Restore initial 9 default typers"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Defaults</span>
              </button>
            </div>

            {/* 1. General Settings */}
            <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[#09090c] border border-white/[0.08]">
              {/* Include typer symbols Switch */}
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-300 font-semibold">
                    Include Typer Symbols
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    Include typer tags and prefix symbols in compiled TypeR scripts and exports
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={typerSettings.includeTyperSymbols}
                    onChange={(e) => handleToggleIncludeTyperSymbols(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-600 peer-checked:after:bg-white" />
                </label>
              </div>

              {/* Prefix position Selector */}
              <div className="flex items-center justify-between pt-2.5 border-t border-white/[0.04]">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-300 font-semibold">
                    Prefix Position
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    Right position matches natural Arabic RTL workflow; Left position places tag at start
                  </span>
                </div>
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-zinc-900 border border-white/[0.08] text-[11px] font-mono">
                  <button
                    type="button"
                    onClick={() => handleSetPrefixPosition('right')}
                    className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                      typerSettings.prefixPosition === 'right'
                        ? 'bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/30'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Right (Arabic)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetPrefixPosition('left')}
                    className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                      typerSettings.prefixPosition === 'left'
                        ? 'bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/30'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Left
                  </button>
                </div>
              </div>
            </div>

            {/* 2. Typers List */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                  Configured Typers ({typerSettings.typers.length})
                </span>
                <button
                  type="button"
                  onClick={handleAddTyper}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-[11px] font-mono transition-colors cursor-pointer shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Typer</span>
                </button>
              </div>

              {typerSettings.typers.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#09090c] border border-dashed border-white/[0.10] text-center text-xs text-zinc-500 font-mono">
                  No typers configured. All detected dialogue will remain untyped.
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {typerSettings.typers.map((typer) => {
                    const hasInstructions = typer.instructions && typer.instructions.trim().length > 0;
                    return (
                      <div
                        key={typer.id}
                        className="flex flex-col gap-2 p-3 rounded-xl bg-[#09090c] border border-white/[0.08] hover:border-white/[0.14] transition-colors"
                      >
                        {/* Row 1: Prefix input, Name input, AI status badge, and Delete button */}
                        <div className="flex items-center gap-2">
                          {/* Prefix input */}
                          <div className="flex items-center gap-1 w-24 shrink-0">
                            <span className="text-[10px] font-mono text-zinc-500">Tag</span>
                            <input
                              type="text"
                              value={typer.prefix}
                              onChange={(e) => handleUpdateTyper(typer.id, { prefix: e.target.value })}
                              placeholder='e.g. ""'
                              className="w-full px-2 py-1 rounded bg-[#050508] border border-white/[0.10] text-zinc-200 font-mono text-xs focus:outline-none focus:border-sky-500/50"
                            />
                          </div>

                          {/* Name input */}
                          <div className="flex-1 min-w-0">
                            <input
                              type="text"
                              value={typer.name}
                              onChange={(e) => handleUpdateTyper(typer.id, { name: e.target.value })}
                              placeholder="Typer Name"
                              className="w-full px-2.5 py-1 rounded bg-[#050508] border border-white/[0.10] text-zinc-200 font-sans text-xs font-medium focus:outline-none focus:border-sky-500/50"
                            />
                          </div>

                          {/* AI Eligibility Badge */}
                          <div
                            title={
                              hasInstructions
                                ? 'Eligible for automatic AI classification during scan'
                                : 'Empty instructions: will NEVER be automatically selected by AI (manual selection only)'
                            }
                            className={`shrink-0 px-2 py-0.5 rounded text-[9px] font-mono font-semibold uppercase border ${
                              hasInstructions
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                            }`}
                          >
                            {hasInstructions ? 'AI Active' : 'Manual Only'}
                          </div>

                          {/* Delete button */}
                          <button
                            type="button"
                            onClick={() => handleDeleteTyper(typer.id)}
                            className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                            title={`Delete "${typer.name}"`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Row 2: AI Classification Instructions Textarea */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-mono text-zinc-500 flex items-center justify-between">
                            <span>AI Classification Rules</span>
                            {!hasInstructions && (
                              <span className="text-[9px] text-amber-400/80">
                                (Leave empty to keep manual-only)
                              </span>
                            )}
                          </label>
                          <textarea
                            rows={2}
                            value={typer.instructions}
                            onChange={(e) => handleUpdateTyper(typer.id, { instructions: e.target.value })}
                            placeholder="Functional classification rules telling the AI how to recognize this type (bubble shape, context, vocal tone)..."
                            className="w-full p-2 rounded bg-[#050508] border border-white/[0.08] text-zinc-300 font-sans text-xs leading-relaxed focus:outline-none focus:border-sky-500/50 resize-y custom-scrollbar"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3. Footer */}
        <div className="h-12 min-h-[48px] px-5 border-t border-[#27272a] bg-[#09090b] flex items-center justify-between shrink-0">
          <span className="font-mono text-[10px] text-zinc-500">
            DRAGONFLY 44 ENGINE // v0.5
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-mono text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-95"
          >
            APPLY & CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};
