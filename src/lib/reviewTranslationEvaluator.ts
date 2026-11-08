/**
 * Folio Script: System #4 — Review & Quality Control Engine
 * Translation, Linguistic & Instruction-Compliance Evaluator
 *
 * Implements Section 10 of the System #4 specification:
 * - Integrates with System #2 compiled instructions and translation lineage
 * - Enforces Master Prompt priority and explicit dialect immunity (e.g. Algerian Darija)
 * - Source Reliability Gate: abstains from asserting translation errors on ambiguous OCR
 * - Evaluates semantic fidelity, negation, omissions/additions, character voice, and orthography
 * - Validates naturalness without stylistic overreach (multiple valid phrasings are marked PASS)
 */

import type { ReviewFinding, ReviewSnapshot, ReviewStrictness } from '../types/review';
import { ISSUE_CODES } from '../types/review';
import type { EloquenceLevel, ProjectLoreLedger, ChapterIntelligence } from '../types/workbench';
import { compileInstructions, detectExplicitDialect } from './instructionCompiler';

export interface TranslationReviewOptions {
  snapshot: ReviewSnapshot;
  apiKey: string;
  selectedModel?: string;
  targetBubbleId?: string;
  strictness?: ReviewStrictness;
  eloquenceLevel?: EloquenceLevel;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
  projectLore?: ProjectLoreLedger | null;
  chapterIntelligence?: ChapterIntelligence | null;
}

