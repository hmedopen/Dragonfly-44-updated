import React, { useState, useRef } from 'react';
import {
  FileCode,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Copy,
  Download,
  X,
  FileCheck,
  ShieldAlert,
} from 'lucide-react';
import { validateTrainingPackageV1, normalizePackageToSet } from '../../lib/training/trainingPackageValidator';
import { trainingStorage } from '../../services/trainingStorage';
import type { TrainingPackageManifestV1, PackageValidationResult } from '../../types/trainingPackage';
import type { TrainingReferenceSet } from '../../types/training';

interface AgentPackageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPackageImported: (newSet: TrainingReferenceSet) => void;
  exportSet?: TrainingReferenceSet | null; // If provided, modal opens in Export mode
}

export const AgentPackageModal: React.FC<AgentPackageModalProps> = ({
  isOpen,
  onClose,
  onPackageImported,
  exportSet = null,
}) => {
  const [activeTab, setActiveTab] = useState<'import' | 'export'>(exportSet ? 'export' : 'import');
  const [jsonInput, setJsonInput] = useState<string>('');
  const [parsedManifest, setParsedManifest] = useState<TrainingPackageManifestV1 | null>(null);
  const [validationResult, setValidationResult] = useState<PackageValidationResult | null>(null);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Handle JSON input change & real-time validation
  const handleValidateJson = (rawText: string) => {
    setJsonInput(rawText);
    if (!rawText.trim()) {
      setParsedManifest(null);
      setValidationResult(null);
      return;
    }

    try {
      const parsed = JSON.parse(rawText);
      const res = validateTrainingPackageV1(parsed);
      setParsedManifest(parsed);
      setValidationResult(res);
    } catch (e: any) {
      setParsedManifest(null);
      setValidationResult({
        isValid: false,
        schemaVersion: 'unknown',
        errors: [`JSON Parse Error: ${e.message}`],
        warnings: [],
        stats: { exampleCount: 0, annotationCount: 0, unverifiedAnnotationCount: 0, embeddedImagesCount: 0, tasksCount: 0 },
      });
    }
  };

  // Handle .json file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      handleValidateJson(text);
    };
    reader.readAsText(file);
  };

  // Commit approved package into Reference Sets and Managed Storage
  const handleCommitPackage = async () => {
    if (!parsedManifest || !validationResult?.isValid) return;

    setIsCommitting(true);
    try {
      const { referenceSet, embeddedImagesToStore } = normalizePackageToSet(parsedManifest, {
        preserveVerification: false, // Ensure AI annotations start unverified
      });

      // Save any embedded base64 images into training_blobs store
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

      // Save the Reference Set
      const saved = await trainingStorage.saveReferenceSet(referenceSet);
      setIsCommitting(false);
      onPackageImported(saved);
      onClose();
    } catch (err: any) {
      console.error('[AgentPackageModal] Commit failed:', err);
      setIsCommitting(false);
      alert(`Import failed: ${err.message || 'Unknown error'}`);
    }
  };

  // Generate Export Package JSON for an existing Reference Set
  const generateExportJson = (): string => {
    if (!exportSet) return '';
    const manifest: TrainingPackageManifestV1 = {
      schemaVersion: 'dragonfly.training.v1',
      exportedAt: Date.now(),
      generator: 'dragonfly-training-studio',
      referenceSet: {
        id: exportSet.id,
        title: exportSet.title,
        description: exportSet.description,
        generalInstructions: exportSet.generalInstructions,
        targetTasks: exportSet.targetTasks,
        priority: exportSet.priority,
        enabled: exportSet.enabled,
      },
      examples: exportSet.examples.map((ex) => ({
        id: ex.id,
        orderIndex: ex.orderIndex,
        title: ex.title,
        sourceFileName: ex.sourceFileName,
        imageBlobKey: ex.blobKey,
        aiNote: ex.aiNote,
        expectedBehaviour: ex.expectedBehaviour,
        tags: ex.tags,
        isEnabled: ex.isEnabled,
        annotations: ex.annotations.map((a) => ({
          id: a.id,
          physicalObjectId: a.physicalObjectId,
          box_2d: a.box_2d,
          label: a.label,
          translationUnitId: a.translationUnitId,
          readingOrderIndex: a.readingOrderIndex,
          relationships: a.relationships,
          notes: a.notes,
          isVerified: a.isVerified,
        })),
      })),
    };

    return JSON.stringify(manifest, null, 2);
  };

  const handleCopyExport = () => {
    const text = generateExportJson();
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleDownloadExport = () => {
    if (!exportSet) return;
    const text = generateExportJson();
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `training_package_${exportSet.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#0c0d12] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans">
        {/* Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <FileCode className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide">
                AGENT INTEGRATION // TRAINING PACKAGE V1
              </h2>
              <p className="text-[11px] text-zinc-500">
                Documented contract for agent-prepared reference sets, metadata, and ground-truth validation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-zinc-900 border border-white/[0.08] rounded-lg p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('import')}
                className={`px-3 py-1 rounded font-mono text-[11px] transition-colors ${
                  activeTab === 'import' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Import Package
              </button>
              {exportSet && (
                <button
                  type="button"
                  onClick={() => setActiveTab('export')}
                  className={`px-3 py-1 rounded font-mono text-[11px] transition-colors ${
                    activeTab === 'export' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Export Package
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeTab === 'import' ? (
            <>
              {/* File upload or paste prompt */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-zinc-300 font-semibold uppercase tracking-wider">
                  Paste Manifest JSON or Upload Package File
                </span>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-mono text-zinc-200 border border-white/[0.08] flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Load .JSON File
                  </button>
                </div>
              </div>

              {/* JSON Textarea */}
              <textarea
                rows={7}
                value={jsonInput}
                onChange={(e) => handleValidateJson(e.target.value)}
                placeholder="Paste dragonfly.training.v1 JSON manifest here..."
                className="w-full p-3 rounded-xl bg-[#07070a] border border-white/[0.1] text-zinc-200 font-mono text-xs focus:border-amber-400 focus:outline-none resize-none"
              />

              {/* Validation Status Card */}
              {validationResult && (
                <div
                  className={`p-4 rounded-xl border ${
                    validationResult.isValid
                      ? 'bg-emerald-950/20 border-emerald-500/30'
                      : 'bg-rose-950/20 border-rose-500/30'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {validationResult.isValid ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                    )}
                    <span
                      className={`text-xs font-mono font-bold ${
                        validationResult.isValid ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {validationResult.isValid
                        ? 'Package Validated Successfully'
                        : 'Package Validation Failed'}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-white/[0.06] ml-auto">
                      schema: {validationResult.schemaVersion}
                    </span>
                  </div>

                  {/* Errors */}
                  {validationResult.errors.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {validationResult.errors.map((err, idx) => (
                        <div key={idx} className="text-xs font-mono text-rose-300 flex items-start gap-1.5">
                          <span className="text-rose-500">•</span> {err}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Warnings */}
                  {validationResult.warnings.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {validationResult.warnings.map((warn, idx) => (
                        <div key={idx} className="text-xs font-mono text-amber-300 flex items-start gap-1.5">
                          <span className="text-amber-500">⚠</span> {warn}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Stats Pill Row */}
                  {validationResult.isValid && (
                    <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06] text-[11px] font-mono text-zinc-400 flex-wrap">
                      <span>{validationResult.stats.exampleCount} Example(s)</span>
                      <span>•</span>
                      <span>{validationResult.stats.annotationCount} Annotation(s)</span>
                      <span>•</span>
                      <span className="text-amber-400">
                        {validationResult.stats.unverifiedAnnotationCount} Unverified AI Suggestion(s)
                      </span>
                      <span>•</span>
                      <span>{validationResult.stats.embeddedImagesCount} Embedded Image(s)</span>
                    </div>
                  )}
                </div>
              )}

              {/* Package Preview */}
              {parsedManifest && validationResult?.isValid && (
                <div className="space-y-3 pt-2">
                  <div className="text-xs font-mono text-zinc-400 uppercase tracking-wider font-semibold">
                    Package Review & Staging
                  </div>

                  <div className="p-4 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-white text-sm">
                        {parsedManifest.referenceSet.title}
                      </div>
                      <div className="flex items-center gap-1">
                        {parsedManifest.referenceSet.targetTasks.map((t) => (
                          <span
                            key={t}
                            className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/10 text-sky-300 border border-sky-500/30"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    {parsedManifest.referenceSet.description && (
                      <p className="text-zinc-400 text-[11px]">{parsedManifest.referenceSet.description}</p>
                    )}

                    <div className="pt-2 text-[11px] text-zinc-500 font-mono">
                      Generator: {parsedManifest.generator} • Exported:{' '}
                      {new Date(parsedManifest.exportedAt).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Safety Notice */}
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2 text-xs text-amber-200">
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold">Review Assurance:</span> All AI-suggested annotations will
                      be imported as unverified. You can inspect each bounding box and approve it as ground truth
                      in the Visual Annotations Studio.
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Export Tab */
            <div className="space-y-4">
              <div className="text-xs font-mono text-zinc-300 font-semibold uppercase tracking-wider">
                Exported Canonical Manifest (dragonfly.training.v1)
              </div>
              <textarea
                readOnly
                rows={12}
                value={generateExportJson()}
                className="w-full p-3 rounded-xl bg-[#07070a] border border-white/[0.1] text-zinc-300 font-mono text-xs focus:outline-none resize-none"
              />

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCopyExport}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-mono text-xs font-semibold border border-white/[0.08] flex items-center gap-2 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copySuccess ? 'Copied to Clipboard!' : 'Copy JSON'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadExport}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-mono text-xs font-semibold shadow-lg shadow-sky-950/20 flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Package File
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {activeTab === 'import' && (
          <div className="h-14 px-6 border-t border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
            <div className="text-[11px] text-zinc-500">
              {validationResult?.isValid
                ? 'Package verified. Ready to commit into Reference Set.'
                : 'Awaiting valid package manifest...'}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white font-mono text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommitPackage}
                disabled={!validationResult?.isValid || isCommitting}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-semibold shadow-lg shadow-emerald-950/30 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <FileCheck className="w-3.5 h-3.5" />
                {isCommitting ? 'Committing...' : 'Commit & Import Reference Set'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
