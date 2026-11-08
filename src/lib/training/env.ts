/**
 * Folio Script - Development Mode & Feature Flag Verification
 * Ensures Training Studio is completely restricted to development builds.
 */

declare global {
  interface Window {
    dragonfly?: {
      platform: string;
      version: string;
      isDev?: boolean;
      trainingStudio?: {
        selectFolder: () => Promise<string | null>;
        scanFolder: (folderPath: string) => Promise<{
          folderPath: string;
          candidates: Array<{
            fileName: string;
            filePath: string;
            fileSize: number;
            modifiedTime: number;
            mimeType: string;
            hash: string;
          }>;
          ignoredCount: number;
        }>;
        readImageFile: (filePath: string) => Promise<{
          filePath: string;
          base64: string;
          mimeType: string;
          size: number;
        }>;
      };
    };
  }
}

/**
 * Returns true if the current runtime environment is development.
 * Checks both Vite import.meta.env and Electron preload isDev flag.
 */
export function isDevelopmentMode(): boolean {
  // 1. Vite development mode check
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    return true;
  }

  // 2. Electron contextBridge isDev check
  if (typeof window !== 'undefined' && window.dragonfly?.isDev) {
    return true;
  }

  // 3. Localhost / local loopback development server check (server.cjs / Folio Script.exe launcher)
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      window.location.protocol === 'file:'
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Feature flag for Training Studio.
 * Strictly checks isDevelopmentMode().
 */
export function isTrainingStudioEnabled(): boolean {
  return isDevelopmentMode();
}
