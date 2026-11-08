import React, { useState, useEffect } from 'react';
import {
  Plus,
  FileCode,
  Layers,
  Copy,
  Trash2,
  Activity,
  Sparkles,
  ShieldAlert,
  Database,
  ArrowRight,
} from 'lucide-react';
import { trainingStorage } from '../../services/trainingStorage';
import { isTrainingStudioEnabled } from '../../lib/training/env';
import { ReferenceSetEditor } from './ReferenceSetEditor';
import { AgentPackageModal } from './AgentPackageModal';
import { TrainingDiagnosticsView } from './TrainingDiagnosticsView';
import { normalizePackageToSet } from '../../lib/training/trainingPackageValidator';
import type { TrainingReferenceSet } from '../../types/training';

export const TrainingStudioScreen: React.FC = () => {
  // 1. Enforce development build boundary
  if (!isTrainingStudioEnabled()) {
    return (
      <div className="p-8 text-center max-w-md mx-auto space-y-4">
        <div className="p-3 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 w-12 h-12 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-white">Development Access Restricted</h2>
        <p className="text-xs text-zinc-400">
          The Training Studio is strictly restricted to development environments and is excluded from production builds.
        </p>
      </div>
    );
  }

  const [referenceSets, setReferenceSets] = useState<TrainingReferenceSet[]>([]);
  const [activeEditingSetId, setActiveEditingSetId] = useState<string | null>(null);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isAgentPackageOpen, setIsAgentPackageOpen] = useState(false);
  const [exportTargetSet, setExportTargetSet] = useState<TrainingReferenceSet | null>(null);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);

  const loadSets = async () => {
    let sets = await trainingStorage.getAllReferenceSets();
    if (sets.length === 0) {
      try {
        const res = await fetch('/seed_double_balloon_detection.json');
        if (res.ok) {
          const seedPackage = await res.json();
          const { referenceSet, embeddedImagesToStore } = normalizePackageToSet(seedPackage, {
            preserveVerification: false,
          });
          for (const img of embeddedImagesToStore) {
            const byteCharacters = atob(img.base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: img.mimeType });
            await trainingStorage.saveTrainingBlob(img.blobKey, blob);
          }
          const saved = await trainingStorage.saveReferenceSet(referenceSet);
          sets = [saved];
        }
      } catch (err) {
        console.warn('[TrainingStudio] Could not auto-seed double balloon reference set:', err);
      }
    }
    setReferenceSets(sets);
  };

  useEffect(() => {
    loadSets();
  }, []);

  // Set management handlers
  const handleCreateNewSet = async () => {
    const now = Date.now();
    const newSet: TrainingReferenceSet = {
      id: `ref_set_${now}_${Math.random().toString(36).substring(2, 7)}`,
      title: 'New Reference Set',
      description: '',
      generalInstructions: '',
      targetTasks: ['scanning_classification'],
      enabled: false,
      priority: 50,
      version: 1,
      createdAt: now,
      updatedAt: now,
      examples: [],
    };

    const saved = await trainingStorage.saveReferenceSet(newSet);
    await loadSets();
    setActiveEditingSetId(saved.id);
  };

  const handleDuplicateSet = async (id: string) => {
    const duplicated = await trainingStorage.duplicateReferenceSet(id);
    await loadSets();
    setActiveEditingSetId(duplicated.id);
  };

  const handleDeleteSet = async (id: string, title: string) => {
    if (confirm(`Are you sure you want to delete Reference Set "${title}" and all its managed screenshot examples?`)) {
      await trainingStorage.deleteReferenceSet(id);
      await loadSets();
      if (activeEditingSetId === id) {
        setActiveEditingSetId(null);
      }
    }
  };

  const handleToggleEnabled = async (set: TrainingReferenceSet) => {
    const updated = { ...set, enabled: !set.enabled };
    await trainingStorage.saveReferenceSet(updated);
    await loadSets();
  };

  const handleCleanupOrphanedBlobs = async () => {
    const deletedCount = await trainingStorage.cleanupOrphanedBlobs();
    setCleanupMessage(`Cleaned up ${deletedCount} unreferenced image blob${deletedCount !== 1 ? 's' : ''}.`);
    setTimeout(() => setCleanupMessage(null), 3000);
  };

  // If user is currently editing a set, render the ReferenceSetEditor
  const activeSet = referenceSets.find((s) => s.id === activeEditingSetId) || null;
  if (activeEditingSetId && activeSet) {
    return (
      <ReferenceSetEditor
        referenceSet={activeSet}
        onSave={() => loadSets()}
        onBack={() => {
          setActiveEditingSetId(null);
          loadSets();
        }}
        onDelete={(id) => {
          handleDeleteSet(id, activeSet.title);
          setActiveEditingSetId(null);
        }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0c0d12] text-zinc-100 font-sans select-none overflow-hidden">
      {/* Studio Top Bar */}
      <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-xs font-bold tracking-wider uppercase text-zinc-100">
                DRAGONFLY 44 // TRAINING STUDIO
              </h1>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
                DEV ONLY
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Multimodal Reference Sets, domain guidance, and verified ground-truth training studio for Gemini.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {cleanupMessage && (
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-1 rounded border border-emerald-500/30">
              {cleanupMessage}
            </span>
          )}

          <button
            type="button"
            onClick={handleCleanupOrphanedBlobs}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Purge unreferenced image blobs from IndexedDB"
          >
            <Database className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsDiagnosticsOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-mono text-zinc-200 border border-white/[0.08] flex items-center gap-1.5 cursor-pointer"
            title="Inspect dispatches to Gemini"
          >
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            Diagnostics
          </button>

          <button
            type="button"
            onClick={() => {
              setExportTargetSet(null);
              setIsAgentPackageOpen(true);
            }}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-mono text-zinc-200 border border-white/[0.08] flex items-center gap-1.5 cursor-pointer"
            title="Import or view agent package contract"
          >
            <FileCode className="w-3.5 h-3.5 text-sky-400" />
            Agent Package
          </button>

          <button
            type="button"
            onClick={handleCreateNewSet}
            className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-mono text-xs font-semibold shadow-lg shadow-amber-950/20 flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Reference Set
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {referenceSets.length === 0 ? (
          /* PROPER EMPTY STATE: Zero mock/placeholder data */
          <div className="max-w-xl mx-auto my-12 p-8 rounded-2xl border border-dashed border-white/[0.12] bg-[#09090d] text-center space-y-4">
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 w-12 h-12 flex items-center justify-center mx-auto">
              <Layers className="w-6 h-6" />
            </div>

            <div>
              <h2 className="text-base font-bold text-white">No Reference Sets Configured</h2>
              <p className="text-xs text-zinc-400 mt-1.5 max-w-md mx-auto leading-relaxed">
                Training Studio operates in a pristine, empty state until you create your first Reference Set.
                Reference Sets provide task-scoped multimodal screenshot examples and instructions to Gemini during
                scanning, classification, and translation.
              </p>
            </div>

            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleCreateNewSet}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-mono text-xs font-semibold shadow-lg shadow-amber-950/30 flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Create First Reference Set
              </button>

              <button
                type="button"
                onClick={() => {
                  setExportTargetSet(null);
                  setIsAgentPackageOpen(true);
                }}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs font-semibold border border-white/[0.08] flex items-center gap-2 cursor-pointer"
              >
                <FileCode className="w-4 h-4 text-sky-400" />
                Import Agent Package
              </button>
            </div>
          </div>
        ) : (
          /* REFERENCE SETS GRID */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {referenceSets.map((set) => (
              <div
                key={set.id}
                className="rounded-xl border border-white/[0.08] bg-[#09090d] flex flex-col justify-between overflow-hidden text-xs transition-all hover:border-white/[0.18] p-4 space-y-3"
              >
                {/* Header info */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-white/[0.06]">
                      Priority {set.priority} • v{set.version}
                    </span>

                    {/* Enabled Switch */}
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={set.enabled}
                        onChange={() => handleToggleEnabled(set)}
                        className="sr-only peer"
                      />
                      <div className="w-7 h-4 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600"></div>
                      <span
                        className={`text-[11px] font-mono font-semibold ${
                          set.enabled ? 'text-emerald-400' : 'text-zinc-500'
                        }`}
                      >
                        {set.enabled ? 'Active' : 'Off'}
                      </span>
                    </label>
                  </div>

                  <h3 className="font-semibold text-white text-sm tracking-wide">{set.title}</h3>
                  {set.description ? (
                    <p className="text-zinc-400 text-[11px] mt-1 line-clamp-2">{set.description}</p>
                  ) : (
                    <p className="text-zinc-600 text-[11px] mt-1 italic">No description provided</p>
                  )}
                </div>

                {/* Target Tasks */}
                <div className="flex items-center gap-1 flex-wrap">
                  {(set.targetTasks || []).map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/10 text-sky-300 border border-sky-500/20"
                    >
                      {t}
                    </span>
                  ))}
                </div>

                {/* Footer Bar */}
                <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
                  <span className="font-mono text-[11px] text-zinc-400">
                    {set.examples.length} example{set.examples.length !== 1 ? 's' : ''}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleDuplicateSet(set.id)}
                      className="p-1.5 rounded text-zinc-500 hover:text-white transition-colors cursor-pointer"
                      title="Duplicate Set"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExportTargetSet(set);
                        setIsAgentPackageOpen(true);
                      }}
                      className="p-1.5 rounded text-zinc-500 hover:text-sky-400 transition-colors cursor-pointer"
                      title="Export Package"
                    >
                      <FileCode className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSet(set.id, set.title)}
                      className="p-1.5 rounded text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
                      title="Delete Set"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveEditingSetId(set.id)}
                      className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-mono text-xs font-semibold border border-white/[0.08] ml-1 flex items-center gap-1 cursor-pointer"
                    >
                      Edit Set <ArrowRight className="w-3 h-3 text-amber-400" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Diagnostics Modal */}
      {isDiagnosticsOpen && <TrainingDiagnosticsView onClose={() => setIsDiagnosticsOpen(false)} />}

      {/* Agent Package Modal (Import or Export) */}
      {isAgentPackageOpen && (
        <AgentPackageModal
          isOpen={isAgentPackageOpen}
          onClose={() => {
            setIsAgentPackageOpen(false);
            setExportTargetSet(null);
          }}
          onPackageImported={(newSet) => {
            loadSets();
            setActiveEditingSetId(newSet.id);
          }}
          exportSet={exportTargetSet}
        />
      )}
    </div>
  );
};
