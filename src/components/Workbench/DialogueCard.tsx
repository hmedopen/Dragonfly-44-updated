import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { BubbleItem } from '../../types/workbench';
import { BUBBLE_TYPE_CONFIG, REVIEW_CATEGORY_LABELS } from '../../types/workbench';
import { focusRegistry } from '../../lib/focusRegistry';
import { internalTextDrag, type TextDragPayload } from '../../lib/internalTextDrag';
import { useConfirmationSetting } from '../../lib/confirmation';
import { 
  Eye, 
  Trash2, 
  GripVertical, 
  ChevronDown, 
  ChevronUp,
  Check, 
  X, 
  RotateCcw,
  HelpCircle,
  Languages,
  Scissors
} from 'lucide-react';
import {
  deriveFallbackTyperColor,
  formatTyperSymbol,
  normalizeHexColor,
  resolveTyperVisual,
} from '../../types/typers';
import { TyperSymbolBadge } from '../../features/manual-selection/components/TyperSymbolBadge';
import { useTyperSettings } from '../../features/manual-selection/symbols/useTyperSettings';

interface DialogueCardProps {
  bubble: BubbleItem;
  isSelected: boolean;
  isEyeActive?: boolean;
  onSelect: (bubbleId: string) => void;
  onFocusBubble?: (bubble: BubbleItem) => void;
  onUpdate: (bubbleId: string, patch: Partial<BubbleItem>) => void;
  onDelete: (bubbleId: string) => void;
  onSplitBubble?: (bubbleId: string, splitIndex: number, field?: 'sourceText' | 'translatedText') => void;
  onTransferText?: (params: {
    sourceBubbleId: string;
    sourceField: 'sourceText' | 'translatedText';
    sourceStart: number;
    sourceEnd: number;
    destBubbleId: string;
    destField: 'sourceText' | 'translatedText';
    dropPos: number;
    transferredText: string;
  }) => void;
  onTranslate?: (bubbleId: string) => Promise<void>;
  onAcceptFlag?: (flagId: string) => void;
  onDismissFlag?: (flagId: string) => void;
  onRevertSource?: () => void;
  onRevertTranslation?: () => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragEnter: (e: React.DragEvent, index: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
  index: number;
}

/** Auto-resize a textarea to fit its content. */
function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export const DialogueCard: React.FC<DialogueCardProps> = ({
  bubble,
  isSelected,
  isEyeActive = false,
  onSelect,
  onFocusBubble,
  onUpdate,
  onDelete,
  onSplitBubble,
  onTransferText,
  onTranslate,
  onAcceptFlag,
  onDismissFlag,
  onRevertSource,
  onRevertTranslation,
  onDragStart,
  onDragEnter,
  onDragEnd,
  index,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const translationTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [splitTip, setSplitTip] = useState<string | null>(null);
  const [lastFocusedField, setLastFocusedField] = useState<'source' | 'translation' | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Phase 1.2: Local draft state for robust Save/Revert controls and automatic cancellation
  const [draftSourceText, setDraftSourceText] = useState(bubble.sourceText || '');
  const [draftTranslatedText, setDraftTranslatedText] = useState(bubble.translatedText || '');

  // Keep draft in sync with external bubble updates
  useEffect(() => {
    setDraftSourceText(bubble.sourceText || '');
  }, [bubble.sourceText]);

  useEffect(() => {
    setDraftTranslatedText(bubble.translatedText || '');
  }, [bubble.translatedText]);

  const isSourceDirty = draftSourceText !== (bubble.sourceText || '');
  const isTranslationDirty = draftTranslatedText !== (bubble.translatedText || '');

  // System #6 Unified Confirmation Setting (Delete action remains confirmable)
  const isConfirmationEnabled = useConfirmationSetting();
  const [isArmedDeleteBubble, setIsArmedDeleteBubble] = useState(false);

  // Review flags expansion: OPEN by default when flags appear, only closes on click
  const [selectedFlagId, setSelectedFlagId] = useState<string | null>(null);
  const [closedFlagIds, setClosedFlagIds] = useState<Record<string, boolean>>({});

  const flags = bubble.reviewFlags || [];
  const hasFlags = flags.length > 0;

  const effectiveExpandedFlagId = useMemo(() => {
    if (!flags || flags.length === 0) return null;
    const candidateId = selectedFlagId && flags.some((f) => f.id === selectedFlagId)
      ? selectedFlagId
      : flags[0].id;
    if (closedFlagIds[candidateId]) {
      return null;
    }
    return candidateId;
  }, [flags, selectedFlagId, closedFlagIds]);

  // Auto-resize source textarea when value changes
  useEffect(() => {
    autoResize(sourceTextareaRef.current);
  }, [draftSourceText]);

  // Auto-resize translation textarea when value changes
  useEffect(() => {
    autoResize(translationTextareaRef.current);
  }, [draftTranslatedText]);

  // Listen to shared Workspace typer settings updates dynamically
  const typerSettings = useTyperSettings();
  const bubbleTyperVisual = resolveTyperVisual(bubble, typerSettings.typers);

  // Close type dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsTypeDropdownOpen(false);
      }
    };
    if (isTypeDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [isTypeDropdownOpen]);

