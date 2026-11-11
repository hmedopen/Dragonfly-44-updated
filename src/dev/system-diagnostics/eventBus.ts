import {
  DEFAULT_RECORDING_PRIVACY_OPTIONS,
  redactPayload,
  sanitizeErrorInfo,
  scrubSecretPatterns,
} from './privacyRedactor';
import type {
  DiagnosticEvent,
  DiagnosticEventInput,
  RecordingPrivacyOptions,
} from './types';

export type DiagnosticEventListener = (event: DiagnosticEvent) => void;

export interface DiagnosticEventBusOptions {
  maxBufferSize?: number;
  privacyOptions?: RecordingPrivacyOptions;
  onInternalDrop?: (droppedCount: number) => void;
}

export class DiagnosticEventBus {
  private readonly maxBufferSize: number;
  private privacyOptions: RecordingPrivacyOptions;
  private buffer: DiagnosticEvent[] = [];
  private listeners = new Set<DiagnosticEventListener>();
  private seqCounter = 0;
  private droppedLiveEvents = 0;
  private activeSessionId = 'live-buffer';
  private pendingBatch: DiagnosticEvent[] = [];
  private flushScheduled = false;
  private readonly onInternalDrop?: (droppedCount: number) => void;

  constructor(options: DiagnosticEventBusOptions = {}) {
    this.maxBufferSize = Math.max(50, options.maxBufferSize ?? 1000);
    this.privacyOptions = options.privacyOptions ?? { ...DEFAULT_RECORDING_PRIVACY_OPTIONS };
    this.onInternalDrop = options.onInternalDrop;
  }

  public setActiveSessionId(sessionId: string | null): void {
    this.activeSessionId = sessionId || 'live-buffer';
  }

  public getActiveSessionId(): string {
    return this.activeSessionId;
  }

  public setPrivacyOptions(options: RecordingPrivacyOptions): void {
    this.privacyOptions = { ...options };
  }

  public getPrivacyOptions(): RecordingPrivacyOptions {
    return { ...this.privacyOptions };
  }

  public record(input: DiagnosticEventInput): DiagnosticEvent {
    this.seqCounter += 1;
    const seq = this.seqCounter;
    const timestamp = input.timestamp ?? Date.now();
    const { sanitized, redactedFields } = redactPayload(input.payload, this.privacyOptions);
    const explanation = scrubSecretPatterns(input.explanation || '').value;
    const errorInfo = sanitizeErrorInfo(input.error);

    const event: DiagnosticEvent = {
      eventId: `evt-${seq}-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
      seq,
      sessionId: input.sessionId || this.activeSessionId,
      timestamp,
      isoTimestamp: new Date(timestamp).toISOString(),
      subsystem: input.subsystem,
      component: input.component,
      operation: input.operation,
      eventType: input.eventType,
      severity: input.severity,
      status: input.status,
      ...(typeof input.durationMs === 'number' ? { durationMs: input.durationMs } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.parentEventId ? { parentEventId: input.parentEventId } : {}),
      ...(input.identifiers ? { identifiers: { ...input.identifiers } } : {}),
      ...(sanitized ? { payload: sanitized } : {}),
      explanation,
      ...(errorInfo ? { error: errorInfo } : {}),
      ...(redactedFields.length > 0 ? { redactedFields } : {}),
    };

    if (this.buffer.length >= this.maxBufferSize) {
      this.buffer.shift();
      this.droppedLiveEvents += 1;
      this.onInternalDrop?.(this.droppedLiveEvents);
    }
    this.buffer.push(event);

    this.scheduleNotify(event);
    return event;
  }

  private scheduleNotify(event: DiagnosticEvent): void {
    this.pendingBatch.push(event);
    if (this.flushScheduled) return;
    this.flushScheduled = true;

    const flush = () => {
      this.flushScheduled = false;
      const batch = this.pendingBatch.splice(0, this.pendingBatch.length);
      for (const evt of batch) {
        for (const listener of this.listeners) {
          try {
            listener(evt);
          } catch {
            // Never let a diagnostic UI/recorder listener throw back into caller paths
          }
        }
      }
    };

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(flush);
    } else {
      Promise.resolve().then(flush).catch(() => {});
    }
  }

  /**
   * Synchronously drains any queued subscriber notifications (useful in tests & session stop).
   */
  public flushPendingNotifications(): void {
    if (this.pendingBatch.length === 0) return;
    this.flushScheduled = false;
    const batch = this.pendingBatch.splice(0, this.pendingBatch.length);
    for (const evt of batch) {
      for (const listener of this.listeners) {
        try {
          listener(evt);
        } catch {
          // Isolated listener error
        }
      }
    }
  }

  public subscribe(listener: DiagnosticEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getEvents(): DiagnosticEvent[] {
    return [...this.buffer];
  }

  public getRecentEvents(limit = 200): DiagnosticEvent[] {
    if (limit <= 0) return [];
    return this.buffer.slice(-limit);
  }

  public getDroppedLiveEventsCount(): number {
    return this.droppedLiveEvents;
  }

  public clearBuffer(): void {
    this.buffer = [];
    this.droppedLiveEvents = 0;
  }
}
