const fs = require('fs');
const path = require('path');

// SSRF Guard: Reject private and link-local IP addresses and invalid schemes
function isSsrfSafeUrl(urlStr, allowlistDomains) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();

    // Block localhost, loopbacks, and private IP ranges
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }

    // Check private IPv4 patterns: 10.x.x.x, 192.168.x.x, 172.16-31.x.x, 169.254.x.x
    if (
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return false;
    }

    // Check allowlisted domain patterns
    const isAllowed = allowlistDomains.some((pattern) => {
      if (pattern.startsWith('*.')) {
        const root = pattern.slice(2);
        return host === root || host.endsWith('.' + root);
      }
      return host === pattern;
    });

    return isAllowed;
  } catch {
    return false;
  }
}

// Precomputed CRC-32 table
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

// Spec-compliant ZIP generation in Node buffer
function createZipBuffer(entries) {
  const localHeaders = [];
  const centralHeaders = [];
  let currentOffset = 0;

  for (const entry of entries) {
    const filenameBuf = Buffer.from(entry.filename, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = computeCrc32(dataBuf);
    const size = dataBuf.length;

    // Local file header (30 bytes + name + data)
    const local = Buffer.alloc(30 + filenameBuf.length + size);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed (2.0)
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(0, 8); // compression: 0 (Stored)
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14); // crc-32
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(filenameBuf.length, 26); // name length
    local.writeUInt16LE(0, 28); // extra field length
    filenameBuf.copy(local, 30);
    dataBuf.copy(local, 30 + filenameBuf.length);
    localHeaders.push(local);

    // Central directory header (46 bytes + name)
    const central = Buffer.alloc(46 + filenameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(filenameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(currentOffset, 42); // offset of local header
    filenameBuf.copy(central, 46);
    centralHeaders.push(central);

    currentOffset += local.length;
  }

  const centralOffset = currentOffset;
  let centralSize = 0;
  for (const c of centralHeaders) centralSize += c.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  const finalZip = Buffer.concat([...localHeaders, ...centralHeaders, eocd]);

  // Verify archive signature and count
  const eocdCheckOffset = finalZip.length - 22;
  if (finalZip.readUInt32LE(eocdCheckOffset) !== 0x06054b50) {
    throw new Error('Generated ZIP validation failed: EOCD signature mismatch.');
  }

  return finalZip;
}

function validateImageBuffer(buf) {
  if (!buf || buf.length === 0) {
    throw new Error('Downloaded image buffer is empty (0 bytes).');
  }

  // Reject HTML error pages
  const headStr = buf.slice(0, Math.min(buf.length, 128)).toString('utf8').trim().toLowerCase();
  if (
    headStr.startsWith('<!doctype html') ||
    headStr.startsWith('<html') ||
    headStr.startsWith('<?xml') ||
    headStr.startsWith('{"error"') ||
    headStr.startsWith('{"result":"error"')
  ) {
    throw new Error('Server returned HTML or text error response instead of an image.');
  }

  // Check magic bytes
  // PNG: 89 50 4E 47
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  // WebP: RIFF ... WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  // GIF: GIF87a or GIF89a
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return { mimeType: 'image/gif', extension: 'gif' };
  }

  // AVIF: offset 4 ftypavif
  if (buf.length >= 12) {
    const brand = buf.slice(4, 12).toString('ascii');
    if (brand.startsWith('ftypavif') || brand.startsWith('ftypavis')) {
      return { mimeType: 'image/avif', extension: 'avif' };
    }
  }

  return { mimeType: 'image/jpeg', extension: 'jpg' };
}

const ALLOWED_SOURCE_DOMAINS = [
  'mangadex.org',
  '*.mangadex.org',
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
];

const ALLOWED_IMAGE_DOMAINS = [
  '*.mangadex.network',
  '*.mangadex.org',
  'cdn.asurascans.com',
  '*.asurascans.com',
  '*.asuracomic.net',
  '*.asuracomics.com',
];

// MangaDex requires a dedicated honest User-Agent without browser spoofing
const MANGADEX_USER_AGENT = 'FolioScript/1.0.0 (contact@folioscript.app)';

const ASURA_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchMetadata(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new Error('Invalid URL provided.');
  }

  if (!isSsrfSafeUrl(targetUrl, ALLOWED_SOURCE_DOMAINS)) {
    throw new Error(`URL domain is not in the allowlist or is restricted: "${targetUrl}"`);
  }

  const parsed = new URL(targetUrl);
  const host = parsed.hostname.toLowerCase();

  if (host.includes('mangadex.org')) {
    // -------------------------------------------------------------
    // MangaDex Backend Fetcher
    // -------------------------------------------------------------
    const segments = parsed.pathname.split('/').filter(Boolean);
    const chIdx = segments.indexOf('chapter');
    if (chIdx === -1 || !segments[chIdx + 1]) {
      throw new Error('Invalid MangaDex chapter URL. Expected format: https://mangadex.org/chapter/{uuid}');
    }
    const chapterId = segments[chIdx + 1].toLowerCase();

    // 1. Fetch chapter metadata & relationships
    const metaRes = await fetch(`https://api.mangadex.org/chapter/${chapterId}?includes[]=manga`, {
      headers: {
        'User-Agent': MANGADEX_USER_AGENT,
        Accept: 'application/json',
      },
    });

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

    // 2. Fetch At-Home Server details
    const atHomeRes = await fetch(`https://api.mangadex.org/at-home/server/${chapterId}`, {
      headers: {
        'User-Agent': MANGADEX_USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!atHomeRes.ok) {
      throw new Error(`MangaDex At-Home server error (HTTP ${atHomeRes.status}).`);
    }

    const atHomeJson = await atHomeRes.json();
    if (atHomeJson.result === 'error' || !atHomeJson.chapter) {
      throw new Error('MangaDex At-Home server failed to provide image endpoints.');
    }

    const baseUrl = atHomeJson.baseUrl;
    const hash = atHomeJson.chapter.hash;
    // Section 6: Use original-quality data images by default. Do not silently substitute data-saver.
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
  } else {
    // -------------------------------------------------------------
    // Asura Scans Backend Fetcher
    // -------------------------------------------------------------
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': ASURA_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Asura chapter was not found at "${targetUrl}" (404).`);
      }
      throw new Error(`Asura Scans responded with HTTP ${res.status}.`);
    }

    const html = await res.text();

    // 1. Astro Island ChapterReader props parser
    const islandMatch =
      html.match(/<astro-island[^>]+opts=["'][^"']*ChapterReader[^"']*["'][^>]*props=(["'])([\s\S]*?)\1/i) ||
      html.match(/<astro-island[^>]+props=(["'])([\s\S]*?)\1[^>]*opts=["'][^"']*ChapterReader[^"']*["']/i) ||
      html.match(/<astro-island[^>]+component-url=["'][^"']*ChapterReader[^"']*["'][^>]*props=(["'])([\s\S]*?)\1/i) ||
      html.match(/<astro-island[^>]+props=(["'])([\s\S]*?)\1/i);

    if (islandMatch && islandMatch[2]) {
      const decodedJson = islandMatch[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      let parsedRaw;
      try {
        parsedRaw = JSON.parse(decodedJson);
      } catch (err) {
        console.warn('Failed parsing Asura astro props', err);
      }

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

        if (props.isLocked === true || props.isPremium === true) {
          throw new Error('This chapter is locked or premium on Asura Scans and cannot be retrieved.');
        }

        const rawPages = Array.isArray(props.pages) ? props.pages : [];
        if (rawPages.length > 0) {
          const pages = [];
          const seen = new Set();
          for (let i = 0; i < rawPages.length; i++) {
            const p = rawPages[i];
            const u = typeof p === 'string' ? p : p?.url;
            if (!u || seen.has(u)) continue;
            seen.add(u);

            const originalIndex = pages.length + 1;
            const ext = u.split('?')[0].split('.').pop()?.toLowerCase() || 'webp';
            pages.push({
              id: `asura-${props.chapterId || Date.now()}-${originalIndex}`,
              originalIndex,
              filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
              mimeType: ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp',
              extension: ext,
              sizeBytes: 0,
              imageUrl: u,
              downloadStatus: 'pending',
            });
          }

          return {
            metadata: {
              source: 'asura',
              sourceChapterId: String(props.chapterId || props.chapterNumber || 'asura-ch'),
              seriesTitle: props.seriesName || 'Asura Scans Series',
              chapterTitle: props.chapterTitle || undefined,
              chapterNumber: props.chapterNumber !== undefined ? String(props.chapterNumber) : undefined,
              sourceUrl: targetUrl,
              pageCount: pages.length,
            },
            pages,
          };
        }
      }
    }

    // 2. Fallback Classic HTML Reader Parser
    const readerAreaMatch =
      html.match(/<div[^>]+id=["']readerarea["'][^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]+class=["'][^"']*reading-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const container = readerAreaMatch ? readerAreaMatch[1] : html;

    const imgMatches = [...container.matchAll(/<img([^>]+)>/gi)];
    const pages = [];
    const seen = new Set();

    for (const match of imgMatches) {
      const attrs = match[1];
      const srcMatch =
        attrs.match(/(?:data-src|data-lazy-src|data-original)=["']([^"']+)["']/i) ||
        attrs.match(/src=["']([^"']+)["']/i);
      if (!srcMatch) continue;
      const rawUrl = srcMatch[1].trim();

      if (
        rawUrl.includes('/ads/') ||
        rawUrl.includes('/banners/') ||
        rawUrl.includes('logo') ||
        rawUrl.includes('avatar') ||
        rawUrl.includes('placeholder') ||
        rawUrl.endsWith('.svg')
      ) {
        continue;
      }

      let fullUrl = rawUrl;
      try {
        fullUrl = new URL(rawUrl, targetUrl).toString();
      } catch {}

      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);

      const originalIndex = pages.length + 1;
      const ext = fullUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'webp';
      pages.push({
        id: `asura-${Date.now()}-${originalIndex}`,
        originalIndex,
        filename: `${String(originalIndex).padStart(3, '0')}.${ext}`,
        mimeType: ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp',
        extension: ext,
        sizeBytes: 0,
        imageUrl: fullUrl,
        downloadStatus: 'pending',
      });
    }

    if (pages.length === 0) {
      throw new Error('Could not find chapter reader pages in the Asura Scans response.');
    }

    let seriesTitle = 'Asura Scans Series';
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) {
      seriesTitle = titleMatch[1].split(/Chapter|Ch\./i)[0].replace(/[|-].*$/, '').trim();
    }

    return {
      metadata: {
        source: 'asura',
        sourceChapterId: 'asura-chapter',
        seriesTitle,
        sourceUrl: targetUrl,
        pageCount: pages.length,
      },
      pages,
    };
  }
}

async function downloadPageImage(imageUrl, referer) {
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
  if (referer) {
    headers['Referer'] = referer;
  }

  let delay = 1000;
  let res = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(imageUrl, { headers });
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

  return {
    dataBase64: buf.toString('base64'),
    mimeType: valid.mimeType,
    extension: valid.extension,
    sizeBytes: buf.length,
  };
}

module.exports = {
  fetchMetadata,
  downloadPageImage,
  createZipBuffer,
  validateImageBuffer,
  isSsrfSafeUrl,
};
