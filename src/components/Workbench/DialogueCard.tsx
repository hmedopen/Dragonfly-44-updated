import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { BubbleItem } from '../../types/workbench';
import { BUBBLE_TYPE_CONFIG, REVIEW_CATEGORY_LABELS } from '../../types/workbench';
import { loadTyperSettings } from '../../types/typers';
import { focusRegistry } from '../../lib/focusRegistry';
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

interface DialogueCardProps {
  bubble: BubbleItem;
  isSelected: boolean;
  onSelect: (bubbleId: string) => void;
  onFocusBubble?: (bubble: BubbleItem) => void;
  onUpdate: (bubbleId: string, patch: Partial<BubbleItem>) => void;
  onDelete: (bubbleId: string) => void;
  onSplitBubble?: (bubbleId: string, splitIndex: number) => void;
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
  onSelect,
  onFocusBubble,
  onUpdate,
  onDelete,
  onSplitBubble,
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
  const dropdownRef = useRef<HTMLDivElement>(null);

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
  }, [bubble.sourceText]);

  // Auto-resize translation textarea when value changes
  useEffect(() => {
    autoResize(translationTextareaRef.current);
  }, [bubble.translatedText]);

  // Listen to typer settings updates dynamically
  const [typerSettings, setTyperSettings] = useState(() => loadTyperSettings());

  useEffect(() => {
    const handleSettingsUpdate = () => {
      setTyperSettings(loadTyperSettings());
    };
    window.addEventListener('dragonfly44_typer_settings_updated', handleSettingsUpdate);
    return () => window.removeEventListener('dragonfly44_typer_settings_updated', handleSettingsUpdate);
  }, []);

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
    // Fallback to legacy config if present
    const legacy = BUBBLE_TYPE_CONFIG[bubble.type as keyof typeof BUBBLE_TYPE_CONFIG];
    return legacy ? legacy.label : bubble.type;
  }, [currentTyper, bubble.type]);

  const currentPrefixDisplay = useMemo(() => {
    if (currentTyper) return currentTyper.prefix;
    if (bubble.type === 'none' || !bubble.type) return '';
    return bubble.typerPrefix || '';
  }, [currentTyper, bubble.type, bubble.typerPrefix]);

  const canRevertSource = Boolean(
    bubble.originalSourceText && bubble.sourceText !== bubble.originalSourceText
  );
  const canRevertTranslation = Boolean(
    (bubble.humanizedTranslatedText && bubble.translatedText !== bubble.humanizedTranslatedText) ||
    (bubble.rawTranslatedText && bubble.translatedText !== bubble.rawTranslatedText)
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

  const handleSourceInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onUpdate(bubble.id, { sourceText: e.target.value });
    autoResize(e.target);
  }, [bubble.id, onUpdate]);

  const handleTranslationInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onUpdate(bubble.id, { translatedText: e.target.value });
    autoResize(e.target);
  }, [bubble.id, onUpdate]);

  const handleSplitClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onSplitBubble) return;

    const textarea = sourceTextareaRef.current;
    const text = bubble.sourceText || '';
    if (!textarea) return;

    const selStart = textarea.selectionStart;

    if (selStart !== null && selStart > 0 && selStart < text.length) {
      setSplitTip(null);
      onSplitBubble(bubble.id, selStart);
    } else {
      setSplitTip('Place cursor in raw dialogue where you want to split.');
      textarea.focus();
      setTimeout(() => {
        setSplitTip(null);
      }, 4000);
    }
  }, [bubble.id, bubble.sourceText, onSplitBubble]);

  return (
    <div
      ref={cardRef}
      onClick={() => onSelect(bubble.id)}
      onDragEnter={(e) => onDragEnter(e, index)}
      onDragOver={(e) => e.preventDefault()}
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
          <div className="px-2.5 py-0.5 rounded-full bg-[#181920] border border-white/5 flex items-center justify-center">
            <span className="font-sans text-xs font-semibold text-zinc-300">
              #{paddedIndex}
            </span>
          </div>

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
              <div className="absolute left-0 top-full mt-1.5 w-52 max-h-64 overflow-y-auto rounded-xl bg-[#181920] border border-white/[0.12] shadow-2xl z-50 py-1.5 custom-scrollbar animate-in fade-in zoom-in-95 duration-100">
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
                  return (
                    <button
                      key={typer.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTypeSelect(typer.id, typer.prefix);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-xs font-sans flex items-center justify-between transition-colors cursor-pointer ${
                        isCurrent
                          ? 'bg-sky-500/20 text-sky-300 font-semibold'
                          : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                      }`}
                    >
                      <span className="truncate pr-2">{typer.name}</span>
                      <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                        {typer.prefix || '""'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Header Flag Indicator — no count */}
          {hasFlags && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400 text-black text-[10px] font-bold">
              <span>FLAGGED</span>
            </span>
          )}
        </div>

        {/* Right: Translate Button [Languages], Camera Focus & Zoom Button [👁], Delete Button [🗑] */}
        <div className="flex items-center gap-2.5 text-zinc-400">
          {/* Translate Single Bubble Button */}
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

          {/* Camera Focus & Zoom Button [👁] */}
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
            title="Focus page and zoom on canvas bubble"
            className="hover:text-white transition-colors cursor-pointer p-0.5"
          >
            <Eye className="w-4 h-4" />
          </button>

          {/* Delete Button [🗑] */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(bubble.id);
            }}
            title="Delete card"
            className="hover:text-red-400 transition-colors cursor-pointer p-0.5"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Card Body: Source Text Box & RTL Translation Box */}
      <div className="flex flex-col gap-3">
        {/* Source Text Box */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              RAW / SOURCE DIALOGUE
            </label>
            <div className="flex items-center gap-2">
              {onSplitBubble && (
                <button
                  type="button"
                  onClick={handleSplitClick}
                  className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-sky-300 cursor-pointer transition-colors px-1.5 py-0.5 rounded border border-transparent hover:border-sky-500/20 hover:bg-sky-500/10"
                  title="Place cursor in raw dialogue and click to split this bubble into two records"
                >
                  <Scissors className="w-2.5 h-2.5" />
                  <span>Split Bubble</span>
                </button>
              )}
              {canRevertSource && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRevertSource?.();
                  }}
                  className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 cursor-pointer transition-colors"
                  title="Restore initial scanned source text"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>Revert</span>
                </button>
              )}
            </div>
          </div>
          {splitTip && (
            <div className="mb-1.5 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-md">
              {splitTip}
            </div>
          )}
          <div className="rounded-xl bg-[#08080a] border border-white/[0.05] focus-within:border-white/[0.18] transition-colors px-3.5 py-2.5">
            <textarea
              ref={sourceTextareaRef}
              dir="auto"
              rows={1}
              value={bubble.sourceText}
              onChange={handleSourceInput}
              onClick={(e) => e.stopPropagation()}
              placeholder="Type or paste source dialogue..."
              className="w-full bg-transparent text-zinc-200 placeholder-zinc-600 focus:outline-none text-xs leading-relaxed resize-none font-sans block overflow-hidden"
            />
          </div>
        </div>

        {/* Translation Box */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              ARABIC TRANSLATION
            </label>
            {canRevertTranslation && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRevertTranslation?.();
                }}
                className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 cursor-pointer transition-colors"
                title="Restore prior translation version without losing edit history"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>{revertTranslationLabel}</span>
              </button>
            )}
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl bg-[#08080a] border border-white/[0.05] focus-within:border-white/[0.18] transition-colors px-3.5 py-2.5"
          >
            <textarea
              ref={translationTextareaRef}
              dir="rtl"
              rows={1}
              value={bubble.translatedText}
              onFocus={() => focusRegistry.register(translationTextareaRef.current)}
              onChange={handleTranslationInput}
              placeholder="اكتب الترجمة العربية هنا..."
              className="w-full bg-transparent text-zinc-100 placeholder-zinc-600 focus:outline-none font-sans text-sm leading-relaxed text-right resize-none block overflow-hidden"
            />
          </div>
        </div>

        {/* 3. Multi-Flag Review Container */}
        {hasFlags && (
          <div className="mt-1 pt-2.5 border-t border-white/[0.06] flex flex-col gap-2">

            {/* Flag Pills row — Accept/Dismiss sit inline on the same line */}
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

                    {/* Accept / Dismiss inline — same height as the flag pill, only shown when pill is active */}
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

            {/* Expanded Flag Detail — reason plain, suggested fix in translation-style box */}
            {effectiveExpandedFlagId && (() => {
              const currentFlag = flags.find((f) => f.id === effectiveExpandedFlagId);
              if (!currentFlag) return null;

              return (
                <div className="flex flex-col gap-2">
                  {/* Reason — plain RTL text, no box */}
                  <p
                    dir="rtl"
                    className="text-zinc-300 text-sm leading-relaxed text-right font-sans"
                  >
                    {currentFlag.reasonAr}
                  </p>

                  {/* Evidence — visual cue from artwork or text */}
                  {currentFlag.evidence && (
                    <p className="text-[11px] text-zinc-400 font-mono italic">
                      Evidence: {currentFlag.evidence}
                    </p>
                  )}

                  {/* Suggested fix — in a box identical to the Arabic translation box */}
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
