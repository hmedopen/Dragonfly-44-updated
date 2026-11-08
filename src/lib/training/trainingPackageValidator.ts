/**
 * Folio Script - Training Package Validator & Normalizer
 * Validates DragonflyTrainingPackageV1 manifests, verifies bounding box coordinates,
 * enforces unverified status on agent annotations, and maps packages to Reference Sets.
 */

import type {
  TrainingPackageManifestV1,
  PackageValidationResult,
  TrainingPackageExampleV1,
  TrainingPackageAnnotationV1,
} from '../../types/trainingPackage';
import type {
  TrainingReferenceSet,
  ReferenceExample,
  TrainingVisualAnnotation,
  TrainingTaskType,
} from '../../types/training';

const VALID_TASKS: Set<TrainingTaskType> = new Set([
  'scanning_classification',
  'reading_order',
  'speech_balloon_detection',
  'ocr_text_region',
  'sfx_classification',
  'translation_quality',
  'review_qc',
]);

const VALID_LABELS = new Set([
  'balloon',
  'tail',
  'text_region',
  'sfx',
  'panel',
  'character',
  'other',
]);

/**
 * Validates a parsed TrainingPackageManifestV1 object against the canonical contract.
 */
export function validateTrainingPackageV1(manifest: any): PackageValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let exampleCount = 0;
  let annotationCount = 0;
  let unverifiedAnnotationCount = 0;
  let embeddedImagesCount = 0;
  let tasksCount = 0;

  if (!manifest || typeof manifest !== 'object') {
    return {
      isValid: false,
      schemaVersion: 'unknown',
      errors: ['Manifest must be a non-null JSON object.'],
      warnings: [],
      stats: { exampleCount: 0, annotationCount: 0, unverifiedAnnotationCount: 0, embeddedImagesCount: 0, tasksCount: 0 },
    };
  }

  // 1. Schema version
  if (manifest.schemaVersion !== 'dragonfly.training.v1') {
    errors.push(`Invalid schemaVersion: expected "dragonfly.training.v1", got "${manifest.schemaVersion}".`);
  }

  // 2. Reference Set metadata
  if (!manifest.referenceSet || typeof manifest.referenceSet !== 'object') {
    errors.push('Manifest is missing required "referenceSet" object.');
  } else {
    const ref = manifest.referenceSet;
    if (!ref.title || typeof ref.title !== 'string' || ref.title.trim().length === 0) {
      errors.push('referenceSet.title is required and cannot be empty.');
    }
    if (!Array.isArray(ref.targetTasks) || ref.targetTasks.length === 0) {
      errors.push('referenceSet.targetTasks must be a non-empty array of valid tasks.');
    } else {
      tasksCount = ref.targetTasks.length;
      for (const t of ref.targetTasks) {
        if (!VALID_TASKS.has(t)) {
          errors.push(`Unknown targetTask: "${t}".`);
        }
      }
    }
  }

  // 3. Examples
  if (!Array.isArray(manifest.examples)) {
    errors.push('Manifest is missing required "examples" array.');
  } else {
    exampleCount = manifest.examples.length;
    if (exampleCount === 0) {
      warnings.push('Manifest contains 0 examples. Package will create an empty Reference Set.');
    }

    manifest.examples.forEach((ex: TrainingPackageExampleV1, exIdx: number) => {
      const exNum = exIdx + 1;
      if (!ex.title || typeof ex.title !== 'string') {
        warnings.push(`Example #${exNum} is missing a descriptive title. Defaulting to "Example ${exNum}".`);
      }
      if (!ex.aiNote || typeof ex.aiNote !== 'string' || ex.aiNote.trim().length === 0) {
        errors.push(`Example #${exNum} is missing required "aiNote". Notes must explain to the AI why this example matters.`);
      }

      // Image presence check
      const hasBase64 = typeof ex.imageBase64 === 'string' && ex.imageBase64.trim().length > 0;
      const hasBlobKey = typeof ex.imageBlobKey === 'string' && ex.imageBlobKey.trim().length > 0;
      const hasPath = typeof ex.sourceFilePath === 'string' && ex.sourceFilePath.trim().length > 0;

      if (hasBase64) embeddedImagesCount++;
      if (!hasBase64 && !hasBlobKey && !hasPath) {
        errors.push(`Example #${exNum} has no image data (neither imageBase64, imageBlobKey, nor sourceFilePath).`);
      }

      // Annotations check
      if (Array.isArray(ex.annotations)) {
        const physicalIds = new Set<string>();

        ex.annotations.forEach((ann: TrainingPackageAnnotationV1, annIdx: number) => {
          annotationCount++;
          const annNum = annIdx + 1;

          // Ground truth check: AI-generated packages must NOT assert pre-verified ground truth
          if (ann.isVerified === true) {
            warnings.push(
              `Example #${exNum} annotation #${annNum} (${ann.physicalObjectId || 'unnamed'}) was marked as pre-verified. AI suggestions must be reviewed by the user.`
            );
          } else {
            unverifiedAnnotationCount++;
          }

          if (!ann.physicalObjectId || typeof ann.physicalObjectId !== 'string') {
            errors.push(`Example #${exNum} annotation #${annNum} is missing "physicalObjectId".`);
          } else {
            physicalIds.add(ann.physicalObjectId);
          }

          if (!ann.label || !VALID_LABELS.has(ann.label)) {
            warnings.push(`Example #${exNum} annotation #${annNum} has unknown label "${ann.label}". Defaulting to "other".`);
          }

          // Coordinate validation [ymin, xmin, ymax, xmax] normalized 0-1000
          if (!Array.isArray(ann.box_2d) || ann.box_2d.length !== 4) {
            errors.push(`Example #${exNum} annotation #${annNum} box_2d must be an array of 4 integers [ymin, xmin, ymax, xmax].`);
          } else {
            const [ymin, xmin, ymax, xmax] = ann.box_2d;
            if (
              typeof ymin !== 'number' ||
              typeof xmin !== 'number' ||
              typeof ymax !== 'number' ||
              typeof xmax !== 'number'
            ) {
              errors.push(`Example #${exNum} annotation #${annNum} box_2d coordinates must be numbers.`);
            } else {
              if (ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) {
                errors.push(`Example #${exNum} annotation #${annNum} coordinates out of 0-1000 range: [${ymin}, ${xmin}, ${ymax}, ${xmax}].`);
              }
              if (ymin >= ymax) {
                errors.push(`Example #${exNum} annotation #${annNum} invalid height: ymin (${ymin}) >= ymax (${ymax}).`);
              }
              if (xmin >= xmax) {
                errors.push(`Example #${exNum} annotation #${annNum} invalid width: xmin (${xmin}) >= xmax (${xmax}).`);
              }
            }
          }

          // Relationships target verification
          if (Array.isArray(ann.relationships)) {
            for (const rel of ann.relationships) {
              if (!rel.targetObjectId) {
                warnings.push(`Example #${exNum} annotation #${annNum} has relationship with missing targetObjectId.`);
              }
            }
          }
        });
      }
    });
  }

  return {
    isValid: errors.length === 0,
    schemaVersion: manifest?.schemaVersion || 'unknown',
    errors,
    warnings,
    stats: {
      exampleCount,
      annotationCount,
      unverifiedAnnotationCount,
      embeddedImagesCount,
      tasksCount,
    },
  };
}

