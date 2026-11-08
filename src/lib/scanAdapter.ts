/**
 * Folio Script: System #3 — Manga Scanning & Classification Engine
 * Scan Data Adapter
 * 
 * Bridges canonical PageScanResult <-> workspace BubbleItem[]
 * Enforces:
 * - Separation of generic text classification from custom typers
 * - Never overwriting manually selected typers
 * - Preserving SFX and all detected content in scan data
 * - Keeping BubbleItem clean without corrupting canonical scan structures
 */

import type { BubbleItem, ReviewFlagItem } from '../types/workbench';
import type { CustomTyperConfig, TyperSettings } from '../types/typers';
import { resolveCanonicalTyper } from '../types/typers';
import type {
  PageScanResult,
  TextRegion,
  GenericTextClass,
  ScanIssue,
} from '../types/scanning';
import { clampBox } from './coordinateTransforms';

/**
 * Deterministic mapping from GenericTextClass to default Typer Config.
 * Used ONLY when assigning initial defaults. Does NOT overwrite manual choices.
 */
export function defaultTyperForClass(
  primaryClass: GenericTextClass,
  configuredTypers: CustomTyperConfig[]
): { id: string; prefix: string } {
  const typers = configuredTypers && configuredTypers.length > 0 ? configuredTypers : [];

  const findTyper = (keys: string[]) => {
    for (const k of keys) {
      const match = typers.find(
        (t) =>
          t.id.toLowerCase() === k.toLowerCase() ||
          t.name.toLowerCase().includes(k.toLowerCase())
      );
      if (match) return match;
    }
    return undefined;
  };

  switch (primaryClass) {
    case 'dialogue': {
      const matched = findTyper(['speech_bubbles', 'dialogue']);
      if (matched) return { id: matched.id, prefix: matched.prefix };
      break;
    }
    case 'thought': {
      const matched = findTyper(['thought_bubbles', 'thought']);
      if (matched) return { id: matched.id, prefix: matched.prefix };
      break;
    }
    case 'vocalization': {
      const matched = findTyper(['shouting', 'scream', 'speech_bubbles']);
      if (matched) return { id: matched.id, prefix: matched.prefix };
      break;
    }
    case 'narration': {
      const matched = findTyper(['square_bubbles', 'box', 'outside_text']);
      if (matched) return { id: matched.id, prefix: matched.prefix };
      break;
    }
    case 'caption':
    case 'environmental_text': {
      const matched = findTyper(['outside_text', 'small_text']);
      if (matched) return { id: matched.id, prefix: matched.prefix };
      break;
    }
    case 'sfx': {
      const matched = findTyper(['sfx', 'sound_effects']);
      if (matched) return { id: matched.id, prefix: matched.prefix };
      break;
    }
    case 'unknown':
    default:
      return { id: 'none', prefix: '' };
  }

  // Fallback to first configured typer or 'none'
  if (typers.length > 0) {
    return { id: typers[0].id, prefix: typers[0].prefix };
  }
  return { id: 'none', prefix: '' };
}

/**
 * Converts a ScanIssue into a workspace ReviewFlagItem.
 */
export function scanIssueToReviewFlag(issue: ScanIssue, index: number): ReviewFlagItem {
  const categoryMap: Record<string, any> = {
    OCR_AMBIGUOUS: 'ocr_error',
    REGION_BOUNDARY_UNCERTAIN: 'missed_bubble',
    BUBBLE_ASSOCIATION_AMBIGUOUS: 'ambiguous_flow',
    PANEL_ASSOCIATION_AMBIGUOUS: 'reading_order',
    READING_ORDER_CONFLICT: 'reading_order',
    CLASSIFICATION_AMBIGUOUS: 'typer_tag',
    TEXT_CLIPPED: 'ocr_error',
    DUPLICATE_CANDIDATE: 'remove_bubble',
  };

  const category = categoryMap[issue.flag] || 'ocr_error';

  return {
    id: issue.issueId || `flag-scan-${Date.now()}-${index}`,
    category,
    severity: issue.severity,
    reasonAr: issue.reason,
    status: 'pending',
    evidence: issue.evidence,
    confidence: 0.85,
    createdAt: Date.now(),
  };
}

/**
 * Adapts canonical PageScanResult to workspace BubbleItem[].
 * Respects existing manual edits and manual typers.
 */
