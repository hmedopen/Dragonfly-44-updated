/**
 * Folio Script: System #3 — Manga Scanning & Classification Engine
 * Hierarchical Reading Order Inference Engine
 * 
 * Implements hierarchical reading order: Page -> Panels -> Intra-panel Regions.
 * Supports Manga (RTL), Webtoon (Vertical Strip), and Western/Manhua (LTR).
 */

import type { PanelRegion, TextRegion, ReadingConvention, RegionOrder } from '../types/scanning';
import { calculateBoxIoU } from './coordinateTransforms';

export interface ReadingOrderOptions {
  readingConvention?: ReadingConvention;
  aspectRatio?: number; // height / width
}

/**
 * Determines effective reading convention from user settings and page aspect ratio.
 */
export function resolveReadingConvention(options: ReadingOrderOptions): ReadingConvention {
  const { readingConvention = 'auto', aspectRatio = 1.4 } = options;

  if (readingConvention !== 'auto') {
    return readingConvention;
  }

  // Webtoon / Manhwa vertical strip detection (height > 2x width)
  if (aspectRatio > 2.0) {
    return 'webtoon_v';
  }

  // Standard manga page default
  return 'manga_rtl';
}

/**
 * Groups bounding boxes into horizontal tiers based on vertical overlap.
 */
function groupIntoTiers<T extends { box: [number, number, number, number] }>(
  items: T[],
  verticalOverlapThreshold = 0.35
): T[][] {
  if (items.length === 0) return [];

  // Sort items by top coordinate (ymin)
  const sorted = [...items].sort((a, b) => a.box[0] - b.box[0]);
  const tiers: T[][] = [];

  for (const item of sorted) {
    let placed = false;
    const [ymin, , ymax] = item.box;
    const itemHeight = Math.max(10, ymax - ymin);

    for (const tier of tiers) {
      // Check vertical overlap with tier's vertical span
      const tierYmin = Math.min(...tier.map((t) => t.box[0]));
      const tierYmax = Math.max(...tier.map((t) => t.box[2]));
      const tierHeight = Math.max(10, tierYmax - tierYmin);

      const overlapYmin = Math.max(ymin, tierYmin);
      const overlapYmax = Math.min(ymax, tierYmax);
      const overlap = Math.max(0, overlapYmax - overlapYmin);

      const overlapRatio = overlap / Math.min(itemHeight, tierHeight);
      if (overlapRatio >= verticalOverlapThreshold) {
        tier.push(item);
        placed = true;
        break;
      }
    }

    if (!placed) {
      tiers.push([item]);
    }
  }

  // Sort tiers from top to bottom
  tiers.sort((a, b) => {
    const minYA = Math.min(...a.map((i) => i.box[0]));
    const minYB = Math.min(...b.map((i) => i.box[0]));
    return minYA - minYB;
  });

  return tiers;
}

/**
 * Orders panels topologically based on reading convention.
 */
export function orderPanels(
  panels: PanelRegion[],
  convention: ReadingConvention
): PanelRegion[] {
  if (!panels || panels.length <= 1) {
    return panels.map((p, idx) => ({ ...p, sequenceIndex: idx + 1 }));
  }

  const items = panels.map((p) => ({ panel: p, box: p.geometry.box_2d }));
  const tiers = groupIntoTiers(items, 0.3);

  const ordered: PanelRegion[] = [];

  for (const tier of tiers) {
    if (convention === 'manga_rtl') {
      // In Manga RTL, read Right-to-Left within the tier (larger xmax or xmin first)
      tier.sort((a, b) => {
        // Primary: right edge descending
        const rightDiff = b.box[3] - a.box[3];
        if (Math.abs(rightDiff) > 30) return rightDiff;
        // Secondary: top edge ascending
        return a.box[0] - b.box[0];
      });
    } else if (convention === 'ltr') {
      // Left-to-Right within tier
      tier.sort((a, b) => {
        const leftDiff = a.box[1] - b.box[1];
        if (Math.abs(leftDiff) > 30) return leftDiff;
        return a.box[0] - b.box[0];
      });
    } else {
      // Webtoon vertical: strictly top-to-bottom
      tier.sort((a, b) => a.box[0] - b.box[0]);
    }

    tier.forEach((item) => ordered.push(item.panel));
  }

  return ordered.map((p, idx) => ({
    ...p,
    sequenceIndex: idx + 1,
  }));
}

