/**
 * Dragonfly 44: System #4 — Review & Quality Control Engine
 * Visual, OCR, Geometry, Association & Reading Order Evaluator
 *
 * Implements Section 9 of the System #4 specification:
 * - Compares raw OCR against actual page artwork
 * - Evaluates multi-dimensional scan confidence and ambiguity flags
 * - Verifies region geometry against original dimensions and transform ledgers
 * - Evaluates reading order across comic panels and intra-panel bubbles
 * - Audits generic text classifications without altering custom typers
 * - Preserves all SFX and detected text in canonical scan data
 */

import type { ReviewFinding, ReviewSnapshot } from '../types/review';
import { ISSUE_CODES } from '../types/review';
import { getPageBlob } from '../services/db';
import { blobToBase64 } from './geminiScan';

export interface VisualScanReviewOptions {
  snapshot: ReviewSnapshot;
  apiKey: string;
  selectedModel?: string;
  includeSFX?: boolean;
}

export async function evaluateVisualAndScan(
  options: VisualScanReviewOptions
): Promise<ReviewFinding[]> {
  const { snapshot, apiKey, selectedModel = 'gemini-3.8-flash', includeSFX = true } = options;
  const { pageId, chapterId, bubbles, scanResult, snapshotId } = snapshot;
  const findings: ReviewFinding[] = [];

  // 1. Fetch image binary from IndexedDB
  const blob = await getPageBlob(pageId);
  if (!blob) {
    // If image blob is missing, record honest blocked state: cannot claim visual verification!
    findings.push({
      findingId: `vis-err-noblob-${pageId}`,
      domain: 'visual',
      issueCode: ISSUE_CODES.PROVIDER_TIMEOUT,
      severity: 'critical',
      status: 'open',
      affectedEntity: { type: 'page', pageId, chapterId },
      observation: 'Page image asset blob was not found in storage. Visual review blocked.',
      expectedBehavior: 'Page image binary must be present to evaluate visual scan quality.',
      evidence: { rationale: 'Image blob missing from STORE_PAGE_BLOBS.' },
      confidence: { sourceOCR: 'uncertain', finding: 'high', correction: 'not_assessed' },
      proposedAction: 'inspect',
      ruleVersion: 'system4-visual-v1',
      createdAt: Date.now(),
      snapshotVersion: snapshotId,
    });
    return findings;
  }

  const mimeType = blob.type || 'image/png';
  const base64Data = await blobToBase64(blob);

  // 2. Prepare visual audit payload with both System #3 scan data and System #2 bubbles
  const panelContext = scanResult?.panels?.map((p) => ({
    panelId: p.panelId,
    sequenceIndex: p.sequenceIndex,
    box: p.geometry.box_2d,
  })) || [];

  const textUnits = bubbles.map((b) => {
    // Cross-reference canonical region in scanResult if available
    const canonicalRegion = scanResult?.regions?.find((r) => r.regionId === b.id);
    return {
      bubbleId: b.id,
      index: b.index,
      box_2d: b.box_2d,
      type: b.type,
      sourceText: b.sourceText,
      originalSourceText: b.originalSourceText,
      translatedText: b.translatedText,
      isManuallyEdited: b.isManuallyEdited || false,
      ocrConfidence: canonicalRegion?.confidence?.ocr,
      flags: canonicalRegion?.flags || [],
    };
  });

  const promptText = `
ROLE & TASK:
You are Dragonfly 44's Chief Visual QC & Scan Reviewer.
Inspect this comic/manga page artwork against the provided detected dialogue units and panel structures.
Find meaningful visual, OCR, geometry, reading-order, and generic classification defects:

AUDIT CRITERIA:
1. MISSED SPEECH (issueCode: "MISSED_TEXT_IN_ART"): Visible speech or narration in the artwork not covered by any box.
   ${includeSFX ? 'Include significant vocalized sound effects and environmental signage.' : 'Ignore background environmental sound effects, but DO flag missed dialogue or character shouts.'}
2. OCR MISMATCH (issueCode: "OCR_SUBSTITUTION" or "OCR_OMISSION"): Misread glyphs, dropped words, or truncated text when comparing sourceText to the visible Japanese/source lettering.
   NOTE: Do NOT confuse stylized handwriting or intentional stutter with OCR errors. If lettering is ambiguous, report confidence as "uncertain".
3. READING ORDER (issueCode: "PANEL_SEQUENCE_CONFLICT" or "REGION_ORDER_AMBIGUOUS"): Numbered bubbles violating comic flow (Manga: Right-to-Left, Top-to-Bottom within panels; Webtoon: Top-to-Bottom).
4. GENERIC CLASSIFICATION (issueCode: "TEXT_TYPE_MISMATCH"): Distinguish dialogue, thought, narration, scream/shout, and SFX.
   NOTE: Do NOT assign custom typers. Only evaluate generic visual functional class.
5. ARTIFACT / REMOVE BUBBLE (issueCode: "REMOVE_BUBBLE"): False detections on screentones, speedlines, or non-text artwork.

INPUT DATA:
Panels: ${JSON.stringify(panelContext)}
Detected Units: ${JSON.stringify(textUnits, null, 2)}

OUTPUT FORMAT:
Return strictly valid JSON:
{
  "pageSummary": "Concise summary of visual inspection",
  "findings": [
    {
      "bubbleId": "Target bubble ID, or 'new-missed-N' for unextracted text",
      "issueCode": "MISSED_TEXT_IN_ART" | "OCR_SUBSTITUTION" | "OCR_OMISSION" | "PANEL_SEQUENCE_CONFLICT" | "TEXT_TYPE_MISMATCH" | "REMOVE_BUBBLE",
      "severity": "critical" | "major" | "moderate" | "minor" | "informational",
      "observationAr": "شرح تفصيلي باللغة العربية لما لوحظ في الرسم أو النص",
      "expectedBehavior": "What should have been detected or expected under manga conventions",
      "evidence": "Visual cue observed in the page art or text coordinates",
      "sourceCropCoords": [ymin, xmin, ymax, xmax],
      "suggestedTextAr": "Arabic translation if suggesting text for missed bubble",
      "suggestedSourceText": "Corrected source Japanese/original text if OCR was wrong",
      "suggestedGenericClass": "dialogue" | "thought" | "narration" | "sfx" | "vocalization",
      "suggestedOrderIndex": 1,
      "findingConfidence": "high" | "moderate" | "low" | "uncertain"
    }
  ]
}
`.trim();

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          },
        ],
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
        findingId: `vis-err-http-${Date.now()}`,
        domain: 'visual',
        issueCode: ISSUE_CODES.PROVIDER_TIMEOUT,
        severity: 'major',
        status: 'open',
        affectedEntity: { type: 'page', pageId, chapterId },
        observation: `Gemini visual review call failed with HTTP ${response.status}: ${errorBody?.error?.message || 'Unknown error'}`,
        expectedBehavior: 'Visual review provider responds with valid status.',
        evidence: { rationale: 'HTTP error from generative language endpoint.' },
        confidence: { sourceOCR: 'uncertain', finding: 'high', correction: 'not_assessed' },
        proposedAction: 're_run_stage',
        ruleVersion: 'system4-visual-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
      return findings;
    }

    const resJson = await response.json();
    const rawContent = resJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) {
      findings.push({
        findingId: `vis-err-empty-${Date.now()}`,
        domain: 'visual',
        issueCode: ISSUE_CODES.MALFORMED_REVIEW_RESPONSE,
        severity: 'major',
        status: 'open',
        affectedEntity: { type: 'page', pageId, chapterId },
        observation: 'Gemini visual review returned an empty response.',
        expectedBehavior: 'Model must return structured JSON findings.',
        evidence: { rationale: 'Empty candidate text parts.' },
        confidence: { sourceOCR: 'uncertain', finding: 'high', correction: 'not_assessed' },
        proposedAction: 're_run_stage',
        ruleVersion: 'system4-visual-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
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
      const isMissed = !rf.bubbleId || rf.bubbleId.startsWith('new-missed') || rf.issueCode === 'MISSED_TEXT_IN_ART';
      const targetBubbleId = isMissed ? undefined : rf.bubbleId;
      const targetBubble = targetBubbleId ? bubbles.find((b) => b.id === targetBubbleId) : undefined;

      // Map domain based on issue code
      let domain: ReviewFinding['domain'] = 'visual';
      if (rf.issueCode?.includes('OCR')) domain = 'ocr';
      else if (rf.issueCode?.includes('ORDER') || rf.issueCode?.includes('SEQUENCE')) domain = 'reading_order';
      else if (rf.issueCode?.includes('TYPE') || rf.issueCode?.includes('CLASSIFICATION')) domain = 'classification';

      const findingId = `vis-fnd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      findings.push({
        findingId,
        domain,
        issueCode: rf.issueCode || ISSUE_CODES.MISSED_TEXT_IN_ART,
        severity: rf.severity || 'warning',
        status: 'open',
        affectedEntity: {
          type: targetBubbleId ? 'bubble' : 'page',
          pageId,
          chapterId,
          bubbleId: targetBubbleId,
        },
        observation: rf.observationAr || rf.observation || 'ملاحظة تدقيقية مرئية على الرسم.',
        expectedBehavior: rf.expectedBehavior || 'Conform to manga visual reading conventions.',
        evidence: {
          sourceCropRef: rf.sourceCropCoords ? JSON.stringify(rf.sourceCropCoords) : undefined,
          rationale: rf.evidence || 'Observed in page artwork during multimodal pass.',
          detectedOCR: rf.suggestedSourceText,
        },
        confidence: {
          sourceOCR: targetBubble ? (targetBubble.confidence && targetBubble.confidence > 0.8 ? 'high' : 'moderate') : 'moderate',
          finding: rf.findingConfidence === 'high' ? 'high' : rf.findingConfidence === 'low' ? 'low' : 'moderate',
          correction: rf.suggestedTextAr ? 'moderate' : 'not_assessed',
        },
        proposedAction: isMissed ? 'edit' : rf.suggestedTextAr ? 'edit' : 'inspect',
        proposedCorrection: isMissed
          ? {
              correctionId: `corr-${findingId}`,
              targetField: 'sourceText',
              currentValue: '',
              suggestedValue: rf.suggestedSourceText || '',
              isEligibleForAuto: false, // Requires user confirmation by default
              validationStatus: 'pending',
            }
          : rf.suggestedTextAr
          ? {
              correctionId: `corr-${findingId}`,
              targetField: 'translatedText',
              currentValue: targetBubble?.translatedText || '',
              suggestedValue: rf.suggestedTextAr,
              isEligibleForAuto: false,
              validationStatus: 'pending',
            }
          : undefined,
        ruleVersion: 'system4-visual-v1',
        modelVersion: selectedModel,
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
    }
  } catch (err: any) {
    findings.push({
      findingId: `vis-err-catch-${Date.now()}`,
      domain: 'visual',
      issueCode: ISSUE_CODES.PROVIDER_TIMEOUT,
      severity: 'major',
      status: 'open',
      affectedEntity: { type: 'page', pageId, chapterId },
      observation: `Visual review execution failed: ${err?.message || String(err)}`,
      expectedBehavior: 'Visual review completes successfully.',
      evidence: { rationale: String(err?.stack || err) },
      confidence: { sourceOCR: 'uncertain', finding: 'high', correction: 'not_assessed' },
      proposedAction: 're_run_stage',
      ruleVersion: 'system4-visual-v1',
      createdAt: Date.now(),
      snapshotVersion: snapshotId,
    });
  }

  return findings;
}
