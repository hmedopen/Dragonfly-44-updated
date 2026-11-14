import type { ChapterPage, DownloadedImageData, ZipExportResult } from '../types';

export interface ZipFileEntry {
  filename: string;
  data: Uint8Array;
}

/**
 * Standard CRC-32 table computation and lookup.
 */
class Crc32 {
  private static table: Uint32Array | null = null;

  private static getTable(): Uint32Array {
    if (!this.table) {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        t[i] = c;
      }
      this.table = t;
    }
    return this.table;
  }

  public static compute(bytes: Uint8Array): number {
    const table = this.getTable();
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}

export class ChapterZipExporter {
  /**
   * Generates a standard ZIP archive from file entries (method 0: STORE).
   * Preserves exact original image bytes without recompression.
   */
  public static createZip(entries: ZipFileEntry[]): Uint8Array {
    const localHeaders: Uint8Array[] = [];
    const centralHeaders: Uint8Array[] = [];
    let currentOffset = 0;

    const encoder = new TextEncoder();

    for (const entry of entries) {
      const filenameBytes = encoder.encode(entry.filename);
      const crc = Crc32.compute(entry.data);
      const size = entry.data.length;

      // 1. Local Header (30 bytes + filename + data)
      const local = new Uint8Array(30 + filenameBytes.length + size);
      const localView = new DataView(local.buffer);

      localView.setUint32(0, 0x04034b50, true); // Local header signature
      localView.setUint16(4, 20, true); // Version needed (2.0)
      localView.setUint16(6, 0x0800, true); // Language encoding flag (UTF-8)
      localView.setUint16(8, 0, true); // Compression method (0 = Stored)
      localView.setUint16(10, 0, true); // File time
      localView.setUint16(12, 0, true); // File date
      localView.setUint32(14, crc, true); // CRC-32
      localView.setUint32(18, size, true); // Compressed size
      localView.setUint32(22, size, true); // Uncompressed size
      localView.setUint16(26, filenameBytes.length, true); // Filename length
      localView.setUint16(28, 0, true); // Extra field length

      local.set(filenameBytes, 30);
      local.set(entry.data, 30 + filenameBytes.length);
      localHeaders.push(local);

      // 2. Central Directory Header (46 bytes + filename)
      const central = new Uint8Array(46 + filenameBytes.length);
      const centralView = new DataView(central.buffer);

      centralView.setUint32(0, 0x02014b50, true); // Central header signature
      centralView.setUint16(4, 20, true); // Version made by
      centralView.setUint16(6, 20, true); // Version needed
      centralView.setUint16(8, 0x0800, true); // UTF-8
      centralView.setUint16(10, 0, true); // Stored
      centralView.setUint16(12, 0, true); // File time
      centralView.setUint16(14, 0, true); // File date
      centralView.setUint32(16, crc, true); // CRC-32
      centralView.setUint32(20, size, true); // Compressed size
      centralView.setUint32(24, size, true); // Uncompressed size
      centralView.setUint16(28, filenameBytes.length, true);
      centralView.setUint16(30, 0, true); // Extra field length
      centralView.setUint16(32, 0, true); // Comment length
      centralView.setUint16(34, 0, true); // Disk number start
      centralView.setUint16(36, 0, true); // Internal attributes
      centralView.setUint32(38, 0, true); // External attributes
      centralView.setUint32(42, currentOffset, true); // Relative offset of local header

      central.set(filenameBytes, 46);
      centralHeaders.push(central);

      currentOffset += local.length;
    }

    const centralDirectoryOffset = currentOffset;
    let centralDirectorySize = 0;
    for (const ch of centralHeaders) {
      centralDirectorySize += ch.length;
    }

    // 3. End of Central Directory Record (22 bytes)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);

    eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
    eocdView.setUint16(4, 0, true); // Disk number
    eocdView.setUint16(6, 0, true); // Disk start
    eocdView.setUint16(8, entries.length, true); // Central dir records this disk
    eocdView.setUint16(10, entries.length, true); // Total central dir records
    eocdView.setUint32(12, centralDirectorySize, true); // Central dir size
    eocdView.setUint32(16, centralDirectoryOffset, true); // Central dir start offset
    eocdView.setUint16(20, 0, true); // Comment length

    // Assemble entire archive
    const totalArchiveSize = currentOffset + centralDirectorySize + 22;
    const zipArchive = new Uint8Array(totalArchiveSize);
    let writePos = 0;

    for (const lh of localHeaders) {
      zipArchive.set(lh, writePos);
      writePos += lh.length;
    }

    for (const ch of centralHeaders) {
      zipArchive.set(ch, writePos);
      writePos += ch.length;
    }

    zipArchive.set(eocd, writePos);

    // Verify the resulting archive before returning
    this.verifyArchive(zipArchive, entries.length);

    return zipArchive;
  }

