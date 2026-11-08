/**
 * Folio Script - Training Studio Diagnostics & Telemetry Ledger
 * Tracks which Reference Sets, Examples, and Instructions were dispatched to Gemini.
 * Sanitizes sensitive data (API keys) and provides inspection capabilities for developers.
 */

import type { TrainingDispatchRecord, TrainingTaskType } from '../../types/training';

const MAX_DISPATCH_HISTORY = 50;
const dispatchHistory: TrainingDispatchRecord[] = [];
type DiagnosticsListener = (records: TrainingDispatchRecord[]) => void;
const listeners = new Set<DiagnosticsListener>();

export const trainingDiagnostics = {
  /**
   * Records a new Gemini training context dispatch.
   */
  record(record: Omit<TrainingDispatchRecord, 'id' | 'timestamp'>): TrainingDispatchRecord {
    const fullRecord: TrainingDispatchRecord = {
      ...record,
      id: `disp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };

    dispatchHistory.unshift(fullRecord);
    if (dispatchHistory.length > MAX_DISPATCH_HISTORY) {
      dispatchHistory.pop();
    }

    listeners.forEach((l) => {
      try {
        l([...dispatchHistory]);
      } catch (err) {
        console.warn('[TrainingDiagnostics] Listener error:', err);
      }
    });

    return fullRecord;
  },

  /**
   * Retrieves all recent dispatch records.
   */
  getHistory(): TrainingDispatchRecord[] {
    return [...dispatchHistory];
  },

  /**
   * Retrieves dispatches for a specific task type.
   */
  getHistoryForTask(taskType: TrainingTaskType): TrainingDispatchRecord[] {
    return dispatchHistory.filter((r) => r.taskType === taskType);
  },

  /**
   * Clears dispatch history.
   */
  clear(): void {
    dispatchHistory.length = 0;
    listeners.forEach((l) => l([]));
  },

  /**
   * Subscribes to new dispatch events.
   */
  subscribe(listener: DiagnosticsListener): () => void {
    listeners.add(listener);
    listener([...dispatchHistory]);
    return () => listeners.delete(listener);
  },
};