  const paddedIndex = String(bubble.index).padStart(2, '0');

  // Find active typer configuration from settings
  const currentTyper = useMemo(() => {
    if (!bubble.type || bubble.type === 'none') return null;
    return typerSettings.typers.find((t) => t.id === bubble.type) || null;
  }, [bubble.type, typerSettings]);

  const currentLabel = useMemo(() => {
    if (currentTyper) return currentTyper.name;
    if (bubble.type === 'none' || !bubble.type) return 'None';
    const legacy = BUBBLE_TYPE_CONFIG[bubble.type as keyof typeof BUBBLE_TYPE_CONFIG];
    return legacy ? legacy.label : bubble.type;
  }, [currentTyper, bubble.type]);

  const currentPrefixDisplay = useMemo(() => {
    if (currentTyper) return currentTyper.prefix;
    if (bubble.type === 'none' || !bubble.type) return '';
    return bubble.typerPrefix || '';
  }, [currentTyper, bubble.type, bubble.typerPrefix]);

  const canRevertSource = Boolean(
    !isSourceDirty && bubble.originalSourceText && bubble.sourceText !== bubble.originalSourceText
  );
  const canRevertTranslation = Boolean(
    !isTranslationDirty &&
    ((bubble.humanizedTranslatedText && bubble.translatedText !== bubble.humanizedTranslatedText) ||
     (bubble.rawTranslatedText && bubble.translatedText !== bubble.rawTranslatedText))
  );

  const revertTranslationLabel = useMemo(() => {
    if (bubble.humanizedTranslatedText && bubble.translatedText !== bubble.humanizedTranslatedText) {
      return 'Revert (Humanized)';
    }
    if (bubble.rawTranslatedText && bubble.translatedText !== bubble.rawTranslatedText) {
      return 'Revert (Raw)';
    }
    return 'Revert';
  }, [bubble.translatedText, bubble.humanizedTranslatedText, bubble.rawTranslatedText]);

  const handleTypeSelect = (typeKey: string, prefix: string) => {
    onUpdate(bubble.id, {
      type: typeKey,
      typerPrefix: prefix,
    });
    setIsTypeDropdownOpen(false);
  };

