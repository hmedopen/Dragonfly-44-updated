const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns');
const vm = require('vm');

// =========================================================================
// SECTION 1: SSRF GUARD & SECURE NETWORKING
// =========================================================================

/**
 * Parses numeric IPv4 representations (octal, hex, dword, dotted-quad) into a 32-bit unsigned integer.
 * Returns null if not a valid IPv4 address representation.
 */
function parseIpv4ToNumber(host) {
  const trimmed = host.trim().replace(/^\[|\]$/g, '');

  // 1. Single integer / dword (e.g. 2130706433 or 0x7f000001 or 017700000001)
  if (/^(?:0x[0-9a-f]+|0[0-7]+|[0-9]+)$/i.test(trimmed)) {
    let num;
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

  // 2. Dotted parts (1 to 4 parts)
  const parts = trimmed.split('.');
  if (parts.length >= 1 && parts.length <= 4) {
    const values = [];
    for (const part of parts) {
      if (!part || !/^(?:0x[0-9a-f]+|0[0-7]+|[0-9]+)$/i.test(part)) return null;
      let val;
      if (part.startsWith('0x') || part.startsWith('0X')) {
        val = parseInt(part, 16);
      } else if (part.startsWith('0') && part.length > 1 && !part.includes('8') && !part.includes('9')) {
        val = parseInt(part, 8);
      } else {
        val = parseInt(part, 10);
      }
      if (!Number.isNaN(val) || val < 0) return null;
      values.push(val);
    }

    if (values.length === 4) {
      if (values.some((v) => v > 255)) return null;
      return ((values[0] << 24) | (values[1] << 16) | (values[2] << 8) | values[3]) >>> 0;
    } else if (values.length === 3) {
      if (values[0] > 255 || values[1] > 255 || values[2] > 65535) return null;
      return ((values[0] << 24) | (values[1] << 16) | values[2]) >>> 0;
    } else if (values.length === 2) {
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
 * Checks whether an IPv4 numeric value falls in a private, loopback, link-local, carrier-grade NAT, or reserved range.
 */
function isPrivateOrReservedIpv4(ipNum) {
  const byte1 = (ipNum >>> 24) & 0xff;
  const byte2 = (ipNum >>> 16) & 0xff;

  if (byte1 === 0) return true; // 0.0.0.0/8
  if (byte1 === 10) return true; // 10.0.0.0/8
  if (byte1 === 127) return true; // 127.0.0.0/8 loopback
  if (byte1 === 100 && (byte2 & 0xc0) === 64) return true; // 100.64.0.0/10 Carrier-grade NAT
  if (byte1 === 169 && byte2 === 254) return true; // 169.254.0.0/16 Link-local
  if (byte1 === 172 && (byte2 & 0xf0) === 16) return true; // 172.16.0.0/12 Private
  if (byte1 === 192 && byte2 === 168) return true; // 192.168.0.0/16 Private
  if (byte1 === 198 && (byte2 & 0xfe) === 18) return true; // 198.18.0.0/15 Benchmarking
  if (byte1 >= 224 && byte1 <= 239) return true; // 224.0.0.0/4 Multicast
  if (byte1 >= 240) return true; // 240.0.0.0/4 Reserved & Broadcast

  return false;
}

/**
 * Checks whether an IPv6 address string is private, loopback, link-local, or IPv4-mapped private.
 */
function isPrivateOrReservedIpv6(host) {
  const cleaned = host.toLowerCase().replace(/^\[|\]$/g, '').trim();

  if (cleaned === '::1' || cleaned === '::' || /^0*(?::0*)*:1$/.test(cleaned) || /^0*(?::0*)*$/.test(cleaned)) {
    return true;
  }

  if (cleaned.startsWith('::ffff:') || cleaned.includes(':ffff:')) {
    const after = cleaned.split(':ffff:').pop() || '';
    if (after.includes('.')) {
      const ipv4Num = parseIpv4ToNumber(after);
      if (ipv4Num !== null) {
        return isPrivateOrReservedIpv4(ipv4Num);
      }
    }
  }

  if (/^fe[89ab][0-9a-f]:/i.test(cleaned)) return true; // Link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/i.test(cleaned)) return true; // Unique local fc00::/7
  if (/^ff[0-9a-f]{2}:/i.test(cleaned)) return true; // Multicast ff00::/8

  return false;
}

/**
 * Validates that a hostname resolves strictly to public, non-private IP addresses.
 * Defends against DNS rebinding and private IP access.
 */
async function verifySafeIp(hostname) {
  const host = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (!host) throw new Error('SSRF Guard: Empty hostname.');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error(`SSRF Guard: Blocked local/internal host: "${host}"`);
  }

  const literalIpv4 = parseIpv4ToNumber(host);
  if (literalIpv4 !== null && isPrivateOrReservedIpv4(literalIpv4)) {
    throw new Error(`SSRF Guard: Host is a private/reserved IPv4: "${host}"`);
  }
  if (host.includes(':') && isPrivateOrReservedIpv6(host)) {
    throw new Error(`SSRF Guard: Host is a private/reserved IPv6: "${host}"`);
  }

  try {
    const addresses = await dns.promises.lookup(host, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new Error(`SSRF Guard: Could not resolve hostname "${host}"`);
    }
    for (const record of addresses) {
      if (record.family === 4) {
        const num = parseIpv4ToNumber(record.address);
        if (num !== null && isPrivateOrReservedIpv4(num)) {
          throw new Error(`SSRF Guard: Host "${host}" resolved to private/reserved IP: ${record.address}`);
        }
      } else if (record.family === 6) {
        if (isPrivateOrReservedIpv6(record.address)) {
          throw new Error(`SSRF Guard: Host "${host}" resolved to private/reserved IPv6: ${record.address}`);
        }
      }
    }
  } catch (err) {
    if (err.message && err.message.startsWith('SSRF Guard:')) {
      throw err;
    }
    throw new Error(`SSRF Guard: DNS resolution failed for "${host}": ${err.message}`);
  }
}

function matchesHostPattern(host, pattern) {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();

  if (p.startsWith('*.')) {
    const root = p.slice(2);
    return h === root || h.endsWith('.' + root);
  }
  return h === p;
}

function isSsrfSafeUrl(urlStr, allowlistDomains) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }

    const host = parsed.hostname.toLowerCase().trim();
    if (!host) return false;

    if (parsed.username || parsed.password) {
      return false;
    }

    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === 'metadata.google.internal'
    ) {
      return false;
    }

    const ipv4Num = parseIpv4ToNumber(host);
    if (ipv4Num !== null && isPrivateOrReservedIpv4(ipv4Num)) {
      return false;
    }

    if (host.includes(':') && isPrivateOrReservedIpv6(host)) {
      return false;
    }

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
 * Executes fetch with hop-by-hop SSRF redirect validation and DNS rebinding defense.
 * Strict standard TLS is enforced (no certificate or hostname bypass).
 */
async function secureFetchWithRedirects(targetUrl, headers, allowlist, maxRedirects = 5) {
  let current = targetUrl;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    if (!isSsrfSafeUrl(current, allowlist)) {
      throw new Error(`SSRF Guard: Blocked destination or unauthorized domain: "${current}"`);
    }

    const currentUrl = new URL(current);
    await verifySafeIp(currentUrl.hostname);

    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(current, {
          headers,
          redirect: 'manual',
        });
        break;
      } catch (fetchErr) {
        if (
          attempt < 2 &&
          (fetchErr.message?.includes('terminated') ||
            fetchErr.message?.includes('fetch failed') ||
            fetchErr.code === 'ECONNRESET')
        ) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        throw fetchErr;
      }
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      if (redirects >= maxRedirects) {
        throw new Error(`Too many redirects (limit: ${maxRedirects}).`);
      }
      const nextUrl = new URL(loc, current).toString();
      if (!isSsrfSafeUrl(nextUrl, allowlist)) {
        throw new Error(`SSRF Guard: Blocked redirect to unauthorized host: "${nextUrl}"`);
      }
      await verifySafeIp(new URL(nextUrl).hostname);
      current = nextUrl;
      redirects++;
      continue;
    }

    return res;
  }
  throw new Error('Too many redirects.');
}

