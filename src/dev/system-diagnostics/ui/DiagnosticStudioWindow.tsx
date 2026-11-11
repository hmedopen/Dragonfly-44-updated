import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Cpu,
  Radio,
  FileText,
  Play,
  Square,
  Stethoscope,
} from 'lucide-react';
import { getSystemDiagnosticsEngine } from '../bootstrap';
import { DEFAULT_RECORDING_PRIVACY_OPTIONS } from '../privacyRedactor';
import type {
  DiagnosticSessionMetadata,
  DiagnosticSessionRecord,
  RecordingPrivacyOptions,
  SubsystemId,
} from '../types';
import { FloatingToolWindow } from './FloatingToolWindow';
import { LiveMonitorTab } from './LiveMonitorTab';
import { OverviewTab } from './OverviewTab';
import { RecordingTab } from './RecordingTab';
import { ReportsTab } from './ReportsTab';
import { StatusBadge } from './StatusBadge';
import { SystemsTab } from './SystemsTab';

export type DiagnosticTabId = 'overview' | 'systems' | 'live' | 'recording' | 'reports';

export interface DiagnosticStudioWindowProps {
  onClose: () => void;
}

export const DiagnosticStudioWindow: React.FC<DiagnosticStudioWindowProps> = ({ onClose }) => {
  const engine = getSystemDiagnosticsEngine();

  const [renderTick, setRenderTick] = useState(0);
  const [activeTab, setActiveTab] = useState<DiagnosticTabId>('overview');
  const [selectedSubsystemId, setSelectedSubsystemId] = useState<SubsystemId>('app-core');
  const [runningCheckKey, setRunningCheckKey] = useState<string | null>(null);
  const [isStreamPaused, setIsStreamPaused] = useState(false);
  const [pausedEventsSnapshot, setPausedEventsSnapshot] = useState(() => engine.eventBus.getEvents());
  const [correlationFilter, setCorrelationFilter] = useState('');

  const [privacyOptions, setPrivacyOptions] = useState<RecordingPrivacyOptions>(
    () => ({ ...DEFAULT_RECORDING_PRIVACY_OPTIONS })
  );
  const [sessions, setSessions] = useState<DiagnosticSessionMetadata[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('live');
  const [selectedSessionRecord, setSelectedSessionRecord] =
    useState<DiagnosticSessionRecord | null>(null);

  const refreshSessionsList = useCallback(async () => {
    try {
      const list = await engine.storage.listSessions();
      setSessions(list);
    } catch {
      // Ignore storage error in list
    }
  }, [engine.storage]);

  useEffect(() => {
    let mounted = true;
    void engine.storage
      .listSessions()
      .then((list) => {
        if (mounted) setSessions(list);
      })
      .catch(() => {
        // Ignore initial storage read error
      });
    const unsub = engine.subscribeState(() => {
      setRenderTick((t) => t + 1);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [engine]);

  useEffect(() => {
    if (selectedSessionId === 'live') {
      return;
    }
    let cancelled = false;
    void engine.storage.getSession(selectedSessionId).then((rec) => {
      if (!cancelled) setSelectedSessionRecord(rec);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, engine.storage]);

  const effectiveSelectedSessionRecord =
    selectedSessionId === 'live' ? null : selectedSessionRecord;

  const inspectors = engine.registry.list();
  const snapshots = engine.getAllSubsystemSnapshots();
  const overallStatus = engine.getOverallHealthStatus(snapshots);
  const activeOperations = engine.getActiveOperations();
  const recentFindings = engine.getAllFindings();
  const activeRecording = engine.recorder.getActiveMetadata();
  const liveEvents = isStreamPaused ? pausedEventsSnapshot : engine.eventBus.getEvents();

  const handleRunAllSafe = async () => {
    setRunningCheckKey('all');
    try {
      await engine.runAllDiagnostics({ allowedSafety: ['read_only'] });
    } finally {
      setRunningCheckKey(null);
    }
  };

  const handleRunSubsystemSafe = async (id: SubsystemId) => {
    setRunningCheckKey(`${id}:all`);
    try {
      await engine.runSubsystemDiagnostics(id, { allowedSafety: ['read_only'] });
    } finally {
      setRunningCheckKey(null);
    }
  };

  const handleRunSingleCheck = async (subsystemId: SubsystemId, checkId: string) => {
    setRunningCheckKey(`${subsystemId}:${checkId}`);
    try {
      await engine.runCheck(subsystemId, checkId);
    } finally {
      setRunningCheckKey(null);
    }
  };

  const handleStartRecording = (label?: string) => {
    engine.startRecording({ label, privacyOptions });
    setRenderTick((t) => t + 1);
  };

  const handleStopRecording = async () => {
    const rec = await engine.stopRecording();
    await refreshSessionsList();
    setSelectedSessionId(rec.metadata.sessionId);
    setSelectedSessionRecord(rec);
    setActiveTab('reports');
  };

  const handleDeleteSession = async (sessionId: string) => {
    await engine.storage.deleteSession(sessionId);
    if (selectedSessionId === sessionId) {
      setSelectedSessionId('live');
      setSelectedSessionRecord(null);
    }
    await refreshSessionsList();
  };

  const handleTogglePause = () => {
    if (!isStreamPaused) {
      setPausedEventsSnapshot(engine.eventBus.getEvents());
    }
    setIsStreamPaused((prev) => !prev);
  };

  const navItems: Array<{
    id: DiagnosticTabId;
    label: string;
    icon: React.ReactElement;
    badge?: string | number;
  }> = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <Activity className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    {
      id: 'systems',
      label: 'Systems',
      icon: <Cpu className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
      badge: snapshots.filter(
        (s) => s.status === 'error' || s.status === 'critical' || s.status === 'warning'
      ).length || undefined,
    },
    {
      id: 'live',
      label: 'Live Monitor',
      icon: <Radio className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
      badge: liveEvents.length || undefined,
    },
    {
      id: 'recording',
      label: 'Recording',
      icon: <Stethoscope className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
      badge: activeRecording ? 'REC' : undefined,
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
      badge: sessions.length || undefined,
    },
  ];

  const headerBadge = (
    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-zinc-900 text-zinc-400 border border-white/[0.08]">
      DEV OBD-II
    </span>
  );

  const headerRightStatus = (
    <div className="hidden sm:flex items-center gap-1.5 mr-1">
      <StatusBadge status={overallStatus} compact />
      {activeRecording && (
        <StatusBadge
          status="running"
          labelOverride={`REC ${activeRecording.eventCount}`}
          compact
        />
      )}
    </div>
  );

  return (
    <FloatingToolWindow
      title="Diagnostic Studio"
      headerBadge={headerBadge}
      headerRightStatus={headerRightStatus}
      onClose={onClose}
    >
      {/* Top Action Control Strip */}
      <div className="px-3.5 py-2 bg-[#09090c] border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRunAllSafe}
            disabled={runningCheckKey !== null}
            className="px-3 py-1 rounded bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 font-mono text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Play className="w-3 h-3 fill-current" aria-hidden="true" />
            <span>{runningCheckKey === 'all' ? 'Running Checks...' : 'Run Safe Diagnostics'}</span>
          </button>

          {activeRecording ? (
            <button
              type="button"
              onClick={handleStopRecording}
              className="px-3 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 font-mono text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" aria-hidden="true" />
              <span>Stop Recording ({activeRecording.eventCount})</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleStartRecording()}
              className="px-3 py-1 rounded bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 font-mono text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Radio className="w-3 h-3" aria-hidden="true" />
              <span>Record Session</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 font-mono text-[10px] text-zinc-400">
          <span>Active ops: {activeOperations.length}</span>
          <span>Findings: {recentFindings.length}</span>
        </div>
      </div>

      {/* Main Split: Left OBD Tab Rail + Content Area */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <nav
          aria-label="Diagnostic Studio Sections"
          className="w-36 sm:w-40 bg-[#09090c] border-r border-white/[0.06] flex flex-col py-2.5 px-2 gap-0.5 shrink-0 overflow-y-auto custom-scrollbar"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(item.id)}
                className={`w-full h-8 px-2 rounded-md flex items-center justify-between gap-2 text-left text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 ${
                  isActive
                    ? 'bg-white/[0.08] text-white font-medium border-l-2 border-white'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03] border-l-2 border-transparent'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className={isActive ? 'text-zinc-100' : 'text-zinc-500'}>{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span className="px-1.5 py-0.2 rounded bg-zinc-900 border border-white/[0.08] font-mono text-[9px] text-zinc-300 shrink-0">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-4 bg-[#0b0c10]">
          {activeTab === 'overview' && (
            <OverviewTab
              overallStatus={overallStatus}
              snapshots={snapshots}
              activeOperations={activeOperations}
              recentFindings={recentFindings}
              activeRecording={activeRecording}
              lastDiagnosticRunAt={engine.getLastDiagnosticRunAt()}
              onInspectSubsystem={(subId) => {
                setSelectedSubsystemId(subId);
                setActiveTab('systems');
              }}
              onSelectFindingCorrelation={(corrId) => {
                setCorrelationFilter(corrId);
                setActiveTab('live');
              }}
            />
          )}

          {activeTab === 'systems' && (
            <SystemsTab
              inspectors={inspectors}
              snapshots={snapshots}
              selectedSubsystemId={selectedSubsystemId}
              onSelectSubsystem={setSelectedSubsystemId}
              events={liveEvents}
              runningCheckKey={runningCheckKey}
              onRunSubsystemSafeChecks={handleRunSubsystemSafe}
              onRunSingleCheck={handleRunSingleCheck}
            />
          )}

          {activeTab === 'live' && (
            <LiveMonitorTab
              events={liveEvents}
              inspectors={inspectors}
              droppedLiveEvents={engine.eventBus.getDroppedLiveEventsCount()}
              isPaused={isStreamPaused}
              onTogglePause={handleTogglePause}
              onClearEvents={() => engine.clearRuntimeFindings()}
              correlationFilter={correlationFilter}
              onCorrelationFilterChange={setCorrelationFilter}
              reconstructTraces={(evts) => engine.reconstructCorrelatedTraces(evts)}
            />
          )}

          {activeTab === 'recording' && (
            <RecordingTab
              activeRecording={activeRecording}
              privacyOptions={privacyOptions}
              onChangePrivacyOptions={setPrivacyOptions}
              onStartRecording={handleStartRecording}
              onStopRecording={handleStopRecording}
              storageWriteErrors={engine.recorder.getStorageWriteErrors()}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsTab
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              selectedSessionRecord={effectiveSelectedSessionRecord}
              privacyOptions={privacyOptions}
              snapshotVersion={renderTick}
              onSelectSession={setSelectedSessionId}
              onDeleteSession={handleDeleteSession}
            />
          )}
        </main>
      </div>
    </FloatingToolWindow>
  );
};
