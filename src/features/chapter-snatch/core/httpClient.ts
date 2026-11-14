import type { FetchHttpClientOptions } from './types';

/**
 * Parses numeric IPv4 representations (octal, hex, dword, dotted-quad) into a 32-bit unsigned integer.
 * Returns null if not a valid IPv4 address representation.
 */
export function parseIpv4ToNumber(host: string): number | null {
  const trimmed = host.trim().replace(/^\[|\]$/g, '');

  // 1. Single integer / dword (e.g. 2130706433 or 0x7f000001 or 017700000001)
  if (/^(?:0x[0-9a-f]+|0[0-7]+|[0-9]+)$/i.test(trimmed)) {
    let num: number;
    if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
      num = parseInt(trimmed, 16);
    } else if (trimmed.startsWith('0') && trimmed.length > 1 && !trimmed.includes('8') && !trimmed.includes('9')) {
      num = parseInt(trimmed, 8);
    } else {
      num = parseInt(trimmed, 10);
    }
    if (!Number.isNaN(num) && num >= 0 && num <= 0xffffffff) {
      return num >>> 0;
    }
  }

  // 2. Dotted parts (1 to 4 parts, e.g. 127.0.0.1, 10.1, 127.1)
  const parts = trimmed.split('.');
  if (parts.length >= 1 && parts.length <= 4) {
    const values: number[] = [];
    for (const part of parts) {
      if (!part || !/^(?:0x[0-9a-f]+|0[0-7]+|[0-9]+)$/i.test(part)) {
        return null;
      }
      let val: number;
      if (part.startsWith('0x') || part.startsWith('0X')) {
        val = parseInt(part, 16);
      } else if (part.startsWith('0') && part.length > 1 && !part.includes('8') && !part.includes('9')) {
        val = parseInt(part, 8);
      } else {
        val = parseInt(part, 10);
      }
      if (Number.isNaN(val) || val < 0) return null;
      values.push(val);
    }

    if (values.length === 4) {
      if (values.some((v) => v > 255)) return null;
      return ((values[0] << 24) | (values[1] << 16) | (values[2] << 8) | values[3]) >>> 0;
    } else if (values.length === 3) {
      // a.b.c -> a.b.0.0 + c (c can be up to 65535)
      if (values[0] > 255 || values[1] > 255 || values[2] > 65535) return null;
      return ((values[0] << 24) | (values[1] << 16) | values[2]) >>> 0;
    } else if (values.length === 2) {
      // a.b -> a.0.0.0 + b (b can be up to 16777215)
      if (values[0] > 255 || values[1] > 16777215) return null;
      return ((values[0] << 24) | values[1]) >>> 0;
    } else if (values.length === 1) {
      if (values[0] > 0xffffffff) return null;
      return values[0] >>> 0;
    }
  }

  return null;
}

/**
 * Checks whether an IPv4 numeric value falls in a private, loopback, link-local, or reserved range.
 */
export function isPrivateOrReservedIpv4(ipNum: number): boolean {
  const byte1 = (ipNum >>> 24) & 0xff;
  const byte2 = (ipNum >>> 16) & 0xff;

  // 0.0.0.0/8 (Current network)
  if (byte1 === 0) return true;

  // 10.0.0.0/8 (Private)
  if (byte1 === 10) return true;

  // 127.0.0.0/8 (Loopback)
  if (byte1 === 127) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (byte1 === 100 && (byte2 & 0xc0) === 64) return true;

  // 169.254.0.0/16 (Link-local / Cloud metadata)
  if (byte1 === 169 && byte2 === 254) return true;

  // 172.16.0.0/12 (Private)
  if (byte1 === 172 && (byte2 & 0xf0) === 16) return true;

  // 192.168.0.0/16 (Private)
  if (byte1 === 192 && byte2 === 168) return true;

  // 198.18.0.0/15 (Network benchmark)
  if (byte1 === 198 && (byte2 & 0xfe) === 18) return true;

  // 224.0.0.0/4 (Multicast: 224-239)
  if (byte1 >= 224 && byte1 <= 239) return true;

  // 240.0.0.0/4 (Reserved / Broadcast: 240-255)
  if (byte1 >= 240) return true;

  return false;
}

/**
 * Checks whether an IPv6 address string is private, loopback, link-local, or IPv4-mapped private.
 */
export function isPrivateOrReservedIpv6(host: string): boolean {
  const cleaned = host.toLowerCase().replace(/^\[|\]$/g, '').trim();

  // ::1 loopback, :: unspecified
  if (cleaned === '::1' || cleaned === '::' || /^0*(?::0*)*:1$/.test(cleaned) || /^0*(?::0*)*$/.test(cleaned)) {
    return true;
  }

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (cleaned.startsWith('::ffff:') || cleaned.includes(':ffff:')) {
    const after = cleaned.split(':ffff:').pop() || '';
    if (after.includes('.')) {
      const ipv4Num = parseIpv4ToNumber(after);
      if (ipv4Num !== null) {
        return isPrivateOrReservedIpv4(ipv4Num);
      }
    }
  }

  // Link-local: fe80::/10 (fe80 to febf)
  if (/^fe[89ab][0-9a-f]:/i.test(cleaned)) {
    return true;
  }

  // Unique local: fc00::/7 (fc00 to fdff)
  if (/^f[cd][0-9a-f]{2}:/i.test(cleaned)) {
    return true;
  }

  // Multicast: ff00::/8
  if (/^ff[0-9a-f]{2}:/i.test(cleaned)) {
    return true;
  }

  return false;
}

