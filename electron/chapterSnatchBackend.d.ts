export function fetchMetadata(targetUrl: string): Promise<{ metadata: any; pages: any[] }>;
export function downloadPageImage(imageUrl: string, referer?: string): Promise<{ dataBase64: string; mimeType: string }>;
export function isSsrfSafeUrl(urlStr: string): boolean;
