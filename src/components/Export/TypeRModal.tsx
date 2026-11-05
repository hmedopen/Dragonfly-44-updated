import React, { useState, useMemo } from 'react';
import { 
  X, 
  Copy, 
  Download, 
  Check, 
  FileCode, 
  SlidersHorizontal,
  FileText
} from 'lucide-react';
import type { BubbleItem } from '../../types/workbench';
import { compileTypeRScript, compileRawTextExtract } from '../../lib/compileTypeR';

interface TypeRModalProps {
  isOpen: boolean;
  onClose: () => void;
  bubbles: BubbleItem[];
  allChapterPages?: { pageIndex: number; bubbles: BubbleItem[] }[];
  chapterName?: string;
  activePageIndex?: number;
  initialScope?: 'entire' | 'active';
  initialMode?: 'raw_text' | 'typer_script';
}

export const TypeRModal: React.FC<TypeRModalProps> = ({
  isOpen,
  onClose,
  bubbles,
  allChapterPages,
  chapterName = 'CHAPTER 01',
  activePageIndex = 1,
  initialScope = 'entire',
  initialMode = 'raw_text',
}) => {
  const [scope, setScope] = useState<'entire' | 'active'>(initialScope);
  const [exportMode, setExportMode] = useState<'raw_text' | 'typer_script'>(initialMode);
  const [includePageHeaders, setIncludePageHeaders] = useState(true);
  const [includeIndexTags, setIncludeIndexTags] = useState(true);
  const [includePrefixTags, setIncludePrefixTags] = useState(true);
  const [includeSourceComments, setIncludeSourceComments] = useState(true);
  const [includeFlagNotes, setIncludeFlagNotes] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Compile pages according to scope
  const targetPages = useMemo(() => {
    if (scope === 'active' || !allChapterPages || allChapterPages.length === 0) {
      return [{ pageIndex: activePageIndex, bubbles }];
    }
    return allChapterPages;
  }, [scope, allChapterPages, activePageIndex, bubbles]);

  const generatedScript = useMemo(() => {
    if (exportMode === 'raw_text') {
      return compileRawTextExtract({
        chapterName,
        pages: targetPages,
        includePageHeaders,
        includeIndexTags,
      });
    }

    return compileTypeRScript({
      chapterName,
      pages: targetPages,
      includePageHeaders,
      includeIndexTags,
      includePrefixTags,
      includeSourceComments,
      includeFlagNotes,
    });
  }, [
    exportMode,
    chapterName,
    targetPages,
    includePageHeaders,
    includeIndexTags,
    includePrefixTags,
    includeSourceComments,
    includeFlagNotes,
  ]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedScript).catch(() => {});
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([generatedScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const suffix = exportMode === 'raw_text' ? 'Raw_Source_Text' : 'TypeR_Script';
    link.download = `${chapterName.replace(/\s+/g, '_')}_${suffix}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const lineCount = generatedScript.split('\n').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity" 
        onClick={onClose} 
      />

      {/* Modal Surface */}
      <div className="relative w-full max-w-3xl bg-[#0e0e12] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] z-10 select-none">
        {/* Header */}
        <div className="h-12 min-h-[48px] px-5 border-b border-[#27272a] bg-[#0a0a0d] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <FileCode className="w-4 h-4 text-sky-400" />
            <span className="font-mono text-xs font-semibold tracking-wider text-zinc-100 uppercase">
              {exportMode === 'raw_text' ? 'RAW TEXT EXPORTER (NO TRANSLATION)' : 'TYPER TRANSLATION SCRIPT EXPORTER'}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Split */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
          {/* Controls Side Panel */}
          <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-[#27272a] bg-[#0a0a0d] p-4 flex flex-col gap-4 shrink-0 overflow-y-auto custom-scrollbar">
            {/* Export Mode */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1.5">
                <SlidersHorizontal className="w-3 h-3 text-sky-400" />
                <span>FORMAT MODE</span>
              </label>
              <div className="grid grid-cols-2 p-1 rounded-lg bg-zinc-950 border border-white/[0.08] gap-1">
                <button
                  type="button"
                  onClick={() => setExportMode('raw_text')}
                  className={`py-1 rounded font-mono text-[10px] transition-all cursor-pointer text-center ${
                    exportMode === 'raw_text'
                      ? 'bg-sky-500/20 text-sky-300 font-medium shadow-xs border border-sky-400/40'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Raw Text
                </button>
                <button
                  type="button"
                  onClick={() => setExportMode('typer_script')}
                  className={`py-1 rounded font-mono text-[10px] transition-all cursor-pointer text-center ${
                    exportMode === 'typer_script'
                      ? 'bg-sky-500/20 text-sky-300 font-medium shadow-xs border border-sky-400/40'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  TypeR Script
                </button>
              </div>
            </div>

            {/* Scope */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                EXPORT SCOPE
              </label>
              <div className="grid grid-cols-2 p-1 rounded-lg bg-zinc-950 border border-white/[0.08] gap-1">
                <button
                  type="button"
                  onClick={() => setScope('entire')}
                  className={`py-1 rounded font-mono text-[11px] transition-all cursor-pointer ${
                    scope === 'entire'
                      ? 'bg-zinc-800 text-white font-medium shadow-xs border border-white/[0.12]'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Chapter
                </button>
                <button
                  type="button"
                  onClick={() => setScope('active')}
                  className={`py-1 rounded font-mono text-[11px] transition-all cursor-pointer ${
                    scope === 'active'
                      ? 'bg-zinc-800 text-white font-medium shadow-xs border border-white/[0.12]'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Page {activePageIndex}
                </button>
              </div>
            </div>

            {/* Formatting Options */}
            <div className="flex flex-col gap-2.5 pt-2 border-t border-white/[0.06]">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                FORMATTING RULES
              </span>

              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includePageHeaders}
                  onChange={(e) => setIncludePageHeaders(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-sky-500 focus:ring-0"
                />
                <span>Page Delimiters (###)</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeIndexTags}
                  onChange={(e) => setIncludeIndexTags(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-sky-500 focus:ring-0"
                />
                <span>Bubble Index (#01)</span>
              </label>

              {exportMode === 'typer_script' && (
                <>
                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includePrefixTags}
                      onChange={(e) => setIncludePrefixTags(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900 text-sky-500 focus:ring-0"
                    />
                    <span>TypeR Tags (():, {}:)</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeSourceComments}
                      onChange={(e) => setIncludeSourceComments(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900 text-sky-500 focus:ring-0"
                    />
                    <span>Source Comments</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeFlagNotes}
                      onChange={(e) => setIncludeFlagNotes(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900 text-sky-500 focus:ring-0"
                    />
                    <span>QC Flag Notes</span>
                  </label>
                </>
              )}
            </div>
          </div>

          {/* Monospace Preview Pane */}
          <div className="flex-1 flex flex-col min-h-0 bg-[#07070a] p-4">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/[0.06] font-mono text-[10px] text-zinc-500">
              <span className="flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-zinc-400" />
                <span>
                  {exportMode === 'raw_text' ? 'RAW SOURCE TEXT PREVIEW' : 'TYPER SCRIPT PREVIEW'} // UTF-8
                </span>
              </span>
              <span>{lineCount} LINES</span>
            </div>

            <textarea
              readOnly
              value={generatedScript}
              className="flex-1 w-full bg-transparent text-zinc-200 font-mono text-xs leading-relaxed p-2 focus:outline-none resize-none custom-scrollbar select-text border border-white/[0.06] rounded-lg"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="h-12 min-h-[48px] px-5 border-t border-[#27272a] bg-[#0a0a0d] flex items-center justify-between shrink-0">
          <span className="font-mono text-[10px] text-zinc-500">
            {exportMode === 'raw_text' ? 'PLAIN TEXT EXTRACT // NO TRANSLATION' : 'COMPATIBLE WITH PHOTOSHOP TYPER'}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-white/[0.08] font-mono text-xs font-medium transition-all cursor-pointer active:scale-95"
            >
              {isCopied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300 font-bold">COPIED!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>COPY TO CLIPBOARD</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-zinc-950 font-mono text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>DOWNLOAD .TXT</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
