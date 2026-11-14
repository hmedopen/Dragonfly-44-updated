const backend = require('../electron/chapterSnatchBackend.cjs');

async function testCompleteAcquisition(name, url) {
  console.log(`\n============================================================`);
  console.log(`TESTING COMPLETE CHAPTER ACQUISITION: ${name}`);
  console.log(`URL: ${url}`);
  console.log(`============================================================`);

  const t0 = Date.now();
  const res = await backend.fetchMetadata(url);
  const meta = res.metadata;
  const pages = res.pages;

  console.log(`Series: ${meta.seriesTitle}`);
  console.log(`Chapter: ${meta.chapterTitle || 'N/A'} (#${meta.chapterNumber || 'N/A'})`);
  console.log(`Total Pages: ${pages.length}`);

  const pageEntries = [];
  const urlsSeen = new Set();

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const expected = i + 1;
    if (p.originalIndex !== expected) {
      throw new Error(`Page index gap: expected ${expected}, got ${p.originalIndex}`);
    }
    if (urlsSeen.has(p.imageUrl)) {
      throw new Error(`Duplicate page image URL detected: ${p.imageUrl}`);
    }
    urlsSeen.add(p.imageUrl);

    const pt0 = Date.now();
    const imgRes = await backend.downloadPageImage(p.imageUrl, url);
    const buf = Buffer.from(imgRes.dataBase64, 'base64');
    const valid = backend.validateImageBuffer(buf);

    if (buf.length === 0) {
      throw new Error(`Empty buffer on page ${expected}`);
    }

    pageEntries.push({
      filename: `${String(expected).padStart(3, '0')}.${valid.extension}`,
      data: buf,
    });

    console.log(`  Page ${String(expected).padStart(2, '0')}/${pages.length}: ${valid.mimeType} (${(buf.length / 1024).toFixed(1)} KB) in ${Date.now() - pt0}ms`);
  }

  // Pack into full ZIP
  const zipBuf = backend.createZipBuffer(pageEntries);
  if (zipBuf[0] !== 0x50 || zipBuf[1] !== 0x4b) {
    throw new Error('ZIP header signature validation failed');
  }

  const totalBytes = pageEntries.reduce((acc, p) => acc + p.data.length, 0);
  console.log(`\n[SUCCESS] Full chapter acquired: ${pages.length} pages, ${(totalBytes / 1024 / 1024).toFixed(2)} MB, ZIP size: ${(zipBuf.length / 1024 / 1024).toFixed(2)} MB in ${Date.now() - t0}ms`);
  return true;
}

async function run() {
  // Test complete download on TW Manga (6 pages) and NuviaToon (12 pages)
  await testCompleteAcquisition('TW Manga (Baozimh)', 'https://www.twbzmg.com/comic/chapter/dingjiqiyunqiaoqiaoxiulianqiannian-yuewenmanhua/0_0.html');
  await testCompleteAcquisition('NuviaToon', 'https://nuviatoon.org/comics/my-husband-was-definitely-a-paladin/chapter/40');
}

run().catch(console.error);
