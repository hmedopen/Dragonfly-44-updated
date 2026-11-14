export function fetchMetadata(targetUrl: string): Promise<{ metadata: any; pages: any[] }>;
export function downloadPageImage(
  imageUrl: string,
  referer?: string,
  options?: { acquisitionId?: string; filename?: string }
): Promise<{ dataBase64: string; mimeType: string; extension: string; sizeBytes: number; filePath?: string }>;
export function createZipBuffer(entries: Array<{ filename: string; data: Buffer | Uint8Array }>): Buffer;
export function createZipFromDisk(fileEntries: Array<{ filename: string; filePath: string }>, outputPath: string): Promise<number>;
export function readPageFile(acquisitionId: string, filename: string): Promise<{ dataBase64: string; sizeBytes: number }>;
export function cleanupAcquisition(acquisitionId: string): Promise<void>;
export function validateImageBuffer(buf: Buffer | Uint8Array): { mimeType: string; extension: string };
export function isSsrfSafeUrl(urlStr: string, allowlistDomains?: readonly string[]): boolean;
export function parseIpv4ToNumber(host: string): number | null;
export function isPrivateOrReservedIpv4(ipNum: number): boolean;
export function isPrivateOrReservedIpv6(host: string): boolean;
export const ALLOWED_SOURCE_DOMAINS: readonly string[];
export const ALLOWED_IMAGE_DOMAINS: readonly string[];