/**
 * Associates text regions to their enclosing or closest panel.
 */
export function associateRegionsToPanels(
  regions: TextRegion[],
  panels: PanelRegion[]
): Map<string, string | undefined> {
  const associations = new Map<string, string | undefined>();

  if (!panels || panels.length === 0) {
    regions.forEach((r) => associations.set(r.regionId, undefined));
    return associations;
  }

  for (const region of regions) {
    const [rymin, rxmin, rymax, rxmax] = region.geometry.box_2d;
    const rcx = (rxmin + rxmax) / 2;
    const rcy = (rymin + rymax) / 2;

    let bestPanelId: string | undefined = undefined;
    let bestScore = -1;

    for (const panel of panels) {
      const [pymin, pxmin, pymax, pxmax] = panel.geometry.box_2d;

      // Check centroid containment
      const containsCentroid = rcx >= pxmin && rcx <= pxmax && rcy >= pymin && rcy <= pymax;
      const iou = calculateBoxIoU(region.geometry.box_2d, panel.geometry.box_2d);

      let score = 0;
      if (containsCentroid) score += 10;
      score += iou * 5;

      if (score > bestScore && score > 0) {
        bestScore = score;
        bestPanelId = panel.panelId;
      }
    }

    associations.set(region.regionId, bestPanelId);
  }

  return associations;
}

/**
 * Orders a group of regions within a single panel or tier.
 */
function orderIntraPanelRegions(
  regions: TextRegion[],
  convention: ReadingConvention
): TextRegion[] {
  if (regions.length <= 1) return regions;

  const items = regions.map((r) => ({ region: r, box: r.geometry.box_2d }));
  // Intra-bubble vertical tolerance: 25% overlap
  const tiers = groupIntoTiers(items, 0.25);
  const result: TextRegion[] = [];

  for (const tier of tiers) {
    if (convention === 'manga_rtl') {
      // Right to Left within tier
      tier.sort((a, b) => {
        // If one is noticeably higher, read it first
        const topDiff = a.box[0] - b.box[0];
        if (Math.abs(topDiff) > 60) return topDiff;
        // Otherwise, right-to-left
        return b.box[3] - a.box[3];
      });
    } else if (convention === 'ltr') {
      // Left to Right within tier
      tier.sort((a, b) => {
        const topDiff = a.box[0] - b.box[0];
        if (Math.abs(topDiff) > 60) return topDiff;
        return a.box[1] - b.box[1];
      });
    } else {
      // Webtoon vertical: strictly top-to-bottom
      tier.sort((a, b) => a.box[0] - b.box[0]);
    }

    tier.forEach((item) => result.push(item.region));
  }

  return result;
}

/**
 * Hierarchical reading order inference:
 * 1. Orders panels hierarchically.
 * 2. Assigns regions to panels.
 * 3. Orders regions intra-panel.
 * 4. Integrates uncontained regions into global sequence seamlessly.
 */
