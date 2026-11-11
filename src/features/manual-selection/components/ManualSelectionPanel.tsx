import React, { useEffect, useMemo, useState } from 'react';
import {
  Eraser,
  Languages,
  Lasso,
  Pin,
  PinOff,
  Redo2,
  RotateCw,
  ScanText,
  Square,
  Trash2,
  Undo2,
  XCircle,
} from 'lucide-react';
import { FloatingWindow } from '../../../components/Tools/FloatingWindow';
import { useWorkbenchStore } from '../../../store/workbenchStore';
import {
  deriveFallbackTyperColor,
  formatTyperSymbol,
  normalizeHexColor,
  resolveTyperVisual,
} from '../../../types/typers';
import { useManualControllerStore } from '../services/manualActionsService';
import { toggleTyperPin, useTyperSettings } from '../symbols/useTyperSettings';
import type { OcrSupportedLanguage, SelectionMode } from '../types/selection';
import { ManualDropdown } from './ManualDropdown';
import { TyperSymbolBadge } from './TyperSymbolBadge';

export interface ManualSelectionPanelProps {
  projectId: string | null;
  chapterId: string | null;
  pages: Array<{ id: string; index: number }>;
  activePageId: string | null;
}

const EllipseBubbleIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <ellipse cx="12" cy="12" rx="8.5" ry="6" />
  </svg>
);

const SELECTION_MODES: Array<{
  id: SelectionMode;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'box', label: 'Box', shortcut: '1', icon: Square },
  { id: 'bubble', label: 'Bubble', shortcut: '2', icon: EllipseBubbleIcon },
  { id: 'lasso', label: 'Lasso', shortcut: '3', icon: Lasso },
];

const OCR_LANGUAGES: Array<{ id: OcrSupportedLanguage; label: string }> = [
  { id: 'ja', label: 'JA — Japanese' },
  { id: 'zh', label: 'ZH — Chinese' },
  { id: 'ko', label: 'KO — Korean' },
  { id: 'en', label: 'EN — English' },
];

const ACTION_PILL_BASE =
  'h-7 px-2.5 rounded-xl border text-[11px] font-medium whitespace-nowrap leading-none flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer enabled:active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed';

const ICON_PILL_BASE =
  'w-7 h-7 rounded-xl border bg-[#121317] border-white/[0.08] hover:bg-[#181920] hover:border-white/[0.16] text-zinc-300 hover:text-white flex items-center justify-center shadow-sm transition-colors cursor-pointer enabled:active:scale-[0.96] disabled:opacity-35 disabled:cursor-not-allowed shrink-0';

