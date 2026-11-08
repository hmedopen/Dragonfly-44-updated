/**
 * Dragonfly 44 - Training Studio Gemini Prompt Injection & Context Assembler
 * Selects task-specific enabled Reference Sets and examples, enforces image/token budgets,
 * constructs multimodal Gemini API parts, and records diagnostic telemetry.
 */

import { trainingStorage } from '../../services/trainingStorage';
import { formatProjectContextForPrompt } from './trainingProjectContext';
import { trainingDiagnostics } from './trainingDiagnostics';
import { blobToBase64 } from '../geminiScan';
import type {
  TrainingTaskType,
  TrainingVisualAnnotation,
} from '../../types/training';

export interface AssembleTrainingOptions {
  task: TrainingTaskType;
  maxExamples?: number; // Configurable image budget (default: 2)
  model?: string;
  operationId?: string;
}

export interface TrainingMultimodalPart {
  text?: string;
  inline_data?: {
    mime_type: string;
    data: string;
  };
}

export interface AssembledTrainingContext {
  hasTrainingContext: boolean;
  systemInstructionDirective: string;
  multimodalReferenceParts: TrainingMultimodalPart[];
  appliedReferenceSets: Array<{
    id: string;
    title: string;
    version: number;
    priority: number;
  }>;
  selectedExamples: Array<{
    exampleId: string;
    orderIndex: number;
    title: string;
    hasImage: boolean;
    hasAnnotations: boolean;
  }>;
}

/**
 * Formats a single visual annotation for AI consumption.
 * Explicitly distinguishes physical balloon identity from logical translation grouping.
 */
function formatAnnotationForAI(ann: TrainingVisualAnnotation, idx: number): string {
  const parts: string[] = [];
  parts.push(`Annotation #${idx + 1}:`);
  parts.push(`  Physical Object ID: "${ann.physicalObjectId}"`);
  parts.push(`  Label: [${ann.label}]`);
  parts.push(`  Box [ymin, xmin, ymax, xmax]: [${ann.box_2d.join(', ')}]`);

  if (ann.translationUnitId) {
    parts.push(`  Translation Unit Grouping: "${ann.translationUnitId}" (Logical Grouping)`);
  }
  if (typeof ann.readingOrderIndex === 'number') {
    parts.push(`  Reading Order Sequence: #${ann.readingOrderIndex}`);
  }
  if (ann.relationships && ann.relationships.length > 0) {
    const rels = ann.relationships.map((r) => `${r.relationType} -> "${r.targetObjectId}"`).join(', ');
    parts.push(`  Relationships: ${rels}`);
  }
  if (ann.notes && ann.notes.trim().length > 0) {
    parts.push(`  Annotation Note: "${ann.notes.trim()}"`);
  }
  parts.push(`  Verified Ground Truth: ${ann.isVerified ? 'YES' : 'NO (Unverified)'}`);

  return parts.join('\n');
}

/**
 * Assembles task-specific training context for Gemini prompt construction.
 * Zero overhead and completely untouched if no enabled reference sets exist.
 */