export function inferHierarchicalReadingOrder(
  panels: PanelRegion[],
  regions: TextRegion[],
  convention: ReadingConvention
): TextRegion[] {
  if (!regions || regions.length === 0) return [];

  // Step 1: Order panels
  const orderedPanels = orderPanels(panels, convention);
  const panelAssociations = associateRegionsToPanels(regions, orderedPanels);

  // Group regions by panelId
  const panelBuckets = new Map<string, TextRegion[]>();
  const uncontainedRegions: TextRegion[] = [];

  for (const panel of orderedPanels) {
    panelBuckets.set(panel.panelId, []);
  }

  for (const region of regions) {
    const assignedPanelId = panelAssociations.get(region.regionId);
    if (assignedPanelId && panelBuckets.has(assignedPanelId)) {
      panelBuckets.get(assignedPanelId)!.push({
        ...region,
        associations: { ...region.associations, panelId: assignedPanelId },
      });
    } else {
      uncontainedRegions.push(region);
    }
  }

  // Step 2: Order regions within each panel
  const globallyOrdered: TextRegion[] = [];

  for (const panel of orderedPanels) {
    const intra = panelBuckets.get(panel.panelId) || [];
    const orderedIntra = orderIntraPanelRegions(intra, convention);
    globallyOrdered.push(...orderedIntra);
  }

  // Step 3: Insert uncontained regions by vertical/horizontal position
  if (uncontainedRegions.length > 0) {
    const orderedUncontained = orderIntraPanelRegions(uncontainedRegions, convention);

    if (globallyOrdered.length === 0) {
      globallyOrdered.push(...orderedUncontained);
    } else {
      // Merge uncontained by vertical midpoints
      for (const uncontained of orderedUncontained) {
        const uY = (uncontained.geometry.box_2d[0] + uncontained.geometry.box_2d[2]) / 2;
        let inserted = false;

        for (let i = 0; i < globallyOrdered.length; i++) {
          const gY = (globallyOrdered[i].geometry.box_2d[0] + globallyOrdered[i].geometry.box_2d[2]) / 2;
          if (uY < gY) {
            globallyOrdered.splice(i, 0, uncontained);
            inserted = true;
            break;
          }
        }

        if (!inserted) {
          globallyOrdered.push(uncontained);
        }
      }
    }
  }

  // Step 4: Assign sequence indices and confidence
  return globallyOrdered.map((region, idx) => {
    const orderData: RegionOrder = {
      sequenceIndex: idx + 1,
      confidence: 0.95,
      rationale: `Hierarchical sequence via ${convention} layout rules`,
    };
    return {
      ...region,
      order: orderData,
    };
  });
}

export interface ReadingOrderValidationResult {
  isValid: boolean;
  orderedIds: string[];
  errors: string[];
  missingIds: string[];
  unknownIds: string[];
  duplicateIds: string[];
}

/**
 * Validates that Gemini's returned reading order accounts for every eligible input group ID exactly once.
 * Rejects unknown IDs, duplicates, and omitted IDs.
 */