  /**
   * Verifies ZIP integrity by inspecting the central directory and entry count.
   */
  public static verifyArchive(zipBytes: Uint8Array, expectedEntriesCount: number): void {
    if (zipBytes.length < 22) {
      throw new Error('Generated ZIP archive is truncated (less than 22 bytes).');
    }

    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

    // Verify EOCD signature at end
    const eocdOffset = zipBytes.length - 22;
    const eocdSig = view.getUint32(eocdOffset, true);
    if (eocdSig !== 0x06054b50) {
      throw new Error('ZIP archive validation failed: Invalid End of Central Directory signature.');
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    if (totalEntries !== expectedEntriesCount) {
      throw new Error(
        `ZIP archive validation mismatch: Expected ${expectedEntriesCount} entries but found ${totalEntries}.`
      );
    }
  }

  /**
   * Builds sanitized archive default filename: SeriesName_Ch_XX.zip
   */
  public static buildArchiveFilename(seriesTitle?: string, chapterNumber?: string): string {
    const rawSeries = (seriesTitle || 'Chapter').replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
    const cleanSeries = rawSeries.replace(/\s+/g, '_');
    const cleanChapter = chapterNumber ? `_Ch_${chapterNumber.replace(/[^a-zA-Z0-9_.]/g, '')}` : '';
    return `${cleanSeries}${cleanChapter}.zip`;
  }

  /**
   * Packages selected pages into a ZIP archive and triggers native save or download.
   */
  public static async exportSelectedPagesToZip(
    selectedPages: ChapterPage[],
    imageMap: Map<string, DownloadedImageData>,
    defaultFilename: string,
    acquisitionId?: string
  ): Promise<ZipExportResult> {
    if (selectedPages.length === 0) {
      throw new Error('No pages selected for export.');
    }

    // Sort by originalIndex to guarantee preserved source ordering
    const sorted = [...selectedPages].sort((a, b) => a.originalIndex - b.originalIndex);

    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    const electronBridge = win?.folioScript?.chapterSnatch;

    // Fast-path: Disk-backed streaming ZIP export (zero Base64 overhead across IPC)
    const hasAllDiskPaths = sorted.every((p) => Boolean(p.tempFilePath));
    if (electronBridge?.saveZip && hasAllDiskPaths && acquisitionId) {
      const pageFiles = sorted.map((p, idx) => ({
        filename: `${String(idx + 1).padStart(3, '0')}.${p.extension}`,
        filePath: p.tempFilePath!,
      }));

      const res = await electronBridge.saveZip({
        defaultFilename,
        acquisitionId,
        pageFiles,
      });

      return res;
    }

    const entries: ZipFileEntry[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const page = sorted[i];
      const img = imageMap.get(page.id);
      if (!img || !img.data || img.data.length === 0) {
        throw new Error(`Page ${page.originalIndex} (${page.filename}) has not completed downloading.`);
      }

      const seqFilename = `${String(i + 1).padStart(3, '0')}.${img.extension}`;
      entries.push({
        filename: seqFilename,
        data: img.data,
      });
    }

    if (electronBridge?.saveZip) {
      // Use Electron's native file-dialog pattern
      const entriesForIpc = entries.map((e) => ({
        filename: e.filename,
        dataBase64: this.uint8ArrayToBase64(e.data),
      }));

      const res = await electronBridge.saveZip({
        defaultFilename,
        entries: entriesForIpc,
      });

      return res;
    }

    // Web fallback: construct standard ZIP in browser and download via Blob link
    const zipBytes = this.createZip(entries);
    const blob = new Blob([zipBytes as any], { type: 'application/zip' });
    const blobUrl = URL.createObjectURL(blob);

    if (typeof document !== 'undefined') {
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = defaultFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    return {
      saved: true,
      canceled: false,
      totalBytes: zipBytes.length,
    };
  }

  public static uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    return btoa(binary);
  }

  public static base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
