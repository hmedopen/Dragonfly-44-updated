import React, { useMemo, useState } from 'react';
import { Pause, Play, Search, Trash2, X } from 'lucide-react';
import type { CorrelatedTrace, DiagnosticEvent, SubsystemId, SubsystemInspector } from '../types';
import { StatusBadge } from './StatusBadge';

export interface LiveMonitorTabProps {
  events: DiagnosticEvent[];
  inspectors: SubsystemInspector[];
  droppedLiveEvents: number;
  isPaused: boolean;
  onTogglePause: () => void;
  onClearEvents: () => void;
  correlationFilter: string;
  onCorrelationFilterChange: (corrId: string) => void;
  reconstructTraces: (events: DiagnosticEvent[]) => CorrelatedTrace[];
}

export const LiveMonitorTab: React.FC<LiveMonitorTabProps> = ({
  events,
  inspectors,
  droppedLiveEvents,
  isPaused,
  onTogglePause,
  onClearEvents,
  correlationFilter,
  onCorrelationFilterChange,
  reconstructTraces,
}) => {
  const [severityFilter, setSeverityFilter] = useState<'all' | 'warnings' | 'errors'>('all');
  const [subsystemFilter, setSubsystemFilter] = useState<SubsystemId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...events]
      .reverse()
      .filter((evt) => {
        if (severityFilter === 'warnings') {
          if (evt.severity !== 'warning' && evt.severity !== 'error' && evt.severity !== 'critical') {
            return false;
          }
        } else if (severityFilter === 'errors') {
          if (evt.severity !== 'error' && evt.severity !== 'critical') {
            return false;
          }
        }
        if (subsystemFilter !== 'all' && evt.subsystem !== subsystemFilter) {
          return false;
        }
        if (correlationFilter && evt.correlationId !== correlationFilter) {
          return false;
        }
        if (q) {
          const hay = `${evt.subsystem} ${evt.component} ${evt.operation} ${evt.explanation} ${evt.correlationId || ''} ${evt.identifiers?.pageId || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [events, severityFilter, subsystemFilter, correlationFilter, searchQuery]);

  const selectedEvent =
    filteredEvents.find((e) => e.eventId === selectedEventId) || filteredEvents[0] || null;

  const selectedTrace = useMemo(() => {
    if (!selectedEvent?.correlationId) return null;
    const related = events.filter((e) => e.correlationId === selectedEvent.correlationId);
    const traces = reconstructTraces(related);
    return traces[0] || null;
  }, [selectedEvent, events, reconstructTraces]);

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/[0.06] shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          {/* Severity filter */}
          <div className="flex items-center p-0.5 rounded bg-[#09090c] border border-white/[0.08] font-mono text-[10px]">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'warnings', label: 'Warn+' },
                { id: 'errors', label: 'Error+' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSeverityFilter(opt.id)}
                className={`px-2 py-1 rounded transition-colors cursor-pointer ${
                  severityFilter === opt.id
                    ? 'bg-white/[0.12] text-white font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Subsystem filter */}
          <label className="sr-only" htmlFor="diag-subsystem-filter">
            Filter by subsystem
          </label>
          <select
            id="diag-subsystem-filter"
            value={subsystemFilter}
            onChange={(e) => setSubsystemFilter(e.target.value)}
            className="px-2 py-1 rounded bg-[#09090c] border border-white/[0.08] text-zinc-200 font-mono text-[11px] focus:outline-none focus:border-white/25"
          >
            <option value="all">All Subsystems</option>
            {inspectors.map((ins) => (
              <option key={ins.id} value={ins.id}>
                {ins.name}
              </option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex items-center">
            <Search className="w-3 h-3 text-zinc-500 absolute left-2 pointer-events-none" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search operation, page, trace..."
              aria-label="Search live events"
              className="pl-6 pr-2 py-1 w-48 rounded bg-[#09090c] border border-white/[0.08] text-zinc-200 font-mono text-[11px] focus:outline-none focus:border-white/25"
            />
          </div>

          {correlationFilter && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 font-mono text-[10px]">
              <span>Trace: {correlationFilter.slice(0, 18)}</span>
              <button
                type="button"
                onClick={() => onCorrelationFilterChange('')}
                aria-label="Clear trace filter"
                className="hover:text-white cursor-pointer"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {droppedLiveEvents > 0 && (
            <span className="font-mono text-[10px] text-amber-400">
              {droppedLiveEvents} older event(s) dropped
            </span>
          )}

          <button
            type="button"
            onClick={onTogglePause}
            className="px-2.5 py-1 rounded bg-[#09090c] hover:bg-zinc-800 border border-white/[0.08] text-zinc-200 font-mono text-[10px] flex items-center gap-1 cursor-pointer"
          >
            {isPaused ? (
              <>
                <Play className="w-3 h-3 text-sky-400" aria-hidden="true" />
                <span>Resume</span>
              </>
            ) : (
              <>
                <Pause className="w-3 h-3 text-zinc-400" aria-hidden="true" />
                <span>Pause</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClearEvents}
            className="px-2.5 py-1 rounded bg-[#09090c] hover:bg-zinc-800 border border-white/[0.08] text-zinc-300 hover:text-rose-300 font-mono text-[10px] flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Split Stream & Detail Inspector */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3">
        {/* Stream List */}
        <div className="flex-1 min-h-[180px] border border-white/[0.06] rounded-lg bg-[#07070a] overflow-y-auto custom-scrollbar divide-y divide-white/[0.04]">
          {filteredEvents.length === 0 ? (
            <div className="p-6 text-center text-xs text-zinc-500">
              No events match the active filters.
            </div>
          ) : (
            filteredEvents.map((evt) => {
              const isSelected = selectedEvent?.eventId === evt.eventId;
              return (
                <button
                  key={evt.eventId}
                  type="button"
                  onClick={() => setSelectedEventId(evt.eventId)}
                  className={`w-full px-3 py-2 text-left transition-colors cursor-pointer space-y-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 ${
                    isSelected
                      ? 'bg-white/[0.08] border-l-2 border-sky-400'
                      : 'hover:bg-white/[0.03] border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusBadge status={evt.status} compact />
                      <span className="text-zinc-400 shrink-0">{evt.subsystem}</span>
                      <span className="text-zinc-200 font-semibold truncate">
                        {evt.component}.{evt.operation}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-zinc-500">
                      {typeof evt.durationMs === 'number' && <span>{evt.durationMs}ms</span>}
                      <span>{new Date(evt.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-300 leading-snug line-clamp-2">
                    {evt.explanation}
                  </p>
                </button>
              );
            })
          )}
        </div>

        {/* Event & Trace Inspector */}
        <div className="lg:w-[340px] shrink-0 border border-white/[0.06] rounded-lg bg-[#09090c] p-3 overflow-y-auto custom-scrollbar space-y-3">
          {selectedEvent ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
                <span className="font-mono text-[11px] font-semibold uppercase text-zinc-200">
                  Event #{selectedEvent.seq}
                </span>
                <StatusBadge status={selectedEvent.status} compact />
              </div>

              <div className="space-y-1 text-xs">
                <div className="text-zinc-100 font-medium">{selectedEvent.explanation}</div>
                <div className="font-mono text-[10px] text-zinc-500 space-y-0.5">
                  <div>Subsystem: {selectedEvent.subsystem}</div>
                  <div>Component: {selectedEvent.component}</div>
                  <div>Operation: {selectedEvent.operation} ({selectedEvent.eventType})</div>
                  <div>Time: {selectedEvent.isoTimestamp}</div>
                  {selectedEvent.correlationId && (
                    <div className="flex items-center gap-2 pt-0.5">
                      <span>Trace: {selectedEvent.correlationId}</span>
                      <button
                        type="button"
                        onClick={() => onCorrelationFilterChange(selectedEvent.correlationId!)}
                        className="text-sky-400 hover:text-sky-300 underline cursor-pointer"
                      >
                        Filter Trace
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {selectedTrace && selectedTrace.events.length > 1 && (
                <div className="p-2 rounded bg-[#060609] border border-white/[0.05] space-y-1">
                  <div className="font-mono text-[10px] text-sky-400 uppercase">
                    Correlated Chain ({selectedTrace.events.length} stages, {selectedTrace.durationMs}ms)
                  </div>
                  <div className="space-y-1">
                    {selectedTrace.events.map((step) => (
                      <div
                        key={step.eventId}
                        className="text-[10px] font-mono text-zinc-400 flex items-center justify-between gap-2"
                      >
                        <span className="truncate">
                          #{step.seq} {step.component}.{step.operation}
                        </span>
                        <span className="text-zinc-500 shrink-0">{step.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedEvent.identifiers && Object.keys(selectedEvent.identifiers).length > 0 && (
                <div className="space-y-1">
                  <div className="font-mono text-[10px] uppercase text-zinc-400">Identifiers</div>
                  <pre className="p-2 rounded bg-[#050508] border border-white/[0.05] text-[10px] font-mono text-zinc-300 overflow-x-auto select-text">
                    {JSON.stringify(selectedEvent.identifiers, null, 2)}
                  </pre>
                </div>
              )}

              {selectedEvent.payload && (
                <div className="space-y-1">
                  <div className="font-mono text-[10px] uppercase text-zinc-400">
                    Sanitized Payload
                  </div>
                  <pre className="p-2 rounded bg-[#050508] border border-white/[0.05] text-[10px] font-mono text-zinc-300 overflow-x-auto max-h-40 select-text">
                    {JSON.stringify(selectedEvent.payload, null, 2)}
                  </pre>
                </div>
              )}

              {selectedEvent.error && (
                <div className="space-y-1">
                  <div className="font-mono text-[10px] uppercase text-rose-400">Error Details</div>
                  <pre className="p-2 rounded bg-[#140a0c] border border-rose-500/25 text-[10px] font-mono text-rose-200 whitespace-pre-wrap max-h-40 overflow-y-auto select-text">
                    {selectedEvent.error.name ? `${selectedEvent.error.name}: ` : ''}
                    {selectedEvent.error.message}
                    {selectedEvent.error.stack ? `\n${selectedEvent.error.stack}` : ''}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-zinc-500">Select an event to inspect details.</div>
          )}
        </div>
      </div>
    </div>
  );
};
