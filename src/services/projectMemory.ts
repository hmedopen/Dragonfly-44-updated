/**
 * Dragonfly 44: System #5 — Project Memory & AI Data Integrity Master Service
 * 
 * Master facade exposing canonical API contracts, candidate lifecycle,
 * transactional commits, scoped retrieval, integrity auditing, and backward-compatible projections.
 */

import type {
  KnowledgeRecord,
  KnowledgeRevision,
  KnowledgeAuditEvent,
  KnowledgeConflictSet,
  ProjectMemorySettings,
  KnowledgeScope,
  RetrievalRequest,
  ContextBundle,
  MemoryResult,
  ResultError,
  CharacterProfilePayload,
  GlossaryTermPayload,
  RelationshipPayload,
} from '../types/memory';
import { MEMORY_ISSUE_CODES } from '../types/memory';
import type { ProjectLoreLedger, ChapterIntelligence } from '../types/workbench';
import {
  ingestKnowledgeProposals,
  type IntakeProposalEnvelope,
  type CandidateIntakeOutcome,
} from '../lib/memory/candidateIntake';
import {
  approveKnowledgeCandidate,
  rejectKnowledgeCandidate,
  reopenKnowledgeCandidate,
  updateKnowledgeRecordWithCas,
  resolveKnowledgeConflict,
} from '../lib/memory/governanceEngine';
import { buildContextBundle, formatContextBundleForPrompt } from '../lib/memory/contextRetrieval';
import { runIntegrityCheck, type IntegrityReport } from '../lib/memory/integrityChecker';
import { strictParseJson } from '../lib/memory/memoryValidator';
import { getMemoryDriver, type IMemoryDriver, setMemoryDriver } from './memoryRepository';

export class ProjectMemoryService {
  private driver: IMemoryDriver;

  constructor(driver?: IMemoryDriver) {
    this.driver = driver || getMemoryDriver();
  }

  setDriver(driver: IMemoryDriver): void {
    this.driver = driver;
    setMemoryDriver(driver);
  }

  getDriver(): IMemoryDriver {
    return this.driver;
  }

  // 1. Candidate Proposal Submission
  async submitKnowledgeProposal(
    envelope: IntakeProposalEnvelope
  ): Promise<MemoryResult<CandidateIntakeOutcome>> {
    return ingestKnowledgeProposals(envelope);
  }

  // 2. Candidate Approval
  async approveKnowledgeCandidate(
    candidateId: string,
    expectedRevision: number | null = null,
    actor: string = 'user'
  ): Promise<MemoryResult<KnowledgeRecord>> {
    return approveKnowledgeCandidate(candidateId, expectedRevision, actor);
  }

  // 3. Candidate Rejection
  async rejectKnowledgeCandidate(
    candidateId: string,
    reason: string = 'Rejected by user',
    actor: string = 'user'
  ): Promise<MemoryResult<boolean>> {
    return rejectKnowledgeCandidate(candidateId, reason, actor);
  }

  // 4. Candidate Reopen
  async reopenKnowledgeCandidate(
    candidateId: string,
    reason: string = 'Reopened for re-evaluation',
    actor: string = 'user'
  ): Promise<MemoryResult<boolean>> {
    return reopenKnowledgeCandidate(candidateId, reason, actor);
  }

  // 5. Update Record with CAS
  async updateKnowledgeRecord(
    recordId: string,
    expectedRevision: number,
    patch: Partial<KnowledgeRecord>,
    actor: string = 'user',
    changeReason: string = 'Record updated'
  ): Promise<MemoryResult<KnowledgeRecord>> {
    return updateKnowledgeRecordWithCas(recordId, expectedRevision, patch, actor, changeReason);
  }

  // 6. Conflict Resolution
  async resolveKnowledgeConflict(
    conflictId: string,
    resolutionDecision: string,
    winningPayload: any,
    actor: string = 'user'
  ): Promise<MemoryResult<KnowledgeConflictSet>> {
    return resolveKnowledgeConflict(conflictId, resolutionDecision, winningPayload, actor);
  }

  // 7. Context Bundle Retrieval
  async buildContextBundle(request: RetrievalRequest): Promise<ContextBundle> {
    return buildContextBundle(request);
  }

  // 8. Delimited Prompt Context
  async getPromptSafeContext(request: RetrievalRequest): Promise<string> {
    const bundle = await buildContextBundle(request);
    return formatContextBundleForPrompt(bundle);
  }

  // 9. Structured AI Payload Validation Boundary
  validateStructuredPayload(
    contract: string,
    schemaVersion: string,
    rawPayload: string | object,
    _producer: string
  ): { valid: boolean; data?: any; errors: ResultError[] } {
    if (contract !== 'dragonfly.memory.proposal') {
      return {
        valid: false,
        errors: [{ code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE, message: `Unsupported contract "${contract}"` }],
      };
    }
    if (schemaVersion !== '1.0') {
      return {
        valid: false,
        errors: [{ code: MEMORY_ISSUE_CODES.UNSUPPORTED_SCHEMA_VERSION, message: `Unsupported schema version "${schemaVersion}"` }],
      };
    }

    let parsed = rawPayload;
    if (typeof rawPayload === 'string') {
      const parseRes = strictParseJson(rawPayload);
      if (!parseRes.success) {
        return { valid: false, errors: parseRes.errors };
      }
      parsed = parseRes.data;
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        valid: false,
        errors: [{ code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE, message: 'Payload must be a non-null object' }],
      };
    }