export async function evaluateTranslationAndLinguistics(
  options: TranslationReviewOptions
): Promise<ReviewFinding[]> {
  const {
    snapshot,
    apiKey,
    selectedModel = 'gemini-3.8-flash',
    targetBubbleId,
    strictness = 'balanced',
    eloquenceLevel = 2,
    masterPromptOverride = '',
    isMasterPromptActive = true,
    projectLore,
    chapterIntelligence,
  } = options;

  const { pageId, chapterId, bubbles, scanResult, snapshotId } = snapshot;
  const findings: ReviewFinding[] = [];

  // Filter bubbles to evaluate (either target single bubble or all bubbles with source or translation)
  const candidateBubbles = targetBubbleId
    ? bubbles.filter((b) => b.id === targetBubbleId)
    : bubbles.filter((b) => (b.sourceText && b.sourceText.trim().length > 0) || (b.translatedText && b.translatedText.trim().length > 0));

  if (candidateBubbles.length === 0) {
    return findings;
  }

  // 0. Deterministic Missing Translation Gate (F-05)
  // Source-only bubbles with empty/blank translation must emit deterministic MISSING_TRANSLATION
  // and must NOT be linguistically scored as a translation defect.
  const bubblesForLinguisticAudit: typeof candidateBubbles = [];

  for (const b of candidateBubbles) {
    const hasSource = Boolean(b.sourceText && b.sourceText.trim().length > 0);
    const hasTranslation = Boolean(b.translatedText && b.translatedText.trim().length > 0);

    if (hasSource && !hasTranslation) {
      findings.push({
        findingId: `trn-missing-${b.id}`,
        domain: 'translation',
        issueCode: ISSUE_CODES.MISSING_TRANSLATION,
        severity: 'major',
        status: 'open',
        affectedEntity: { type: 'bubble', pageId, chapterId, bubbleId: b.id },
        observation: `Bubble #${String(b.index).padStart(2, '0')} has source dialogue but no Arabic translation.`,
        expectedBehavior: 'All dialogue bubbles must have a valid Arabic translation.',
        evidence: {
          detectedOCR: b.sourceText,
          rationale: 'Deterministic missing translation check: source text present without translated output.',
        },
        confidence: { sourceOCR: 'high', finding: 'high', correction: 'not_assessed' },
        proposedAction: 'edit',
        ruleVersion: 'system4-linguistic-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
      // Do not forward to Gemini linguistic scorer
      continue;
    }

    if (!hasSource && hasTranslation) {
      // Translation exists without source
      findings.push({
        findingId: `trn-no-source-${b.id}`,
        domain: 'integrity',
        issueCode: ISSUE_CODES.ORPHAN_TEXT_REGION,
        severity: 'minor',
        status: 'open',
        affectedEntity: { type: 'bubble', pageId, chapterId, bubbleId: b.id },
        observation: `Bubble #${String(b.index).padStart(2, '0')} has Arabic translation but empty source text.`,
        expectedBehavior: 'Translation should correspond to a detected source OCR string.',
        evidence: {
          translationSpan: b.translatedText,
          rationale: 'Orphan translation detected without source OCR.',
        },
        confidence: { sourceOCR: 'uncertain', finding: 'high', correction: 'not_assessed' },
        proposedAction: 'inspect',
        ruleVersion: 'system4-linguistic-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
      continue;
    }

    bubblesForLinguisticAudit.push(b);
  }

  // 1. Source Reliability Gate: Inspect OCR confidence and ambiguity flags (F-15)
  // Rule: If source is materially ambiguous, record uncertainty finding and HARD ABSTAIN
  // from submitting to linguistic model to prevent hallucinated/speculative error assertions.
  const verifiedBubbles: typeof candidateBubbles = [];

  for (const b of bubblesForLinguisticAudit) {
    const canonicalRegion = scanResult?.regions?.find((r) => r.regionId === b.id);
    const isAmbiguousOCR = canonicalRegion?.flags?.includes('OCR_AMBIGUOUS');
    const isLowOCR = (canonicalRegion?.confidence?.ocr !== undefined && canonicalRegion.confidence.ocr < 0.45) ||
                     (b.confidence !== undefined && b.confidence < 0.45);

    if (isAmbiguousOCR || isLowOCR) {
      // Record source uncertainty finding and flag as source-limited
      findings.push({
        findingId: `trn-source-uncertain-${b.id}`,
        domain: 'ocr',
        issueCode: ISSUE_CODES.SOURCE_LIMITED_UNCERTAINTY,
        severity: 'informational',
        status: 'open',
        affectedEntity: { type: 'bubble', pageId, chapterId, bubbleId: b.id },
        observation: `Source OCR has low confidence (${canonicalRegion?.confidence?.ocr ?? b.confidence ?? 'unknown'}) or is flagged ambiguous. Translation review is source-limited.`,
        expectedBehavior: 'High-confidence source text required for definitive semantic verification.',
        evidence: {
          detectedOCR: b.sourceText,
          rationale: 'Source OCR uncertainty gate engaged; hard abstention from speculative linguistic error.',
        },
        confidence: { sourceOCR: 'uncertain', finding: 'high', correction: 'not_assessed' },
        proposedAction: 'inspect',
        ruleVersion: 'system4-linguistic-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
      // Hard abstention: do not forward materially ambiguous OCR to model for linguistic judgment
      continue;
    }
    verifiedBubbles.push(b);
  }

  // 2. Compile System #2 Instruction Package & Dialect Detection
  const dialectInfo = isMasterPromptActive && masterPromptOverride
    ? detectExplicitDialect(masterPromptOverride)
    : { isDialect: false };

  const systemInstructions = compileInstructions({
    task: 'chapter_review',
    eloquenceLevel,
    masterPromptOverride,
    isMasterPromptActive,
    projectLore,
    chapterIntelligence,
  });

  // 3. Prepare payload for Gemini Linguistic Evaluator
  const bubblesPayload = verifiedBubbles.map((b) => ({
    bubbleId: b.id,
    index: b.index,
    sourceText: b.sourceText,
    originalSourceText: b.originalSourceText,
    translatedText: b.translatedText,
    rawTranslatedText: b.rawTranslatedText,
    humanizedTranslatedText: b.humanizedTranslatedText,
    isManuallyEdited: b.isManuallyEdited || false,
  }));

  const promptText = `
ROLE & TASK:
You are Folio Script's Senior Localization & Linguistic Quality Control Evaluator.
Audit the following dialogue translation units for genuine translation and linguistic defects.

QUALITY PRINCIPLES:
1. PRECISION OVER NOISE: Do NOT flag harmless stylistic variations or legitimate alternative phrasings. If a translation preserves the meaning, tone, and character intent, it is a PASS.
2. MASTER PROMPT & DIALECT IMMUNITY:
   ${dialectInfo.isDialect ? `CRITICAL: The user has explicitly specified a regional dialect: [${dialectInfo.dialectName}]. Do NOT flag colloquial dialect vocabulary, phrasing, or syntax as grammatical errors. MSA rules must NOT be forced onto colloquial dialogue.` : 'Standard Arabic scanlation conventions apply.'}
3. SEMANTIC FIDELITY:
   - Check for dropped negations (e.g. source has negation, translation affirmative or vice versa). Issue code: "POSSIBLE_NEGATION_MISMATCH".
   - Check for omitted vital clauses or invented statements. Issue code: "MEANING_OMISSION" or "MEANING_ADDITION".
   - Check for speaker gender agreement mismatches. Issue code: "GENDER_AGREEMENT_MISMATCH".
4. ARABIC ORTHOGRAPHY:
   - Maintain legitimate hamzas (أ، إ، آ), shadda, and tanween adverbs contextually.
   - Do NOT suggest removing hamzas or blind normalization.
5. STRICTNESS LEVEL: [${strictness.toUpperCase()}]
   ${strictness === 'conservative' ? 'Conservative mode: Only report critical blocker errors (such as outright reversed negations, major hallucinations, or severe gender mismatches). Completely suppress minor stylistic recommendations and naturalness suggestions.' : strictness === 'thorough' ? 'Thorough mode: Scrutinize character voice nuances, terminology consistency, punctuation, and all orthographic details.' : 'Balanced mode: Focus strictly on material meaning, negation, and clear grammatical defects.'}

DATASET:
${JSON.stringify(bubblesPayload, null, 2)}

OUTPUT FORMAT:
Return strictly valid JSON:
{
  "findings": [
    {
      "bubbleId": "ID of affected bubble",
      "issueCode": "POSSIBLE_NEGATION_MISMATCH" | "MEANING_OMISSION" | "MEANING_ADDITION" | "GENDER_AGREEMENT_MISMATCH" | "NAME_INCONSISTENCY" | "TERMINOLOGY_INCONSISTENCY" | "GRAMMAR_ERROR" | "ORTHOGRAPHY_ERROR" | "NATURALNESS_SUGGESTION",
      "severity": "critical" | "major" | "moderate" | "minor" | "informational",
      "observationAr": "شرح تفصيلي باللغة العربية للخلل الدلالي أو اللغوي",
      "expectedBehavior": "How the translation should read or what rule was violated",
      "evidence": "Exact source or translation words demonstrating the defect",
      "suggestedTextAr": "الترجمة المقترحة المصححة بدقة دون زيادة أو نقصان",
      "findingConfidence": "high" | "moderate" | "low"
    }
  ]
}
`.trim();

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;

  const payload = {
    system_instruction: {
      parts: [{ text: systemInstructions.systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: promptText }],
      },
    ],
    generation_config: {
      response_mime_type: 'application/json',
      temperature: 0.1,
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      findings.push({
        findingId: `trn-err-http-${Date.now()}`,
        domain: 'translation',
        issueCode: ISSUE_CODES.PROVIDER_TIMEOUT,
        severity: 'major',
        status: 'open',
        affectedEntity: { type: 'page', pageId, chapterId },
        observation: `Gemini linguistic review call failed with HTTP ${response.status}: ${errorBody?.error?.message || 'Unknown error'}`,
        expectedBehavior: 'Translation review provider responds with valid status.',
        evidence: { rationale: 'HTTP error from generative language endpoint.' },
        confidence: { sourceOCR: 'high', finding: 'high', correction: 'not_assessed' },
        proposedAction: 're_run_stage',
        ruleVersion: 'system4-linguistic-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
      return findings;
    }

    const resJson = await response.json();
    const rawContent = resJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) {
      return findings;
    }

    let clean = rawContent.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(clean);
    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];

    for (const rf of rawFindings) {
      const targetBubble = bubbles.find((b) => b.id === rf.bubbleId);
      if (!targetBubble) continue;

      const findingId = `trn-fnd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      findings.push({
        findingId,
        domain: 'translation',
        issueCode: rf.issueCode || ISSUE_CODES.MEANING_OMISSION,
        severity: rf.severity || 'moderate',
        status: 'open',
        affectedEntity: {
          type: 'bubble',
          pageId,
          chapterId,
          bubbleId: targetBubble.id,
        },
        observation: rf.observationAr || rf.observation || 'ملاحظة تدقيقية لغوية على الترجمة.',
        expectedBehavior: rf.expectedBehavior || 'Accurate, high-eloquence translation reflecting source meaning.',
        evidence: {
          sourceSpan: targetBubble.sourceText,
          translationSpan: targetBubble.translatedText,
          rationale: rf.evidence || 'Semantic discrepancy detected against source dialogue.',
        },
        confidence: {
          sourceOCR: targetBubble.confidence && targetBubble.confidence > 0.8 ? 'high' : 'moderate',
          finding: rf.findingConfidence === 'high' ? 'high' : rf.findingConfidence === 'low' ? 'low' : 'moderate',
          correction: rf.suggestedTextAr ? 'high' : 'not_assessed',
        },
        proposedAction: rf.suggestedTextAr ? 'edit' : 'inspect',
        proposedCorrection: rf.suggestedTextAr
          ? {
              correctionId: `corr-${findingId}`,
              targetField: 'translatedText',
              currentValue: targetBubble.translatedText,
              suggestedValue: rf.suggestedTextAr,
              isEligibleForAuto: false, // In accordance with Decision #1: Semantic fixes require human confirmation
              validationStatus: 'pending',
            }
          : undefined,
        ruleVersion: 'system4-linguistic-v1',
        modelVersion: selectedModel,
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
    }
  } catch (err: any) {
    findings.push({
      findingId: `trn-err-catch-${Date.now()}`,
      domain: 'translation',
      issueCode: ISSUE_CODES.PROVIDER_TIMEOUT,
      severity: 'major',
      status: 'open',
      affectedEntity: { type: 'page', pageId, chapterId },
      observation: `Translation review execution failed: ${err?.message || String(err)}`,
      expectedBehavior: 'Translation review completes successfully.',
      evidence: { rationale: String(err?.stack || err) },
      confidence: { sourceOCR: 'high', finding: 'high', correction: 'not_assessed' },
      proposedAction: 're_run_stage',
      ruleVersion: 'system4-linguistic-v1',
      createdAt: Date.now(),
      snapshotVersion: snapshotId,
    });
  }

  return findings;
}
