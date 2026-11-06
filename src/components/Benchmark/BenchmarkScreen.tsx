import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  Cpu,
  Activity,
  Award,
  Filter
} from 'lucide-react';
import type {
  BenchmarkExecutionMode,
  BenchmarkRunReport,
  BenchmarkSystem,
} from '../../types/benchmark';
import { benchmarkRunner } from '../../services/benchmark/benchmarkRunner';
import { baselineStore } from '../../services/benchmark/baselineStore';

interface BenchmarkScreenProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BenchmarkScreen: React.FC<BenchmarkScreenProps> = ({ isOpen, onClose }) => {
  const [mode, setMode] = useState<BenchmarkExecutionMode>('smoke');
  const [selectedSystem, setSelectedSystem] = useState<BenchmarkSystem | 'all'>('all');
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<BenchmarkRunReport | null>(() => benchmarkRunner.getLatestReport());
  const [activeTab, setActiveTab] = useState<'overview' | 'cases' | 'baselines'>('overview');
  const [caseFilter, setCaseFilter] = useState<'all' | 'failed' | 'passed'>('all');
  const [isPromoting, setIsPromoting] = useState(false);
  const [operatorName, setOperatorName] = useState('Quality Architect');
  const [promotionNotes, setPromotionNotes] = useState('');
  const [promotionSuccess, setPromotionSuccess] = useState<string | null>(null);

  useEffect(() => {
    const unsub = benchmarkRunner.subscribe((newReport) => {
      setReport(newReport);
      setIsRunning(false);
    });
    return () => unsub();
  }, []);