// =========================================================================
// SECTION 2: SPEC-COMPLIANT ZIP ENGINE
// =========================================================================

let crcTable = null;
function getCrcTable() {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[i] = c;
    }
  }
  return crcTable;
}

function computeCrc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipBuffer(entries) {
  const localHeaders = [];
  const centralHeaders = [];
  let currentOffset = 0;

  for (const entry of entries) {
    const filenameBuf = Buffer.from(entry.filename, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = computeCrc32(dataBuf);
    const uncompressedSize = dataBuf.length;
    const compressedSize = uncompressedSize;

    const localHeader = Buffer.alloc(30 + filenameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6);     // General purpose bit flag (UTF-8 filename)
    localHeader.writeUInt16LE(0, 8);          // Compression method (0 = stored)
    localHeader.writeUInt16LE(0, 10);         // Last mod file time
    localHeader.writeUInt16LE(0, 12);         // Last mod file date
    localHeader.writeUInt32LE(crc, 14);       // CRC-32
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(filenameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);         // Extra field length
    filenameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, dataBuf);

    const centralHeader = Buffer.alloc(46 + filenameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory file header
    centralHeader.writeUInt16LE(20, 4);          // Version made by
    centralHeader.writeUInt16LE(20, 6);          // Version needed
    centralHeader.writeUInt16LE(0x0800, 8);      // General purpose bit flag
    centralHeader.writeUInt16LE(0, 10);          // Compression method
    centralHeader.writeUInt16LE(0, 12);          // Last mod time
    centralHeader.writeUInt16LE(0, 14);          // Last mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(filenameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);          // Extra field length
    centralHeader.writeUInt16LE(0, 32);          // File comment length
    centralHeader.writeUInt16LE(0, 34);          // Disk number start
    centralHeader.writeUInt16LE(0, 36);          // Internal file attributes
    centralHeader.writeUInt32LE(0, 38);          // External file attributes
    centralHeader.writeUInt32LE(currentOffset, 42); // Relative offset of local header
    filenameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    currentOffset += localHeader.length + dataBuf.length;
  }

  const centralDirOffset = currentOffset;
  const centralDirSize = centralHeaders.reduce((acc, h) => acc + h.length, 0);

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // End of central dir signature
  endRecord.writeUInt16LE(0, 4);          // Number of this disk
  endRecord.writeUInt16LE(0, 6);          // Disk where central directory starts
  endRecord.writeUInt16LE(entries.length, 8);  // Number of central directory records on this disk
  endRecord.writeUInt16LE(entries.length, 10); // Total number of central directory records
  endRecord.writeUInt32LE(centralDirSize, 12);  // Size of central directory
  endRecord.writeUInt32LE(centralDirOffset, 16); // Offset of start of central directory
  endRecord.writeUInt16LE(0, 20);         // ZIP file comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, endRecord]);
}

async function createZipFromDisk(param1, param2) {
  // Overload 1: createZipFromDisk(entries: Array<{ filename, filePath }>, outputPath?: string)
  if (Array.isArray(param1)) {
    const entries = [];
    for (const item of param1) {
      const data = await fs.promises.readFile(item.filePath);
      entries.push({ filename: item.filename, data });
    }
    const buf = createZipBuffer(entries);
    if (param2 && typeof param2 === 'string') {
      await fs.promises.writeFile(param2, buf);
      return buf.length;
    }
    return buf;
  }

  // Overload 2: createZipFromDisk(acquisitionId: string, pageFiles: Array<any>)
  const acqDir = getAcquisitionDir(param1);
  const entries = [];
  for (const page of param2 || []) {
    const filename = page.filename || path.basename(page.tempFilePath || '');
    const filePath =
      page.filePath ||
      (page.tempFilePath ? page.tempFilePath : path.join(acqDir, path.basename(filename)));
    const data = await fs.promises.readFile(filePath);
    entries.push({ filename, data });
  }
  return createZipBuffer(entries);
}

// =========================================================================
// SECTION 3: IMAGE VALIDATOR & MAGIC BYTES
// =========================================================================

function validateImageBuffer(buffer) {
  if (!buffer || buffer.length < 12) {
    throw new Error('Image data is too small to be a valid image file.');
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  // WebP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  // GIF: GIF87a or GIF89a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return { mimeType: 'image/gif', extension: 'gif' };
  }

  // AVIF / ISO BMFF: .... ftyp avif / avis
  if (buffer.length >= 16) {
    const ftyp = buffer.toString('ascii', 4, 8);
    if (ftyp === 'ftyp') {
      const brand = buffer.toString('ascii', 8, 12);
      if (brand === 'avif' || brand === 'avis' || brand === 'mif1') {
        return { mimeType: 'image/avif', extension: 'avif' };
      }
    }
  }

  return { mimeType: 'image/jpeg', extension: 'jpg' };
}

// =========================================================================
// SECTION 4: DOMAIN DEFINITIONS & CONSTANTS
// =========================================================================

const ALLOWED_SOURCE_DOMAINS = [
  // 1. MangaDex
  'mangadex.org',
  '*.mangadex.org',

  // 2. Asura Scans
  'asurascans.com',
  '*.asurascans.com',
  'asuracomic.net',
  '*.asuracomic.net',
  'asuracomics.com',
  '*.asuracomics.com',
  'asuratoons.com',
  '*.asuratoons.com',
  'asura.gg',
  '*.asura.gg',

  // 3. LINE Webtoon
  'webtoons.com',
  '*.webtoons.com',

  // 4. Tonari no Young Jump
  'tonarinoyj.jp',
  '*.tonarinoyj.jp',

  // 5. King of Shojo
  'kingofshojo.com',
  'cdn.kingofshojo.com',
  '*.kingofshojo.com',

  // 6. Rawkuma
  'rawkuma.net',
  '*.rawkuma.net',
  'rawkuma.com',
  '*.rawkuma.com',

  // 7. Thunder Scans
  'en-thunderscans.com',
  '*.en-thunderscans.com',
  'thunderscans.com',
  '*.thunderscans.com',

  // 8. Qi Scans / Qi Manga
  'qiscans.com',
  '*.qiscans.com',
  'qimanga.com',
  '*.qimanga.com',

  // 9. Vortex Scans
  'vortexscans.org',
  '*.vortexscans.org',

  // 10. Rinko Comics
  'rinkocomics.com',
  '*.rinkocomics.com',

  // 11. Flame Comics
  'flamecomics.xyz',
  '*.flamecomics.xyz',
  'flamecomics.com',
  '*.flamecomics.com',
  'flamescans.org',
  '*.flamescans.org',

  // 12. Demonic Scans
  'demonicscans.org',
  '*.demonicscans.org',

  // 13. GenZ Toons
  'genztoons.org',
  '*.genztoons.org',
  'genztoons.com',
  '*.genztoons.com',
  'genzupdates.com',
  '*.genzupdates.com',

  // 14. ElfToon
  'elftoon.net',
  '*.elftoon.net',
  'elftoon.com',
  '*.elftoon.com',

  // 15. Hijala
  'en-hijala.com',
  '*.en-hijala.com',
  'hijala.com',
  '*.hijala.com',

  // 16. Kyan Scans / Kayn Scans
  'kaynscans.com',
  '*.kaynscans.com',
  'kaynscan.org',
  '*.kaynscan.org',
  'kaynscan.com',
  '*.kaynscan.com',
  'kyanscans.com',
  '*.kyanscans.com',

  // 17. NuviaToon
  'nuviatoon.org',
  '*.nuviatoon.org',
  'nuviatoon.com',
  '*.nuviatoon.com',

  // 18. Nyx Scans
  'nyxscans.com',
  '*.nyxscans.com',

  // 19. Rokari Comics
  'rokaricomics.com',
  '*.rokaricomics.com',

  // 20. Hive Toons
  'hivetoons.org',
  '*.hivetoons.org',
  'hivetoon.com',
  '*.hivetoon.com',

  // 21. TW Manga / Baozimh
  'www.twmanga.com',
  'twmanga.com',
  '*.twmanga.com',
  'www.twbzmg.com',
  'twbzmg.com',
  '*.twbzmg.com',
  'baozimh.com',
  '*.baozimh.com',

  // 22. RuManhua
  'www.rumanhua2.com',
  'rumanhua2.com',
  '*.rumanhua2.com',
  'www.rumanhua.com',
  'rumanhua.com',
  '*.rumanhua.com',

  // 23. Kurage Bunch
  'kuragebunch.com',
  '*.kuragebunch.com',

  // Additional GigaViewer / Restricted
  'shonenjumpplus.com',
  '*.shonenjumpplus.com',
  'comic.naver.com',
  '*.naver.com',
  'page.kakao.com',
  '*.kakao.com',
  'ac.qq.com',
  '*.qq.com',
  'kuaikanmanhua.com',
  '*.kuaikanmanhua.com',
  'tappytoon.com',
  '*.tappytoon.com',
  'comic-walker.com',
  '*.comic-walker.com',
  'comic-walker.jp',
  '*.comic-walker.jp',
];

const ALLOWED_IMAGE_DOMAINS = [
  // 1. MangaDex
  '*.mangadex.network',
  '*.mangadex.org',
  'uploads.mangadex.org',

  // 2. Asura Scans
  'cdn.asurascans.com',
  'gg.asuracomic.net',
  'asuracomic.net',

  // 3. LINE Webtoon
  'webtoon-phinf.pstatic.net',

  // 4. Tonari no Young Jump
  'cdn-img.tonarinoyj.jp',

  // 5. King of Shojo
  'kingofshojo.com',
  'cdn.kingofshojo.com',

  // 6. Rawkuma
  'cdn.rawkuma.com',
  'rawkuma.net',

  // 7. Thunder Scans
  'en-thunderscans.com',
  'media.en-thunderscans.com',

  // 8. Qi Manga
  'media.qimanga.com',

  // 9. Vortex Scans
  'storage.vortexscans.org',

  // 10. Rinko Comics
  'cdn.rinkocomics.com',
  'rinkocomics.com',

  // 11. Flame Comics
  'cdn.flamecomics.xyz',

  // 12. Demonic Scans
  'cdn2.demoniclibs.com',
  'cdn.demoniclibs.com',
  'librarydm.com',

  // 13. GenZ Toons
  'cdn.meowing.org',

  // 14. ElfToon
  'elftoon.net',

  // 15. Hijala
  'storage.en-hijala.com',

  // 16. Kayn Scans
  'kaynscans.com',
  'kaynscan.org',

  // 17. NuviaToon (Strict Tenant R2)
  'nuviatoon.a57a9ab619b3f91ead3c71426d0451c6.r2.cloudflarestorage.com',
  'media.nuviatoon.org',

  // 18. Nyx Scans
  'storage.nyxscans.com',
  'storage.nyxscans.org',

  // 19. Rokari Comics
  'rokaricomics.com',

  // 20. Hive Toons
  'storage.hivetoon.com',

  // 21. TW Manga / Baozimh
  's1.bzcdn.net',

  // 22. RuManhua
  'p9-zhuxiaobang-sign.shimolife.com',
  'p3-zhuxiaobang-sign.shimolife.com',

  // 23. Kurage Bunch
  'cdn-img.kuragebunch.com',

  // Shonen Jump+
  'cdn-img.shonenjumpplus.com',
  'cdn-ak-img.shonenjumpplus.com',
];

const MANGADEX_USER_AGENT = 'FolioScript/1.0.0 (contact@folioscript.app)';
const ASURA_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ACQUISITION_BASE_DIR = path.join(os.tmpdir(), 'folio-chapter-snatch');

try {
  fs.mkdirSync(ACQUISITION_BASE_DIR, { recursive: true });
} catch {}

function getAcquisitionDir(acquisitionId) {
  const safeId = (acquisitionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(ACQUISITION_BASE_DIR, safeId);
}

// =========================================================================
// SECTION 5: METADATA & ACQUISITION PIPELINE
// =========================================================================

async function fetchMetadata(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new Error('Invalid URL provided.');
  }

  if (!isSsrfSafeUrl(targetUrl, ALLOWED_SOURCE_DOMAINS)) {
    throw new Error(`URL domain is not in the allowlist or is restricted: "${targetUrl}"`);
  }

  const parsed = new URL(targetUrl);
  const host = parsed.hostname.toLowerCase();

  // 1. MangaDex
  if (host.includes('mangadex.org')) {
    const segments = parsed.pathname.split('/').filter(Boolean);
    const chIdx = segments.indexOf('chapter');
    if (chIdx === -1 || !segments[chIdx + 1]) {
      throw new Error('Invalid MangaDex chapter URL. Expected format: https://mangadex.org/chapter/{uuid}');
    }
    const chapterId = segments[chIdx + 1].toLowerCase();

    const metaRes = await secureFetchWithRedirects(
      `https://api.mangadex.org/chapter/${chapterId}?includes[]=manga`,
      {
        'User-Agent': MANGADEX_USER_AGENT,
        Accept: 'application/json',
      },
      ALLOWED_SOURCE_DOMAINS
    );

    if (!metaRes.ok) {
      if (metaRes.status === 404) {
        throw new Error(`MangaDex chapter "${chapterId}" was not found (404).`);
      }
      throw new Error(`MangaDex API error (HTTP ${metaRes.status}) while retrieving chapter details.`);
    }

    const metaJson = await metaRes.json();
    if (metaJson.result === 'error') {
      const msg = metaJson.errors?.[0]?.detail || 'Unknown MangaDex error';
      throw new Error(`MangaDex API: ${msg}`);
    }

    const attrs = metaJson.data?.attributes || {};
    const rels = metaJson.data?.relationships || [];
    const mangaRel = rels.find((r) => r.type === 'manga');
    let seriesTitle = 'Unknown Manga';
    if (mangaRel?.attributes?.title) {
      const titles = mangaRel.attributes.title;
      seriesTitle = titles.en || titles['ja-ro'] || titles.ja || Object.values(titles)[0] || 'Unknown Manga';
    }

    const atHomeRes = await secureFetchWithRedirects(
      `https://api.mangadex.org/at-home/server/${chapterId}`,
      {
        'User-Agent': MANGADEX_USER_AGENT,
        Accept: 'application/json',
      },
      ALLOWED_SOURCE_DOMAINS
    );

    if (!atHomeRes.ok) {
      throw new Error(`MangaDex At-Home server error (HTTP ${atHomeRes.status}).`);
    }

    const atHomeJson = await atHomeRes.json();
    if (atHomeJson.result === 'error' || !atHomeJson.chapter) {
      throw new Error('MangaDex At-Home server failed to provide image endpoints.');
    }

    const baseUrl = atHomeJson.baseUrl;
    const hash = atHomeJson.chapter.hash;
    const dataFiles = atHomeJson.chapter.data || [];

    if (dataFiles.length === 0) {
      throw new Error('MangaDex chapter contains no pages.');
    }

    const pages = dataFiles.map((fn, idx) => {
      const originalIndex = idx + 1;
      const ext = fn.split('.').pop()?.toLowerCase() || 'png';
      let mime = 'image/png';
      if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
      else if (ext === 'webp') mime = 'image/webp';
      else if (ext === 'avif') mime = 'image/avif';

      return {
        id: `md-${chapterId}-${originalIndex}`,
        originalIndex,
        filename: fn,
        mimeType: mime,
        extension: ext,
        sizeBytes: 0,
        imageUrl: `${baseUrl}/data/${hash}/${fn}`,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'mangadex',
        sourceChapterId: chapterId,
        seriesTitle,
        chapterTitle: attrs.title || undefined,
        chapterNumber: attrs.chapter ? String(attrs.chapter) : undefined,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // Restricted platforms check
  if (host === 'comic.naver.com' || host.endsWith('.naver.com')) {
    throw new Error('Access Restricted: Naver Webtoon requires Naver account session and Korean telecom/carrier identity age verification.');
  }
  if (host === 'page.kakao.com' || host.endsWith('.kakao.com')) {
    throw new Error('Access Restricted: KakaoPage is a single-page app requiring Kakao OAuth authorization tokens.');
  }
  if (host === 'ac.qq.com' || host.endsWith('.qq.com')) {
    throw new Error('Access Restricted: Tencent Comic requires QQ user authentication.');
  }
  if (host === 'kuaikanmanhua.com' || host.endsWith('.kuaikanmanhua.com')) {
    throw new Error('Access Restricted: Kuaikan Manhua requires mobile app API tokens.');
  }
  if (host === 'tappytoon.com' || host.endsWith('.tappytoon.com')) {
    throw new Error('Access Restricted: Tappytoon is a commercial service with tokenized DRM encryption.');
  }
  if (host.includes('comic-walker.')) {
    throw new Error('Access Restricted: ComicWalker uses SpeedBinb proprietary canvas viewer with scrambled image slices.');
  }

  // 2. LINE Webtoon
  if (host.includes('webtoons.com')) {
    const res = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        Referer: 'https://www.webtoons.com/',
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!res.ok) throw new Error(`Webtoons responded with HTTP ${res.status}.`);
    const html = await res.text();
    const listMatch = html.match(/<div[^>]+id=["']_imageList["'][^>]*>([\s\S]*?)<\/div>/i);
    const container = listMatch ? listMatch[1] : html;
    const imgMatches = [...container.matchAll(/<img([^>]+)>/gi)];
    const imageUrls = [];
    for (const match of imgMatches) {
      const attrs = match[1];
      const dataUrlMatch = attrs.match(/data-url=["']([^"']+)["']/i);
      const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
      const target = dataUrlMatch ? dataUrlMatch[1].trim() : srcMatch ? srcMatch[1].trim() : null;
      if (!target || target.includes('placeholder') || target.includes('logo') || target.endsWith('.svg')) continue;
      imageUrls.push(target);
    }
    if (imageUrls.length === 0) throw new Error('Could not find chapter pages in the Webtoons response.');
    let seriesTitle = 'LINE Webtoon';
    const subjMatch = html.match(/<a[^>]+class=["'][^"']*subj[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (subjMatch) seriesTitle = subjMatch[1].replace(/<[^>]+>/g, '').trim();

    let chapterTitle;
    const epMatch = html.match(/<h1[^>]+class=["'][^"']*subj_episode[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
    if (epMatch) chapterTitle = epMatch[1].replace(/<[^>]+>/g, '').trim();

    const titleNo = parsed.searchParams.get('title_no') || 'title';
    const epNo = parsed.searchParams.get('episode_no') || 'ep';
    const pages = imageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const cleanUrl = u.split('?')[0];
      const ext = cleanUrl.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        id: `webtoons-${titleNo}-${epNo}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });
    return {
      metadata: {
        source: 'webtoons',
        sourceChapterId: `${titleNo}-${epNo}`,
        seriesTitle,
        chapterTitle,
        chapterNumber: epNo,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 3. Asura Scans
  if (
    host.includes('asurascans.com') ||
    host.includes('asuracomic.net') ||
    host.includes('asuracomics.com') ||
    host.includes('asuratoons.com') ||
    host.includes('asura.gg')
  ) {
    // Normalize domain to canonical asurascans.com and ensure /comics/ path
    let fetchUrl = targetUrl;
    try {
      const u = new URL(targetUrl);
      u.hostname = 'asurascans.com';
      u.pathname = u.pathname.replace(/^\/series\//i, '/comics/');
      fetchUrl = u.toString();
    } catch {}

    const res = await secureFetchWithRedirects(
      fetchUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://asurascans.com/',
      },
      ALLOWED_SOURCE_DOMAINS
    );

    if (!res.ok) {
      if (res.status === 404) throw new Error(`Asura chapter was not found at "${targetUrl}" (404).`);
      throw new Error(`Asura Scans responded with HTTP ${res.status}.`);
    }

    const html = await res.text();
    const islandMatch =
      html.match(/<astro-island[^>]+opts=["'][^"']*ChapterReader[^"']*["'][^>]*props=(["'])([\s\S]*?)\1/i) ||
      html.match(/<astro-island[^>]+props=(["'])([\s\S]*?)\1[^>]*opts=["'][^"']*ChapterReader[^"']*["']/i) ||
      html.match(/<astro-island[^>]+component-url=["'][^"']*ChapterReader[^"']*["'][^>]*props=(["'])([\s\S]*?)\1/i) ||
      html.match(/<astro-island[^>]+props=(["'])([\s\S]*?)\1/i);

    let imageUrls = [];
    let seriesTitle = 'Asura Comic';
    let chapterTitle = undefined;
    let chapterNumber = undefined;

    if (islandMatch && islandMatch[2]) {
      const decodedJson = islandMatch[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      let parsedRaw;
      try {
        parsedRaw = JSON.parse(decodedJson);
      } catch {}

      if (parsedRaw) {
        function unwrap(val) {
          if (!Array.isArray(val)) return val;
          const [type, data] = val;
          if (type === 0) {
            if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
              const out = {};
              for (const [k, v] of Object.entries(data)) out[k] = unwrap(v);
              return out;
            }
            return data;
          }
          if (type === 1 && Array.isArray(data)) {
            return data.map(unwrap);
          }
          return data;
        }

        const props = {};
        for (const [k, v] of Object.entries(parsedRaw)) {
          props[k] = unwrap(v);
        }

        const pagesData = props.pages || props.chapter?.pages || [];
        if (Array.isArray(pagesData) && pagesData.length > 0) {
          imageUrls = pagesData
            .map((p) => (typeof p === 'string' ? p : p?.url || p?.src || p?.image || ''))
            .filter(Boolean);
        }
        seriesTitle = props.seriesName || props.series?.title || props.seriesTitle || seriesTitle;
        chapterTitle = props.chapterTitle || props.chapter?.title || (props.chapterName ? `Chapter ${props.chapterName}` : undefined);
        chapterNumber = props.chapterNumber != null ? String(props.chapterNumber) : props.chapterName ? String(props.chapterName) : (props.chapter?.number ? String(props.chapter.number) : undefined);
      }
    }

    if (imageUrls.length === 0) {
      const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)];
      for (const m of imgMatches) {
        const src = m[1];
        if (src && (src.includes('gg.asuracomic.net') || src.includes('asurascans.com')) && src.includes('page')) {
          imageUrls.push(src);
        }
      }
    }

    if (imageUrls.length === 0) throw new Error('Could not find chapter pages in Asura response.');

    const pages = imageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const cleanUrl = u.split('?')[0];
      const ext = cleanUrl.split('.').pop()?.toLowerCase() || 'webp';
      return {
        id: `asura-${Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/webp',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'asura',
        sourceChapterId: parsed.pathname.replace(/\/+$/, '').split('/').pop() || 'chapter',
        seriesTitle,
        chapterTitle,
        chapterNumber,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 4. GigaViewer (Tonari no Young Jump, Kurage Bunch, Shonen Jump+)
  if (host.includes('tonarinoyj.jp') || host.includes('kuragebunch.com') || host.includes('shonenjumpplus.com')) {
    const segments = parsed.pathname.split('/').filter(Boolean);
    const epIdx = segments.indexOf('episode');
    if (epIdx === -1 || !segments[epIdx + 1]) {
      throw new Error('Invalid GigaViewer URL. Expected /episode/{episodeId}');
    }
    const episodeId = segments[epIdx + 1].replace(/\.json$/, '');

    let product = null;
    const htmlRes = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `https://${host}/`,
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (htmlRes.ok) {
      const pageHtml = await htmlRes.text();
      const dataValMatch =
        pageHtml.match(/<script[^>]+id=["']episode-json["'][^>]*data-value=(["'])([\s\S]*?)\1/i) ||
        pageHtml.match(/<script[^>]+data-value=(["'])([\s\S]*?)\1[^>]*id=["']episode-json["']/i);
      if (dataValMatch && dataValMatch[2]) {
        try {
          const decoded = dataValMatch[2]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          const parsedJson = JSON.parse(decoded);
          product = parsedJson?.readableProduct || parsedJson;
        } catch {}
      }
    }

    if (!product) {
      const jsonUrl = `https://${host}/episode/${episodeId}.json`;
      const res = await secureFetchWithRedirects(
        jsonUrl,
        {
          'User-Agent': ASURA_USER_AGENT,
          Accept: 'application/json, text/plain, */*',
          Referer: targetUrl,
        },
        ALLOWED_SOURCE_DOMAINS
      );
      if (res.ok) {
        const data = await res.json();
        product = data?.readableProduct;
      }
    }

    if (!product) throw new Error('Episode contains no accessible readable product data.');
    const rawPages = product.pageStructure?.pages || [];
    const mainPages = rawPages.filter((p) => p.type === 'main' && p.src);
    if (mainPages.length === 0) throw new Error('Episode contains no accessible main pages.');

    const pages = mainPages.map((p, idx) => {
      const originalIndex = idx + 1;
      const srcUrl = p.src;
      const ext = srcUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';
      return {
        id: `giga-${episodeId}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
        extension: ext,
        sizeBytes: 0,
        imageUrl: srcUrl,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'gigaviewer',
        sourceChapterId: episodeId,
        seriesTitle: product.series?.title || 'Manga',
        chapterTitle: product.title || undefined,
        chapterNumber: product.number !== undefined ? String(product.number) : undefined,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 5. Rinko Comics (ComicWorld XOR Encryption)
  if (host.includes('rinkocomics.com')) {
    const res = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://rinkocomics.com/',
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!res.ok) throw new Error(`Rinko Comics responded with HTTP ${res.status}.`);
    const html = await res.text();
    const cwMatch = html.match(/<script[^>]+id=["']cwPages["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!cwMatch || !cwMatch[1]) throw new Error('Could not find encrypted cwPages in Rinko Comics.');
    const raw = Buffer.from(cwMatch[1].trim(), 'base64');
    if (raw.length <= 16) throw new Error('Invalid encrypted payload length.');
    const key = raw.subarray(0, 16);
    const decrypted = Buffer.alloc(raw.length - 16);
    for (let i = 0; i < decrypted.length; i++) {
      decrypted[i] = raw[16 + i] ^ key[i % 16];
    }
    const pageUrls = JSON.parse(decrypted.toString('utf8'));
    if (!Array.isArray(pageUrls) || pageUrls.length === 0) throw new Error('Decrypted zero pages.');

    let seriesTitle = 'Rinko Comics';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) seriesTitle = titleMatch[1].split(/Chapter|Ch\./i)[0].replace(/[-–—|]/g, '').trim();

    const pages = pageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'webp';
      return {
        id: `rinko-${Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'rinkocomics',
        sourceChapterId: parsed.pathname.replace(/\/+$/, '').split('/').pop() || 'chapter',
        seriesTitle,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 6. Flame Comics (Next.js SPA)
  if (host.includes('flamecomics.') || host.includes('flamescans.org')) {
    const res = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://flamecomics.xyz/',
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!res.ok) throw new Error(`Flame Comics responded with HTTP ${res.status}.`);
    const html = await res.text();
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!nextMatch) throw new Error('Could not find Next.js data in Flame Comics.');
    const nextData = JSON.parse(nextMatch[1]);
    const ch = nextData?.props?.pageProps?.chapter;
    const series = nextData?.props?.pageProps?.series;
    let rawImages = ch?.images || [];
    if (typeof rawImages === 'string') {
      try { rawImages = JSON.parse(rawImages); } catch {}
    }
    if (!Array.isArray(rawImages) && typeof rawImages === 'object' && rawImages !== null) {
      rawImages = Object.values(rawImages);
    }
    if (!Array.isArray(rawImages) || rawImages.length === 0) throw new Error('No images found in Flame Comics chapter.');

    const seriesId = ch.series_id || series?.series_id || 1;
    const token = ch.token || '';

    const imageUrls = rawImages.map((img) => {
      if (typeof img === 'string') return img;
      if (img && img.name) {
        return `https://cdn.flamecomics.xyz/uploads/images/series/${seriesId}/${token}/${img.name}`;
      }
      return '';
    }).filter(Boolean);

    if (imageUrls.length === 0) throw new Error('Could not construct image URLs for Flame Comics.');

    const pages = imageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        id: `flame-${ch?.chapter_id || ch?.id || 'ch'}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'flamecomics',
        sourceChapterId: String(ch?.chapter_id || ch?.id || 'chapter'),
        seriesTitle: series?.title || ch?.title || 'Flame Comics Series',
        chapterTitle: ch?.chapter_title || ch?.title || undefined,
        chapterNumber: ch?.chapter != null ? String(ch.chapter) : undefined,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 7. Vasto / Komi CMS (Vortex, Qi Manga, Hijala, Nyx, Hive Toons)
  const isVasto = [
    'vortexscans.org',
    'qimanga.com',
    'qiscans.com',
    'en-hijala.com',
    'hijala.com',
    'nyxscans.com',
    'hivetoons.org',
  ].some((d) => host === d || host.endsWith('.' + d));

  if (isVasto) {
    const res = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `https://${host}/`,
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!res.ok) throw new Error(`Vasto CMS responded with HTTP ${res.status}.`);
    const html = await res.text();
    const imgRegex =
      /(https?:\/\/(?:storage\.(?:vortexscans\.org|en-hijala\.com|nyxscans\.(?:com|org)|hivetoon\.com)|media\.qimanga\.com)\/[^\s"'<>]+\.(?:webp|jpg|jpeg|png))/gi;
    let matches = [...new Set([...html.matchAll(imgRegex)].map((m) => m[1]))];
    if (matches.length === 0) {
      const fallbackImgs = [...html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi)]
        .map((m) => m[1])
        .filter((u) => !u.includes('logo') && !u.includes('avatar') && !u.endsWith('.svg'));
      matches = [...new Set(fallbackImgs)];
    }
    if (matches.length === 0) throw new Error('Could not find chapter pages in Vasto CMS.');

    let seriesTitle = 'Manga Series';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) seriesTitle = titleMatch[1].split(/Chapter|Ch\./i)[0].replace(/[-–—|]/g, '').trim();

    const pages = matches.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'webp';
      return {
        id: `vasto-${Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'vasto',
        sourceChapterId: parsed.pathname.replace(/\/+$/, '').split('/').pop() || 'chapter',
        seriesTitle,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 8. ElfToon & Kayn Scans (Custom Next.js/Laravel CMS)
  const isElfOrKayn = [
    'elftoon.net',
    'elftoon.com',
    'kaynscans.com',
    'kyanscans.com',
    'kaynscan.org',
    'kaynscan.com',
  ].some((d) => host === d || host.endsWith('.' + d));

  if (isElfOrKayn) {
    const res = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `https://${host}/`,
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!res.ok) throw new Error(`Server responded with HTTP ${res.status}.`);
    const html = await res.text();
    const uploadMatches = [
      ...new Set([...html.matchAll(/(\/uploads\/series\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|avif))/gi)].map((m) => m[1])),
    ];
    const pageUrls = uploadMatches
      .filter((p) => /\/p\d+/i.test(p) || /page-\d+/i.test(p))
      .sort((a, b) => {
        const numA = parseInt(a.match(/p(\d+)/i)?.[1] || '0', 10);
        const numB = parseInt(b.match(/p(\d+)/i)?.[1] || '0', 10);
        return numA - numB;
      })
      .map((p) => new URL(p, targetUrl).toString());

    if (pageUrls.length === 0) throw new Error('Could not find chapter pages in response.');

    let seriesTitle = host.includes('elftoon') ? 'Elf Toon' : 'Kayn Scans';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) seriesTitle = titleMatch[1].split(/Chapter|Ch\./i)[0].replace(/[-–—|]/g, '').trim();

    const pages = pageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'webp';
      return {
        id: `elfkayn-${Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: host.includes('elftoon') ? 'elftoon' : 'kaynscans',
        sourceChapterId: parsed.pathname.replace(/\/+$/, '').split('/').pop() || 'chapter',
        seriesTitle,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 9. NuviaToon (Next.js App Router + Content API)
  if (host.includes('nuviatoon.')) {
    const res = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://nuviatoon.org/',
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!res.ok) throw new Error(`NuviaToon responded with HTTP ${res.status}.`);
    const html = await res.text();
    const idMatch =
      html.match(/"meta"\s*:\s*\{\s*"id"\s*:\s*"([a-f0-9-]+)"/i) ||
      html.match(/\\"meta\\"\s*:\s*\{\s*\\"id\\"\s*:\s*\\"([a-f0-9-]+)\\"/i) ||
      html.match(/"chapterId"\s*:\s*"([a-f0-9-]+)"/i);

    if (!idMatch) throw new Error('Could not resolve NuviaToon chapter ID from page.');
    const chapterId = idMatch[1];
    const contentApiUrl = `https://nuviatoon.org/api/comic-chapters/${chapterId}/content`;

    const apiRes = await secureFetchWithRedirects(
      contentApiUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'application/json',
        Referer: targetUrl,
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!apiRes.ok) throw new Error(`NuviaToon API responded with HTTP ${apiRes.status}.`);
    const apiJson = await apiRes.json();
    const pagesData = apiJson?.data?.pages || [];
    if (pagesData.length === 0) throw new Error('NuviaToon chapter contains no pages.');

    let seriesTitle = 'Nuviatoon Comic';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) seriesTitle = titleMatch[1].split(/—|Chapter/i)[0].trim();

    const pages = pagesData.map((p, idx) => {
      const originalIndex = idx + 1;
      const clean = p.url.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'webp';
      return {
        id: `nuvia-${chapterId}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp',
        extension: ext,
        sizeBytes: 0,
        imageUrl: p.url,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'nuviatoon',
        sourceChapterId: chapterId,
        seriesTitle,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 10. GenZ Toons (Custom SSR UID Mapping)
  if (host.includes('genztoons.') || host.includes('genzupdates.')) {
    const res = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `https://${host}/`,
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!res.ok) throw new Error(`GenZ Toons responded with HTTP ${res.status}.`);
    const html = await res.text();
    const uidMatches = [...html.matchAll(/<img[^>]+uid=["']([^"']+\.[a-z0-9]+)["'][^>]*>/gi)].map((m) => m[1]);
    if (uidMatches.length === 0) throw new Error('Could not find chapter pages in GenZ Toons.');

    let seriesTitle = 'Genz Toon';
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) seriesTitle = h1Match[1].trim();

    const pages = uidMatches.map((uid, idx) => {
      const originalIndex = idx + 1;
      const ext = uid.split('.').pop()?.toLowerCase() || 'webp';
      return {
        id: `genz-${Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : ext === 'avif' ? 'image/avif' : 'image/webp',
        extension: ext,
        sizeBytes: 0,
        imageUrl: `https://cdn.meowing.org/uploads/${uid}`,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'genztoons',
        sourceChapterId: parsed.pathname.replace(/\/+$/, '').split('/').pop() || 'chapter',
        seriesTitle,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 11. Demonic Scans (PHP 302 Follow & ReaderMC Imgholder)
  if (host.includes('demonicscans.org')) {
    const res = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://demonicscans.org/',
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!res.ok) throw new Error(`Demonic Scans responded with HTTP ${res.status}.`);
    const html = await res.text();
    const imgMatches = [
      ...html.matchAll(
        /<img[^>]+(?:class=["'][^"']*imgholder[^"']*["']|src=["'][^"']*(?:demoniclibs|librarydm)[^"']*["'])[^>]*>/gi
      ),
    ];
    const pageUrls = [];
    for (const m of imgMatches) {
      const src = m[0].match(/src=["']([^"']+)["']/i)?.[1];
      if (src && (src.includes('demoniclibs.com') || src.includes('librarydm.com')) && !src.includes('free_ads')) {
        pageUrls.push(encodeURI(src));
      }
    }
    if (pageUrls.length === 0) throw new Error('Could not find chapter images in Demonic Scans.');

    let seriesTitle = 'Demonic Scans Manga';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) seriesTitle = titleMatch[1].split(/Chapter|Ch\./i)[0].trim();

    const pages = pageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        id: `demonic-${Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'demonicscans',
        sourceChapterId: parsed.pathname.replace(/\/+$/, '').split('/').pop() || 'chapter',
        seriesTitle,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 12. TW Manga / Baozimh
  if (host.includes('twmanga.') || host.includes('twbzmg.') || host.includes('baozimh.')) {
    const res = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `https://${host}/`,
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!res.ok) throw new Error(`Baozimh responded with HTTP ${res.status}.`);
    const html = await res.text();
    const matches = [
      ...new Set([...html.matchAll(/https?:\/\/[a-z0-9.]*bzcdn\.net\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/gi)].map((m) => m[0])),
    ];
    if (matches.length === 0) throw new Error('Could not find chapter pages in Baozimh/TW Manga.');

    let seriesTitle = 'Baozi Manga';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) seriesTitle = titleMatch[1].split(/[-–—|]/)[0].trim();

    const pages = matches.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        id: `twmanga-${Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'twmanga',
        sourceChapterId: parsed.pathname.replace(/\/+$/, '').split('/').pop() || 'chapter',
        seriesTitle,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 13. RuManhua (Dean Edwards Packer + all2.js Decryptor)
  if (host.includes('rumanhua')) {
    const res = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `http://${host}/`,
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!res.ok) throw new Error(`RuManhua responded with HTTP ${res.status}.`);
    const html = await res.text();
    const packed = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?<\/script>/i)?.[0];
    if (!packed) throw new Error('Could not find packed script in RuManhua.');
    const unpackedCall = packed
      .replace('<script>', '')
      .replace('</script>', '')
      .replace(/eval\s*\(/, 'return (');
    const getC0rst = new Function(unpackedCall);
    const unpackedScript = getC0rst();

    const dataId = html.match(/class=["'][^"']*readerContainer[^"']*["'][^>]*data-id=["'](\d+)["']/i)?.[1] || '0';

    const all2Res = await secureFetchWithRedirects(
      `http://${host}/static/js/all2.js?v=2.3`,
      { 'User-Agent': ASURA_USER_AGENT, Referer: targetUrl },
      ALLOWED_SOURCE_DOMAINS
    );
    const all2Js = await all2Res.text();

    const sandbox = {
      console,
      window: {},
      document: {
        getElementById: () => ({ appendChild: () => {} }),
        createElement: () => ({ setAttribute: () => {}, style: {} }),
        querySelectorAll: () => [],
      },
      location: { href: targetUrl },
    };
    sandbox.$ = function (arg) {
      if (typeof arg === 'function') {
        arg();
        return;
      }
      return {
        data: (k) => (k === 'id' ? parseInt(dataId, 10) : undefined),
        html: () => {},
        append: () => {},
        on: () => {},
      };
    };
    sandbox.jQuery = sandbox.$;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(unpackedScript, sandbox);

    const modifiedAll2 = all2Js.replace(
      'var _0x409eb8=JSON',
      'globalThis.PARSED = JSON.parse(_0x2eb701); var _0x409eb8=JSON'
    );
    vm.runInContext(modifiedAll2, sandbox);

    const pageUrls = sandbox.PARSED;
    if (!Array.isArray(pageUrls) || pageUrls.length === 0) {
      throw new Error('Failed to decrypt RuManhua pages.');
    }

    let seriesTitle = 'RuManhua Series';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) seriesTitle = titleMatch[1].split(/[-–—_|]/)[0].trim();

    const pages = pageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'jpeg';
      return {
        id: `ruman-${Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'rumanhua',
        sourceChapterId: parsed.pathname.replace(/\/+$/, '').split('/').pop() || 'chapter',
        seriesTitle,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  // 14. MangaThemesia (King of Shojo, Thunder Scans, Rokari Comics, Rawkuma)
  const isMangaThemesia = [
    'kingofshojo.com',
    'rawkuma.net',
    'rawkuma.com',
    'en-thunderscans.com',
    'thunderscans.com',
    'rokaricomics.com',
  ].some((d) => host === d || host === `www.${d}` || host.endsWith(`.${d}`));

  if (isMangaThemesia) {
    const res = await secureFetchWithRedirects(
      targetUrl,
      {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        Referer: `https://${host}/`,
      },
      ALLOWED_SOURCE_DOMAINS
    );
    if (!res.ok) {
      if (res.status === 404) throw new Error(`Chapter not found at "${targetUrl}" (404).`);
      throw new Error(`Server responded with HTTP ${res.status}.`);
    }
    const html = await res.text();
    let imageUrls = [];

    // Check ts_reader.run
    const tsMatch = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/i);
    if (tsMatch && tsMatch[1]) {
      try {
        const readerData = JSON.parse(tsMatch[1]);
        const sources = readerData.sources || [];
        for (const src of sources) {
          if (Array.isArray(src.images) && src.images.length > 0) {
            imageUrls = src.images;
            break;
          }
        }
      } catch {}
    }

    // Check Rawkuma section[data-image-data="1"] or readerarea
    if (imageUrls.length === 0) {
      const rawkumaSec = html.match(/<section[^>]+data-image-data=["']1["'][^>]*>([\s\S]*?)<\/section>/i);
      const readerAreaMatch =
        rawkumaSec ||
        html.match(/<div[^>]+id=["']readerarea["'][^>]*>([\s\S]*?)<\/div>/i) ||
        html.match(/<div[^>]+class=["'][^"']*reading-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      const container = readerAreaMatch ? readerAreaMatch[1] : html;
      const imgMatches = [...container.matchAll(/<img([^>]+)>/gi)];
      const seen = new Set();
      for (const m of imgMatches) {
        const attrs = m[1];
        const srcMatch =
          attrs.match(/(?:data-src|data-lazy-src|data-original)=["']([^"']+)["']/i) ||
          attrs.match(/src=["']([^"']+)["']/i);
        if (!srcMatch) continue;
        const raw = srcMatch[1].trim();
        if (raw.includes('/ads/') || raw.includes('logo') || raw.includes('avatar') || raw.endsWith('.svg')) continue;
        try {
          const full = new URL(raw, targetUrl).toString();
          if (!seen.has(full)) {
            seen.add(full);
            imageUrls.push(full);
          }
        } catch {}
      }
    }

    if (imageUrls.length === 0) throw new Error('Could not find chapter reader pages in response.');

    let seriesTitle = 'Manga Series';
    const titleTagMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleTagMatch) {
      const parts = titleTagMatch[1].split(/[-–—|]/);
      if (parts[0].trim()) seriesTitle = parts[0].split(/Chapter|Ch\./i)[0].trim();
    }
    let chapterTitle;
    let chapterNumber;
    const h1Match = html.match(/<h1[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      chapterTitle = h1Match[1].replace(/<[^>]+>/g, '').trim();
      const numMatch = chapterTitle.match(/(?:Chapter|Ch\.?)\s*(\d+(?:\.\d+)?)/i);
      if (numMatch) chapterNumber = numMatch[1];
    }

    const pages = imageUrls.map((u, idx) => {
      const originalIndex = idx + 1;
      const clean = u.split('?')[0];
      const ext = clean.split('.').pop()?.toLowerCase() || 'jpg';
      return {
        id: `ts-${Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
        extension: ext,
        sizeBytes: 0,
        imageUrl: u,
        downloadStatus: 'pending',
      };
    });

    return {
      metadata: {
        source: 'mangathemesia',
        sourceChapterId: parsed.pathname.replace(/\/+$/, '').split('/').pop() || 'chapter',
        seriesTitle,
        chapterTitle,
        chapterNumber,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }

  throw new Error(`Unsupported source "${host}".`);
}

/**
 * Downloads page image, validates magic bytes, and caches to disk when requested.
 * Enforces strict TLS and Referer propagation.
 */
async function downloadPageImage(imageUrl, referer, options = {}) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('Invalid image URL.');
  }

  if (!isSsrfSafeUrl(imageUrl, ALLOWED_IMAGE_DOMAINS)) {
    throw new Error(`Image domain is not in the allowlist or is restricted: "${imageUrl}"`);
  }

  const isMangaDex = imageUrl.includes('mangadex.');
  const headers = {
    'User-Agent': isMangaDex ? MANGADEX_USER_AGENT : ASURA_USER_AGENT,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };

  // Referer resolution & fallback
  let effectiveReferer = referer;
  if (!effectiveReferer) {
    if (imageUrl.includes('pstatic.net') || imageUrl.includes('webtoons.com')) {
      effectiveReferer = 'https://www.webtoons.com/';
    } else if (imageUrl.includes('bzcdn.net')) {
      effectiveReferer = 'https://www.twbzmg.com/';
    } else if (imageUrl.includes('demoniclibs.com') || imageUrl.includes('librarydm.com')) {
      effectiveReferer = 'https://demonicscans.org/';
    } else if (imageUrl.includes('shimolife.com')) {
      effectiveReferer = 'http://www.rumanhua2.com/';
    } else if (imageUrl.includes('kingofshojo.com')) {
      effectiveReferer = 'https://kingofshojo.com/';
    } else if (imageUrl.includes('rawkuma')) {
      effectiveReferer = 'https://rawkuma.net/';
    } else if (imageUrl.includes('rinkocomics.com')) {
      effectiveReferer = 'https://rinkocomics.com/';
    }
  }

  if (effectiveReferer) {
    headers['Referer'] = effectiveReferer;
  }

  let delay = 1000;
  let res = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await secureFetchWithRedirects(imageUrl, headers, ALLOWED_IMAGE_DOMAINS);
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    throw new Error(`Failed to download image (HTTP ${res?.status || 'Unknown'})`);
  }

  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const valid = validateImageBuffer(buf);

  let savedFilePath = undefined;
  if (options.acquisitionId && options.filename) {
    const acqDir = getAcquisitionDir(options.acquisitionId);
    await fs.promises.mkdir(acqDir, { recursive: true });
    savedFilePath = path.join(acqDir, path.basename(options.filename));
    await fs.promises.writeFile(savedFilePath, buf);
  }

  return {
    dataBase64: buf.toString('base64'),
    mimeType: valid.mimeType,
    extension: valid.extension,
    sizeBytes: buf.length,
    filePath: savedFilePath,
  };
}

async function readPageFile(acquisitionId, filename) {
  const acqDir = getAcquisitionDir(acquisitionId);
  const filePath = path.join(acqDir, path.basename(filename));
  const data = await fs.promises.readFile(filePath);
  return {
    dataBase64: data.toString('base64'),
    sizeBytes: data.length,
  };
}

async function cleanupAcquisition(acquisitionId) {
  if (!acquisitionId) return;
  const acqDir = getAcquisitionDir(acquisitionId);
  try {
    await fs.promises.rm(acqDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[ChapterSnatch] Could not clean up temp dir "${acqDir}":`, err);
  }
}

module.exports = {
  fetchMetadata,
  downloadPageImage,
  createZipBuffer,
  createZipFromDisk,
  readPageFile,
  cleanupAcquisition,
  validateImageBuffer,
  isSsrfSafeUrl,
  verifySafeIp,
  parseIpv4ToNumber,
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
  ALLOWED_SOURCE_DOMAINS,
  ALLOWED_IMAGE_DOMAINS,
};