export async function assembleTaskTrainingContext(
  options: AssembleTrainingOptions
): Promise<AssembledTrainingContext> {
  const { task, maxExamples = 2, model = 'gemini-3.8-flash', operationId = `op_${Date.now()}` } = options;

  // 1. Retrieve all reference sets
  const allSets = await trainingStorage.getAllReferenceSets();

  // 2. Filter applicable, enabled reference sets matching this task
  const applicableSets = allSets.filter((s) => s.enabled && s.targetTasks.includes(task));

  if (applicableSets.length === 0) {
    return {
      hasTrainingContext: false,
      systemInstructionDirective: '',
      multimodalReferenceParts: [],
      appliedReferenceSets: [],
      selectedExamples: [],
    };
  }

  // 3. Sort sets by priority descending
  applicableSets.sort((a, b) => b.priority - a.priority);

  // 4. Assemble system instruction directives
  const instructionBlocks: string[] = [];
  instructionBlocks.push('\n=== DRAGONFLY 44 TRAINING STUDIO — ACTIVE REFERENCE INSTRUCTIONS ===');

  // Inject authoritative task architectural rules
  const projectContext = formatProjectContextForPrompt([task]);
  if (projectContext) {
    instructionBlocks.push(projectContext);
  }

  const appliedReferenceSets: AssembledTrainingContext['appliedReferenceSets'] = [];
  const selectedExamples: AssembledTrainingContext['selectedExamples'] = [];
  const multimodalParts: TrainingMultimodalPart[] = [];

  let examplesBudgetRemaining = maxExamples;

  for (const set of applicableSets) {
    appliedReferenceSets.push({
      id: set.id,
      title: set.title,
      version: set.version,
      priority: set.priority,
    });

    instructionBlocks.push(`\n[Reference Set: "${set.title}" (v${set.version}) | Priority: ${set.priority}]`);
    if (set.generalInstructions && set.generalInstructions.trim().length > 0) {
      instructionBlocks.push(`General Instructions:\n${set.generalInstructions.trim()}`);
    }

    // 5. Select enabled examples within image budget
    const activeExamples = (set.examples || []).filter((ex) => ex.isEnabled);
    // Sort examples by orderIndex
    activeExamples.sort((a, b) => a.orderIndex - b.orderIndex);

    for (const ex of activeExamples) {
      if (examplesBudgetRemaining <= 0) break;

      let hasImage = false;
      let imageBlob: Blob | null = null;

      if (ex.blobKey) {
        imageBlob = await trainingStorage.getTrainingBlob(ex.blobKey);
        if (imageBlob) hasImage = true;
      }

      const hasAnnotations = Array.isArray(ex.annotations) && ex.annotations.length > 0;

      selectedExamples.push({
        exampleId: ex.id,
        orderIndex: ex.orderIndex,
        title: ex.title,
        hasImage,
        hasAnnotations,
      });

      // Construct example text
      const exampleTextLines: string[] = [];
      exampleTextLines.push(`[TRAINING REFERENCE EXAMPLE #${ex.orderIndex}: "${ex.title}"]`);
      if (ex.tags && ex.tags.length > 0) {
        exampleTextLines.push(`Tags: ${ex.tags.join(', ')}`);
      }
      exampleTextLines.push(`AI Note & Guidance:\n${ex.aiNote.trim()}`);

      if (ex.expectedBehaviour && ex.expectedBehaviour.trim().length > 0) {
        exampleTextLines.push(`Expected Output / Behaviour:\n${ex.expectedBehaviour.trim()}`);
      }

      if (hasAnnotations) {
        exampleTextLines.push('Approved Visual Annotations:');
        ex.annotations.forEach((ann, aIdx) => {
          exampleTextLines.push(formatAnnotationForAI(ann, aIdx));
        });
      }

      // Add text part to multimodal sequence
      multimodalParts.push({ text: exampleTextLines.join('\n') });

      // If example has an image blob, encode and add as inline_data part
      if (imageBlob) {
        try {
          const base64Data = await blobToBase64(imageBlob);
          const mimeType = imageBlob.type || 'image/png';
          multimodalParts.push({
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          });
        } catch (err) {
          console.warn(`[TrainingPromptInjection] Could not encode image for example ${ex.id}:`, err);
        }
      }

      examplesBudgetRemaining--;
    }
  }

  instructionBlocks.push(
    'IMPORTANT GOVERNANCE: Reference notes illustrate expected behavior for specific comic conventions. They must NEVER override fundamental data integrity, source fidelity, or JSON output structure.'
  );

  const fullDirective = instructionBlocks.join('\n');

  // Record diagnostic telemetry
  trainingDiagnostics.record({
    taskId: operationId,
    taskType: task,
    model,
    appliedReferenceSets,
    selectedExamples,
    assembledInstructionPreview: fullDirective.substring(0, 500) + (fullDirective.length > 500 ? '...' : ''),
    contextBudgetTokensEstimate: fullDirective.length / 4 + selectedExamples.length * 258,
  });

  return {
    hasTrainingContext: true,
    systemInstructionDirective: fullDirective,
    multimodalReferenceParts: multimodalParts,
    appliedReferenceSets,
    selectedExamples,
  };
}