export const ManualSelectionPanel: React.FC<ManualSelectionPanelProps> = ({
  projectId,
  chapterId,
  pages,
  activePageId,
}) => {
  const {
    isManualSelectionOpen,
    setIsManualSelectionOpen,
    manualSelectionMode,
    setManualSelectionMode,
    manualSelectedTyperId,
    setManualSelectedTyperId,
    bubblesByPage,
    selectedBubbleId,
    bubbleUndoStack,
    bubbleRedoStack,
    undoBubbleAction,
    redoBubbleAction,
    updateBubble,
    clearManualSelections,
  } = useWorkbenchStore();

  const {
    phase,
    statusMessage,
    errorMessage,
    missingModelInfo,
    ocrLanguage,
    setOcrLanguage,
    syncLanguageFromSettings,
    clearError,
    downloadMissingModel,
    extractPage,
    extractAll,
    cancelOcr,
    translatePage,
    translateAll,
    cancelTranslation,
  } = useManualControllerStore();

  const typerSettings = useTyperSettings();
  const [isTyperDropdownOpen, setIsTyperDropdownOpen] = useState(false);
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [confirmClearKey, setConfirmClearKey] = useState<string | null>(null);
  const currentConfirmKey = `${activePageId || 'none'}:${isManualSelectionOpen ? 1 : 0}`;
  const confirmClearAll = confirmClearKey === currentConfirmKey;

  useEffect(() => {
    syncLanguageFromSettings(projectId, chapterId);
  }, [projectId, chapterId, syncLanguageFromSettings]);

  const activeTyper = useMemo(() => {
    return (
      typerSettings.typers.find((t) => t.id === manualSelectedTyperId) ||
      typerSettings.typers.find((t) => t.id === 'speech_bubbles') ||
      typerSettings.typers[0] ||
      null
    );
  }, [typerSettings.typers, manualSelectedTyperId]);

  const activeLanguageOption = useMemo(
    () => OCR_LANGUAGES.find((l) => l.id === ocrLanguage) || OCR_LANGUAGES[0],
    [ocrLanguage]
  );

  const pinnedTypers = useMemo(
    () => typerSettings.typers.filter((t) => Boolean(t.pinned)),
    [typerSettings.typers]
  );

  const pageBubbles = useMemo(
    () => (activePageId ? bubblesByPage[activePageId] || [] : []),
    [activePageId, bubblesByPage]
  );

  const manualPageBubbles = useMemo(
    () => pageBubbles.filter((b) => b.provenance === 'manual_selection'),
    [pageBubbles]
  );

  const selectedBubble = useMemo(
    () => pageBubbles.find((b) => b.id === selectedBubbleId) || null,
    [pageBubbles, selectedBubbleId]
  );

  const failedTranslationCount = useMemo(() => {
    let count = 0;
    for (const p of pages) {
      const list = bubblesByPage[p.id] || [];
      for (const b of list) {
        if (
          b.provenance === 'manual_selection' &&
          b.manualTranslationStatus === 'translation_failed'
        ) {
          count++;
        }
      }
    }
    return count;
  }, [pages, bubblesByPage]);

  const hasExtractedOnPage = manualPageBubbles.some(
    (b) => b.sourceText && b.sourceText.trim().length > 0
  );
  const canUndo = Boolean(activePageId && (bubbleUndoStack[activePageId]?.length ?? 0) > 0);
  const canRedo = Boolean(activePageId && (bubbleRedoStack[activePageId]?.length ?? 0) > 0);

  const isExtracting = phase === 'extracting';
  const isTranslating = phase === 'translating';
  const isBusy = isExtracting || isTranslating;

  const activeVisual = activeTyper
    ? resolveTyperVisual(
        { type: activeTyper.id, typerPrefix: activeTyper.prefix, manualColorSnapshot: activeTyper.color },
        typerSettings.typers
      )
    : null;

  const showApplySelected =
    Boolean(selectedBubble && selectedBubble.provenance === 'manual_selection' && activeTyper) &&
    selectedBubble!.type !== activeTyper!.id;

  const handleAssignToSelected = () => {
    if (!activePageId || !selectedBubble || !activeTyper) return;
    updateBubble(activePageId, selectedBubble.id, {
      type: activeTyper.id,
      typerPrefix: activeTyper.prefix,
      manualColorSnapshot: normalizeHexColor(
        activeTyper.color,
        deriveFallbackTyperColor(activeTyper.id)
      ),
    });
  };

  return (
    <FloatingWindow
      isOpen={isManualSelectionOpen}
      title="Manual Selection"
      storageKey="folio_manual_selection_panel_geom_v1"
      defaultGeometry={{ x: 740, y: 84, width: 328, height: 452 }}
      minWidth={296}
      minHeight={330}
      minimizedWidth={250}
      headerBadge={
        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px]">
          {manualPageBubbles.length}
        </span>
      }
      closeTitle="Close Manual Selection"
      onClose={() => setIsManualSelectionOpen(false)}
    >
      <div className="flex-1 min-h-0 flex flex-col justify-between p-2.5 gap-2 overflow-y-auto custom-scrollbar text-xs">
        <div className="space-y-2.5">
          {/* 1. Selection Mode */}
          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Selection Mode
            </div>
            <div
              role="group"
              aria-label="Selection mode"
              className="grid grid-cols-3 gap-1 p-1 rounded-md bg-[#070709] border border-white/[0.08]"
            >
              {SELECTION_MODES.map((mode) => {
                const Icon = mode.icon;
                const active = manualSelectionMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    aria-pressed={active}
                    title={`${mode.label} (${mode.shortcut})`}
                    onClick={() => setManualSelectionMode(mode.id)}
                    className={`h-7 px-2 rounded flex items-center justify-center gap-1.5 text-xs font-medium cursor-pointer transition-colors ${
                      active
                        ? 'bg-zinc-100 text-zinc-950 font-semibold'
                        : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{mode.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Typer Selection, In-Dropdown Pinning & Quick Access */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                Typer Symbol
              </span>
              {showApplySelected && activeTyper && (
                <button
                  type="button"
                  onClick={handleAssignToSelected}
                  className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-mono text-[10px] cursor-pointer"
                >
                  Apply to #{selectedBubble!.index}
                </button>
              )}
            </div>

            <ManualDropdown
              isOpen={isTyperDropdownOpen}
              onOpenChange={(open) => {
                setIsTyperDropdownOpen(open);
                if (open) setIsLanguageDropdownOpen(false);
              }}
              listboxLabel="Configured typers"
              triggerLabel="Typer Symbol"
              triggerContent={
                <>
                  {activeVisual ? (
                    <TyperSymbolBadge symbol={activeVisual.symbol} color={activeVisual.color} />
                  ) : null}
                  <span className="truncate font-medium">
                    {activeTyper?.name || 'Select Typer'}
                  </span>
                </>
              }
            >
              {typerSettings.typers.map((typer) => {
                const color = normalizeHexColor(
                  typer.color,
                  deriveFallbackTyperColor(typer.id)
                );
                const symbol = formatTyperSymbol(typer.prefix, typer.name);
                const isSelected = activeTyper?.id === typer.id;
                const isPinned = Boolean(typer.pinned);
                return (
                  <div
                    key={typer.id}
                    className={`flex items-center gap-1 pr-1.5 ${
                      isSelected
                        ? 'bg-white/[0.1] text-white'
                        : 'text-zinc-300 hover:bg-white/[0.05]'
                    }`}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setManualSelectedTyperId(typer.id);
                        setIsTyperDropdownOpen(false);
                      }}
                      className={`flex-1 min-w-0 px-2.5 py-1.5 flex items-center gap-2.5 text-left text-xs cursor-pointer ${
                        isSelected ? 'font-semibold text-white' : 'text-zinc-300'
                      }`}
                    >
                      <TyperSymbolBadge symbol={symbol} color={color} />
                      <span className="truncate flex-1">{typer.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={isPinned}
                      aria-label={isPinned ? `Unpin ${typer.name}` : `Pin ${typer.name}`}
                      title={
                        isPinned
                          ? 'Unpin from quick selection'
                          : 'Pin for quick selection'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTyperPin(typer.id);
                      }}
                      className={`w-6 h-6 rounded flex items-center justify-center shrink-0 border transition-colors cursor-pointer ${
                        isPinned
                          ? 'bg-sky-500/18 border-sky-400/35 text-sky-300 hover:bg-sky-500/28'
                          : 'bg-transparent border-transparent text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.07]'
                      }`}
                    >
                      {isPinned ? (
                        <Pin className="w-3 h-3 fill-current" aria-hidden="true" />
                      ) : (
                        <PinOff className="w-3 h-3" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                );
              })}
            </ManualDropdown>

            {/* Pinned Typers Quick Access */}
            {pinnedTypers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {pinnedTypers.map((typer) => {
                  const color = normalizeHexColor(
                    typer.color,
                    deriveFallbackTyperColor(typer.id)
                  );
                  const symbol = formatTyperSymbol(typer.prefix, typer.name);
                  const isActive = activeTyper?.id === typer.id;
                  return (
                    <button
                      key={typer.id}
                      type="button"
                      aria-pressed={isActive}
                      title={`${typer.name} (${symbol})`}
                      onClick={() => setManualSelectedTyperId(typer.id)}
                      className={`p-0.5 rounded-[5px] cursor-pointer transition-transform ${
                        isActive
                          ? 'ring-2 ring-zinc-100 scale-105'
                          : 'opacity-85 hover:opacity-100'
                      }`}
                    >
                      <TyperSymbolBadge symbol={symbol} color={color} size="sm" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Offline Local OCR Extraction */}
          <div className="space-y-1.5 pt-2 border-t border-white/[0.08]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 whitespace-nowrap">
                Local OCR (Offline)
              </span>
              <ManualDropdown
                isOpen={isLanguageDropdownOpen && !isBusy}
                onOpenChange={(open) => {
                  setIsLanguageDropdownOpen(open);
                  if (open) setIsTyperDropdownOpen(false);
                }}
                listboxLabel="OCR Language"
                triggerLabel="OCR Language"
                disabled={isBusy}
                triggerClassName="h-7 px-2 min-w-[144px]"
                menuClassName="right-0 min-w-full w-44"
                triggerContent={
                  <span className="truncate font-medium">{activeLanguageOption.label}</span>
                }
              >
                {OCR_LANGUAGES.map((lang) => {
                  const isSelected = lang.id === ocrLanguage;
                  return (
                    <button
                      key={lang.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setOcrLanguage(lang.id);
                        setIsLanguageDropdownOpen(false);
                      }}
                      className={`w-full px-2.5 py-1.5 flex items-center text-left text-xs cursor-pointer ${
                        isSelected
                          ? 'bg-white/[0.1] text-white font-semibold'
                          : 'text-zinc-300 hover:bg-white/[0.05]'
                      }`}
                    >
                      <span className="truncate">{lang.label}</span>
                    </button>
                  );
                })}
              </ManualDropdown>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isBusy || !activePageId || manualPageBubbles.length === 0}
                onClick={() => activePageId && void extractPage(activePageId)}
                className={`${ACTION_PILL_BASE} flex-1 bg-[#121317] border-sky-400/20 hover:bg-sky-500/10 hover:border-sky-400/40 text-zinc-200`}
              >
                <ScanText className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
                <span>Extract Page</span>
              </button>

              <span className="w-px h-3.5 bg-white/[0.08] shrink-0" aria-hidden="true" />

              {isExtracting ? (
                <button
                  type="button"
                  onClick={cancelOcr}
                  className={`${ACTION_PILL_BASE} flex-1 bg-rose-600 hover:bg-rose-500 border-rose-400/30 text-white`}
                >
                  <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Cancel OCR</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isBusy || pages.length === 0}
                  onClick={() => void extractAll(pages)}
                  className={`${ACTION_PILL_BASE} flex-1 bg-sky-500/18 hover:bg-sky-500/28 border-sky-400/35 hover:border-sky-400/55 text-sky-100`}
                >
                  <ScanText className="w-3.5 h-3.5 text-sky-300 shrink-0" aria-hidden="true" />
                  <span>Extract All</span>
                </button>
              )}
            </div>

            {missingModelInfo && (
              <div className="p-2 rounded bg-amber-950/70 border border-amber-500/40 text-[11px] text-amber-100 space-y-1.5">
                <div>{missingModelInfo.message}</div>
                <div className="flex items-center gap-2">
                  {missingModelInfo.canDownload && (
                    <button
                      type="button"
                      disabled={missingModelInfo.downloading}
                      onClick={() => void downloadMissingModel()}
                      className="px-2 py-0.5 rounded bg-amber-400 hover:bg-amber-300 text-zinc-950 font-semibold cursor-pointer"
                    >
                      {missingModelInfo.downloading ? 'Downloading...' : 'Download Model'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={clearError}
                    className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 4. Separate Gemini Translation */}
          <div className="space-y-1.5 pt-2 border-t border-white/[0.08]">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Translation (Gemini)
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isBusy || !activePageId || !hasExtractedOnPage}
                onClick={() =>
                  activePageId && void translatePage(projectId, chapterId, pages, activePageId)
                }
                className={`${ACTION_PILL_BASE} flex-1 bg-[#121317] border-emerald-400/20 hover:bg-emerald-500/10 hover:border-emerald-400/40 text-zinc-200`}
              >
                <Languages className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                <span>Translate Page</span>
              </button>

              <span className="w-px h-3.5 bg-white/[0.08] shrink-0" aria-hidden="true" />

              {isTranslating ? (
                <button
                  type="button"
                  onClick={cancelTranslation}
                  className={`${ACTION_PILL_BASE} flex-1 bg-rose-600 hover:bg-rose-500 border-rose-400/30 text-white`}
                >
                  <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Cancel</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isBusy || pages.length === 0}
                  onClick={() => void translateAll(projectId, chapterId, pages, false)}
                  className={`${ACTION_PILL_BASE} flex-1 bg-emerald-500/18 hover:bg-emerald-500/28 border-emerald-400/35 hover:border-emerald-400/55 text-emerald-100`}
                >
                  <Languages className="w-3.5 h-3.5 text-emerald-300 shrink-0" aria-hidden="true" />
                  <span>Translate All</span>
                </button>
              )}
            </div>

            {failedTranslationCount > 0 && !isBusy && (
              <button
                type="button"
                onClick={() => void translateAll(projectId, chapterId, pages, true)}
                className={`${ACTION_PILL_BASE} w-full bg-rose-600 hover:bg-rose-500 border-rose-400/30 text-white font-semibold`}
              >
                <RotateCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Retry Failed ({failedTranslationCount})</span>
              </button>
            )}
          </div>

          {/* 5. Compact Icon Undo / Redo & Scoped Clear Actions */}
          <div className="pt-2 border-t border-white/[0.08]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 shrink-0" role="group" aria-label="History">
                <button
                  type="button"
                  disabled={!canUndo}
                  onClick={() => activePageId && undoBubbleAction(activePageId)}
                  aria-label="Undo"
                  title="Undo (Ctrl+Z)"
                  className={ICON_PILL_BASE}
                >
                  <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={!canRedo}
                  onClick={() => activePageId && redoBubbleAction(activePageId)}
                  aria-label="Redo"
                  title="Redo (Ctrl+Y)"
                  className={ICON_PILL_BASE}
                >
                  <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  disabled={isBusy || manualPageBubbles.length === 0}
                  onClick={() =>
                    activePageId &&
                    void clearManualSelections(
                      'page',
                      activePageId,
                      pages.map((p) => p.id)
                    )
                  }
                  title="Clear manual selections on this page only"
                  className={`${ACTION_PILL_BASE} bg-[#121317] border-rose-400/20 hover:bg-rose-500/10 hover:border-rose-400/40 text-zinc-300 hover:text-rose-100`}
                >
                  <Eraser className="w-3.5 h-3.5 text-rose-400/85 shrink-0" aria-hidden="true" />
                  <span>Clear Page</span>
                </button>

                <span className="w-px h-3.5 bg-white/[0.08] shrink-0" aria-hidden="true" />

                {confirmClearAll ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      setConfirmClearKey(null);
                      void clearManualSelections(
                        'chapter',
                        activePageId,
                        pages.map((p) => p.id)
                      );
                    }}
                    className={`${ACTION_PILL_BASE} bg-rose-600 hover:bg-rose-500 border-rose-400/40 text-white font-semibold`}
                  >
                    <span>Confirm Clear</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy || pages.length === 0}
                    onClick={() => setConfirmClearKey(currentConfirmKey)}
                    title="Clear manual selections across this chapter (preserves automatic scans)"
                    className={`${ACTION_PILL_BASE} bg-rose-500/14 hover:bg-rose-500/24 border-rose-400/30 hover:border-rose-400/50 text-rose-200 hover:text-rose-100`}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-300 shrink-0" aria-hidden="true" />
                    <span>Clear All</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 6. Operational Status Bar */}
        <div className="pt-2 border-t border-white/[0.08] flex items-center justify-between gap-2 text-[11px] font-mono">
          <span
            className={`truncate ${
              phase === 'extraction_failed' || phase === 'translation_failed'
                ? 'text-rose-400'
                : phase === 'extraction_completed' || phase === 'translation_completed'
                  ? 'text-emerald-400'
                  : phase === 'extracting' || phase === 'translating'
                    ? 'text-sky-400'
                    : 'text-zinc-400'
            }`}
            title={errorMessage || statusMessage}
          >
            {errorMessage && (phase === 'extraction_failed' || phase === 'translation_failed')
              ? `${statusMessage}: ${errorMessage}`
              : statusMessage}
          </span>
        </div>
      </div>
    </FloatingWindow>
  );
};