/**
 * Normalizes a validated manifest into a persistent TrainingReferenceSet model.
 * Prepares stable IDs and flags annotations as unverified if generated by an agent.
 */
export function normalizePackageToSet(
  manifest: TrainingPackageManifestV1,
  options?: { preserveVerification?: boolean }
): {
  referenceSet: TrainingReferenceSet;
  embeddedImagesToStore: Array<{ blobKey: string; base64: string; mimeType: string }>;
} {
  const now = Date.now();
  const ref = manifest.referenceSet;
  const setId = ref.id || `ref_set_${now}_${Math.random().toString(36).substring(2, 7)}`;

  const embeddedImagesToStore: Array<{ blobKey: string; base64: string; mimeType: string }> = [];

  const examples: ReferenceExample[] = manifest.examples.map((ex, idx) => {
    const orderIndex = idx + 1;
    const exampleId = ex.id || `ex_${now}_${orderIndex}_${Math.random().toString(36).substring(2, 6)}`;
    let blobKey = ex.imageBlobKey || '';

    // If package includes embedded base64 image data, prepare for storage
    if (ex.imageBase64 && ex.imageBase64.trim().length > 0) {
      blobKey = `tb_${now}_${orderIndex}_${Math.random().toString(36).substring(2, 7)}`;
      let mimeType = 'image/png';
      let cleanBase64 = ex.imageBase64;

      if (ex.imageBase64.startsWith('data:')) {
        const parts = ex.imageBase64.split(';base64,');
        mimeType = parts[0].replace('data:', '') || 'image/png';
        cleanBase64 = parts[1] || '';
      }

      embeddedImagesToStore.push({
        blobKey,
        base64: cleanBase64,
        mimeType,
      });
    }

    const annotations: TrainingVisualAnnotation[] = (ex.annotations || []).map((ann, annIdx) => {
      const annId = ann.id || `ann_${now}_${orderIndex}_${annIdx + 1}`;
      // Invariant: AI/Agent generated annotations start as unverified unless human user explicitly approves
      const isVerified = options?.preserveVerification ? Boolean(ann.isVerified) : false;

      return {
        id: annId,
        physicalObjectId: ann.physicalObjectId || `obj_${annIdx + 1}`,
        box_2d: ann.box_2d,
        label: VALID_LABELS.has(ann.label) ? ann.label : 'other',
        translationUnitId: ann.translationUnitId,
        readingOrderIndex: ann.readingOrderIndex || annIdx + 1,
        relationships: ann.relationships || [],
        notes: ann.notes || '',
        isVerified,
        source: 'agent',
        confidence: ann.confidence,
      };
    });

    return {
      id: exampleId,
      orderIndex,
      title: ex.title || `Example #${orderIndex}`,
      blobKey,
      sourceFileName: ex.sourceFileName || `screenshot_${orderIndex}.png`,
      sourceFilePath: ex.sourceFilePath,
      aiNote: ex.aiNote || '',
      expectedBehaviour: ex.expectedBehaviour || '',
      tags: Array.isArray(ex.tags) ? ex.tags : [],
      annotations,
      isEnabled: ex.isEnabled !== undefined ? ex.isEnabled : true,
      createdAt: now,
      updatedAt: now,
    };
  });

  const referenceSet: TrainingReferenceSet = {
    id: setId,
    title: ref.title.trim(),
    description: ref.description || '',
    generalInstructions: ref.generalInstructions || '',
    targetTasks: ref.targetTasks,
    enabled: ref.enabled !== undefined ? ref.enabled : false, // Default to disabled so user reviews before activating
    priority: typeof ref.priority === 'number' ? ref.priority : 50,
    version: 1,
    createdAt: now,
    updatedAt: now,
    examples,
  };

  return { referenceSet, embeddedImagesToStore };
}
