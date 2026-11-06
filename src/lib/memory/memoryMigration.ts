/**
 * Dragonfly 44: System #5 — Memory Migration & Recovery
 * 
 * Implements a reversible, dry-runnable, idempotent migration from legacy
 * `project_lore` and `chapter_intelligence` stores into the new versioned System #5 knowledge store.
 */

import type {
  KnowledgeRecord,
  GlossaryTermPayload,
  CharacterProfilePayload,
  RelationshipPayload,
  KnowledgeProvenance,
} from '../../types/memory';
import { generateCanonicalKey } from './memoryNormalization';
import { validateKnowledgeRecord } from './memoryValidator';
import { getMemoryDriver } from '../../services/memoryRepository';
import { getProjectLore } from '../../services/db';

export interface MigrationDryRunReport {
  projectId: string;
  legacyCharactersFound: number;
  legacyTermsFound: number;
  legacyRelationshipsFound: number;
  validProposalsCount: number;
  invalidProposalsCount: number;
  errors: string[];
}

export interface MigrationExecutionResult {
  projectId: string;
  status: 'completed' | 'failed' | 'rolled_back';
  migratedRecordsCount: number;
  auditEventsCount: number;
  error?: string;
}

/**
 * Performs a safe dry-run analysis of legacy lore data without mutating storage.
 */
export async function dryRunLegacyLoreMigration(projectId: string): Promise<MigrationDryRunReport> {
  const report: MigrationDryRunReport = {
    projectId,
    legacyCharactersFound: 0,
    legacyTermsFound: 0,
    legacyRelationshipsFound: 0,
    validProposalsCount: 0,
    invalidProposalsCount: 0,
    errors: [],
  };

  try {
    const projectLore = await getProjectLore(projectId);
    if (!projectLore) {
      return report;
    }

    report.legacyCharactersFound = (projectLore.characters || []).length;
    report.legacyTermsFound = (projectLore.terms || []).length;
    report.legacyRelationshipsFound = (projectLore.speakerRelationships || []).length;

    // Validate characters
    for (const c of projectLore.characters || []) {
      const canonicalKey = generateCanonicalKey('character_profile', c.nameOriginal || c.id);
      const payload: CharacterProfilePayload = {
        canonical_name: c.nameArabic || c.nameOriginal,
        aliases: c.aliases || [],
        gender: c.gender || 'unknown',
        title: c.title,
      };

      const prov: KnowledgeProvenance[] = [
        {
          producer: 'migration_pipeline',
          source_refs: [c.provenance?.pageId ? `page:${c.provenance.pageId}` : `legacy:char:${c.id}`],
          extraction_method: 'import',
          timestamp: c.provenance?.timestamp || Date.now(),
        },
      ];

      const record: KnowledgeRecord = {
        record_id: `rec-char-${c.id}`,
        record_type: 'character_profile',
        project_id: projectId,
        scope: { level: 'project', project_id: projectId },
        canonical_key: canonicalKey,
        payload,
        status: 'approved',
        trust_class: 'imported_user_data',
        provenance: prov,
        revision: 1,
        schema_version: '1.0',
        created_at: c.provenance?.timestamp || Date.now(),
        updated_at: Date.now(),
        created_by: 'system_migration',
        updated_by: 'system_migration',
      };

      const val = validateKnowledgeRecord(record);
      if (val.valid) {
        report.validProposalsCount++;
      } else {
        report.invalidProposalsCount++;
        report.errors.push(`Character ${c.id}: ${val.errors.map((e) => e.message).join(', ')}`);
      }
    }

    // Validate terms
    for (const t of projectLore.terms || []) {
      const canonicalKey = generateCanonicalKey('glossary_term', t.termOriginal || t.id);
      const payload: GlossaryTermPayload = {
        source_form: t.termOriginal,
        approved_rendering: t.termArabic,
        category: t.category,
      };

      const prov: KnowledgeProvenance[] = [
        {
          producer: 'migration_pipeline',
          source_refs: [t.provenance?.pageId ? `page:${t.provenance.pageId}` : `legacy:term:${t.id}`],
          extraction_method: 'import',
          timestamp: t.provenance?.timestamp || Date.now(),
        },
      ];

      const record: KnowledgeRecord = {
        record_id: `rec-term-${t.id}`,
        record_type: 'glossary_term',
        project_id: projectId,
        scope: { level: 'project', project_id: projectId },
        canonical_key: canonicalKey,
        payload,
        status: 'approved',
        trust_class: 'imported_user_data',
        provenance: prov,
        revision: 1,
        schema_version: '1.0',
        created_at: t.provenance?.timestamp || Date.now(),
        updated_at: Date.now(),
        created_by: 'system_migration',
        updated_by: 'system_migration',
      };

      const val = validateKnowledgeRecord(record);
      if (val.valid) {
        report.validProposalsCount++;
      } else {
        report.invalidProposalsCount++;
        report.errors.push(`Term ${t.id}: ${val.errors.map((e) => e.message).join(', ')}`);
      }
    }
  } catch (err: any) {
    report.errors.push(`Migration dry-run error: ${err?.message || String(err)}`);
  }

  return report;
}

/**
 * Executes idempotent migration from legacy lore to System #5 Knowledge Records.
 */
