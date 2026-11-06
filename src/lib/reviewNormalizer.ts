/**
 * Dragonfly 44: System #4 — Review & Quality Control Engine
 * Finding Normalization & Deduplication Module
 *
 * Implements Section 12 of the System #4 specification:
 * - Maps findings from multiple evaluators to canonical issue codes
 * - Merges true duplicates referring to the same root defect
 * - Preserves independent findings even when sharing the same entity
 * - Prioritizes findings by severity and actionability
 */

import type { ReviewFinding, ReviewSeverity } from '../types/review';

const SEVERITY_WEIGHT: Record<ReviewSeverity, number> = {
  critical: 5,
  major: 4,
  moderate: 3,
  minor: 2,
  informational: 1,
};

export function normalizeAndDeduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
  if (!findings || findings.length === 0) return [];

  const deduplicated: ReviewFinding[] = [];
  const signatureMap = new Map<string, ReviewFinding>();

  for (const finding of findings) {
    const entityKey = `${finding.affectedEntity.pageId}:${finding.affectedEntity.bubbleId || 'page'}`;
    // A signature combines entity + issueCode family
    const signature = `${entityKey}:${finding.domain}:${finding.issueCode}`;

    if (!signatureMap.has(signature)) {
      signatureMap.set(signature, finding);
      deduplicated.push(finding);
    } else {
      // Duplicate candidate detected! Check if we should upgrade evidence or severity
      const existing = signatureMap.get(signature)!;
      const existingWeight = SEVERITY_WEIGHT[existing.severity] || 0;
      const newWeight = SEVERITY_WEIGHT[finding.severity] || 0;

      if (newWeight > existingWeight) {
        // Replace with higher severity finding while preserving related references
        existing.severity = finding.severity;
        existing.observation = finding.observation;
        if (finding.proposedCorrection && !existing.proposedCorrection) {
          existing.proposedCorrection = finding.proposedCorrection;
        }
      }

      // Link related finding ID if available
      if (!existing.relatedFindingIds) {
        existing.relatedFindingIds = [];
      }
      existing.relatedFindingIds.push(finding.findingId);
    }
  }

  // Sort by severity descending (critical -> major -> moderate -> minor -> informational)
  deduplicated.sort((a, b) => {
    const wa = SEVERITY_WEIGHT[a.severity] || 0;
    const wb = SEVERITY_WEIGHT[b.severity] || 0;
    return wb - wa;
  });

  return deduplicated;
}
