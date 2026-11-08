import React, { useState, useRef } from 'react';
import {
  FolderOpen,
  Image as ImageIcon,
  AlertTriangle,
  Trash2,
  Upload,
  X,
  FileCheck,
} from 'lucide-react';
import { trainingStorage } from '../../services/trainingStorage';
import type { FolderImportCandidate, ReferenceExample } from '../../types/training';

interface FolderImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCommitExamples: (newExamples: ReferenceExample[]) => void;
  existingExampleCount: number;
}

export const FolderImportModal: React.FC<FolderImportModalProps> = ({
  isOpen,
  onClose,
  onCommitExamples,
  existingExampleCount,
}) => {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<FolderImportCandidate[]>([]);
  const [ignoredCount, setIgnoredCount] = useState<number>(0);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // 1. Electron Native Folder Selection
  const handleSelectFolderElectron = async () => {
    const ts = window.dragonfly?.trainingStudio;
    if (!ts) {
      // Fallback to browser file input
      fileInputRef.current?.click();
      return;
    }

    try {
      setIsScanning(true);
      setStatusMessage('Opening native folder dialog...');
      const selectedPath = await ts.selectFolder();
      if (!selectedPath) {
        setIsScanning(false);
        setStatusMessage(null);
        return;
      }

      setFolderPath(selectedPath);
      setStatusMessage(`Scanning ${selectedPath} for PNG, JPG, JPEG, WebP...`);
      const scanResult = await ts.scanFolder(selectedPath);

      // Check duplicates by hash
      const seenHashes = new Set<string>();
      const mappedCandidates: FolderImportCandidate[] = scanResult.candidates.map((c) => {
        const isDuplicate = seenHashes.has(c.hash);
        seenHashes.add(c.hash);
        return {
          ...c,
          isSelected: !isDuplicate, // Uncheck duplicates by default
          isDuplicate,
        };
      });

      setCandidates(mappedCandidates);
      setIgnoredCount(scanResult.ignoredCount);
      setStatusMessage(null);
    } catch (err: any) {
      console.error('[FolderImport] Scan failed:', err);
      setStatusMessage(`Scan failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsScanning(false);
    }
  };

  // 2. Browser Fallback Folder Selection
  const handleBrowserFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsScanning(true);
    const supportedExts = new Set(['png', 'jpg', 'jpeg', 'webp']);
    const list: FolderImportCandidate[] = [];
    let ignored = 0;
    const seenHashes = new Set<string>();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!supportedExts.has(ext)) {
        ignored++;
        continue;
      }

      // Quick fingerprint for browser duplicate detection
      const hash = `${file.name}_${file.size}_${file.lastModified}`;
      const isDuplicate = seenHashes.has(hash);
      seenHashes.add(hash);

      list.push({
        fileName: file.name,
        filePath: file.webkitRelativePath || file.name,
        fileSize: file.size,
        modifiedTime: file.lastModified,
        mimeType: file.type || 'image/png',
        hash,
        isSelected: !isDuplicate,
        isDuplicate,
        fileObject: file,
      });
    }

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    list.sort((a, b) => collator.compare(a.fileName, b.fileName));

    setFolderPath('Browser Upload Directory');
    setCandidates(list);
    setIgnoredCount(ignored);
    setIsScanning(false);
  };

  const toggleSelectAll = (select: boolean) => {
    setCandidates((prev) => prev.map((c) => ({ ...c, isSelected: select })));
  };

  const toggleSelectCandidate = (index: number) => {
    setCandidates((prev) =>
      prev.map((c, i) => (i === index ? { ...c, isSelected: !c.isSelected } : c))
    );
  };

  const removeCandidate = (index: number) => {
    setCandidates((prev) => prev.filter((_, i) => i !== index));
  };

  // 3. Commit Approved Screenshots into Dragonfly Managed Storage
  const handleExecuteImport = async () => {
    const selected = candidates.filter((c) => c.isSelected);
    if (selected.length === 0) return;

    setIsImporting(true);
    setImportProgress(0);
    const newExamples: ReferenceExample[] = [];
    const now = Date.now();

    const ts = window.dragonfly?.trainingStudio;

    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      const orderIndex = existingExampleCount + i + 1;
      const blobKey = `tb_${now}_${orderIndex}_${Math.random().toString(36).substring(2, 7)}`;
      const title = item.fileName.replace(/\.[^/.]+$/, ''); // Strip extension

      let blob: Blob | null = null;

      if (item.fileObject) {
        // Direct browser file object
        blob = item.fileObject;
      } else if (ts && item.filePath) {
        // Electron IPC read
        try {
          const fileData = await ts.readImageFile(item.filePath);
          // Convert base64 to Blob safely
          const byteCharacters = atob(fileData.base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let j = 0; j < byteCharacters.length; j++) {
            byteNumbers[j] = byteCharacters.charCodeAt(j);
          }
          const byteArray = new Uint8Array(byteNumbers);
          blob = new Blob([byteArray], { type: fileData.mimeType });
        } catch (err) {
          console.error(`Failed to read file ${item.filePath}:`, err);
        }
      }

      if (blob) {
        await trainingStorage.saveTrainingBlob(blobKey, blob);

        newExamples.push({
          id: `ex_${now}_${orderIndex}_${Math.random().toString(36).substring(2, 6)}`,
          orderIndex,
          title,
          blobKey,
          sourceFileName: item.fileName,
          sourceFilePath: item.filePath,
          aiNote: '',
          expectedBehaviour: '',
          tags: [],
          annotations: [],
          isEnabled: true,
          createdAt: now,
          updatedAt: now,
        });
      }

      setImportProgress(Math.round(((i + 1) / selected.length) * 100));
    }

    setIsImporting(false);
    onCommitExamples(newExamples);
    onClose();
  };

  const selectedCount = candidates.filter((c) => c.isSelected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-4xl max-h-[88vh] bg-[#0c0d12] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans">
        {/* Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide">
                FOLDER-BASED SCREENSHOT IMPORT
              </h2>
              <p className="text-[11px] text-zinc-500">
                Select any folder on your PC. Screenshots are safely imported into Dragonfly's managed storage.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Action Area: Folder Selector */}
          <div className="p-5 rounded-xl border border-dashed border-white/[0.15] bg-zinc-900/40 text-center">
            <input
              ref={fileInputRef}
              type="file"
              // @ts-ignore
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={handleBrowserFolderSelect}
            />

            <FolderOpen className="w-10 h-10 text-sky-400 mx-auto mb-2 opacity-80" />
            <h3 className="text-xs font-semibold text-zinc-200">
              {folderPath ? folderPath : 'Select a screenshot folder anywhere on your computer'}
            </h3>
            <p className="text-[11px] text-zinc-500 max-w-md mx-auto mt-1 mb-4">
              Supported formats: PNG, JPG, JPEG, WebP. High fidelity is preserved without lossy re-encoding.
            </p>

            <button
              type="button"
              onClick={handleSelectFolderElectron}
              disabled={isScanning || isImporting}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-mono text-xs font-semibold shadow-lg shadow-sky-900/20 transition-colors inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {isScanning ? 'Scanning Directory...' : 'Choose Folder...'}
            </button>
          </div>

          {statusMessage && (
            <div className="p-3 rounded-lg bg-zinc-900 border border-white/[0.08] text-xs font-mono text-zinc-300">
              {statusMessage}
            </div>
          )}

          {/* Staging Candidates List */}
          {candidates.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-zinc-300">
                    Found {candidates.length} images ({selectedCount} selected for import)
                  </span>
                  {ignoredCount > 0 && (
                    <span className="text-[10px] text-zinc-500 font-mono">
                      ({ignoredCount} non-image file{ignoredCount > 1 ? 's' : ''} ignored)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(true)}
                    className="text-[11px] text-sky-400 hover:underline cursor-pointer"
                  >
                    Select All
                  </button>
                  <span className="text-zinc-600">•</span>
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(false)}
                    className="text-[11px] text-zinc-400 hover:underline cursor-pointer"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Table / List */}
              <div className="border border-white/[0.08] rounded-xl overflow-hidden bg-[#09090d] divide-y divide-white/[0.04] max-h-72 overflow-y-auto">
                {candidates.map((cand, idx) => (
                  <div
                    key={cand.hash + idx}
                    className="px-4 py-2.5 flex items-center justify-between hover:bg-white/[0.02] text-xs transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={cand.isSelected}
                        onChange={() => toggleSelectCandidate(idx)}
                        className="rounded border-zinc-700 bg-zinc-900 text-sky-500 focus:ring-0 cursor-pointer"
                      />

                      <div className="p-1 rounded bg-zinc-800 text-zinc-400">
                        <ImageIcon className="w-3.5 h-3.5" />
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-zinc-200 font-medium">{cand.fileName}</span>
                          {cand.isDuplicate && (
                            <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              <AlertTriangle className="w-2.5 h-2.5" /> Duplicate
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono">
                          {(cand.fileSize / 1024).toFixed(1)} KB • {cand.mimeType}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeCandidate(idx)}
                      className="text-zinc-500 hover:text-rose-400 p-1 rounded transition-colors"
                      title="Remove from import"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Progress Indicator */}
          {isImporting && (
            <div className="space-y-1.5 p-4 rounded-xl bg-zinc-900 border border-white/[0.08]">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-300">
                <span>Copying to Managed Application Storage...</span>
                <span>{importProgress}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-150"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-14 px-6 border-t border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="text-[11px] text-zinc-500">
            {selectedCount > 0
              ? `Ready to import ${selectedCount} screenshot${selectedCount > 1 ? 's' : ''}`
              : 'Select files to begin import'}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/05 font-mono text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExecuteImport}
              disabled={selectedCount === 0 || isImporting}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-semibold shadow-lg shadow-emerald-950/30 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <FileCheck className="w-3.5 h-3.5" />
              {isImporting ? 'Importing...' : `Approve & Import (${selectedCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
