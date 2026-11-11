import type { DiagnosticEngine } from '../diagnosticEngine';
import type { SubsystemInspector } from '../types';
import { createAiServicesInspector } from './aiServicesInspector';
import { createAppCoreInspector } from './appCoreInspector';
import { createAppStateInspector } from './appStateInspector';
import { createDataStorageInspector } from './dataStorageInspector';
import { createElectronFsInspector } from './electronFsInspector';
import { createModelsAssetsInspector } from './modelsAssetsInspector';
import { createRenderingUiInspector } from './renderingUiInspector';
import { createScanningOcrInspector } from './scanningOcrInspector';
import { createSettingsConfigInspector } from './settingsConfigInspector';
import { createTranslationInspector } from './translationInspector';

export function createBuiltInInspectors(): SubsystemInspector[] {
  return [
    createAppCoreInspector(),
    createScanningOcrInspector(),
    createAiServicesInspector(),
    createTranslationInspector(),
    createDataStorageInspector(),
    createAppStateInspector(),
    createRenderingUiInspector(),
    createModelsAssetsInspector(),
    createElectronFsInspector(),
    createSettingsConfigInspector(),
  ];
}

export function registerBuiltInInspectors(engine: DiagnosticEngine): void {
  for (const inspector of createBuiltInInspectors()) {
    engine.registerInspector(inspector);
  }
}

export {
  createAiServicesInspector,
  createAppCoreInspector,
  createAppStateInspector,
  createDataStorageInspector,
  createElectronFsInspector,
  createModelsAssetsInspector,
  createRenderingUiInspector,
  createScanningOcrInspector,
  createSettingsConfigInspector,
  createTranslationInspector,
};
