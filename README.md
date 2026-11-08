# Folio Script

**Folio Script** is an elite comic and manga scanlation studio and desktop localization workbench designed for high-precision chapter organization, visual balloon detection, AI-powered contextual translation, and automated typesetting preparation.

## Features

- **Multi-Chapter Organization:** Manage scanlation projects, chapters, and drafts with instant drag-and-drop page importing.
- **Precision Scanning & Classification:** Automated visual speech bubble, narration box, shout, and sound effect region detection with sub-pixel bounding box normalization.
- **Contextual Multimodal Translation:** Arabic scanlation engine leveraging Gemini multimodal models with speaker voice attribution and cultural localization.
- **TypeR Export:** Direct generation of standard TypeR classification scripts for Photoshop and desktop typesetting pipelines.
- **Quality Benchmark Engine:** Automated regression verification suite to ensure translation fidelity, orthography, and speech bubble geometry integrity.
- **Training Studio:** Curate visual reference datasets, ground-truth annotations, and double-balloon training directives.

## Tech Stack

- **Desktop Shell:** Electron with native dark title bar overlay integration.
- **UI Architecture:** React 19, TypeScript, Tailwind CSS, Lucide Icons, Framer Motion.
- **Storage Layer:** IndexedDB with idempotent migrations and local blob caching.
- **Build Tooling:** Vite, TypeScript.

## Getting Started

### Development

```bash
# Start Vite development server
npm run dev

# Start Electron desktop app connected to dev server
npm run desktop
```

### Production Build

```bash
# Build web bundle
npm run build

# Package Windows desktop executable
npm run package:exe
```
