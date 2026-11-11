import { buildPrivacyManifest, DEFAULT_RECORDING_PRIVACY_OPTIONS, redactEventForPrivacy } from './privacyRedactor';
import type { IDiagnosticStorageDriver } from './diagnosticStorage';
import type {
  DiagnosticEvent,
  DiagnosticSessionMetadata,
  DiagnosticSessionRecord,
  RecordingPrivacyOptions,
  SubsystemHealthSnapshot,
  SubsystemId,
} from './types';

export interface SessionRecorderOptions {
  storage: IDiagnosticStorageDriver;
  maxEventsPerSession?: number;
  flushIntervalMs?: number;
  onRecorderWarning?: (message: string, err?: unknown) => void;
  getSystemSnapshots?: () => SubsystemHealthSnapshot[];
}

export class SessionRecorder {
  private readonly storage: IDiagnosticStorageDriver;
  private readonly maxEventsPerSession: number;
  private readonly flushIntervalMs: number;
  private readonly onRecorderWarning?: (message: string, err?: unknown) => void;
  private readonly getSystemSnapshots?: () => SubsystemHealthSnapshot[];

  private activeMetadata: DiagnosticSessionMetadata | null = null;
  private capturedEvents: DiagnosticEvent[] = [];
  private unpersistedChunkEvents: DiagnosticEvent[] = [];
  private chunkCounter = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight: Promise<void> = Promise.resolve();
  private pagesSet = new Set<string>();
  private operationsSet = new Set<string>();
  private subsystemsSet = new Set<SubsystemId>();
  private storageWriteErrors = 0;

  constructor(options: SessionRecorderOptions) {
    this.storage = options.storage;
    this.maxEventsPerSession = Math.max(10, options.maxEventsPerSession ?? 5000);
    this.flushIntervalMs = Math.max(25, options.flushIntervalMs ?? 250);
    this.onRecorderWarning = options.onRecorderWarning;
    this.getSystemSnapshots = options.getSystemSnapshots;
  }

  public isRecording(): boolean {
    return Boolean(this.activeMetadata && this.activeMetadata.status === 'recording');
  }

  public getActiveMetadata(): DiagnosticSessionMetadata | null {
    return this.activeMetadata ? structuredClone(this.activeMetadata) : null;
  }

  public getCapturedEvents(): DiagnosticEvent[] {
    return [...this.capturedEvents];
  }

  public getStorageWriteErrors(): number {
    return this.storageWriteErrors;
  }

