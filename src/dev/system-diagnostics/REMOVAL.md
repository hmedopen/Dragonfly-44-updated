# System Diagnostics (`Diagnostic Studio`) Removal Guide

`Diagnostic Studio` is a development-only diagnostic instrument isolated inside `src/dev/system-diagnostics/`. Deleting it cleanly without touching core OCR, translation, storage, or export behavior is an explicit architectural requirement.

---

## Tier 1: Quick Disable / Directory Deletion (Zero Compilation Impact)

You can delete the entire module directory immediately:

```text
src/dev/system-diagnostics/
```

Why the app still compiles and builds cleanly:
- `src/App.tsx` discovers the UI host via Vite's `import.meta.glob('./dev/system-diagnostics/ui/DiagnosticStudioHost.tsx')`, so deleting `src/dev/system-diagnostics/` leaves zero unresolved static imports (`hasDiagnosticStudioModule` becomes `false`).
- `src/lib/diagnosticTap.ts` has zero dependencies on `src/dev/system-diagnostics/`. When no listener is registered (or in packaged/remote production builds where `isSystemDiagnosticsEnabled()` returns `false`), `emitDiagnosticBoundary()` and `createDiagnosticCorrelationId()` become no-op helpers.
- Packaged Electron builds (`folioScript.isDev === false`) and deployed remote origins skip loading `DiagnosticStudioHost`, hide all UI buttons, and short-circuit `emitDiagnosticBoundary()`.

---

## Tier 2: Full Clean Strip (All Touched Files)

To completely strip all diagnostic shims, UI entry points, Electron dev IPC handlers, and boundary instrumentation:

### 1. Delete Added Diagnostic Files
- `src/dev/system-diagnostics/` (entire directory: core engine, inspectors, adapters, UI, tests, `REMOVAL.md`)
- `src/lib/diagnosticTap.ts`

### 2. Revert UI & Dev Loader Hooks
- `src/App.tsx`:
  - Remove `diagnosticStudioHostModules`, `DiagnosticStudioHostComponent`, `isDiagnosticsOpen` state, `Ctrl+Shift+D` shortcut handler, Hub toolbar `Diagnostic Studio` button (`DEV` badge), and `{DevDiagnosticsHost}` wrapper.
- `src/components/Workbench/Workbench.tsx`:
  - Remove `Stethoscope` icon import, `isSystemDiagnosticsEnabled` import, `onToggleDiagnostics` and `isDiagnosticsOpen` props on `WorkbenchProps`, and the `isSystemDiagnosticsEnabled() && onToggleDiagnostics` entry in `utilityTools`.

### 3. Revert Electron Dev-Only IPC Bridge
- `electron/main.cjs`:
  - Remove `createSafeRuntimeInfoSnapshot`, `inspectDevModelCache`, and `exportDiagnosticReportFile` helpers plus the `diagnostics:getRuntimeInfo`, `diagnostics:inspectModelCache`, and `diagnostics:exportReportFile` handlers registered inside `if (isDev)`.
- `electron/preload.cjs`:
  - Remove the `diagnostics` object exposed on `window.folioScript` inside `isDev ? { ... } : undefined`.

### 4. Revert Boundary Instrumentation Calls (`emitDiagnosticBoundary`) & Optional `correlationId` Parameters
Remove `import { emitDiagnosticBoundary, ... } from ...` and its calls from:
- `src/lib/scanQueue.ts`
- `src/lib/geminiScan.ts`
- `src/lib/hybridScan.ts`
- `src/lib/mangaScanner.ts`
- `src/lib/batchTranslation.ts`
- `src/lib/reviewOrchestrator.ts`
- `src/lib/localOcr/localOcrEngine.ts`
- `src/types/localOcr.ts` (optional `correlationId?: string` field on `LocalOcrEngineOptions`)
- `src/services/db.ts`
- `src/services/fileIngestion.ts`
- `src/lib/compileTypeR.ts`
- `src/components/Workbench/CanvasPane.tsx`

### 5. Revert `package.json` Test Script
- Remove the `"test:diagnostics"` script line in `package.json`.

---

## Browser / Desktop Local Storage Used Only by Diagnostics

Diagnostic Studio never writes to the application's primary `dragonfly44_db` IndexedDB database or user project settings. Removing these isolated developer storage artifacts is optional and never affects user projects:

- **IndexedDB database:** `folio_dev_diagnostics_db` (`sessions` object store)
- **`localStorage` key:** `folio_dev_diagnostics_window_v1` (floating window coordinates & dimensions)

---

## Post-Removal Verification

Run these commands after Tier 1 or Tier 2 removal:

```powershell
npx.cmd tsc -b
npm.cmd run build
npm.cmd run test:local-ocr
```
