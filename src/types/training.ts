/**
 * Folio Script - Training Studio Core Types
 * Defines data models for Reference Sets, Examples, Visual Annotations,
 * Task Associations, and Agent Integration.
 */

export type TrainingTaskType =
  | 'scanning_classification'   // System #3: Visual layout, panel boundaries, balloon detection
  | 'reading_order'             // System #3: Panel & intra-panel reading order (RTL, LTR, Webtoon)
  | 'speech_balloon_detection'  // System #3: Physical balloon boundary separation (e.g. double balloons)
  | 'ocr_text_region'           // System #3: Verbatim OCR and text-region alignment
  | 'sfx_classification'        // System #3: Sound effect identification vs dialogue
  | 'translation_quality'       // System #2: High-eloquence Arabic translation & voice
  | 'review_qc';                // System #4: Quality control, ambiguity checks & verification

export interface TrainingTaskDefinition {
  type: TrainingTaskType;
  label: string;
  systemName: string;
  description: string;
}

export const TRAINING_TASKS: TrainingTaskDefinition[] = [
  {
    type: 'scanning_classification',
    label: 'Scanning & Classification',
    systemName: 'System #3',
    description: 'Visual layout, panel boundaries, and generic functional text classification.',
  },
  {
    type: 'speech_balloon_detection',
    label: 'Speech Balloon Detection',
    systemName: 'System #3',
    description: 'Physical balloon detection, double-balloon separation, and connected tails.',
  },
  {
    type: 'reading_order',
    label: 'Reading Order & Flow',
    systemName: 'System #3',
    description: 'Panel sequences and intra-panel conversational flow (Manga RTL, Webtoon, LTR).',
  },
  {
    type: 'ocr_text_region',
    label: 'OCR & Text Region Association',
    systemName: 'System #3',
    description: 'Verbatim transcription fidelity, vertical text, and ambiguity handling.',
  },
  {
    type: 'sfx_classification',
    label: 'SFX Classification',
    systemName: 'System #3',
    description: 'Environmental sounds, battle impacts, vocalizations, and in-art text.',
  },
  {
    type: 'translation_quality',
    label: 'Translation Quality & Eloquence',
    systemName: 'System #2',
    description: 'Dignified Arabic literary voice, terminology adherence, and character cadence.',
  },
  {
    type: 'review_qc',
    label: 'Review & Quality Control',
    systemName: 'System #4',
    description: 'Ambiguity flags, omission detection, and regression defense.',
  },
];

export interface VisualAnnotationRelation {
  targetObjectId: string;
  relationType: 'connected_tail' | 'same_speaker' | 'continuation' | 'child_of' | 'points_to';
}

export interface TrainingVisualAnnotation {
  id: string; // Unique annotation ID (e.g. "ann_171...")
  physicalObjectId: string; // Unique physical identifier (e.g. "balloon_1", "tail_A")
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  label: 'balloon' | 'tail' | 'text_region' | 'sfx' | 'panel' | 'character' | 'other';
  translationUnitId?: string; // Logical translation grouping (e.g. "TU_1" grouping multiple physical balloons)
  readingOrderIndex?: number; // 1-based expected reading order sequence
  relationships?: VisualAnnotationRelation[];
  notes?: string;
  isVerified: boolean; // Ground truth certification. AI suggestions MUST be false until approved by user.
  source: 'user' | 'agent' | 'gemini_suggestion';
  confidence?: number;
}

export interface ReferenceExample {
  id: string; // Stable UUID
  orderIndex: number; // 1-based order index for consistent presentation to AI (#1, #2, ...)
  title: string;
  blobKey: string; // Key in training_blobs IndexedDB store
  sourceFileName?: string;
  sourceFilePath?: string;
  aiNote: string; // Explanatory instruction for Gemini
  expectedBehaviour?: string; // What the AI is expected to output for this example
  tags: string[]; // e.g. ["double-balloon", "manga_rtl", "stacked"]
  annotations: TrainingVisualAnnotation[];
  isEnabled: boolean; // Can be toggled on/off
  createdAt: number;
  updatedAt: number;
}

export interface TrainingReferenceSet {
  id: string; // Stable UUID (e.g. "ref_set_173...")
  title: string;
  description: string;
  generalInstructions: string; // Sent to AI when this set is relevant
  targetTasks: TrainingTaskType[]; // Associated systems/tasks
  enabled: boolean;
  priority: number; // 1-100 (higher priority evaluated first)
  version: number; // Integer tracking revisions
  createdAt: number;
  updatedAt: number;
  examples: ReferenceExample[];
}

export interface FolderImportCandidate {
  fileName: string;
  filePath: string;
  fileSize: number;
  modifiedTime: number;
  mimeType: string;
  hash: string;
  isSelected: boolean;
  isDuplicate?: boolean;
  duplicateOf?: string;
  fileObject?: File; // Browser fallback when File object is available directly
}

export interface TrainingDispatchRecord {
  id: string;
  taskId: string;
  taskType: TrainingTaskType;
  model: string;
  timestamp: number;
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
  assembledInstructionPreview: string;
  contextBudgetTokensEstimate: number;
}