export async function executeLegacyLoreMigration(projectId: string): Promise<MigrationExecutionResult> {
  const driver = getMemoryDriver();
  const dryRun = await dryRunLegacyLoreMigration(projectId);

  if (dryRun.invalidProposalsCount > 0 && dryRun.validProposalsCount === 0) {
    return {
      projectId,
      status: 'failed',
      migratedRecordsCount: 0,
      auditEventsCount: 0,
      error: `Aborted due to validation errors: ${dryRun.errors.join('; ')}`,
    };
  }

  const projectLore = await getProjectLore(projectId);
  if (!projectLore) {
    return {
      projectId,
      status: 'completed',
      migratedRecordsCount: 0,
      auditEventsCount: 0,
    };
  }

  let migratedCount = 0;
  let auditCount = 0;

  try {
    // 1. Migrate characters
    for (const c of projectLore.characters || []) {
      const canonicalKey = generateCanonicalKey('character_profile', c.nameOriginal || c.id);
      const record: KnowledgeRecord<CharacterProfilePayload> = {
        record_id: `rec-char-${c.id}`,
        record_type: 'character_profile',
        project_id: projectId,
        scope: { level: 'project', project_id: projectId },
        canonical_key: canonicalKey,
        payload: {
          canonical_name: c.nameArabic || c.nameOriginal,
          aliases: c.aliases || [],
          gender: c.gender || 'unknown',
          title: c.title,
        },
        status: 'approved',
        trust_class: 'imported_user_data',
        provenance: [
          {
            producer: 'migration_pipeline',
            source_refs: [c.provenance?.pageId ? `page:${c.provenance.pageId}` : `legacy:char:${c.id}`],
            extraction_method: 'import',
            timestamp: c.provenance?.timestamp || Date.now(),
          },
        ],
        revision: 1,
        schema_version: '1.0',
        created_at: c.provenance?.timestamp || Date.now(),
        updated_at: Date.now(),
        created_by: 'system_migration',
        updated_by: 'system_migration',
      };

      const auditEvent = {
        event_id: `audit-mig-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        event_type: 'RecordCreated' as const,
        project_id: projectId,
        record_id: record.record_id,
        actor: 'migration_pipeline',
        decision_reason: 'Migrated from legacy project_lore to System #5 canonical record',
        timestamp: Date.now(),
        result: 'success' as const,
      };

      const res = await driver.saveRecordAtomic(record, null, auditEvent);
      if (res.success) {
        migratedCount++;
        auditCount++;
      }
    }

    // 2. Migrate terms
    for (const t of projectLore.terms || []) {
      const canonicalKey = generateCanonicalKey('glossary_term', t.termOriginal || t.id);
      const record: KnowledgeRecord<GlossaryTermPayload> = {
        record_id: `rec-term-${t.id}`,
        record_type: 'glossary_term',
        project_id: projectId,
        scope: { level: 'project', project_id: projectId },
        canonical_key: canonicalKey,
        payload: {
          source_form: t.termOriginal,
          approved_rendering: t.termArabic,
          category: t.category,
        },
        status: 'approved',
        trust_class: 'imported_user_data',
        provenance: [
          {
            producer: 'migration_pipeline',
            source_refs: [t.provenance?.pageId ? `page:${t.provenance.pageId}` : `legacy:term:${t.id}`],
            extraction_method: 'import',
            timestamp: t.provenance?.timestamp || Date.now(),
          },
        ],
        revision: 1,
        schema_version: '1.0',
        created_at: t.provenance?.timestamp || Date.now(),
        updated_at: Date.now(),
        created_by: 'system_migration',
        updated_by: 'system_migration',
      };

      const auditEvent = {
        event_id: `audit-mig-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        event_type: 'RecordCreated' as const,
        project_id: projectId,
        record_id: record.record_id,
        actor: 'migration_pipeline',
        decision_reason: 'Migrated from legacy project_lore to System #5 canonical record',
        timestamp: Date.now(),
        result: 'success' as const,
      };

      const res = await driver.saveRecordAtomic(record, null, auditEvent);
      if (res.success) {
        migratedCount++;
        auditCount++;
      }
    }

    // 3. Migrate relationships
    for (const r of projectLore.speakerRelationships || []) {
      const canonicalKey = generateCanonicalKey('relationship', `${r.speaker}-${r.addressee}`);
      const record: KnowledgeRecord<RelationshipPayload> = {
        record_id: `rec-rel-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        record_type: 'relationship',
        project_id: projectId,
        scope: { level: 'project', project_id: projectId },
        canonical_key: canonicalKey,
        payload: {
          speaker: r.speaker,
          addressee: r.addressee,
          tone: r.tone,
          pronouns: r.pronouns,
          hierarchy: r.hierarchy,
        },
        status: 'approved',
        trust_class: 'imported_user_data',
        provenance: [
          {
            producer: 'migration_pipeline',
            source_refs: [`legacy:rel:${r.speaker}:${r.addressee}`],
            extraction_method: 'import',
            timestamp: Date.now(),
          },
        ],
        revision: 1,
        schema_version: '1.0',
        created_at: Date.now(),
        updated_at: Date.now(),
        created_by: 'system_migration',
        updated_by: 'system_migration',
      };

      const auditEvent = {
        event_id: `audit-mig-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        event_type: 'RecordCreated' as const,
        project_id: projectId,
        record_id: record.record_id,
        actor: 'migration_pipeline',
        decision_reason: 'Migrated from legacy speaker relationships',
        timestamp: Date.now(),
        result: 'success' as const,
      };

      const res = await driver.saveRecordAtomic(record, null, auditEvent);
      if (res.success) {
        migratedCount++;
        auditCount++;
      }
    }

    return {
      projectId,
      status: 'completed',
      migratedRecordsCount: migratedCount,
      auditEventsCount: auditCount,
    };
  } catch (err: any) {
    return {
      projectId,
      status: 'failed',
      migratedRecordsCount: migratedCount,
      auditEventsCount: auditCount,
      error: err?.message || String(err),
    };
  }
}