export function validateGeminiReadingOrder(
  readingOrder: unknown,
  expectedRegionIds: string[]
): ReadingOrderValidationResult {
  const errors: string[] = [];
  const expectedSet = new Set(expectedRegionIds);

  if (!Array.isArray(readingOrder)) {
    return {
      isValid: false,
      orderedIds: [],
      errors: ['Gemini reading order is not an array.'],
      missingIds: [...expectedRegionIds],
      unknownIds: [],
      duplicateIds: [],
    };
  }

  // Canonical mapping supports exact match or prefix-stripped suffix match
  const canonicalMap = new Map<string, string>();
  for (const exp of expectedRegionIds) {
    canonicalMap.set(exp, exp);
    if (exp.includes('__')) {
      const afterDoubleUnderscore = exp.split('__')[1];
      if (afterDoubleUnderscore && !canonicalMap.has(afterDoubleUnderscore)) {
        canonicalMap.set(afterDoubleUnderscore, exp);
      }
    }
    if (exp.includes('-')) {
      const parts = exp.split('-');
      // Support stripping first segment (e.g. pageId prefix)
      const afterFirstDash = parts.slice(1).join('-');
      if (!canonicalMap.has(afterFirstDash)) {
        canonicalMap.set(afterFirstDash, exp);
      }
      // Support last segment (e.g. local-1)
      const lastTwo = parts.slice(-2).join('-');
      if (!canonicalMap.has(lastTwo)) {
        canonicalMap.set(lastTwo, exp);
      }
    }
  }

  const rawIds = readingOrder
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id.length > 0);

  const unknownIds: string[] = [];
  const duplicateIds: string[] = [];
  const seenIds = new Set<string>();
  const canonicalIds: string[] = [];

  for (const id of rawIds) {
    const canonical = canonicalMap.get(id);
    if (!canonical || !expectedSet.has(canonical)) {
      unknownIds.push(id);
    } else {
      if (seenIds.has(canonical)) {
        duplicateIds.push(id);
      }
      seenIds.add(canonical);
      canonicalIds.push(canonical);
    }
  }

  const missingIds = expectedRegionIds.filter((id) => !seenIds.has(id));

  if (unknownIds.length > 0) {
    errors.push(`Gemini reading order contains ${unknownIds.length} unknown region ID(s): ${unknownIds.join(', ')}`);
  }
  if (duplicateIds.length > 0) {
    errors.push(`Gemini reading order contains duplicate region ID(s): ${duplicateIds.join(', ')}`);
  }
  if (missingIds.length > 0) {
    errors.push(`Gemini reading order omitted ${missingIds.length} input region ID(s): ${missingIds.join(', ')}`);
  }

  const isValid = errors.length === 0 && canonicalIds.length === expectedRegionIds.length;
  return {
    isValid,
    orderedIds: isValid ? canonicalIds : [],
    errors,
    missingIds,
    unknownIds,
    duplicateIds,
  };
}

/**
 * Applies a verified sequence of region IDs to order TextRegion records,
 * assigning explicit sequence indices and recording confidence/ambiguities.
 */
export function applyReadingOrder(
  regions: TextRegion[],
  orderedIds: string[],
  options?: {
    isFallback?: boolean;
    confidence?: number;
    rationale?: string;
    ambiguities?: Array<{ regionA: string; regionB: string; reason: string }>;
  }
): TextRegion[] {
  const regionMap = new Map<string, TextRegion>();
  regions.forEach((r) => regionMap.set(r.regionId, r));

  const ordered: TextRegion[] = [];
  const assignedIds = new Set<string>();

  // 1. Follow the validated sequence
  for (let idx = 0; idx < orderedIds.length; idx++) {
    const id = orderedIds[idx];
    const region = regionMap.get(id);
    if (!region) continue;
    assignedIds.add(id);

    const isAmbiguous = options?.ambiguities?.some(
      (a) => a.regionA === id || a.regionB === id
    );

    const updatedFlags = [...region.flags];
    if (isAmbiguous && !updatedFlags.includes('READING_ORDER_CONFLICT')) {
      updatedFlags.push('READING_ORDER_CONFLICT');
    }

    ordered.push({
      ...region,
      order: {
        sequenceIndex: idx + 1,
        confidence: isAmbiguous
          ? 0.70
          : options?.confidence ?? (options?.isFallback ? 0.75 : 0.96),
        rationale:
          options?.rationale ||
          (options?.isFallback
            ? 'Geometric layout fallback'
            : 'Gemini visual narrative reading order'),
      },
      flags: updatedFlags,
    });
  }

  // 2. Safety guard: any region missing from orderedIds is placed at the end without disappearing
  for (const region of regions) {
    if (!assignedIds.has(region.regionId)) {
      const updatedFlags = [...region.flags];
      if (!updatedFlags.includes('READING_ORDER_CONFLICT')) {
        updatedFlags.push('READING_ORDER_CONFLICT');
      }
      ordered.push({
        ...region,
        order: {
          sequenceIndex: ordered.length + 1,
          confidence: 0.50,
          rationale: 'Unsequenced group appended during order recovery',
        },
        flags: updatedFlags,
      });
    }
  }

  return ordered;
}