export function scanResultToBubbleItems(
  scan: PageScanResult,
  typerSettings: TyperSettings,
  existingBubbles?: BubbleItem[]
): BubbleItem[] {
  const existingMap = new Map<string, BubbleItem>();
  if (existingBubbles && existingBubbles.length > 0) {
    existingBubbles.forEach((b) => existingMap.set(b.id, b));
  }

  // Build issue map by regionId
  const issuesByRegion = new Map<string, ScanIssue[]>();
  for (const issue of scan.issues || []) {
    for (const rId of issue.affectedRegionIds || []) {
      if (!issuesByRegion.has(rId)) {
        issuesByRegion.set(rId, []);
      }
      issuesByRegion.get(rId)!.push(issue);
    }
  }

  return scan.regions.map((region, idx) => {
    const existing = existingMap.get(region.regionId);
    const isManuallyEdited = existing?.isManuallyEdited || region.isManuallyEdited || false;

    // Resolve Typer:
    // If the bubble was manually edited or had a user-selected typer, PRESERVE IT!
    let selectedType: string;
    let selectedPrefix: string;

    if (existing && existing.type && existing.type !== 'none') {
      const canonical = resolveCanonicalTyper(existing.type, typerSettings.typers);
      selectedType = canonical.id;
      selectedPrefix = existing.typerPrefix !== undefined ? existing.typerPrefix : canonical.prefix;
    } else {
      // Automatic initial assignment from generic classification
      const def = defaultTyperForClass(region.classification.primaryClass, typerSettings.typers);
      selectedType = def.id;
      selectedPrefix = def.prefix;
    }

    // Source Text:
    // If user edited source text manually, preserve user edit; originalSourceText retains raw OCR
    const sourceText = isManuallyEdited && existing?.sourceText !== undefined
      ? existing.sourceText
      : region.rawOCR;
    const originalSourceText = region.rawOCR;

    // Translation:
    // Preserve existing translation and history if available
    const translatedText = existing?.translatedText || '';
    const rawTranslatedText = existing?.rawTranslatedText || '';
    const humanizedTranslatedText = existing?.humanizedTranslatedText || '';
    const translationHistory = existing?.translationHistory || [];

    // Review Flags:
    // Convert new scan issues affecting this region
    const regionIssues = issuesByRegion.get(region.regionId) || [];
    const newFlags: ReviewFlagItem[] = regionIssues.map((iss, fIdx) =>
      scanIssueToReviewFlag(iss, fIdx)
    );

    // Merge with existing pending flags without duplicates
    const existingFlags = existing?.reviewFlags || [];
    const mergedFlags = [...existingFlags];
    for (const nf of newFlags) {
      if (!mergedFlags.some((ef) => ef.reasonAr === nf.reasonAr)) {
        mergedFlags.push(nf);
      }
    }

    const safeBox = clampBox(region.geometry.box_2d, 1000);

    return {
      id: region.regionId,
      pageId: scan.pageId,
      index: region.order.sequenceIndex || idx + 1,
      box_2d: safeBox,
      type: selectedType,
      typerPrefix: selectedPrefix,
      sourceLanguage: region.sourceLanguage || 'ja',
      sourceText,
      originalSourceText,
      translatedText,
      rawTranslatedText,
      humanizedTranslatedText,
      translationHistory,
      reviewFlags: mergedFlags,
      confidence: region.confidence?.ocr ?? 0.9,
      isManuallyEdited,
      updatedAt: Date.now(),
    };
  });
}

/**
 * Synchronizes workspace BubbleItem[] back to canonical PageScanResult.
 */
export function updateScanResultFromBubbleItems(
  scan: PageScanResult,
  bubbles: BubbleItem[]
): PageScanResult {
  const bubbleMap = new Map(bubbles.map((b) => [b.id, b]));

  const updatedRegions: TextRegion[] = scan.regions.map((region) => {
    const bubble = bubbleMap.get(region.regionId);
    if (!bubble) return region;

    return {
      ...region,
      geometry: {
        ...region.geometry,
        box_2d: bubble.box_2d,
      },
      rawOCR: bubble.originalSourceText || region.rawOCR,
      order: {
        ...region.order,
        sequenceIndex: bubble.index,
      },
      isManuallyEdited: bubble.isManuallyEdited,
    };
  });

  // Handle any bubbles added manually by the user that weren't in original scan
  for (const bubble of bubbles) {
    if (!scan.regions.some((r) => r.regionId === bubble.id)) {
      const newRegion: TextRegion = {
        regionId: bubble.id,
        geometry: {
          coordinateSpace: 'normalized_1000',
          box_2d: bubble.box_2d,
        },
        rawOCR: bubble.sourceText || '',
        confidence: {
          imageQuality: 1.0,
          regionDetection: 1.0,
          ocr: 1.0,
          association: 1.0,
          readingOrder: 1.0,
          classification: 1.0,
        },
        classification: {
          primaryClass: 'dialogue',
          confidence: 1.0,
          needsReview: false,
        },
        associations: {},
        order: {
          sequenceIndex: bubble.index,
          confidence: 1.0,
          rationale: 'Manually added by user in workspace',
        },
        flags: [],
        isManuallyEdited: true,
      };
      updatedRegions.push(newRegion);
    }
  }

  // Sort regions by sequenceIndex
  updatedRegions.sort((a, b) => a.order.sequenceIndex - b.order.sequenceIndex);

  return {
    ...scan,
    regions: updatedRegions,
  };
}