  public startSession(options?: {
    label?: string;
    privacyOptions?: RecordingPrivacyOptions;
  }): DiagnosticSessionMetadata {
    if (this.isRecording()) {
      throw new Error('A diagnostic recording session is already active.');
    }

    const now = Date.now();
    const sessionId = `diag-sess-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const privacyOptions: RecordingPrivacyOptions = {
      ...(options?.privacyOptions ?? DEFAULT_RECORDING_PRIVACY_OPTIONS),
    };

    this.capturedEvents = [];
    this.unpersistedChunkEvents = [];
    this.chunkCounter = 0;
    this.pagesSet.clear();
    this.operationsSet.clear();
    this.subsystemsSet.clear();
    this.storageWriteErrors = 0;

    this.activeMetadata = {
      sessionId,
      label: options?.label?.trim() || `Diagnostic Session ${new Date(now).toLocaleTimeString()}`,
      startedAt: now,
      endedAt: null,
      status: 'recording',
      privacyOptions,
      privacyManifest: buildPrivacyManifest(privacyOptions, []),
      eventCount: 0,
      droppedEventCount: 0,
      truncated: false,
      pagesCovered: [],
      operationsCovered: [],
      subsystemsSeen: [],
      findingsCount: 0,
      maxEventsCap: this.maxEventsPerSession,
    };

    this.scheduleFlush();
    return this.getActiveMetadata()!;
  }

  public recordEvent(event: DiagnosticEvent): void {
    if (!this.activeMetadata || this.activeMetadata.status !== 'recording') {
      return;
    }

    try {
      if (this.capturedEvents.length >= this.maxEventsPerSession) {
        this.activeMetadata.droppedEventCount += 1;
        this.activeMetadata.truncated = true;
        return;
      }

      const sanitizedEvent = redactEventForPrivacy(
        {
          ...event,
          sessionId: this.activeMetadata.sessionId,
        },
        this.activeMetadata.privacyOptions
      );

      this.capturedEvents.push(sanitizedEvent);
      this.unpersistedChunkEvents.push(sanitizedEvent);

      this.activeMetadata.eventCount = this.capturedEvents.length;
      if (sanitizedEvent.severity === 'warning' || sanitizedEvent.severity === 'error' || sanitizedEvent.severity === 'critical') {
        this.activeMetadata.findingsCount += 1;
      }

      const pageId = sanitizedEvent.identifiers?.pageId;
      if (typeof pageId === 'string' && pageId) {
        this.pagesSet.add(pageId);
        this.activeMetadata.pagesCovered = Array.from(this.pagesSet);
      }
      if (sanitizedEvent.operation) {
        this.operationsSet.add(`${sanitizedEvent.subsystem}:${sanitizedEvent.operation}`);
        this.activeMetadata.operationsCovered = Array.from(this.operationsSet);
      }
      this.subsystemsSet.add(sanitizedEvent.subsystem);
      this.activeMetadata.subsystemsSeen = Array.from(this.subsystemsSet);
      this.activeMetadata.privacyManifest = buildPrivacyManifest(
        this.activeMetadata.privacyOptions,
        this.capturedEvents
      );

      if (this.unpersistedChunkEvents.length >= 50) {
        void this.flushAsync();
      } else {
        this.scheduleFlush();
      }
    } catch (err) {
      this.onRecorderWarning?.('Recorder failed to process event; event dropped without impacting app.', err);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushAsync();
    }, this.flushIntervalMs);
  }

  public flushAsync(): Promise<void> {
    const run = this.flushInFlight.then(async () => {
      if (!this.activeMetadata) return;
      const metadataSnapshot = structuredClone(this.activeMetadata);
      const pending = this.unpersistedChunkEvents.splice(0, this.unpersistedChunkEvents.length);

      try {
        if (pending.length > 0) {
          this.chunkCounter += 1;
          await this.storage.saveChunk({
            chunkId: `${metadataSnapshot.sessionId}-chunk-${this.chunkCounter}`,
            sessionId: metadataSnapshot.sessionId,
            seqStart: pending[0].seq,
            seqEnd: pending[pending.length - 1].seq,
            events: pending,
          });
        }
        await this.storage.saveCheckpoint({
          id: 'current',
          metadata: metadataSnapshot,
          systemSnapshots: this.getSystemSnapshots ? this.getSystemSnapshots() : [],
          updatedAt: Date.now(),
        });
      } catch (err) {
        this.storageWriteErrors += 1;
        this.onRecorderWarning?.(
          'Asynchronous session checkpoint/chunk write failed; events remain buffered in memory.',
          err
        );
      }
    });

    this.flushInFlight = run.catch(() => {});
    return run;
  }

  public async stopSession(): Promise<DiagnosticSessionRecord> {
    if (!this.activeMetadata) {
      throw new Error('No active diagnostic recording session to stop.');
    }

    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flushAsync();

    const endedAt = Date.now();
    const snapshots = this.getSystemSnapshots ? this.getSystemSnapshots() : [];
    const finalizedMeta: DiagnosticSessionMetadata = {
      ...structuredClone(this.activeMetadata),
      endedAt,
      status: 'stopped',
      privacyManifest: buildPrivacyManifest(this.activeMetadata.privacyOptions, this.capturedEvents),
    };

    const record: DiagnosticSessionRecord = {
      metadata: finalizedMeta,
      events: [...this.capturedEvents],
      systemSnapshots: snapshots,
    };

    try {
      await this.storage.saveSession(record);
      await this.storage.clearCheckpoint();
    } catch (err) {
      this.storageWriteErrors += 1;
      this.onRecorderWarning?.('Failed to persist completed session to IndexedDB; returning in-memory copy.', err);
    }

    this.activeMetadata = null;
    this.capturedEvents = [];
    this.unpersistedChunkEvents = [];

    return record;
  }

  public async recoverInterruptedSession(): Promise<DiagnosticSessionRecord | null> {
    try {
      const checkpoint = await this.storage.getCheckpoint();
      if (!checkpoint || !checkpoint.metadata) return null;

      const chunks = await this.storage.getSessionChunks(checkpoint.metadata.sessionId);
      const events = chunks.flatMap((c) => c.events);

      const recoveredMeta: DiagnosticSessionMetadata = {
        ...checkpoint.metadata,
        endedAt: checkpoint.updatedAt || Date.now(),
        status: 'recovered',
        eventCount: events.length,
        privacyManifest: buildPrivacyManifest(checkpoint.metadata.privacyOptions, events),
      };

      const record: DiagnosticSessionRecord = {
        metadata: recoveredMeta,
        events,
        systemSnapshots: checkpoint.systemSnapshots || [],
      };

      await this.storage.saveSession(record);
      await this.storage.clearCheckpoint();
      return record;
    } catch (err) {
      this.onRecorderWarning?.('Could not recover interrupted diagnostic session.', err);
      return null;
    }
  }
}
