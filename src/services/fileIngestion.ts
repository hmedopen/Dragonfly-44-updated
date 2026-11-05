import { savePageBlob } from './db';
import type { PageMetadata } from '../types';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif']);

/**
 * Natural alphanumeric sorting of image files
 * Strict collator: page_2.png precedes page_10.png
 */
export function sortFilesNaturally(files: File[]): File[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * Format a draft name based on creation time.
 * Example: 31/10/2026_7:48 pm
 */
export function formatDraftName(date: Date = new Date()): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${day}/${month}/${year}_${hours}:${minutes} ${ampm}`;
}

/**
 * Triggers a native file picker accepting images (.png, .jpg, .jpeg, .webp, .avif)
 */
export function pickImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.png,.jpg,.jpeg,.webp,.avif,image/png,image/jpeg,image/webp,image/avif';

    input.onchange = () => {
      const files = Array.from(input.files || []);
      resolve(files);
    };

    // Fallback if user cancels the picker dialog
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!input.files || input.files.length === 0) {
            resolve([]);
          }
        }, 500);
      },
      { once: true }
    );

    input.click();
  });
}

/**
 * Recursively read all files from a directory entry (via webkitGetAsEntry)
 */
async function readDirectoryEntry(dirEntry: any): Promise<File[]> {
  const files: File[] = [];
  const reader = dirEntry.createReader();

  const readEntries = (): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      reader.readEntries(
        (entries: any[]) => resolve(entries),
        (err: any) => reject(err)
      );
    });
  };

  let entries = await readEntries();
  while (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isFile) {
        const file: File = await new Promise((resolve, reject) => {
          entry.file(resolve, reject);
        });
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext && IMAGE_EXTENSIONS.has(ext)) {
          files.push(file);
        }
      } else if (entry.isDirectory) {
        const subFiles = await readDirectoryEntry(entry);
        files.push(...subFiles);
      }
    }
    entries = await readEntries();
  }

  return files;
}

/**
 * Extracts all image files from a DataTransfer object (handles both files and folders)
 */
export async function extractFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  const items = dataTransfer.items;

  if (items && items.length > 0) {
    const promises: Promise<void>[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) {
          if (entry.isFile) {
            const file = item.getAsFile();
            if (file) {
              const ext = file.name.split('.').pop()?.toLowerCase();
              if (ext && IMAGE_EXTENSIONS.has(ext)) {
                files.push(file);
              }
            }
          } else if (entry.isDirectory) {
            promises.push(
              readDirectoryEntry(entry).then((dirFiles) => {
                files.push(...dirFiles);
              })
            );
          }
        } else {
          const file = item.getAsFile();
          if (file) {
            const ext = file.name.split('.').pop()?.toLowerCase();
            if (ext && IMAGE_EXTENSIONS.has(ext)) {
              files.push(file);
            }
          }
        }
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  } else if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const file = dataTransfer.files[i];
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && IMAGE_EXTENSIONS.has(ext)) {
        files.push(file);
      }
    }
  }

  return files;
}

export interface IngestionResult {
  pages: PageMetadata[];
  count: number;
}

/**
 * Natural sorts files, persists each binary Blob to IndexedDB,
 * and generates the PageMetadata list (with 1-based index).
 */
export async function ingestImageFiles(files: File[]): Promise<IngestionResult> {
  if (files.length === 0) {
    return { pages: [], count: 0 };
  }

  // 1. Natural sort files: page_2.png strictly precedes page_10.png
  const sortedFiles = sortFilesNaturally(files);

  // 2. Persist directly to IndexedDB as binary Blobs
  const pages: PageMetadata[] = [];

  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    const index = i + 1; // 1-based index
    const pageId = `page-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 8)}`;

    // Store raw Blob/File directly under key page-blob:${pageId}
    await savePageBlob(pageId, file);

    pages.push({
      id: pageId,
      fileName: file.name,
      index,
      scanStatus: 'unscanned',
    });
  }

  return {
    pages,
    count: pages.length,
  };
}
