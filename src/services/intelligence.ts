/**
 * Chapter & Project Intelligence Lifecycle Service
 * Manages structured character knowledge, relationships, terminology, provenance,
 * confidence scoring, conflict resolution, and rolling context propagation across pages.
 */

export {
  getChapterIntelligence,
  saveChapterIntelligence,
  getProjectLore,
  saveProjectLore,
} from './db';
import {
  getChapterIntelligence,
  saveChapterIntelligence,
  getProjectLore,
  saveProjectLore,
} from './db';
import type {
  ChapterIntelligence,
  CharacterLore,
  TermLore,
  LoreProvenance,
  LoreConflict,
} from '../types/workbench';

export interface RollingPageContext {
  summary: string;
  activeCharactersPrompt: string;
  terminologyPrompt: string;
  relationshipPrompt: string;
  precedingDialogueSnippet?: string;
}

/**
 * Retrieves the rolling context for an upcoming page scan.
 * Ensures page N has visibility into page N-1's dialogue and chapter-level entity continuity.
 */
export async function getRollingContextForPage(
  chapterId: string,
  _pageIndex: number,
  precedingPageBubbles?: Array<{ index: number; type: string; sourceText: string; translatedText: string }>
): Promise<RollingPageContext> {
  const intel = await getChapterIntelligence(chapterId);

  let activeCharactersPrompt = '';
  let terminologyPrompt = '';
  let relationshipPrompt = '';
  let summary = '';

  if (intel) {
    summary = intel.summary || '';

    if (intel.characterRoster && intel.characterRoster.length > 0) {
      activeCharactersPrompt = intel.characterRoster
        .map((c) => {
          const genderStr = c.gender && c.gender !== 'unknown' ? ` [Gender: ${c.gender}]` : '';
          const titleStr = c.title ? ` (Title: ${c.title})` : '';
          return `- ${c.nameOriginal} => ${c.nameArabic}${genderStr}${titleStr}`;
        })
        .join('\n');
    }

    if (intel.termsHarvested && intel.termsHarvested.length > 0) {
      terminologyPrompt = intel.termsHarvested
        .map((t) => `- ${t.termOriginal} => ${t.termArabic} [${t.category}]`)
        .join('\n');
    }

    if (intel.speakerPairs && intel.speakerPairs.length > 0) {
      relationshipPrompt = intel.speakerPairs
        .map((r) => `- ${r.speaker} to ${r.addressee}: Tone: ${r.tone}${r.pronouns ? `, Pronoun rule: ${r.pronouns}` : ''}`)
        .join('\n');
    }
  }

  let precedingDialogueSnippet = '';
  if (precedingPageBubbles && precedingPageBubbles.length > 0) {
    const trailingLines = precedingPageBubbles
      .slice(-3) // Last 3 lines from preceding page
      .map((b) => `#${b.index} [${b.type}]: "${b.sourceText}" -> "${b.translatedText}"`)
      .join('\n');
    if (trailingLines.trim().length > 0) {
      precedingDialogueSnippet = `Preceding Page Trailing Dialogue:\n${trailingLines}`;
    }
  }

  return {
    summary,
    activeCharactersPrompt,
    terminologyPrompt,
    relationshipPrompt,
    precedingDialogueSnippet,
  };
}

export interface IngestIntelligenceParams {
  chapterId: string;
  projectId?: string | null;
  pageId: string;
  pageIndex: number;
  sceneContext?: string;
  detectedCharacters?: Array<{
    nameOriginal: string;
    nameArabic: string;
    gender?: 'male' | 'female' | 'other' | 'unknown';
    title?: string;
    confidence?: number;
  }>;
  detectedTerms?: Array<{
    termOriginal: string;
    termArabic: string;
    category?: string;
    confidence?: number;
  }>;
  detectedRelationships?: Array<{
    speaker: string;
    addressee: string;
    tone: string;
    pronouns?: string;
  }>;
}

/**
 * Ingests newly detected entities from a scanned page into Chapter Intelligence and Project Lore.
 * Performs conflict detection (e.g. gender flips, name discrepancies) with provenance tracking.
 */
