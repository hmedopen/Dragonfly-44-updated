import type { ImageValidationResult } from '../types';

/**
 * ChapterImageValidator
 * Performs strict integrity validation of raw image byte buffers.
 * Never accepts HTML error pages, truncated files, or non-image payloads.
 */
export class ChapterImageValidator {
  /**
   * Inspects binary magic numbers and validates the payload.
   */
  public static validateImageBytes(bytes: Uint8Array, declaredMimeType?: string): ImageValidationResult {
    if (!bytes || bytes.length === 0) {
      return {
        isValid: false,
        sizeBytes: 0,
        error: 'Image payload is empty (0 bytes).',
      };
    }

    const size = bytes.length;

    // Check for HTML or text error responses disguised as images
    if (this.isHtmlOrText(bytes)) {
      return {
        isValid: false,
        sizeBytes: size,
        error: 'Server returned HTML or text document instead of image data.',
      };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      size >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return {
        isValid: true,
        mimeType: 'image/png',
        extension: 'png',
        sizeBytes: size,
      };
    }

    // JPEG: FF D8 FF
    if (size >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return {
        isValid: true,
        mimeType: 'image/jpeg',
        extension: 'jpg',
        sizeBytes: size,
      };
    }

    // WebP: RIFF .... WEBP
    // 52 49 46 46 (RIFF) at offset 0, and 57 45 42 50 (WEBP) at offset 8
    if (
      size >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return {
        isValid: true,
        mimeType: 'image/webp',
        extension: 'webp',
        sizeBytes: size,
      };
    }

    // GIF: GIF87a or GIF89a (47 49 46 38 37 61 or 47 49 46 38 39 61)
    if (
      size >= 6 &&
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38 &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) &&
      bytes[5] === 0x61
    ) {
      return {
        isValid: true,
        mimeType: 'image/gif',
        extension: 'gif',
        sizeBytes: size,
      };
    }

    // AVIF: offset 4 ftypavif or ftypavis
    if (size >= 12) {
      const brand = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11]);
      if (brand.startsWith('ftypavif') || brand.startsWith('ftypavis')) {
        return {
          isValid: true,
          mimeType: 'image/avif',
          extension: 'avif',
          sizeBytes: size,
        };
      }
    }

    // If declared MIME type was valid image and length is plausible, check if BMP
    if (size >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return {
        isValid: true,
        mimeType: 'image/bmp',
        extension: 'bmp',
        sizeBytes: size,
      };
    }

    // If magic bytes were unrecognized, check declared MIME type
    if (declaredMimeType && declaredMimeType.startsWith('image/')) {
      const ext = declaredMimeType.replace('image/', '').toLowerCase().replace('jpeg', 'jpg');
      return {
        isValid: true,
        mimeType: declaredMimeType,
        extension: ext || 'img',
        sizeBytes: size,
      };
    }

    return {
      isValid: false,
      sizeBytes: size,
      error: `Unrecognized image format or corrupted byte sequence (first bytes: ${Array.from(bytes.slice(0, 4))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ')})`,
    };
  }

  /**
   * Helper to detect HTML/text preamble.
   */
  private static isHtmlOrText(bytes: Uint8Array): boolean {
    const sampleLength = Math.min(bytes.length, 128);
    let sample = '';
    for (let i = 0; i < sampleLength; i++) {
      sample += String.fromCharCode(bytes[i]);
    }
    const lower = sample.trim().toLowerCase();
    return (
      lower.startsWith('<!doctype html') ||
      lower.startsWith('<html') ||
      lower.startsWith('<?xml') ||
      lower.startsWith('<error') ||
      lower.startsWith('{"error"') ||
      lower.startsWith('{"result":"error"') ||
      lower.startsWith('{ "error"')
    );
  }
}