/**
 * Checks whether a host pattern matches an allowlist pattern.
 * E.g. '*.mangadex.org' matches 'api.mangadex.org' and 'mangadex.org'.
 */
export function matchesHostPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();

  if (p.startsWith('*.')) {
    const root = p.slice(2);
    return h === root || h.endsWith('.' + root);
  }
  return h === p;
}

/**
 * SSRF Guard: Validates that a URL uses safe protocols (http/https),
 * does not point to localhost, private/loopback/cloud-metadata networks,
 * and matches the provided domain allowlist.
 */
export function isSsrfSafeUrl(urlStr: string, allowlistDomains: readonly string[]): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }

    const host = parsed.hostname.toLowerCase().trim();
    if (!host) return false;

    // Reject userinfo in URLs (e.g. http://user:pass@host)
    if (parsed.username || parsed.password) {
      return false;
    }

    // Direct named localhost and internal names
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === 'metadata.google.internal'
    ) {
      return false;
    }

    // Check IPv4 forms (including integer, octal, hex)
    const ipv4Num = parseIpv4ToNumber(host);
    if (ipv4Num !== null) {
      if (isPrivateOrReservedIpv4(ipv4Num)) {
        return false;
      }
    }

    // Check IPv6 forms
    if (host.includes(':') && isPrivateOrReservedIpv6(host)) {
      return false;
    }

    // Check allowlisted domain patterns
    if (allowlistDomains && allowlistDomains.length > 0) {
      const isAllowed = allowlistDomains.some((pattern) => matchesHostPattern(host, pattern));
      if (!isAllowed) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Central HTTP client providing timeout, retry with backoff, honest user-agents,
 * and strict SSRF redirect validation.
 */
export class FetchHttpClient {
  private defaultTimeoutMs: number;
  private defaultMaxRetries: number;
  private defaultAllowedHosts: string[];

  constructor(options: { defaultTimeoutMs?: number; defaultMaxRetries?: number; defaultAllowedHosts?: string[] } = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15000;
    this.defaultMaxRetries = options.defaultMaxRetries ?? 3;
    this.defaultAllowedHosts = options.defaultAllowedHosts ?? [];
  }

  /**
   * Performs an SSRF-safe HTTP request with redirect validation at each hop.
   */
  public async fetchSafe(
    urlStr: string,
    options: FetchHttpClientOptions = {},
    customFetch: typeof fetch = fetch
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxRetries = options.maxRetries ?? this.defaultMaxRetries;
    const allowedHosts = options.allowedHosts ?? this.defaultAllowedHosts;
    const maxRedirects = options.maxRedirects ?? 5;

    let currentUrl = urlStr;
    let redirectCount = 0;

    // Retry loop
    let attempt = 0;
    let delayMs = 1000;

    while (attempt <= maxRetries) {
      // 1. SSRF Validation of current URL
      if (allowedHosts.length > 0 && !isSsrfSafeUrl(currentUrl, allowedHosts)) {
        throw new Error(`SSRF Guard: Target URL host is blocked or not in allowlist: "${currentUrl}"`);
      }

      // 2. Setup Timeout Controller
      const timeoutController = new AbortController();
      let timer: any = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timeoutController.abort(new Error(`Request timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }

      // Link caller's signal if present
      let mergedSignal = timeoutController.signal;
      if (options.signal) {
        if (options.signal.aborted) {
          if (timer) clearTimeout(timer);
          throw options.signal.reason || new Error('Request aborted.');
        }
        const onCallerAbort = () => {
          timeoutController.abort(options.signal?.reason);
        };
        options.signal.addEventListener('abort', onCallerAbort, { once: true });
      }

      try {
        // Use manual redirect to inspect each hop in browser/node
        const res = await customFetch(currentUrl, {
          method: 'GET',
          headers: options.headers,
          signal: mergedSignal,
          redirect: 'manual',
        });

        if (timer) clearTimeout(timer);

        // Check for redirects (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const location = res.headers.get('location');
          if (!location) {
            return res;
          }
          if (redirectCount >= maxRedirects) {
            throw new Error(`Too many redirects (limit: ${maxRedirects}).`);
          }

          const resolvedRedirectUrl = new URL(location, currentUrl).toString();

          // Validate redirect URL against SSRF and allowlist
          if (allowedHosts.length > 0 && !isSsrfSafeUrl(resolvedRedirectUrl, allowedHosts)) {
            throw new Error(`SSRF Guard: Redirect destination is blocked or not allowed: "${resolvedRedirectUrl}"`);
          }

          currentUrl = resolvedRedirectUrl;
          redirectCount++;
          continue; // follow redirect
        }

        // Handle Rate Limiting (429) and transient errors (502, 503, 504)
        if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
          if (attempt < maxRetries) {
            attempt++;
            let waitTime = delayMs;
            const retryAfter = res.headers.get('retry-after');
            if (retryAfter) {
              const seconds = parseInt(retryAfter, 10);
              if (!Number.isNaN(seconds) && seconds >= 0) {
                waitTime = Math.min(seconds * 1000, 10000);
              }
            }
            await new Promise((r) => setTimeout(r, waitTime));
            delayMs *= 2;
            continue;
          }
        }

        return res;
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        if (options.signal?.aborted) {
          throw options.signal.reason || new Error('Request aborted.');
        }
        if (attempt < maxRetries) {
          attempt++;
          await new Promise((r) => setTimeout(r, delayMs));
          delayMs *= 2;
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Request failed after ${maxRetries} retries.`);
  }
}

export const defaultHttpClient = new FetchHttpClient();