export async function ingestPageIntelligence(
  params: IngestIntelligenceParams
): Promise<{ conflictsFound: LoreConflict[]; chapterIntelligence: ChapterIntelligence }> {
  const {
    chapterId,
    projectId,
    pageId,
    pageIndex,
    sceneContext,
    detectedCharacters = [],
    detectedTerms = [],
    detectedRelationships = [],
  } = params;

  let intel = await getChapterIntelligence(chapterId);
  if (!intel) {
    intel = {
      chapterId,
      projectId: projectId || undefined,
      summary: '',
      sceneFlow: [],
      activeCharacters: [],
      characterRoster: [],
      termsHarvested: [],
      speakerPairs: [],
      lastScannedPageIndex: pageIndex,
      lastUpdated: Date.now(),
    };
  }

  const conflictsFound: LoreConflict[] = [];
  const provenance: LoreProvenance = {
    sourceType: 'ai_detected',
    pageId,
    timestamp: Date.now(),
  };

  // 1. Update scene flow and summary
  if (sceneContext && sceneContext.trim().length > 0) {
    intel.sceneFlow.push(`[Page ${pageIndex}]: ${sceneContext.trim()}`);
    intel.summary = sceneContext.trim();
  }
  intel.lastScannedPageIndex = Math.max(intel.lastScannedPageIndex, pageIndex);
  intel.lastUpdated = Date.now();

  // 2. Ingest Characters with Conflict Detection
  for (const incoming of detectedCharacters) {
    if (!incoming.nameOriginal || !incoming.nameArabic) continue;
    const cleanOrig = incoming.nameOriginal.trim();
    const cleanAr = incoming.nameArabic.trim();
    const cleanOrigLower = cleanOrig.toLowerCase();

    const existingChar = intel.characterRoster.find(
      (c) => c.nameOriginal.toLowerCase() === cleanOrigLower || (c.aliases || []).some(a => a.toLowerCase() === cleanOrigLower)
    );

    if (existingChar) {
      // Check for gender conflict
      if (
        incoming.gender &&
        incoming.gender !== 'unknown' &&
        existingChar.gender &&
        existingChar.gender !== 'unknown' &&
        existingChar.gender !== incoming.gender
      ) {
        const conflict: LoreConflict = {
          id: `conflict-gender-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          field: 'gender',
          existingValue: existingChar.gender,
          conflictingValue: incoming.gender,
          detectedAtPageId: pageId,
          status: 'unresolved',
        };
        conflictsFound.push(conflict);
        existingChar.conflicts = existingChar.conflicts || [];
        existingChar.conflicts.push(conflict);
      }

      // Check for Arabic spelling conflict
      if (existingChar.nameArabic !== cleanAr) {
        existingChar.aliases = existingChar.aliases || [];
        if (!existingChar.aliases.includes(cleanAr)) {
          existingChar.aliases.push(cleanAr);
        }
      }
    } else {
      // New character addition
      const newChar: CharacterLore = {
        id: `char-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        nameOriginal: cleanOrig,
        nameArabic: cleanAr,
        gender: incoming.gender || 'unknown',
        title: incoming.title,
        aliases: [],
        confidence: incoming.confidence || 0.85,
        provenance,
        conflicts: [],
      };
      intel.characterRoster.push(newChar);
      if (!intel.activeCharacters.includes(cleanAr)) {
        intel.activeCharacters.push(cleanAr);
      }
    }
  }

  // 3. Ingest Terms with Conflict Detection
  for (const incoming of detectedTerms) {
    if (!incoming.termOriginal || !incoming.termArabic) continue;
    const cleanTermOrig = incoming.termOriginal.trim();
    const cleanTermAr = incoming.termArabic.trim();
    const cleanTermLower = cleanTermOrig.toLowerCase();

    const existingTerm = intel.termsHarvested.find(
      (t) => t.termOriginal.toLowerCase() === cleanTermLower
    );

    if (existingTerm) {
      if (existingTerm.termArabic !== cleanTermAr) {
        const conflict: LoreConflict = {
          id: `conflict-term-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          field: 'termArabic',
          existingValue: existingTerm.termArabic,
          conflictingValue: cleanTermAr,
          detectedAtPageId: pageId,
          status: 'unresolved',
        };
        conflictsFound.push(conflict);
        existingTerm.conflicts = existingTerm.conflicts || [];
        existingTerm.conflicts.push(conflict);
      }
    } else {
      const newTerm: TermLore = {
        id: `term-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        termOriginal: cleanTermOrig,
        termArabic: cleanTermAr,
        category: incoming.category || 'term',
        confidence: incoming.confidence || 0.85,
        provenance,
        conflicts: [],
      };
      intel.termsHarvested.push(newTerm);
    }
  }

  // 4. Ingest Relationships
  for (const incoming of detectedRelationships) {
    if (!incoming.speaker || !incoming.addressee) continue;
    const existingPair = intel.speakerPairs.find(
      (p) =>
        p.speaker.toLowerCase() === incoming.speaker.toLowerCase() &&
        p.addressee.toLowerCase() === incoming.addressee.toLowerCase()
    );

    if (existingPair) {
      existingPair.tone = incoming.tone || existingPair.tone;
      if (incoming.pronouns) existingPair.pronouns = incoming.pronouns;
    } else {
      intel.speakerPairs.push({
        id: `rel-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        speaker: incoming.speaker.trim(),
        addressee: incoming.addressee.trim(),
        tone: incoming.tone || 'normal',
        pronouns: incoming.pronouns,
        provenance,
      });
    }
  }

  // Save updated Chapter Intelligence
  await saveChapterIntelligence(chapterId, intel);

  // If in a Project, synchronize verified terms and characters to Project Lore Ledger
  if (projectId && projectId !== 'folder-drafts') {
    try {
      let projectLore = await getProjectLore(projectId);
      if (!projectLore) {
        projectLore = {
          projectId,
          characters: [],
          terms: [],
          speakerRelationships: [],
          lastUpdated: Date.now(),
        };
      }

      const existingCharKeys = new Set(projectLore.characters.map((c) => c.nameOriginal.toLowerCase()));
      const existingTermKeys = new Set(projectLore.terms.map((t) => t.termOriginal.toLowerCase()));

      let projectUpdated = false;

      for (const char of intel.characterRoster) {
        if (!existingCharKeys.has(char.nameOriginal.toLowerCase())) {
          projectLore.characters.push(char);
          existingCharKeys.add(char.nameOriginal.toLowerCase());
          projectUpdated = true;
        }
      }

      for (const term of intel.termsHarvested) {
        if (!existingTermKeys.has(term.termOriginal.toLowerCase())) {
          projectLore.terms.push(term);
          existingTermKeys.add(term.termOriginal.toLowerCase());
          projectUpdated = true;
        }
      }

      if (projectUpdated) {
        projectLore.lastUpdated = Date.now();
        await saveProjectLore(projectId, projectLore);
      }
    } catch (err) {
      console.warn('[Intelligence] Failed to sync to Project Lore Ledger:', err);
    }
  }

  return {
    conflictsFound,
    chapterIntelligence: intel,
  };
}
