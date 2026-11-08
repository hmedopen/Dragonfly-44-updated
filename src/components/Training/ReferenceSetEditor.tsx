import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Save,
  Trash2,
  FolderOpen,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  MoveUp,
  MoveDown,
  Layers,
  Edit3,
  Info,
} from 'lucide-react';
import { trainingStorage } from '../../services/trainingStorage';
import { AnnotationCanvas } from './AnnotationCanvas';
import { FolderImportModal } from './FolderImportModal';
import { AgentPackageModal } from './AgentPackageModal';
import { TRAINING_TASKS, type TrainingReferenceSet, type ReferenceExample, type TrainingTaskType } from '../../types/training';

interface ReferenceSetEditorProps {
  referenceSet: TrainingReferenceSet;
  onSave: (updated: TrainingReferenceSet) => void;
  onBack: () => void;
  onDelete: (id: string) => void;
}

export const ReferenceSetEditor: React.FC<ReferenceSetEditorProps> = ({
  referenceSet: initialSet,
  onSave,
  onBack,
  onDelete,
}) => {
  const [currentSet, setCurrentSet] = useState<TrainingReferenceSet>(initialSet);
  const [activeTab, setActiveTab] = useState<'instructions' | 'gallery'>('gallery');
  const [isFolderImportOpen, setIsFolderImportOpen] = useState(false);
  const [isAgentPackageOpen, setIsAgentPackageOpen] = useState(false);
  const [annotatingExampleId, setAnnotatingExampleId] = useState<string | null>(null);
  const [activeImageBlob, setActiveImageBlob] = useState<Blob | null>(null);
  const [exampleBlobs, setExampleBlobs] = useState<Record<string, string>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load thumbnail URLs for examples
  useEffect(() => {
    let isMounted = true;
    const urlsToRevoke: string[] = [];

    async function loadThumbnails() {
      const map: Record<string, string> = {};
      for (const ex of currentSet.examples) {
        if (ex.blobKey) {
          try {
            const blob = await trainingStorage.getTrainingBlob(ex.blobKey);
            if (blob && isMounted) {
              const url = URL.createObjectURL(blob);
              urlsToRevoke.push(url);
              map[ex.id] = url;
            }
          } catch (e) {
            console.warn(`Could not load thumbnail for ${ex.id}:`, e);
          }
        }
      }
      if (isMounted) setExampleBlobs(map);
    }

    loadThumbnails();

    return () => {
      isMounted = false;
      urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [currentSet.examples]);

  // Update Set state
  const handleUpdateField = <K extends keyof TrainingReferenceSet>(field: K, value: TrainingReferenceSet[K]) => {
    setCurrentSet((prev) => ({ ...prev, [field]: value }));
    setHasUnsavedChanges(true);
  };

  const handleToggleTask = (task: TrainingTaskType) => {
    const currentTasks = currentSet.targetTasks || [];
    const exists = currentTasks.includes(task);
    const updated = exists ? currentTasks.filter((t) => t !== task) : [...currentTasks, task];
    handleUpdateField('targetTasks', updated);
  };

  // Example operations
  const handleUpdateExample = (exampleId: string, patch: Partial<ReferenceExample>) => {
    const updated = currentSet.examples.map((ex) => (ex.id === exampleId ? { ...ex, ...patch } : ex));
    handleUpdateField('examples', updated);
  };

  const handleDeleteExample = async (exampleId: string) => {
    const ex = currentSet.examples.find((e) => e.id === exampleId);
    if (!ex) return;
    if (confirm(`Delete example "${ex.title}"?`)) {
      if (ex.blobKey) {
        await trainingStorage.deleteTrainingBlob(ex.blobKey).catch(() => {});
      }
      const updated = currentSet.examples
        .filter((e) => e.id !== exampleId)
        .map((e, idx) => ({ ...e, orderIndex: idx + 1 }));
      handleUpdateField('examples', updated);
    }
  };

  const handleMoveExample = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= currentSet.examples.length) return;

    const list = [...currentSet.examples];
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;

    // Renumber consistently
    const renumbered = list.map((ex, idx) => ({ ...ex, orderIndex: idx + 1 }));
    handleUpdateField('examples', renumbered);
  };

  const handleSaveSet = async () => {
    const saved = await trainingStorage.saveReferenceSet(currentSet);
    setCurrentSet(saved);
    setHasUnsavedChanges(false);
    onSave(saved);
  };

  const handleOpenAnnotations = async (example: ReferenceExample) => {
    if (!example.blobKey) return;
    const blob = await trainingStorage.getTrainingBlob(example.blobKey);
    if (blob) {
      setActiveImageBlob(blob);
      setAnnotatingExampleId(example.id);
    }
  };

  const activeAnnotatingExample = currentSet.examples.find((e) => e.id === annotatingExampleId) || null;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0c0d12] text-zinc-100 font-sans select-none overflow-hidden">
      {/* Editor Top Bar */}
      <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1.5 text-xs font-mono"
            title="Return to Reference Sets"
          >
            <ArrowLeft className="w-4 h-4" />
            Sets
          </button>

          <div className="h-4 w-px bg-white/[0.08]" />

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-amber-400">
              REFERENCE SET EDITOR
            </span>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-white/[0.06]">
              v{currentSet.version}
            </span>
            {hasUnsavedChanges && (
              <span className="text-[10px] font-mono text-amber-400 flex items-center gap-1">
                ● Unsaved changes
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Enabled Switch */}
          <label className="flex items-center gap-2 cursor-pointer mr-2">
            <input
              type="checkbox"
              checked={currentSet.enabled}
              onChange={(e) => handleUpdateField('enabled', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
            <span className="text-xs font-mono text-zinc-300">
              {currentSet.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>

          <button
            type="button"
            onClick={() => setIsAgentPackageOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-mono text-zinc-200 border border-white/[0.08] flex items-center gap-1.5 cursor-pointer"
            title="Export / Import Agent Package"
          >
            <FileCode className="w-3.5 h-3.5 text-emerald-400" />
            Agent Contract
          </button>

          <button
            type="button"
            onClick={handleSaveSet}
            className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-mono text-xs font-semibold shadow-lg shadow-amber-950/20 flex items-center gap-1.5 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            Save Changes
          </button>

          <button
            type="button"
            onClick={() => onDelete(currentSet.id)}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-1 cursor-pointer"
            title="Delete this Reference Set"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Metadata & Scope Bar */}
      <div className="px-6 py-3 bg-[#09090d] border-b border-white/[0.06] space-y-3 shrink-0">
        <div className="flex items-center gap-4">
          <input
            type="text"
            value={currentSet.title}
            onChange={(e) => handleUpdateField('title', e.target.value)}
            className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-900 border border-white/[0.1] text-sm font-semibold text-white focus:border-amber-400 focus:outline-none"
            placeholder="Reference Set Title (e.g. Double Balloon Separation)"
          />

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-400 uppercase">Priority:</span>
            <input
              type="number"
              min="1"
              max="100"
              value={currentSet.priority}
              onChange={(e) => handleUpdateField('priority', Math.max(1, Math.min(100, parseInt(e.target.value) || 50)))}
              className="w-16 px-2 py-1 rounded bg-zinc-900 border border-white/[0.1] text-xs font-mono text-zinc-200 text-center focus:border-amber-400 focus:outline-none"
            />
          </div>
        </div>

        <input
          type="text"
          value={currentSet.description}
          onChange={(e) => handleUpdateField('description', e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-white/[0.08] text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
          placeholder="Brief description of when this Reference Set applies and what behavior it governs..."
        />

        {/* Target Task Associations */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <span className="text-[11px] font-mono text-zinc-500 uppercase mr-1">Target Tasks:</span>
          {TRAINING_TASKS.map((t) => {
            const isSelected = (currentSet.targetTasks || []).includes(t.type);
            return (
              <button
                key={t.type}
                type="button"
                onClick={() => handleToggleTask(t.type)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-mono transition-colors cursor-pointer border ${
                  isSelected
                    ? 'bg-sky-500/15 border-sky-400/50 text-sky-300 font-semibold shadow-sm'
                    : 'bg-zinc-900 border-white/[0.06] text-zinc-500 hover:text-zinc-300'
                }`}
                title={t.description}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="px-6 h-11 border-b border-white/[0.06] bg-[#08080b] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('gallery')}
            className={`px-4 py-2 font-mono text-xs border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'gallery'
                ? 'border-amber-400 text-amber-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Example Gallery ({currentSet.examples.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('instructions')}
            className={`px-4 py-2 font-mono text-xs border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'instructions'
                ? 'border-amber-400 text-amber-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            General AI Instructions
          </button>
        </div>

        {activeTab === 'gallery' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFolderImportOpen(true)}
              className="px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-mono text-xs font-semibold shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Import Folder Screenshots
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'instructions' ? (
          /* SECTION A: General AI Instructions */
          <div className="max-w-4xl mx-auto space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">General AI Directives</h3>
                <p className="text-zinc-400 text-[11px] mt-0.5">
                  These instructions are automatically injected into Gemini whenever this Reference Set is enabled
                  and its associated target tasks match.
                </p>
              </div>

              {/* Quick Snippet Inserts */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateField(
                      'generalInstructions',
                      (currentSet.generalInstructions ? currentSet.generalInstructions + '\n\n' : '') +
                        'CRITICAL DOUBLE-BALLOON DIRECTIVE: When dialogue is split across two connected balloons or stacked vertical bubbles, you must detect each balloon as a separate physical region with distinct bounding boxes. Do not merge them into one box.'
                    )
                  }
                  className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-[10px] font-mono text-zinc-300 border border-white/[0.08] cursor-pointer"
                >
                  + Double Balloon Rule
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateField(
                      'generalInstructions',
                      (currentSet.generalInstructions ? currentSet.generalInstructions + '\n\n' : '') +
                        'VERBATIM OCR DIRECTIVE: Under no circumstances should you invent missing characters or complete partial sentences that are cut off at page edges. State uncertainty honestly in ocrAlternatives.'
                    )
                  }
                  className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-[10px] font-mono text-zinc-300 border border-white/[0.08] cursor-pointer"
                >
                  + Verbatim OCR Rule
                </button>
              </div>
            </div>

            <textarea
              rows={16}
              value={currentSet.generalInstructions}
              onChange={(e) => handleUpdateField('generalInstructions', e.target.value)}
              className="w-full p-4 rounded-xl bg-[#07070a] border border-white/[0.1] text-zinc-200 font-mono text-xs focus:border-amber-400 focus:outline-none resize-none leading-relaxed"
              placeholder="Enter comprehensive instructions for the AI regarding this pattern..."
            />

            <div className="p-3 rounded-xl bg-zinc-900/40 border border-white/[0.06] text-zinc-400 flex items-start gap-2">
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <div>
                Authoritative architectural invariants (such as coordinate constraints, non-destructive merges, and
                safe typing) are maintained by Folio Script's project context engine and cannot be superseded by
                instruction notes.
              </div>
            </div>
          </div>
        ) : (
          /* SECTION B: Example Gallery */
          <div className="space-y-4">
            {currentSet.examples.length === 0 ? (
              <div className="p-12 text-center rounded-2xl border border-dashed border-white/[0.1] bg-zinc-900/20 max-w-lg mx-auto space-y-3">
                <Layers className="w-10 h-10 text-zinc-600 mx-auto" />
                <h4 className="text-sm font-semibold text-zinc-300">No Screenshot Examples Yet</h4>
                <p className="text-xs text-zinc-500">
                  Import a folder of screenshots from your PC or use the development agent integration to add visual
                  references.
                </p>
                <button
                  type="button"
                  onClick={() => setIsFolderImportOpen(true)}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-mono text-xs font-semibold shadow-lg shadow-sky-950/20 inline-flex items-center gap-2 cursor-pointer mt-2"
                >
                  <FolderOpen className="w-4 h-4" />
                  Import Folder Screenshots
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {currentSet.examples.map((ex, idx) => {
                  const thumbUrl = exampleBlobs[ex.id];
                  const hasUnverified = ex.annotations.some((a) => !a.isVerified);

                  return (
                    <div
                      key={ex.id}
                      className="rounded-xl border border-white/[0.08] bg-[#09090d] flex flex-col overflow-hidden text-xs transition-all hover:border-white/[0.15]"
                    >
                      {/* Example Card Header */}
                      <div className="h-10 px-3 border-b border-white/[0.06] bg-[#08080b] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            #{String(ex.orderIndex).padStart(2, '0')}
                          </span>
                          <input
                            type="text"
                            value={ex.title}
                            onChange={(e) => handleUpdateExample(ex.id, { title: e.target.value })}
                            className="bg-transparent text-zinc-100 font-semibold focus:outline-none border-b border-transparent focus:border-amber-400 text-xs w-36 truncate"
                          />
                        </div>

                        {/* Order Controls & Actions */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleMoveExample(idx, 'up')}
                            disabled={idx === 0}
                            className="p-1 rounded text-zinc-500 hover:text-white disabled:opacity-20 cursor-pointer"
                            title="Move Up"
                          >
                            <MoveUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveExample(idx, 'down')}
                            disabled={idx === currentSet.examples.length - 1}
                            className="p-1 rounded text-zinc-500 hover:text-white disabled:opacity-20 cursor-pointer"
                            title="Move Down"
                          >
                            <MoveDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteExample(ex.id)}
                            className="p-1 rounded text-zinc-500 hover:text-rose-400 cursor-pointer ml-1"
                            title="Delete Example"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Image Thumbnail & Visual Studio Trigger */}
                      <div
                        className="relative h-44 bg-[#050507] flex items-center justify-center overflow-hidden group cursor-pointer"
                        onClick={() => handleOpenAnnotations(ex)}
                      >
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={ex.title}
                            className="h-full w-auto object-contain opacity-85 group-hover:opacity-100 transition-opacity"
                          />
                        ) : (
                          <div className="text-zinc-600 text-[11px] font-mono">Loading image...</div>
                        )}

                        {/* Overlay Trigger Button */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="px-3 py-1.5 rounded-lg bg-amber-500 text-black font-mono text-xs font-bold shadow-lg flex items-center gap-1.5">
                            <Edit3 className="w-3.5 h-3.5" />
                            Open Annotations Studio
                          </span>
                        </div>

                        {/* Annotation Badge */}
                        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/85 px-2 py-0.5 rounded border border-white/20 text-[10px] font-mono">
                          {ex.annotations.length > 0 ? (
                            <>
                              {hasUnverified ? (
                                <AlertTriangle className="w-3 h-3 text-amber-400 animate-pulse" />
                              ) : (
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              )}
                              <span>
                                {ex.annotations.length} Box{ex.annotations.length !== 1 ? 'es' : ''}
                              </span>
                            </>
                          ) : (
                            <span className="text-zinc-500">No boxes</span>
                          )}
                        </div>
                      </div>

                      {/* Example Form Fields */}
                      <div className="p-3 space-y-2.5 flex-1 flex flex-col justify-between">
                        <div>
                          <label className="block text-[10px] font-mono text-zinc-500 uppercase mb-1">
                            Individual AI Note
                          </label>
                          <textarea
                            rows={3}
                            value={ex.aiNote}
                            onChange={(e) => handleUpdateExample(ex.id, { aiNote: e.target.value })}
                            className="w-full p-2 rounded bg-zinc-900 border border-white/[0.08] text-zinc-200 text-xs focus:border-amber-400 focus:outline-none resize-none"
                            placeholder="Why does this screenshot matter? What specific boundary or order should the AI follow?"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-mono text-zinc-500 uppercase mb-1">
                            Expected Output / Behavior (Optional)
                          </label>
                          <input
                            type="text"
                            value={ex.expectedBehaviour || ''}
                            onChange={(e) => handleUpdateExample(ex.id, { expectedBehaviour: e.target.value })}
                            className="w-full px-2 py-1.5 rounded bg-zinc-900 border border-white/[0.08] text-zinc-300 text-[11px] focus:border-amber-400 focus:outline-none font-mono"
                            placeholder="e.g. 2 regions with separate bounding boxes"
                          />
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-white/[0.04]">
                          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-zinc-400">
                            <input
                              type="checkbox"
                              checked={ex.isEnabled}
                              onChange={(e) => handleUpdateExample(ex.id, { isEnabled: e.target.checked })}
                              className="rounded border-zinc-700 bg-zinc-900 text-amber-500 focus:ring-0"
                            />
                            Active in Prompt
                          </label>

                          <button
                            type="button"
                            onClick={() => handleOpenAnnotations(ex)}
                            className="text-[11px] font-mono text-amber-400 hover:underline cursor-pointer"
                          >
                            Configure Boxes →
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Visual Annotation Studio Modal */}
      {annotatingExampleId && activeAnnotatingExample && (
        <AnnotationCanvas
          imageBlob={activeImageBlob}
          annotations={activeAnnotatingExample.annotations}
          onChangeAnnotations={(newAnns) => handleUpdateExample(activeAnnotatingExample.id, { annotations: newAnns })}
          onClose={() => {
            setAnnotatingExampleId(null);
            setActiveImageBlob(null);
          }}
          exampleTitle={activeAnnotatingExample.title}
          orderIndex={activeAnnotatingExample.orderIndex}
        />
      )}

      {/* Folder Import Modal */}
      {isFolderImportOpen && (
        <FolderImportModal
          isOpen={isFolderImportOpen}
          onClose={() => setIsFolderImportOpen(false)}
          onCommitExamples={(newExamples) => {
            const updated = [...currentSet.examples, ...newExamples].map((ex, idx) => ({
              ...ex,
              orderIndex: idx + 1,
            }));
            handleUpdateField('examples', updated);
          }}
          existingExampleCount={currentSet.examples.length}
        />
      )}

      {/* Agent Package Import/Export Modal */}
      {isAgentPackageOpen && (
        <AgentPackageModal
          isOpen={isAgentPackageOpen}
          onClose={() => setIsAgentPackageOpen(false)}
          onPackageImported={(newSet) => {
            setCurrentSet(newSet);
            setHasUnsavedChanges(false);
          }}
          exportSet={currentSet}
        />
      )}
    </div>
  );
};
