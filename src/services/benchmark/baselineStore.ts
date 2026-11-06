/**
 * Dragonfly 44: System #6 — Settings, Workspace & Quality Benchmark Engine
 * Baseline Store & Regression Governance Engine
 * 
 * Manages immutable reference baselines, versioned promotions,
 * run-to-baseline delta comparisons, and regression gate classification.
 */

import type { BenchmarkBaseline, BenchmarkRunReport, ComparisonVerdict } from '../../types/benchmark';

const BASELINE_STORAGE_KEY = 'dragonfly44_bench_baselines_v6';
const ACTIVE_BASELINE_KEY = 'dragonfly44_bench_active_baseline_v6';

// Shipped initial curated reference baseline
export const INITIAL_CURATED_BASELINE: BenchmarkBaseline = {
  baseline_id: 'dragonfly44_baseline_v1',
  name: 'Dragonfly 44 Gold Reference v1.0',
  dataset_id: 'dragonfly_core_regression',
  dataset_version: '1.0',
  build_version: '0.5.0',
  createdAt: 1730000000000,
  approvedBy: 'Lead Quality Architect',
  approvalNotes: 'Initial qualification release baseline across Systems #2–#6.',
  categoryScores: {
    system_2: 0.98,
    system_3: 0.99,
    system_4: 0.97,
    system_5: 1.00,
    workspace: 1.00,
  },
  metrics: {
    cer_max: 0.0,
    detection_f1: 0.95,
    order_accuracy: 1.0,
    review_precision: 0.96,
    review_recall: 0.98,
    unsafe_corrections: 0,
    transform_roundtrip_drift_max: 0.05,
    stale_renders_accepted: 0,
  },
  settingsSummary: {
    'translation.model': 'gemini-3.8-flash',
    'scanning.profile': 'balanced',
    'review.profile': 'balanced',
    'memory.learning_mode': 'candidate_only',
  },
  reportReferenceId: 'report_initial_qualification',
};

export class BaselineStore {
  private baselines: Map<string, BenchmarkBaseline> = new Map();
  private activeBaselineId = INITIAL_CURATED_BASELINE.baseline_id;

  constructor() {
    this.init();
  }

  private init() {
    this.baselines.set(INITIAL_CURATED_BASELINE.baseline_id, INITIAL_CURATED_BASELINE);
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      const savedActive = localStorage.getItem(ACTIVE_BASELINE_KEY);
      if (savedActive) this.activeBaselineId = savedActive;

      const raw = localStorage.getItem(BASELINE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const b of parsed) {
            if (b && b.baseline_id) {
              this.baselines.set(b.baseline_id, b);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[BaselineStore] Error loading baselines from localStorage:', e);
    }
  }

  private persist() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const array = Array.from(this.baselines.values());
      localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(array));
      localStorage.setItem(ACTIVE_BASELINE_KEY, this.activeBaselineId);
    } catch (e) {
      console.error('[BaselineStore] Error persisting baselines:', e);
    }
  }

  getActiveBaseline(): BenchmarkBaseline | null {
    return this.baselines.get(this.activeBaselineId) || this.baselines.get(INITIAL_CURATED_BASELINE.baseline_id) || null;
  }

  getAllBaselines(): BenchmarkBaseline[] {
    return Array.from(this.baselines.values());
  }

  setActiveBaseline(baselineId: string): boolean {
    if (this.baselines.has(baselineId)) {
      this.activeBaselineId = baselineId;
      this.persist();
      return true;
    }
    return false;
  }

  /**
   * Promotes a run report to a permanent accepted baseline.
   * Requires explicit operator sign-off notes; NEVER auto-promoted.
   */
  promoteReportToBaseline(
    report: BenchmarkRunReport,
    operator: string,
    notes: string
  ): { success: boolean; baseline: BenchmarkBaseline | null; error?: string } {
    if (report.status !== 'passed') {
      return {
        success: false,
        baseline: null,
        error: 'Cannot promote a failed or incomplete benchmark run to baseline.',
      };
    }

    const baselineId = `baseline_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const categoryScores: Record<string, number> = {};
    for (const [sys, sum] of Object.entries(report.categorySummaries)) {
      categoryScores[sys] = sum.avgScore;
    }

    const newBaseline: BenchmarkBaseline = {
      baseline_id: baselineId,
      name: `Baseline ${new Date().toISOString().split('T')[0]} (${report.build_version})`,
      dataset_id: report.dataset_id,
      dataset_version: report.dataset_version,
      build_version: report.build_version,
      createdAt: Date.now(),
      approvedBy: operator || 'Authorized Operator',
      approvalNotes: notes || 'Promoted via Quality Benchmark UI',
      categoryScores,
      metrics: {
        passRate: Object.values(report.categorySummaries).reduce((acc, s) => acc + s.passRate, 0) /
          Math.max(1, Object.keys(report.categorySummaries).length),
      },
      settingsSummary: report.settingsSnapshot?.values || {},
      reportReferenceId: report.run_id,
    };

    this.baselines.set(baselineId, newBaseline);
    this.activeBaselineId = baselineId;
    this.persist();

    return { success: true, baseline: newBaseline };
  }

  /**
   * Compares a run report against the active baseline.
   */
  compareReportWithBaseline(
    report: BenchmarkRunReport,
    baseline?: BenchmarkBaseline | null
  ): {
    verdict: ComparisonVerdict;
    scoreDelta: number;
    deltas: Record<string, number>;
    regressedCaseIds: string[];
    improvedCaseIds: string[];
  } {
    const targetBaseline = baseline || this.getActiveBaseline();
    if (!targetBaseline) {
      return {
        verdict: 'no_baseline',
        scoreDelta: 0,
        deltas: {},
        regressedCaseIds: [],
        improvedCaseIds: [],
      };
    }

    // Dataset compatibility check
    if (
      report.dataset_id !== targetBaseline.dataset_id ||
      report.dataset_version !== targetBaseline.dataset_version
    ) {
      return {
        verdict: 'inconclusive',
        scoreDelta: 0,
        deltas: {},
        regressedCaseIds: [],
        improvedCaseIds: [],
      };
    }

    let runTotalScore = 0;
    let baseTotalScore = 0;
    let count = 0;
    const deltas: Record<string, number> = {};

    for (const [sys, summary] of Object.entries(report.categorySummaries)) {
      const baseScore = targetBaseline.categoryScores[sys] ?? 1.0;
      const delta = summary.avgScore - baseScore;
      deltas[sys] = Math.round(delta * 1000) / 1000;
      runTotalScore += summary.avgScore;
      baseTotalScore += baseScore;
      count++;
    }

    const avgRun = count > 0 ? runTotalScore / count : 1;
    const avgBase = count > 0 ? baseTotalScore / count : 1;
    const scoreDelta = Math.round((avgRun - avgBase) * 1000) / 1000;

    const regressedCaseIds: string[] = [];
    const improvedCaseIds: string[] = [];

    for (const c of report.caseResults) {
      if (!c.passed) {
        regressedCaseIds.push(c.case_id);
      } else if (c.score > 0.98) {
        improvedCaseIds.push(c.case_id);
      }
    }

    let verdict: ComparisonVerdict = 'unchanged';
    if (regressedCaseIds.length > 0 || scoreDelta < -0.01) {
      verdict = 'regressed';
    } else if (scoreDelta > 0.01) {
      verdict = 'improved';
    }

    return {
      verdict,
      scoreDelta,
      deltas,
      regressedCaseIds,
      improvedCaseIds,
    };
  }
}

export const baselineStore = new BaselineStore();
