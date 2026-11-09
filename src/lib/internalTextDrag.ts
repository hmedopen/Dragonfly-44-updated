/**
 * Folio Script — Internal Text Drag & Drop Coordinator
 * Manages active drag state across dialogue fields, suspending mouse-leave cancellation
 * on dialogue cards during active text transfers.
 */

export interface TextDragPayload {
  sourceBubbleId: string;
  sourceField: 'sourceText' | 'translatedText';
  selectedText: string;
  rangeStart: number;
  rangeEnd: number;
}

let activeDragPayload: TextDragPayload | null = null;
const dragListeners = new Set<(isDragging: boolean) => void>();

export const internalTextDrag = {
  startDrag(payload: TextDragPayload) {
    activeDragPayload = payload;
    dragListeners.forEach((listener) => {
      try {
        listener(true);
      } catch (e) {
        console.error('[internalTextDrag] Listener error on start', e);
      }
    });
  },

  getActiveDrag(): TextDragPayload | null {
    return activeDragPayload;
  },

  endDrag() {
    activeDragPayload = null;
    dragListeners.forEach((listener) => {
      try {
        listener(false);
      } catch (e) {
        console.error('[internalTextDrag] Listener error on end', e);
      }
    });
  },

  isDragging(): boolean {
    return activeDragPayload !== null;
  },

  subscribe(listener: (isDragging: boolean) => void): () => void {
    dragListeners.add(listener);
    return () => {
      dragListeners.delete(listener);
    };
  },
};