  const handleRun = async () => {
    setIsRunning(true);
    setPromotionSuccess(null);
    try {
      const rep = await benchmarkRunner.runSuite(
        mode,
        selectedSystem === 'all' ? undefined : selectedSystem
      );
      setReport(rep);
    } catch (err: any) {
      alert(`Benchmark run failed: ${err?.message || err}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleCancel = () => {
    benchmarkRunner.cancelRun();
  };

  const handlePromoteBaseline = () => {
    if (!report) return;
    const res = baselineStore.promoteReportToBaseline(report, operatorName, promotionNotes);
    if (res.success && res.baseline) {
      setPromotionSuccess(`Promoted baseline: ${res.baseline.baseline_id}`);
      setIsPromoting(false);
      setPromotionNotes('');
    } else {
      alert(`Promotion failed: ${res.error}`);
    }
  };

  if (!isOpen) return null;

  const activeBaseline = baselineStore.getActiveBaseline();
  const filteredCases = report?.caseResults.filter((c) => {
    if (caseFilter === 'failed') return !c.passed;
    if (caseFilter === 'passed') return c.passed;
    return true;
  }) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-5xl h-[88vh] bg-[#0c0d12] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans">
        {/* Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold tracking-wider uppercase text-zinc-100">
                  DRAGONFLY 44 // QUALITY BENCHMARK ENGINE
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-zinc-800 text-zinc-400 border border-white/[0.06]">
                  SYSTEM #6
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Ground-truth regression gates, geometry invariance, and multi-engine quality scoring.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Control Strip */}
        <div className="px-6 py-3 bg-[#0a0a0e] border-b border-white/[0.06] flex items-center justify-between shrink-0 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            {/* Mode Selector */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-zinc-900 border border-white/[0.08] text-xs font-mono">
              {(['smoke', 'focused', 'regression', 'full_qualification'] as BenchmarkExecutionMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={isRunning}
                  onClick={() => setMode(m)}
                  className={`px-2.5 py-1 rounded transition-colors cursor-pointer uppercase ${
                    mode === m
                      ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                      : 'text-zinc-400 hover:text-zinc-200 disabled:opacity-50'
                  }`}
                >
                  {m === 'full_qualification' ? 'Full Qual' : m}
                </button>
              ))}
            </div>

            {/* System Filter */}
            <div className="flex items-center gap-1.5 text-xs font-mono text-zinc-400">
              <Filter className="w-3.5 h-3.5 text-zinc-500" />
              <select
                value={selectedSystem}
                disabled={isRunning}
                onChange={(e) => setSelectedSystem(e.target.value as any)}
                className="bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-zinc-200 text-xs focus:outline-none"
              >
                <option value="all">All Systems</option>
                <option value="system_2">System #2 (Translation)</option>
                <option value="system_3">System #3 (Scanning)</option>
                <option value="system_4">System #4 (Review)</option>
                <option value="system_5">System #5 (Memory)</option>
                <option value="workspace">Workspace & Geometry</option>
              </select>
            </div>
          </div>

          {/* Run / Cancel Action */}
          <div className="flex items-center gap-2">
            {isRunning ? (
              <button
                type="button"
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-mono font-bold transition-all cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                <span>CANCEL RUN</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRun}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-mono font-bold transition-all cursor-pointer shadow-lg active:scale-95"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>EXECUTE BENCHMARK</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Strip */}
        <div className="px-6 border-b border-white/[0.06] bg-[#09090d] flex items-center gap-4 text-xs font-mono">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`py-2.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'overview'
                ? 'border-amber-400 text-amber-300 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Overview & Hard Gates
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cases')}
            className={`py-2.5 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'cases'
                ? 'border-amber-400 text-amber-300 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>Per-Case Outcomes</span>
            {report && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">
                {report.caseResults.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('baselines')}
            className={`py-2.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'baselines'
                ? 'border-amber-400 text-amber-300 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Baseline Governance
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {promotionSuccess && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{promotionSuccess}</span>
            </div>
          )}

          {!report && !isRunning && (
            <div className="h-64 flex flex-col items-center justify-center text-center gap-3 text-zinc-500 font-mono">
              <Cpu className="w-10 h-10 stroke-[1.2] text-zinc-600" />
              <p className="text-sm text-zinc-400">No benchmark run recorded yet in this session.</p>
              <p className="text-xs max-w-md text-zinc-600">
                Execute a benchmark in Smoke or Regression mode to evaluate OCR, translation fidelity, review accuracy, and workspace geometry.
              </p>
              <button
                type="button"
                onClick={handleRun}
                className="mt-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition-all cursor-pointer"
              >
                Start Smoke Benchmark
              </button>
            </div>
          )}

          {report && activeTab === 'overview' && (
            <>
              {/* Status Header Banner */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl bg-[#0e0f14] border border-white/[0.08] flex flex-col justify-between">
                  <span className="text-[10px] font-mono uppercase text-zinc-500">Run Status</span>
                  <div className="flex items-center gap-2 mt-1">
                    {report.status === 'passed' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : report.status === 'warning' ? (
                      <AlertTriangle className="w-5 h-5 text-amber-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-400" />
                    )}
                    <span className="text-sm font-mono font-bold uppercase text-zinc-100">
                      {report.status}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 mt-1">
                    Duration: {report.durationMs}ms
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-[#0e0f14] border border-white/[0.08] flex flex-col justify-between">
                  <span className="text-[10px] font-mono uppercase text-zinc-500">Hard Gates</span>
                  <div className="flex items-center gap-2 mt-1">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    <span className="text-sm font-mono font-bold text-zinc-100">
                      {Object.values(report.hardGates).filter((g) => g.passed).length} /{' '}
                      {Object.values(report.hardGates).length} Passed
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 mt-1">
                    Non-overridable release gates
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-[#0e0f14] border border-white/[0.08] flex flex-col justify-between">
                  <span className="text-[10px] font-mono uppercase text-zinc-500">Baseline Delta</span>
                  <div className="flex items-center gap-2 mt-1">
                    <Award className="w-5 h-5 text-sky-400" />
                    <span
                      className={`text-sm font-mono font-bold ${
                        (report.baselineComparison?.scoreDelta || 0) >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {report.baselineComparison
                        ? `${report.baselineComparison.scoreDelta >= 0 ? '+' : ''}${report.baselineComparison.scoreDelta}`
                        : 'N/A'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 mt-1 uppercase">
                    Verdict: {report.baselineComparison?.verdict || 'none'}
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-[#0e0f14] border border-white/[0.08] flex flex-col justify-between">
                  <span className="text-[10px] font-mono uppercase text-zinc-500">Dataset</span>
                  <span className="text-xs font-mono font-semibold text-zinc-200 mt-1 truncate">
                    {report.dataset_id}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500 mt-1">
                    v{report.dataset_version} • Build {report.build_version}
                  </span>
                </div>
              </div>

              {/* Hard Gates Breakdown */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                    Hard Release Gates (Section 7.6)
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">
                    Hard failures block release regardless of composite score
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {Object.values(report.hardGates).map((gate) => (
                    <div
                      key={gate.gate_id}
                      className={`p-3 rounded-xl border flex flex-col justify-between ${
                        gate.passed
                          ? 'bg-[#0a0f0d] border-emerald-500/20 text-emerald-300'
                          : 'bg-[#140a0c] border-rose-500/30 text-rose-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold">{gate.name}</span>
                        {gate.passed ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            PASS
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse">
                            FAIL ({gate.violationsCount})
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">
                        {gate.description}
                      </p>
                      {gate.failingCaseIds.length > 0 && (
                        <div className="mt-2 text-[9px] font-mono text-rose-400">
                          Failing cases: {gate.failingCaseIds.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Multi-System Category Cards */}
              <div className="space-y-3">
                <span className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                  Multi-System Quality Performance
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {Object.entries(report.categorySummaries)
                    .filter(([sys]) => sys !== 'end_to_end')
                    .map(([sys, sum]) => {
                      const labels: Record<string, string> = {
                        system_2: 'System #2 Translation',
                        system_3: 'System #3 Scanning',
                        system_4: 'System #4 Review',
                        system_5: 'System #5 Memory',
                        workspace: 'Workspace Geometry',
                      };
                      return (
                        <div
                          key={sys}
                          className="p-3.5 rounded-xl bg-[#09090c] border border-white/[0.08] flex flex-col justify-between"
                        >
                          <span className="text-[11px] font-mono uppercase text-zinc-400 font-bold truncate">
                            {labels[sys] || sys}
                          </span>
                          <div className="my-2 flex items-baseline justify-between">
                            <span className="text-2xl font-mono font-bold text-zinc-100">
                              {(sum.avgScore * 100).toFixed(1)}%
                            </span>
                            <span className="text-[10px] font-mono text-zinc-500">
                              {sum.passedCount}/{sum.sampleCount} cases
                            </span>
                          </div>
                          <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                sum.avgScore >= 0.95 ? 'bg-emerald-500' : sum.avgScore >= 0.85 ? 'bg-amber-500' : 'bg-rose-500'
                              }`}
                              style={{ width: `${Math.round(sum.avgScore * 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </>
          )}

          {report && activeTab === 'cases' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                  Detailed Test Cases ({filteredCases.length})
                </span>
                <div className="flex items-center gap-1 text-xs font-mono">
                  {(['all', 'failed', 'passed'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setCaseFilter(f)}
                      className={`px-2 py-0.5 rounded capitalize ${
                        caseFilter === f
                          ? 'bg-zinc-700 text-white font-bold'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {filteredCases.map((c) => (
                  <div
                    key={c.case_id}
                    className="p-3.5 rounded-xl bg-[#09090c] border border-white/[0.08] flex flex-col gap-2 hover:border-white/[0.14] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {c.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                        )}
                        <span className="font-mono text-xs font-bold text-zinc-200">
                          {c.case_id}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-zinc-800 text-zinc-400 uppercase">
                          {c.system}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-bold text-zinc-300">
                          Score: {(c.score * 100).toFixed(1)}%
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500">
                          {c.durationMs}ms
                        </span>
                      </div>
                    </div>

                    {c.details && (
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        {c.details}
                      </p>
                    )}

                    {Object.keys(c.metrics).length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.04]">
                        {Object.entries(c.metrics).map(([k, v]) => (
                          <span key={k} className="text-[10px] font-mono text-zinc-500">
                            {k}: <span className="text-zinc-300">{typeof v === 'number' ? v.toFixed(3) : v}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'baselines' && (
            <div className="space-y-6">
              {/* Active Baseline Card */}
              <div className="p-4 rounded-xl bg-[#0a0b10] border border-amber-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-mono font-bold text-amber-300 uppercase">
                      Active Reference Baseline
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    LOCKED FOR COMPARISON
                  </span>
                </div>

                {activeBaseline ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                    <div>
                      <span className="text-zinc-500 text-[10px] block">Baseline ID</span>
                      <span className="text-zinc-200">{activeBaseline.baseline_id}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 text-[10px] block">Dataset</span>
                      <span className="text-zinc-200">{activeBaseline.dataset_id} v{activeBaseline.dataset_version}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 text-[10px] block">Approved By</span>
                      <span className="text-zinc-200">{activeBaseline.approvedBy}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 text-[10px] block">Date</span>
                      <span className="text-zinc-200">{new Date(activeBaseline.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 font-mono">No baseline active.</p>
                )}
              </div>

              {/* Promote Latest Run to Baseline */}
              {report && report.status === 'passed' && (
                <div className="p-4 rounded-xl bg-[#09090c] border border-white/[0.08] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-mono font-bold uppercase text-zinc-200">
                        Promote Current Run as New Baseline
                      </span>
                      <p className="text-[11px] text-zinc-500">
                        Section 8.1: Promotion requires explicit operator sign-off and review notes; never auto-promoted.
                      </p>
                    </div>
                    {!isPromoting && (
                      <button
                        type="button"
                        onClick={() => setIsPromoting(true)}
                        className="px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-xs font-mono font-bold transition-all cursor-pointer"
                      >
                        Promote Run
                      </button>
                    )}
                  </div>

                  {isPromoting && (
                    <div className="space-y-3 pt-2 border-t border-white/[0.06]">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-mono text-zinc-400 block mb-1">
                            Reviewer / Sign-off Identity
                          </label>
                          <input
                            type="text"
                            value={operatorName}
                            onChange={(e) => setOperatorName(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-white/[0.10] text-zinc-200 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-mono text-zinc-400 block mb-1">
                            Promotion Notes & Tradeoffs
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Qualification verified with zero regressions"
                            value={promotionNotes}
                            onChange={(e) => setPromotionNotes(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-white/[0.10] text-zinc-200 text-xs font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setIsPromoting(false)}
                          className="px-3 py-1 rounded text-zinc-400 hover:text-white text-xs font-mono"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handlePromoteBaseline}
                          className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold transition-all cursor-pointer"
                        >
                          Confirm & Lock Baseline
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-12 px-6 border-t border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <span className="text-[10px] font-mono text-zinc-500">
            DRAGONFLY 44 QUALITY ENGINE // v0.5.0
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs font-bold transition-all cursor-pointer"
          >
            DISMISS
          </button>
        </div>
      </div>
    </div>
  );
};
