/**
 * Folio Script: System #6 — Settings, Workspace & Quality Benchmark Engine
 * Canonical Benchmark Framework Types & Data Contracts
 */

import type { SettingsSnapshot } from './settings';

export type BenchmarkSystem = 'system_2' | 'system_3' | 'system_4' | 'system_5' | 'workspace' | 'end_to_end';

export type BenchmarkExecutionMode = 'smoke' | 'focused' | 'regression' | 'full_qualification';

export type BenchmarkRunStatus = 'passed' | 'failed' | 'warning' | 'incomplete' | 'running';

export type ComparisonVerdict = 'improved' | 'unchanged' | 'regressed' | 'inconclusive' | 'no_baseline';

export interface GroundTruthGeometry {
  box_2d: [number, number, number, number];
  polygon?: Array<[number, number]>;
  classification?: string;
  orderIndex?: number;
}

export interface BenchmarkCaseGroundTruth {
  text?: string;
  normalizedText?: string;
  regions?: GroundTruthGeometry[];
  bubbleAssociations?: Array<{ textId: string; regionId: string }>;
  readingOrder?: string[];
  referenceTranslation?: string;
  glossaryMatches?: Array<{ source: string; target: string }>;
  expectedFindings?: Array<{ category: string; severity: string; issueCode?: string }>;
  forbiddenFindings?: string[]; // Things that MUST NOT be flagged (e.g. Algerian dialect)
  expectedLoreEntries?: Array<{ key: string; status: string }>;
  expectedHitObjectIds?: Record<string, string>; // screenPointKey -> expectedObjectId
}

export interface BenchmarkCase {
  case_id: string;
  name: string;
  system: BenchmarkSystem;
  difficulty_tags: string[];
  input_data: any;
  ground_truth: BenchmarkCaseGroundTruth;
  expected_metrics?: Record<string, number>;
}

export interface BenchmarkDatasetManifest {
  dataset_id: string;
  version: string;
  name: string;
  license: string;
  source_provenance: string;
  description: string;
  cases: BenchmarkCase[];
  createdAt: number;
}

export interface CaseMetricResult {
  case_id: string;
  system: BenchmarkSystem;
  passed: boolean;
  score: number; // 0.0 - 1.0
  metrics: Record<string, number>;
  hardGateViolations: string[];
  durationMs: number;
  details?: string;
}

export interface HardGateResult {
  gate_id: string;
  name: string;
  description: string;
  passed: boolean;
  violationsCount: number;
  failingCaseIds: string[];
}

export interface CategoryMetricSummary {
  system: BenchmarkSystem;
  sampleCount: number;
  passedCount: number;
  failedCount: number;
  passRate: number;
  avgScore: number;
  metrics: Record<string, number>;
}

export interface BenchmarkRunReport {
  run_id: string;
  mode: BenchmarkExecutionMode;
  dataset_id: string;
  dataset_version: string;
  build_version: string;
  status: BenchmarkRunStatus;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  settingsSnapshot: SettingsSnapshot;
  hardGates: Record<string, HardGateResult>;
  categorySummaries: Record<BenchmarkSystem, CategoryMetricSummary>;
  caseResults: CaseMetricResult[];
  baselineComparison?: {
    baseline_id: string;
    verdict: ComparisonVerdict;
    scoreDelta: number;
    deltas: Record<string, number>;
    regressedCaseIds: string[];
    improvedCaseIds: string[];
  };
  reproducibility: {
    appVersion: string;
    environment: string;
    datasetHash: string;
  };
}

export interface BenchmarkBaseline {
  baseline_id: string;
  name: string;
  dataset_id: string;
  dataset_version: string;
  build_version: string;
  createdAt: number;
  approvedBy: string;
  approvalNotes?: string;
  categoryScores: Record<string, number>;
  metrics: Record<string, number>;
  settingsSummary: Record<string, any>;
  reportReferenceId: string;
}
