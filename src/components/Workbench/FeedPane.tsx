import React, { useRef } from 'react';
import type { BubbleItem } from '../../types/workbench';
import type { FeedFilterMode } from '../../store/workbenchStore';
import { VirtualizedDialogueList } from './VirtualizedDialogueList';
import { 
  MessageSquare
} from 'lucide-react';

interface FeedPaneProps {
  bubbles: BubbleItem[];
  selectedBubbleId: string | null;
  feedFilter: FeedFilterMode;
  onSelectBubble: (bubbleId: string) => void;
  onFocusBubble?: (bubble: BubbleItem) => void;
  onUpdateBubble: (bubbleId: string, patch: Partial<BubbleItem>) => void;
  onDeleteBubble: (bubbleId: string) => void;
  onSplitBubble?: (bubbleId: string, splitIndex: number) => void;
  onTranslateBubble?: (bubbleId: string) => Promise<void>;
  onAcceptFlag: (bubbleId: string, flagId: string) => void;
  onDismissFlag: (bubbleId: string, flagId: string) => void;
  onRevertSource: (bubbleId: string) => void;
  onRevertTranslation: (bubbleId: string) => void;
  onAddManualBubble: () => void;
  onReorderBubbles: (startIndex: number, endIndex: number) => void;
  onSetFeedFilter?: (filter: FeedFilterMode) => void;
}

export const FeedPane: React.FC<FeedPaneProps> = ({
  bubbles,
  selectedBubbleId,
  feedFilter,
  onSelectBubble,
  onFocusBubble,
  onUpdateBubble,
  onDeleteBubble,
  onSplitBubble,
  onTranslateBubble,
  onAcceptFlag,
  onDismissFlag,
  onRevertSource,
  onRevertTranslation,
  onAddManualBubble: _onAddManualBubble,
  onReorderBubbles,
}) => {
  const draggedIndexRef = useRef<number | null>(null);

  let filtered = bubbles;
  if (feedFilter === 'flagged') {
    filtered = filtered.filter((b) => b.reviewFlags && b.reviewFlags.length > 0);
  }

  const displayedBubbles = filtered;

  const handleDragStart = (e: React.DragEvent, index: number) => {
    draggedIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragEnter = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (
      draggedIndexRef.current !== null &&
      draggedIndexRef.current !== targetIndex
    ) {
      onReorderBubbles(draggedIndexRef.current, targetIndex);
      draggedIndexRef.current = targetIndex;
    }
  };

  const handleDragEnd = () => {
    draggedIndexRef.current = null;
  };

  return (
    <div className="h-full w-full flex flex-col min-h-0 select-none overflow-hidden">
      {/* Dialogue Cards Feed */}
      {displayedBubbles.length > 0 ? (
        <VirtualizedDialogueList
          bubbles={displayedBubbles}
          selectedBubbleId={selectedBubbleId}
          onSelectBubble={onSelectBubble}
          onFocusBubble={onFocusBubble}
          onUpdateBubble={onUpdateBubble}
          onDeleteBubble={onDeleteBubble}
          onSplitBubble={onSplitBubble}
          onTranslateBubble={onTranslateBubble}
          onAcceptFlag={onAcceptFlag}
          onDismissFlag={onDismissFlag}
          onRevertSource={onRevertSource}
          onRevertTranslation={onRevertTranslation}
          onDragStart={handleDragStart}
          onDragEnter={handleDragEnter}
          onDragEnd={handleDragEnd}
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 m-2 border border-dashed border-white/[0.08] rounded-2xl bg-[#0e0f14]/50">
          <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/[0.08] flex items-center justify-center text-zinc-500 mb-2.5">
            <MessageSquare className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
          </div>
          <span className="text-xs text-zinc-300 font-medium uppercase tracking-wider">
            {feedFilter === 'flagged' ? 'No Review Flags Pending' : 'No Dialogue Cards Available'}
          </span>
        </div>
      )}
    </div>
  );
};
