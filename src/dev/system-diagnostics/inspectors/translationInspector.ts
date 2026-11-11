import { compileInstructions } from '../../../lib/instructionCompiler';
import { settingsService } from '../../../services/settings/settingsService';
import { useWorkbenchStore } from '../../../store/workbenchStore';
import type { EloquenceLevel, HumanizerIntensity, OrthographyMode, TranslationFidelity } from '../../../types/workbench';
import type {
  DiagnosticCheckResult,
  DiagnosticFinding,
  InspectorContext,
  SubsystemInspector,
} from '../types';

export interface TranslationInspectorDeps {
  getEffectiveSetting?: typeof settingsService.getEffectiveValue;
  getStoreState?: typeof useWorkbenchStore.getState;
  compileFn?: typeof compileInstructions;
}

export function createTranslationInspector(deps: TranslationInspectorDeps = {}): SubsystemInspector {
  const getSetting = deps.getEffectiveSetting ?? settingsService.getEffectiveValue.bind(settingsService);
  const getStore = deps.getStoreState ?? useWorkbenchStore.getState;
  const compile = deps.compileFn ?? compileInstructions;

  return {
    id: 'translation',
    name: 'Translation & Localization',
    description: 'Instruction compilation, batch/single translation requests, validation, and text preservation.',
    coverageLevel: 'full',
    capabilities: [
      { capability: 'Batch & single-bubble translation events', tier: 'full', notes: 'Captures requested/translated counts, errors, and source-preservation.' },
      { capability: 'Instruction compiler dry-run', tier: 'read_only_check', notes: 'Compiles current System #2 prompt directives without calling Gemini.' },
      { capability: 'Active page translation coverage audit', tier: 'read_only_check', notes: 'Inspects loaded bubbles for missing translations or unpreserved text.' },
    ],
    checks: [
      {
        checkId: 'instruction-compiler-check',
        name: 'Translation Instruction Compiler Check',
        description: 'Dry-runs compileInstructions with active settings to confirm valid prompt assembly and dialect rules.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'page-translation-coverage',
        name: 'Active Page Translation Coverage',
        description: 'Checks loaded bubbles on the active page for untranslated source dialogue or empty source text.',
        safety: 'read_only',
        defaultEnabled: true,
      },
    ],
    async runCheck(checkId: string, context: InspectorContext): Promise<DiagnosticCheckResult> {
      const start = Date.now();
      const findings: DiagnosticFinding[] = [];
      const store = getStore();
      const projectId = context.activeProjectId ?? store.activeFolderId;
      const chapterId = context.activeChapterId ?? store.activeChapterId;

      if (checkId === 'instruction-compiler-check') {
        const eloquenceLevel = (getSetting<number>('translation.eloquence', { projectId, chapterId }).value || 2) as EloquenceLevel;
        const translationFidelity = (getSetting<string>('translation.fidelity', { projectId, chapterId }).value || 'localized') as TranslationFidelity;
        const isHumanizerEnabled = Boolean(getSetting<boolean>('translation.humanizer_enabled', { projectId, chapterId }).value);
        const humanizerIntensity = (getSetting<string>('translation.humanizer_intensity', { projectId, chapterId }).value || 'balanced') as HumanizerIntensity;
        const orthographyMode = (getSetting<string>('translation.orthography_mode', { projectId, chapterId }).value || 'correct_spelling') as OrthographyMode;
        const masterPromptOverride = String(getSetting<string>('translation.master_prompt_override', { projectId, chapterId }).value || '');
        const isMasterPromptActive = Boolean(getSetting<boolean>('translation.master_prompt_active', { projectId, chapterId }).value);

        const compiled = compile({
          task: 'batch_translation',
          eloquenceLevel,
          translationFidelity,
          isHumanizerEnabled,
          humanizerIntensity,
          orthographyMode,
          masterPromptOverride,
          isMasterPromptActive,
          projectLore: store.projectLore,
          chapterIntelligence: store.chapterIntelligence,
        });

        if (!compiled.systemInstruction || compiled.systemInstruction.trim().length === 0) {
          findings.push({
            findingId: `trans-empty-inst-${start}`,
            subsystem: 'translation',
            checkId,
            code: 'EMPTY_SYSTEM_INSTRUCTION',
            severity: 'error',
            title: 'Compiled translation instruction is empty',
            explanation: 'compileInstructions produced an empty systemInstruction string.',
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'translation',
          name: 'Translation Instruction Compiler Check',
          safety: 'read_only',
          status: findings.length > 0 ? 'error' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `Compiled System #2 instructions (${compiled.systemInstruction.length} chars, eloquence=${eloquenceLevel}, fidelity=${translationFidelity}, humanizer=${isHumanizerEnabled}, dialectActive=${compiled.isDialectActive}).`,
          findings,
          metrics: {
            instructionLength: compiled.systemInstruction.length,
            eloquenceLevel,
            translationFidelity,
            isHumanizerEnabled,
            isDialectActive: compiled.isDialectActive,
          },
        };
      }

      if (checkId === 'page-translation-coverage') {
        const pageId = context.activePageId ?? store.activePageId;
        if (!pageId) {
          return {
            checkId,
            subsystem: 'translation',
            name: 'Active Page Translation Coverage',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'No active page selected; open a chapter page to audit translation coverage.',
            findings: [],
          };
        }

        const bubbles = store.bubblesByPage[pageId] || [];
        const withSource = bubbles.filter((b) => Boolean(b.sourceText?.trim()));
        const untranslated = withSource.filter((b) => !b.translatedText?.trim());
        const manuallyEdited = bubbles.filter((b) => b.isManuallyEdited);

        if (untranslated.length > 0) {
          findings.push({
            findingId: `trans-untranslated-${pageId}-${start}`,
            subsystem: 'translation',
            checkId,
            code: 'UNTRANSLATED_BUBBLES_PRESENT',
            severity: 'warning',
            title: `${untranslated.length} bubble(s) retain extracted source text without Arabic translation`,
            explanation: `Out of ${withSource.length} bubble(s) with source text on page ${pageId}, ${untranslated.length} have empty translatedText.`,
            evidence: { pageId, bubbleIndices: untranslated.map((b) => b.index) },
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'translation',
          name: 'Active Page Translation Coverage',
          safety: 'read_only',
          status: untranslated.length > 0 ? 'warning' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary:
            bubbles.length === 0
              ? `Active page ${pageId} has 0 dialogue bubbles loaded.`
              : `Active page ${pageId}: ${withSource.length - untranslated.length}/${withSource.length} source bubbles translated (${manuallyEdited.length} manually edited).`,
          findings,
          metrics: {
            pageId,
            totalBubbles: bubbles.length,
            withSourceCount: withSource.length,
            untranslatedCount: untranslated.length,
            manuallyEditedCount: manuallyEdited.length,
          },
        };
      }

      throw new Error(`Unsupported checkId "${checkId}" on translation inspector.`);
    },
  };
}
