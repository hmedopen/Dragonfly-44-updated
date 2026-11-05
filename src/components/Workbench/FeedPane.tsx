import React, { useRef } from 'react';
import type { BubbleItem } from '../../types/workbench';
import type { FeedFilterMode } from '../../store/workbenchStore';
import { VirtualizedDialogueList } from './VirtualizedDialogueList';
import { 
  Plus, 
  MessageSquare
} from 'lucide-react';

interface FeedPaneProps {
  bubbles: BubbleItem[];
  selectedBubbleId: string | null;
  feedFilter: FeedFilterMode;
  onSelectBubble: (bubbleId: string) => void;
  onUpdateBubble: (bubbleId: string, patch: Partial<BubbleItem>) => void;
  onDeleteBubble: (bubbleId: string) => void;
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
  onUpdateBubble,
  onDeleteBubble,
  onAcceptFlag,
  onDismissFlag,
  onRevertSource,
  onRevertTranslation,
  onAddManualBubble,
  onReorderBubbles,
}) => {
  const draggedIndexRef = useRef<number | null>(null);

  const displayedBubbles =
    feedFilter === 'flagged'
      ? bubbles.filter((b) => b.reviewFlags && b.reviewFlags.length > 0)
      : bubbles;

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
          onUpdateBubble={onUpdateBubble}
          onDeleteBubble={onDeleteBubble}
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
          <span className="text-xs text-zinc-300 font-medium uppercase tracking-wider mb-1">
            {feedFilter === 'flagged' ? 'No Review Flags Pending' : 'No Dialogue Cards Available'}
          </span>
          <span className="text-[11px] text-zinc-500 max-w-xs mb-3">
            {feedFilter === 'flagged'
              ? 'All QC review flags for this page have been resolved or accepted.'
              : 'Scan page dialogue or draw a bounding box on the canvas.'}
          </span>
          <button
            type="button"
            onClick={onAddManualBubble}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-white/10 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Manual Bubble</span>
          </button>
        </div>
      )}
    </div>
  );
};
