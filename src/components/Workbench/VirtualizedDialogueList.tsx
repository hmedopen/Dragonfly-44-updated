import React, { useRef, useEffect } from 'react';
import type { BubbleItem } from '../../types/workbench';
import { DialogueCard } from './DialogueCard';

interface VirtualizedDialogueListProps {
  bubbles: BubbleItem[];
  selectedBubbleId: string | null;
  activeEyeBubbleId?: string | null;
  onSelectBubble: (bubbleId: string) => void;
  onFocusBubble?: (bubble: BubbleItem) => void;
  onUpdateBubble: (bubbleId: string, patch: Partial<BubbleItem>) => void;
  onDeleteBubble: (bubbleId: string) => void;
  onSplitBubble?: (bubbleId: string, splitIndex: number) => void;
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
  onTranslateBubble?: (bubbleId: string) => Promise<void>;
  onAcceptFlag: (bubbleId: string, flagId: string) => void;
  onDismissFlag: (bubbleId: string, flagId: string) => void;
  onRevertSource: (bubbleId: string) => void;
  onRevertTranslation: (bubbleId: string) => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragEnter: (e: React.DragEvent, index: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

export const VirtualizedDialogueList: React.FC<VirtualizedDialogueListProps> = ({
  bubbles,
  selectedBubbleId,
  activeEyeBubbleId,
  onSelectBubble,
  onFocusBubble,
  onUpdateBubble,
  onDeleteBubble,
  onSplitBubble,
  onTransferText,
  onTranslateBubble,
  onAcceptFlag,
  onDismissFlag,
  onRevertSource,
  onRevertTranslation,
  onDragStart,
  onDragEnter,
  onDragEnd,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardElementsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const lastScrolledBubbleId = useRef<string | null>(null);

  // Smoothly scroll to selected bubble ONLY when selection changes from outside (e.g. clicking canvas)
  useEffect(() => {
    if (!selectedBubbleId) {
      lastScrolledBubbleId.current = null;
      return;
    }

    if (selectedBubbleId !== lastScrolledBubbleId.current) {
      lastScrolledBubbleId.current = selectedBubbleId;
      const targetCard = cardElementsRef.current[selectedBubbleId];
      if (targetCard) {
        targetCard.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }
  }, [selectedBubbleId]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 px-2 py-1 overflow-y-auto custom-scrollbar flex flex-col gap-3 select-none"
    >
      {bubbles.map((bubble, index) => (
        <div
          key={bubble.id}
          ref={(el) => {
            cardElementsRef.current[bubble.id] = el;
          }}
          className="w-full shrink-0"
        >
          <DialogueCard
            bubble={bubble}
            index={index}
            isSelected={selectedBubbleId === bubble.id}
            isEyeActive={activeEyeBubbleId === bubble.id}
            onSelect={onSelectBubble}
            onFocusBubble={onFocusBubble}
            onUpdate={onUpdateBubble}
            onDelete={onDeleteBubble}
            onSplitBubble={onSplitBubble}
            onTransferText={onTransferText}
            onTranslate={onTranslateBubble}
            onAcceptFlag={(flagId) => onAcceptFlag(bubble.id, flagId)}
            onDismissFlag={(flagId) => onDismissFlag(bubble.id, flagId)}
            onRevertSource={() => onRevertSource(bubble.id)}
            onRevertTranslation={() => onRevertTranslation(bubble.id)}
            onDragStart={onDragStart}
            onDragEnter={onDragEnter}
            onDragEnd={onDragEnd}
          />
        </div>
      ))}
    </div>
  );
};