  const handleTranslate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTranslating || !onTranslate) return;
    setIsTranslating(true);
    try {
      await onTranslate(bubble.id);
    } catch (err: any) {
      alert(`Translation error: ${err?.message || 'Failed to translate bubble'}`);
    } finally {
      setIsTranslating(false);
    }
  };

  const toggleFlagExpanded = (flagId: string) => {
    if (effectiveExpandedFlagId === flagId) {
      setClosedFlagIds((prev) => ({ ...prev, [flagId]: true }));
      setSelectedFlagId(null);
    } else {
      setClosedFlagIds((prev) => ({ ...prev, [flagId]: false }));
      setSelectedFlagId(flagId);
    }
  };

  // Input change handlers
  const handleSourceInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraftSourceText(e.target.value);
    autoResize(e.target);
  }, []);

  const handleTranslationInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraftTranslatedText(e.target.value);
    autoResize(e.target);
  }, []);

  // Save / Revert actions (Single-click execution per Requirement 6)
  const handleSaveSourceClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdate(bubble.id, { sourceText: draftSourceText, isManuallyEdited: true });
  }, [bubble.id, draftSourceText, onUpdate]);

  const handleRevertSourceDraftClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftSourceText(bubble.sourceText || '');
    if (sourceTextareaRef.current) {
      sourceTextareaRef.current.value = bubble.sourceText || '';
      autoResize(sourceTextareaRef.current);
    }
  }, [bubble.sourceText]);

  const handleRevertSourceHistoryClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRevertSource?.();
  }, [onRevertSource]);

  const handleSaveTranslationClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdate(bubble.id, { translatedText: draftTranslatedText, isManuallyEdited: true });
  }, [bubble.id, draftTranslatedText, onUpdate]);

  const handleRevertTranslationDraftClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftTranslatedText(bubble.translatedText || '');
    if (translationTextareaRef.current) {
      translationTextareaRef.current.value = bubble.translatedText || '';
      autoResize(translationTextareaRef.current);
    }
  }, [bubble.translatedText]);

  const handleRevertTranslationHistoryClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRevertTranslation?.();
  }, [onRevertTranslation]);

  const handleDeleteBubbleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isConfirmationEnabled) {
      setIsArmedDeleteBubble(false);
      onDelete(bubble.id);
      return;
    }
    if (isArmedDeleteBubble) {
      setIsArmedDeleteBubble(false);
      onDelete(bubble.id);
    } else {
      setIsArmedDeleteBubble(true);
    }
  }, [isConfirmationEnabled, isArmedDeleteBubble, bubble.id, onDelete]);

  // Phase 1.4: Split Bubble handler supporting both English and Arabic text
  const handleSplitClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onSplitBubble) return;

    const sourceEl = sourceTextareaRef.current;
    const transEl = translationTextareaRef.current;

    const sourceSel = sourceEl?.selectionStart ?? null;
    const transSel = transEl?.selectionStart ?? null;

    const isSourceValid = sourceSel !== null && sourceSel > 0 && sourceSel < draftSourceText.length;
    const isTransValid = transSel !== null && transSel > 0 && transSel < draftTranslatedText.length;

    // Determine target based on active focus or valid cursor positions
    let targetField: 'sourceText' | 'translatedText' | null = null;
    let splitPos: number | null = null;

    if (lastFocusedField === 'translation') {
      if (isTransValid) {
        targetField = 'translatedText';
        splitPos = transSel;
      } else if (isSourceValid) {
        targetField = 'sourceText';
        splitPos = sourceSel;
      }
    } else if (lastFocusedField === 'source') {
      if (isSourceValid) {
        targetField = 'sourceText';
        splitPos = sourceSel;
      } else if (isTransValid) {
        targetField = 'translatedText';
        splitPos = transSel;
      }
    } else {
      if (isTransValid && !isSourceValid) {
        targetField = 'translatedText';
        splitPos = transSel;
      } else if (isSourceValid) {
        targetField = 'sourceText';
        splitPos = sourceSel;
      }
    }

    if (targetField && splitPos !== null) {
      setSplitTip(null);
      if (targetField === 'translatedText') {
        if (draftTranslatedText !== (bubble.translatedText || '')) {
          onUpdate(bubble.id, { translatedText: draftTranslatedText, isManuallyEdited: true });
        }
        onSplitBubble(bubble.id, splitPos, 'translatedText');
      } else {
        if (draftSourceText !== (bubble.sourceText || '')) {
          onUpdate(bubble.id, { sourceText: draftSourceText, isManuallyEdited: true });
        }
        onSplitBubble(bubble.id, splitPos, 'sourceText');
      }
    } else {
      setSplitTip('Place cursor in raw dialogue or translation where you want to split.');
      if (lastFocusedField === 'translation' && transEl) {
        transEl.focus();
      } else if (sourceEl) {
        sourceEl.focus();
      }
      setTimeout(() => {
        setSplitTip(null);
      }, 4000);
    }
  }, [
    bubble.id,
    bubble.sourceText,
    bubble.translatedText,
    draftSourceText,
    draftTranslatedText,
    lastFocusedField,
    onSplitBubble,
    onUpdate,
  ]);

  // Phase 1.1: Internal Text Drag & Drop handlers
  const handleTextareaDragStart = (
    e: React.DragEvent<HTMLTextAreaElement>,
    field: 'sourceText' | 'translatedText'
  ) => {
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === null || end === null || start === end) {
      e.preventDefault();
      return;
    }
    const selected = el.value.slice(start, end);
    if (!selected) {
      e.preventDefault();
      return;
    }

    const payload: TextDragPayload = {
      sourceBubbleId: bubble.id,
      sourceField: field,
      selectedText: selected,
      rangeStart: start,
      rangeEnd: end,
    };

    internalTextDrag.startDrag(payload);
    e.dataTransfer.setData('application/x-folio-text-drag', JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', selected);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleTextareaDragEnd = () => {
    internalTextDrag.endDrag();
  };

  const handleTextareaDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (internalTextDrag.isDragging() || e.dataTransfer.types.includes('application/x-folio-text-drag')) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleTextareaDrop = (
    e: React.DragEvent<HTMLTextAreaElement>,
    destField: 'sourceText' | 'translatedText'
  ) => {
    if (!internalTextDrag.isDragging() && !e.dataTransfer.types.includes('application/x-folio-text-drag')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    let dragData = internalTextDrag.getActiveDrag();
    if (!dragData) {
      try {
        const raw = e.dataTransfer.getData('application/x-folio-text-drag');
        if (raw) dragData = JSON.parse(raw);
      } catch {}
    }

    if (!dragData) {
      internalTextDrag.endDrag();
      return;
    }

    const targetEl = e.currentTarget;
    let dropPos = targetEl.value.length;

    if ((document as any).caretPositionFromPoint) {
      const pos = (document as any).caretPositionFromPoint(e.clientX, e.clientY);
      if (pos && typeof pos.offset === 'number') {
        dropPos = pos.offset;
      }
    } else if ((document as any).caretRangeFromPoint) {
      const range = (document as any).caretRangeFromPoint(e.clientX, e.clientY);
      if (range && typeof range.startOffset === 'number') {
        dropPos = range.startOffset;
      }
    } else if (typeof targetEl.selectionStart === 'number') {
      dropPos = targetEl.selectionStart;
    }

    dropPos = Math.max(0, Math.min(targetEl.value.length, dropPos));

    if (onTransferText) {
      onTransferText({
        sourceBubbleId: dragData.sourceBubbleId,
        sourceField: dragData.sourceField,
        sourceStart: dragData.rangeStart,
        sourceEnd: dragData.rangeEnd,
        destBubbleId: bubble.id,
        destField,
        dropPos,
        transferredText: dragData.selectedText,
      });
    }

    internalTextDrag.endDrag();
  };

  return (
    <div
      ref={cardRef}
      onClick={() => onSelect(bubble.id)}
      onDragEnter={(e) => {
        if (internalTextDrag.isDragging()) return;
        onDragEnter(e, index);
      }}
      onDragOver={(e) => {
        if (internalTextDrag.isDragging()) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
      }}
      className={`group/card relative rounded-2xl border transition-all duration-150 select-none p-4 ${
        isSelected
          ? 'bg-[#14151a] border-sky-500/70 shadow-[0_0_24px_rgba(56,189,248,0.12)] ring-1 ring-sky-500/30'
          : hasFlags
          ? 'bg-[#111215] border-amber-500/35 hover:border-amber-500/50'
          : 'bg-[#101114] border-white/[0.08] hover:border-white/[0.14] hover:bg-[#131418]'
      }`}
    >
      {/* 1. Card Top Action & Metadata Header */}
      <div className="flex items-center justify-between mb-3">
        {/* Left: Drag Handle, Index Chip, Type Selector, FLAGGED badge */}
        <div className="flex items-center gap-2">
          {/* Drag Handle */}
          <div
            draggable
            onDragStart={(e) => onDragStart(e, index)}
            onDragEnd={onDragEnd}
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder dialogue card"
            className="flex items-center justify-center p-1 rounded-md text-zinc-500 hover:text-zinc-200 cursor-grab active:cursor-grabbing transition-colors"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          {/* Index Chip #01 */}
          <div className="px-2.5 py-0.5 rounded-full bg-[#181920] border border-white/5 flex items-center justify-center shrink-0">
            <span className="font-sans text-xs font-semibold text-zinc-300">
              #{paddedIndex}
            </span>
          </div>

          {/* Solid Colored Box with Actual Typer Symbol (Shared across Manual & Automatic Records) */}
          {bubbleTyperVisual.isClassified && (
            <TyperSymbolBadge
              symbol={bubbleTyperVisual.symbol}
              color={bubbleTyperVisual.color}
              title={`${bubbleTyperVisual.name} (${bubbleTyperVisual.symbol})`}
            />
          )}

          {bubble.manualExtractionStatus === 'ocr_running' && (
            <span className="px-1.5 py-0.5 rounded bg-sky-600 text-white text-[10px] font-bold shrink-0">
              OCR
            </span>
          )}
          {bubble.manualExtractionStatus === 'ocr_failed' && (
            <span
              title={bubble.manualExtractionError || 'Local OCR failed'}
              className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold shrink-0"
            >
              OCR FAILED
            </span>
          )}
          {bubble.manualTranslationStatus === 'translation_failed' && (
            <span
              title={bubble.manualTranslationError || 'Translation failed'}
              className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold shrink-0"
            >
              TRANS FAILED
            </span>
          )}

          {/* Bubble Type Dropdown Pill */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsTypeDropdownOpen((prev) => !prev);
              }}
              className="flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[#181920] hover:bg-[#20222a] text-zinc-300 border border-white/5 text-xs transition-colors cursor-pointer"
            >
              <span className="font-medium">
                {currentLabel}
              </span>
              {currentPrefixDisplay && (
                <span className="text-[10px] text-zinc-500 font-mono">
                  {currentPrefixDisplay}
                </span>
              )}
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>

            {isTypeDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-56 max-h-64 overflow-y-auto rounded-xl bg-[#181920] border border-white/[0.12] shadow-2xl z-50 py-1.5 custom-scrollbar animate-in fade-in zoom-in-95 duration-100">
                {/* Option: None */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTypeSelect('none', '');
                  }}
                  className={`w-full px-3 py-1.5 text-left text-xs font-sans flex items-center justify-between transition-colors cursor-pointer ${
                    bubble.type === 'none' || !bubble.type
                      ? 'bg-sky-500/20 text-sky-300 font-semibold'
                      : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                  }`}
                >
                  <span>None</span>
                  <span className="text-[10px] text-zinc-500 font-mono">Untyped</span>
                </button>

                {/* All dynamically configured typers from settings */}
                {typerSettings.typers.map((typer) => {
                  const isCurrent = bubble.type === typer.id;
                  const tColor = normalizeHexColor(
                    typer.color,
                    deriveFallbackTyperColor(typer.id)
                  );
                  const tSym = formatTyperSymbol(typer.prefix, typer.name);
                  return (
                    <button
                      key={typer.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTypeSelect(typer.id, typer.prefix);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-xs font-sans flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                        isCurrent
                          ? 'bg-sky-500/20 text-sky-300 font-semibold'
                          : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <TyperSymbolBadge symbol={tSym} color={tColor} size="xs" />
                        <span className="truncate">{typer.name}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Header Flag Indicator */}
          {hasFlags && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400 text-black text-[10px] font-bold">
              <span>FLAGGED</span>
            </span>
          )}
        </div>

        {/* Phase 1.4: Unified 4-Action Toolbar: Translate, Eye / Preview, Split Bubble, Delete */}
        <div className="flex items-center gap-2.5 text-zinc-400">
          {/* 1. Translate Single Bubble Button */}
          <button
            type="button"
            onClick={handleTranslate}
            disabled={isTranslating}
            title="Translate this bubble only into Arabic"
            className={`transition-colors cursor-pointer p-0.5 ${
              isTranslating 
                ? 'text-sky-400 animate-pulse' 
                : 'text-zinc-400 hover:text-sky-400'
            }`}
          >
            {isTranslating ? (
              <svg className="w-4 h-4 animate-spin text-sky-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <Languages className="w-4 h-4" />
            )}
          </button>

          {/* 2. Camera Focus & Zoom Button [👁] with reversible visual feedback */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onFocusBubble) {
                onFocusBubble(bubble);
              } else {
                onSelect(bubble.id);
              }
            }}
            title={isEyeActive ? 'Exit focused zoom (Restore previous view)' : 'Focus page and zoom on canvas bubble'}
            className={`transition-colors cursor-pointer p-0.5 ${
              isEyeActive ? 'text-sky-400 drop-shadow-[0_0_6px_rgba(56,189,248,0.5)]' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Eye className="w-4 h-4" />
          </button>

          {/* 3. Split Bubble Button [✂] Moved into action toolbar */}
          {onSplitBubble && (
            <button
              type="button"
              onClick={handleSplitClick}
              title="Place cursor in raw dialogue and click to split this bubble into two records"
              className="text-zinc-400 hover:text-amber-300 transition-colors cursor-pointer p-0.5"
            >
              <Scissors className="w-4 h-4" />
            </button>
          )}

          {/* 4. Delete Button [🗑] with Confirmation Transform */}
          <button
            type="button"
            onClick={handleDeleteBubbleClick}
            onMouseLeave={() => setIsArmedDeleteBubble(false)}
            title={isConfirmationEnabled ? (isArmedDeleteBubble ? "Click again to confirm delete" : "Delete card") : "Delete card"}
            className={`transition-colors cursor-pointer p-0.5 flex items-center gap-1 ${
              isArmedDeleteBubble
                ? 'px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold animate-pulse shadow-sm'
                : 'hover:text-red-400 text-zinc-400'
            }`}
          >
            <Trash2 className="w-4 h-4 pointer-events-none" />
            {isArmedDeleteBubble && <span className="pointer-events-none">Delete?</span>}
          </button>
        </div>
      </div>

      {/* 2. Card Body: Source Text Box & RTL Translation Box */}
      <div className="flex flex-col gap-3">
        {/* Source Text Box */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-1.5 min-h-[22px]">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              RAW / SOURCE DIALOGUE
            </label>
            <div className="flex items-center gap-2">
              {/* Phase 1.2: Inline Save/Revert controls with independent confirmation transform */}
              {isSourceDirty ? (
                <div className="flex items-center gap-1.5 animate-in fade-in duration-100">
                  <button
                    type="button"
                    onClick={handleSaveSourceClick}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors shadow-sm bg-emerald-500 hover:bg-emerald-400 text-black"
                    title="Save changes to source dialogue"
                  >
                    <Check className="w-2.5 h-2.5 stroke-[2.5] pointer-events-none" />
                    <span className="pointer-events-none">Save</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRevertSourceDraftClick}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
                    title="Cancel unsaved source edits"
                  >
                    <X className="w-2.5 h-2.5 pointer-events-none" />
                    <span className="pointer-events-none">Revert</span>
                  </button>
                </div>
              ) : canRevertSource ? (
                <button
                  type="button"
                  onClick={handleRevertSourceHistoryClick}
                  className="flex items-center gap-1 text-[10px] cursor-pointer transition-colors text-amber-400 hover:text-amber-300"
                  title="Restore initial scanned source text"
                >
                  <RotateCcw className="w-2.5 h-2.5 pointer-events-none" />
                  <span className="pointer-events-none">Revert</span>
                </button>
              ) : null}
            </div>
          </div>
          {splitTip && (
            <div className="mb-1.5 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-md animate-in fade-in duration-150">
              {splitTip}
            </div>
          )}
          <div className="rounded-xl bg-[#08080a] border border-white/[0.05] focus-within:border-white/[0.18] transition-colors px-3.5 py-2.5">
            <textarea
              ref={sourceTextareaRef}
              dir="auto"
              rows={1}
              value={draftSourceText}
              onFocus={() => setLastFocusedField('source')}
              onChange={handleSourceInput}
              onDragStart={(e) => handleTextareaDragStart(e, 'sourceText')}
              onDragEnd={handleTextareaDragEnd}
              onDragOver={handleTextareaDragOver}
              onDrop={(e) => handleTextareaDrop(e, 'sourceText')}
              onClick={(e) => e.stopPropagation()}
              placeholder="Type or paste source dialogue..."
              className="w-full bg-transparent text-zinc-200 placeholder-zinc-600 focus:outline-none text-xs leading-relaxed resize-none font-sans block overflow-hidden select-text"
            />
          </div>
        </div>

        {/* Translation Box */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-1.5 min-h-[22px]">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              ARABIC TRANSLATION
            </label>
            <div className="flex items-center gap-2">
              {/* Phase 1.2: Inline Save/Revert controls for pending unsaved translation edits */}
              {isTranslationDirty ? (
                <div className="flex items-center gap-1.5 animate-in fade-in duration-100">
                  <button
                    type="button"
                    onClick={handleSaveTranslationClick}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors shadow-sm bg-emerald-500 hover:bg-emerald-400 text-black"
                    title="Save changes to translation"
                  >
                    <Check className="w-2.5 h-2.5 stroke-[2.5] pointer-events-none" />
                    <span className="pointer-events-none">Save</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRevertTranslationDraftClick}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
                    title="Cancel unsaved translation edits"
                  >
                    <X className="w-2.5 h-2.5 pointer-events-none" />
                    <span className="pointer-events-none">Revert</span>
                  </button>
                </div>
              ) : canRevertTranslation ? (
                <button
                  type="button"
                  onClick={handleRevertTranslationHistoryClick}
                  className="flex items-center gap-1 text-[10px] cursor-pointer transition-colors text-amber-400 hover:text-amber-300"
                  title="Restore prior translation version without losing edit history"
                >
                  <RotateCcw className="w-2.5 h-2.5 pointer-events-none" />
                  <span className="pointer-events-none">{revertTranslationLabel}</span>
                </button>
              ) : null}
            </div>
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl bg-[#08080a] border border-white/[0.05] focus-within:border-white/[0.18] transition-colors px-3.5 py-2.5"
          >
            <textarea
              ref={translationTextareaRef}
              dir="rtl"
              rows={1}
              value={draftTranslatedText}
              onFocus={() => {
                focusRegistry.register(translationTextareaRef.current);
                setLastFocusedField('translation');
              }}
              onChange={handleTranslationInput}
              onDragStart={(e) => handleTextareaDragStart(e, 'translatedText')}
              onDragEnd={handleTextareaDragEnd}
              onDragOver={handleTextareaDragOver}
              onDrop={(e) => handleTextareaDrop(e, 'translatedText')}
              placeholder="اكتب الترجمة العربية هنا..."
              className="w-full bg-transparent text-zinc-100 placeholder-zinc-600 focus:outline-none font-sans text-sm leading-relaxed text-right resize-none block overflow-hidden select-text"
            />
          </div>
        </div>

        {/* 3. Multi-Flag Review Container */}
        {hasFlags && (
          <div className="mt-1 pt-2.5 border-t border-white/[0.06] flex flex-col gap-2">
            {/* Flag Pills row */}
            <div className="flex flex-wrap items-center gap-1.5">
              {flags.map((flag) => {
                const isExpanded = effectiveExpandedFlagId === flag.id;
                const label = REVIEW_CATEGORY_LABELS[flag.category] || `[? ${flag.category.toUpperCase()}]`;
                const currentFlag = flags.find((f) => f.id === flag.id)!;

                return (
                  <React.Fragment key={flag.id}>
                    {/* Flag category pill */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFlagExpanded(flag.id);
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] transition-colors cursor-pointer font-semibold ${
                        isExpanded
                          ? 'bg-amber-500 text-black'
                          : 'bg-amber-400 text-black hover:bg-amber-300'
                      }`}
                    >
                      <HelpCircle className="w-3 h-3" />
                      <span>{label}</span>
                      {isExpanded ? (
                        <ChevronUp className="w-2.5 h-2.5" />
                      ) : (
                        <ChevronDown className="w-2.5 h-2.5" />
                      )}
                    </button>

                    {/* Accept / Dismiss inline */}
                    {isExpanded && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAcceptFlag?.(currentFlag.id);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-bold cursor-pointer transition-colors shrink-0"
                        >
                          <Check className="w-3 h-3" />
                          <span>Accept</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDismissFlag?.(currentFlag.id);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-600 hover:bg-zinc-500 text-white text-[11px] font-medium cursor-pointer transition-colors shrink-0"
                        >
                          <X className="w-3 h-3" />
                          <span>Dismiss</span>
                        </button>
                      </>
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Expanded Flag Detail */}
            {effectiveExpandedFlagId && (() => {
              const currentFlag = flags.find((f) => f.id === effectiveExpandedFlagId);
              if (!currentFlag) return null;

              return (
                <div className="flex flex-col gap-2">
                  <p
                    dir="rtl"
                    className="text-zinc-300 text-sm leading-relaxed text-right font-sans"
                  >
                    {currentFlag.reasonAr}
                  </p>

                  {currentFlag.evidence && (
                    <p className="text-[11px] text-zinc-400 font-mono italic">
                      Evidence: {currentFlag.evidence}
                    </p>
                  )}

                  {currentFlag.suggestedTextAr && (
                    <div className="rounded-xl bg-[#08080a] border border-white/[0.05] px-3.5 py-2.5">
                      <p
                        dir="rtl"
                        className="text-zinc-100 text-sm leading-relaxed text-right font-sans"
                      >
                        {currentFlag.suggestedTextAr}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};
