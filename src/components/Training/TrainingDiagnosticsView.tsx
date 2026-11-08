import React, { useState, useEffect } from 'react';
import {
  Activity,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { trainingDiagnostics } from '../../lib/training/trainingDiagnostics';
import { assembleTaskTrainingContext } from '../../lib/training/trainingPromptInjection';
import { TRAINING_TASKS, type TrainingDispatchRecord, type TrainingTaskType } from '../../types/training';

interface TrainingDiagnosticsViewProps {
  onClose: () => void;
}

export const TrainingDiagnosticsView: React.FC<TrainingDiagnosticsViewProps> = ({ onClose }) => {
  const [history, setHistory] = useState<TrainingDispatchRecord[]>(() => trainingDiagnostics.getHistory());
  const [selectedRecord, setSelectedRecord] = useState<TrainingDispatchRecord | null>(() => history[0] || null);

  // Live simulation state
  const [simTask, setSimTask] = useState<TrainingTaskType>('scanning_classification');
  const [isSimulating, setIsSimulating] = useState(false);
  const [simResult, setSimResult] = useState<any | null>(null);

  useEffect(() => {
    const unsub = trainingDiagnostics.subscribe((records) => {
      setHistory(records);
      if (!selectedRecord && records.length > 0) {
        setSelectedRecord(records[0]);
      }
    });
    return () => unsub();
  }, [selectedRecord]);

  const handleRunSimulation = async () => {
    setIsSimulating(true);
    try {
      const res = await assembleTaskTrainingContext({
        task: simTask,
        model: 'gemini-3.8-flash',
        operationId: `sim_${Date.now()}`,
      });
      setSimResult(res);
    } catch (err) {
      console.error('Simulation error:', err);
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-5xl h-[88vh] bg-[#0c0d12] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans">
        {/* Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide">
                TRAINING STUDIO // GEMINI DISPATCH DIAGNOSTICS
              </h2>
              <p className="text-[11px] text-zinc-500">
                Inspect which Reference Sets, examples, and multimodal instructions were actually sent to Gemini.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => trainingDiagnostics.clear()}
              className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 border border-white/[0.08] text-xs font-mono transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Log
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body Split */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Dispatch History List */}
          <div className="w-80 border-r border-white/[0.08] bg-[#09090d] flex flex-col overflow-y-auto">
            <div className="p-3 border-b border-white/[0.06] text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
              <span>Recent Dispatches ({history.length})</span>
            </div>

            {history.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 text-xs">
                No Gemini dispatches recorded yet in this session.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {history.map((rec) => (
                  <button
                    key={rec.id}
                    type="button"
                    onClick={() => setSelectedRecord(rec)}
                    className={`w-full p-3 text-left transition-colors cursor-pointer ${
                      selectedRecord?.id === rec.id
                        ? 'bg-amber-500/10 border-l-2 border-amber-400'
                        : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-mono font-semibold text-zinc-200">{rec.taskType}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {new Date(rec.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 font-mono truncate">
                      {rec.appliedReferenceSets.length} sets • {rec.selectedExamples.length} examples
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-1 font-mono">
                      model: {rec.model} • ~{Math.round(rec.contextBudgetTokensEstimate)} tokens
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Record Inspector or Live Simulation */}
          <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-6">
            {/* Live Context Simulation Section */}
            <div className="p-4 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Live Prompt Simulation Tool
                </span>
                <span className="text-[11px] text-zinc-500">Test current Reference Set selection & budget</span>
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={simTask}
                  onChange={(e) => setSimTask(e.target.value as any)}
                  className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-white/[0.1] text-xs text-zinc-200 font-mono"
                >
                  {TRAINING_TASKS.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label} ({t.systemName})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleRunSimulation}
                  disabled={isSimulating}
                  className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-mono text-xs font-semibold shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSimulating ? 'animate-spin' : ''}`} />
                  Simulate Assembly
                </button>
              </div>

              {simResult && (
                <div className="p-3 rounded-lg bg-[#07070a] border border-white/[0.06] text-xs font-mono text-zinc-300 space-y-2">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span>
                      Active Sets: {simResult.appliedReferenceSets.length} • Examples Selected:{' '}
                      {simResult.selectedExamples.length}
                    </span>
                    <span className="text-emerald-400">
                      {simResult.hasTrainingContext ? 'Context Injected' : 'No Active Sets for Task'}
                    </span>
                  </div>
                  {simResult.hasTrainingContext && (
                    <pre className="text-[11px] text-zinc-300 max-h-36 overflow-y-auto whitespace-pre-wrap">
                      {simResult.systemInstructionDirective}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {/* Selected Dispatch Details */}
            {selectedRecord ? (
              <div className="space-y-4">
                <div className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400">
                  Recorded Dispatch // {selectedRecord.taskId}
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs font-mono">
                  <div className="p-3 rounded-xl bg-zinc-900 border border-white/[0.06]">
                    <span className="text-zinc-500 block text-[10px]">TARGET TASK</span>
                    <span className="text-white font-bold">{selectedRecord.taskType}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-zinc-900 border border-white/[0.06]">
                    <span className="text-zinc-500 block text-[10px]">MODEL DISPATCHED</span>
                    <span className="text-emerald-400 font-bold">{selectedRecord.model}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-zinc-900 border border-white/[0.06]">
                    <span className="text-zinc-500 block text-[10px]">ESTIMATED TOKEN BUDGET</span>
                    <span className="text-amber-400 font-bold">
                      ~{Math.round(selectedRecord.contextBudgetTokensEstimate)} tokens
                    </span>
                  </div>
                </div>

                {/* Applied Reference Sets */}
                <div className="space-y-2">
                  <span className="text-xs font-mono text-zinc-400 uppercase font-semibold">
                    Applied Reference Sets ({selectedRecord.appliedReferenceSets.length})
                  </span>
                  <div className="divide-y divide-white/[0.04] border border-white/[0.06] rounded-xl overflow-hidden bg-zinc-900/60">
                    {selectedRecord.appliedReferenceSets.map((s) => (
                      <div key={s.id} className="p-3 flex items-center justify-between text-xs font-mono">
                        <span className="text-white font-semibold">{s.title}</span>
                        <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
                          <span>v{s.version}</span>
                          <span>•</span>
                          <span>Priority {s.priority}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Selected Examples */}
                <div className="space-y-2">
                  <span className="text-xs font-mono text-zinc-400 uppercase font-semibold">
                    Selected Examples ({selectedRecord.selectedExamples.length})
                  </span>
                  <div className="divide-y divide-white/[0.04] border border-white/[0.06] rounded-xl overflow-hidden bg-zinc-900/60">
                    {selectedRecord.selectedExamples.map((ex) => (
                      <div key={ex.exampleId} className="p-3 flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <span className="text-amber-400 font-bold">#{ex.orderIndex}</span>
                          <span className="text-zinc-200">{ex.title}</span>
                        </div>
                        <div className="flex items-center gap-3 text-zinc-400 text-[11px]">
                          <span>Image: {ex.hasImage ? 'Inline Data' : 'None'}</span>
                          <span>•</span>
                          <span>Annotations: {ex.hasAnnotations ? 'Included' : 'None'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Instructions Preview */}
                <div className="space-y-2">
                  <span className="text-xs font-mono text-zinc-400 uppercase font-semibold">
                    Assembled Instruction Directive
                  </span>
                  <pre className="p-4 rounded-xl bg-[#07070a] border border-white/[0.08] text-zinc-300 font-mono text-xs whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
                    {selectedRecord.assembledInstructionPreview}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="text-center text-zinc-500 text-xs py-8">
                Select a dispatch record from the left to inspect details.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