    return { valid: true, data: parsed, errors: [] };
  }

  // 10. Record History & Provenance
  async getKnowledgeHistory(recordId: string): Promise<{
    record: KnowledgeRecord | null;
    revisions: KnowledgeRevision[];
    auditEvents: KnowledgeAuditEvent[];
  }> {
    const record = await this.driver.getRecord(recordId);
    const revisions = await this.driver.getRevisions(recordId);
    const auditEvents = await this.driver.getAuditEventsForRecord(recordId);
    return { record, revisions, auditEvents };
  }

  // 11. System Integrity Audit
  async runIntegrityCheck(projectId: string): Promise<IntegrityReport> {
    return runIntegrityCheck(projectId);
  }

  // 12. Settings Management
  async getProjectSettings(projectId: string): Promise<ProjectMemorySettings> {
    return this.driver.getProjectSettings(projectId);
  }

  async updateProjectSettings(settings: ProjectMemorySettings): Promise<void> {
    await this.driver.saveProjectSettings(settings);
  }

  // 13. Snapshots
  async getKnowledgeSnapshot(
    projectId: string,
    scope: KnowledgeScope,
    snapshotRevision?: number
  ): Promise<{
    projectId: string;
    scope: KnowledgeScope;
    snapshotRevision: number;
    records: KnowledgeRecord[];
  }> {
    const all = await this.driver.getRecordsByProject(projectId);
    const approved = all.filter((r) => r.status === 'approved');
    let maxRev = snapshotRevision || 1;
    for (const r of approved) {
      if (r.revision > maxRev) maxRev = r.revision;
    }
    return {
      projectId,
      scope,
      snapshotRevision: maxRev,
      records: approved,
    };
  }

  // 14. Backward Compatibility: Project to Legacy ProjectLoreLedger
  async projectToLegacyProjectLore(projectId: string): Promise<ProjectLoreLedger> {
    const records = await this.driver.getRecordsByProject(projectId);
    const approved = records.filter((r) => r.status === 'approved');

    const characters = approved
      .filter((r) => r.record_type === 'character_profile')
      .map((r) => {
        const payload = r.payload as CharacterProfilePayload;
        return {
          id: r.record_id,
          nameOriginal: payload.canonical_name || r.canonical_key,
          nameArabic: payload.canonical_name || '',
          gender: payload.gender || 'unknown',
          title: payload.title,
          aliases: payload.aliases || [],
          confidence: r.confidence?.interpretation || 0.9,
          provenance: {
            sourceType: (r.trust_class === 'user_confirmed' ? 'user_defined' : 'ai_detected') as any,
            timestamp: r.updated_at,
          },
        };
      });

    const terms = approved
      .filter((r) => r.record_type === 'glossary_term')
      .map((r) => {
        const payload = r.payload as GlossaryTermPayload;
        return {
          id: r.record_id,
          termOriginal: payload.source_form || r.canonical_key,
          termArabic: payload.approved_rendering || '',
          category: payload.category || 'term',
          confidence: r.confidence?.extraction || 0.9,
          provenance: {
            sourceType: (r.trust_class === 'user_confirmed' ? 'user_defined' : 'ai_detected') as any,
            timestamp: r.updated_at,
          },
        };
      });

    const speakerRelationships = approved
      .filter((r) => r.record_type === 'relationship')
      .map((r) => {
        const payload = r.payload as RelationshipPayload;
        return {
          id: r.record_id,
          speaker: payload.speaker || '',
          addressee: payload.addressee || '',
          tone: payload.tone || 'normal',
          pronouns: payload.pronouns,
          hierarchy: payload.hierarchy,
          confidence: r.confidence?.interpretation || 0.9,
        };
      });

    return {
      projectId,
      characters,
      terms,
      speakerRelationships,
      lastUpdated: Date.now(),
    };
  }

  // 15. Backward Compatibility: Project to Legacy ChapterIntelligence
  async projectToLegacyChapterIntelligence(
    chapterId: string,
    projectId: string = 'default'
  ): Promise<ChapterIntelligence> {
    const scope: KnowledgeScope = { level: 'chapter', chapter_id: chapterId, project_id: projectId };
    const bundle = await buildContextBundle({
      project_id: projectId,
      consumer: 'intelligence_projection',
      operation_id: `proj-${chapterId}`,
      scope,
    });

    const characters = bundle.items
      .filter((i) => i.record_type === 'character_profile')
      .map((i) => ({
        id: i.record_id,
        nameOriginal: i.content.canonical_name || i.canonical_key,
        nameArabic: i.content.canonical_name || '',
        gender: i.content.gender || 'unknown',
        title: i.content.title,
        aliases: i.content.aliases || [],
      }));

    const terms = bundle.items
      .filter((i) => i.record_type === 'glossary_term')
      .map((i) => ({
        id: i.record_id,
        termOriginal: i.content.source_form || i.canonical_key,
        termArabic: i.content.approved_rendering || '',
        category: i.content.category || 'term',
      }));

    const speakerPairs = bundle.items
      .filter((i) => i.record_type === 'relationship')
      .map((i) => ({
        id: i.record_id,
        speaker: i.content.speaker || '',
        addressee: i.content.addressee || '',
        tone: i.content.tone || 'normal',
        pronouns: i.content.pronouns,
        hierarchy: i.content.hierarchy,
      }));

    return {
      chapterId,
      projectId,
      summary: '',
      sceneFlow: [],
      activeCharacters: characters.map((c) => c.nameArabic),
      characterRoster: characters,
      termsHarvested: terms,
      speakerPairs,
      lastScannedPageIndex: 1,
      lastUpdated: Date.now(),
    };
  }
}

export const projectMemory = new ProjectMemoryService();
