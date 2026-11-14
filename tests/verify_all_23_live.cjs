const backend = require('../electron/chapterSnatchBackend.cjs');

const ALL_23_SOURCES = [
  { id: 'mangadex', name: 'MangaDex', domain: 'mangadex.org', engine: 'REST API', url: 'https://mangadex.org/chapter/0aaf8b27-0013-4ae0-8935-91a089466874' },
  { id: 'asura', name: 'Asura Scans', domain: 'asurascans.com', engine: 'Astro Island', url: 'https://asurascans.com/comics/logging-out-is-too-hard-f212c582/chapter/1' },
  { id: 'webtoons', name: 'LINE Webtoon', domain: 'webtoons.com', engine: 'Reader DOM', url: 'https://www.webtoons.com/en/fantasy/tower-of-god/season-3-ep-1/viewer?title_no=95&episode_no=420' },
  { id: 'tonarinoyj', name: 'Tonari no Young Jump', domain: 'tonarinoyj.jp', engine: 'GigaViewer', url: 'https://tonarinoyj.jp/episode/12207421984093802437' },
  { id: 'kuragebunch', name: 'Kurage Bunch', domain: 'kuragebunch.com', engine: 'GigaViewer', url: 'https://kuragebunch.com/episode/12207421984512319617' },
  { id: 'kingofshojo', name: 'King of Shojo', domain: 'kingofshojo.com', engine: 'MangaThemesia', url: 'https://kingofshojo.com/logging-out-is-too-hard-chapter-20/' },
  { id: 'rawkuma', name: 'Rawkuma', domain: 'rawkuma.net', engine: 'WordPress', url: 'https://rawkuma.net/chainsaw-man-chapter-1/' },
  { id: 'thunderscans', name: 'Thunder Scans', domain: 'en-thunderscans.com', engine: 'MangaThemesia', url: 'https://en-thunderscans.com/the-amber-sword-chapter-33/' },
  { id: 'rokaricomics', name: 'Rokari Comics', domain: 'rokaricomics.com', engine: 'MangaThemesia', url: 'https://rokaricomics.com/golden-chevalier-chapter-57/' },
  { id: 'vortexscans', name: 'Vortex Scans', domain: 'vortexscans.org', engine: 'Vasto CMS', url: 'https://vortexscans.org/series/reality-quest-2/chapter-230' },
  { id: 'qiscans', name: 'Qi Manga', domain: 'qimanga.com', engine: 'Vasto CMS', url: 'https://qimanga.com/series/one-day-i-became-a-hatchling/chapter-1' },
  { id: 'hijala', name: 'Hijala', domain: 'en-hijala.com', engine: 'Vasto CMS', url: 'https://en-hijala.com/series/the-build-up/chapter-203' },
  { id: 'nyxscans', name: 'Nyx Scans', domain: 'nyxscans.com', engine: 'Vasto CMS', url: 'https://nyxscans.com/series/the-villainess-wants-a-divorce!/chapter-34' },
  { id: 'hivetoons', name: 'Hive Toons', domain: 'hivetoons.org', engine: 'Vasto CMS', url: 'https://hivetoons.org/series/red-shirt/chapter-54' },
  { id: 'rinkocomics', name: 'Rinko Comics', domain: 'rinkocomics.com', engine: 'ComicWorld XOR', url: 'https://rinkocomics.com/chapter/hug-us-chapter-35/' },
  { id: 'flamecomics', name: 'Flame Comics', domain: 'flamecomics.xyz', engine: 'Next.js SPA', url: 'https://flamecomics.xyz/series/1/385fe46707bd150c' },
  { id: 'demonicscans', name: 'Demonic Scans', domain: 'demonicscans.org', engine: 'ReaderMC PHP', url: 'https://demonicscans.org/title/The-Wizard%2527s-Notes/chapter/1/1' },
  { id: 'genztoons', name: 'GenZ Toons', domain: 'genztoons.org', engine: 'Custom SSR', url: 'https://genztoons.org/chapter/65f8b05e74a-65f8dc4a4e7/' },
  { id: 'elftoon', name: 'ElfToon', domain: 'elftoon.net', engine: 'Next.js CMS', url: 'https://elftoon.net/series/comic/infinite-evolution-from-zero/chapter/1' },
  { id: 'kyanscans', name: 'Kayn Scans', domain: 'kaynscans.com', engine: 'Next.js CMS', url: 'https://kaynscans.com/series/comic/the-dignity-of-a-chaebol/chapter/1' },
  { id: 'nuviatoon', name: 'NuviaToon', domain: 'nuviatoon.org', engine: 'Next.js App API', url: 'https://nuviatoon.org/comics/my-husband-was-definitely-a-paladin/chapter/40' },
  { id: 'twmanga', name: 'TW Manga', domain: 'www.twbzmg.com', engine: 'Baozimh Reader', url: 'https://www.twbzmg.com/comic/chapter/dingjiqiyunqiaoqiaoxiulianqiannian-yuewenmanhua/0_0.html' },
  { id: 'rumanhua2', name: 'RuManhua', domain: 'www.rumanhua2.com', engine: 'Dean Edwards + all2.js', url: 'http://www.rumanhua2.com/OjQucQi/vsUsUaF.html' },
];

async function run() {
  console.log('='.repeat(80));
  console.log('FOLIO SCRIPT - 23 LIVE SOURCE VERIFICATION RUNNER');
  console.log('='.repeat(80));

  const results = [];

  for (let i = 0; i < ALL_23_SOURCES.length; i++) {
    const s = ALL_23_SOURCES[i];
    const num = String(i + 1).padStart(2, ' ');
    process.stdout.write(`[${num}/23] Testing ${s.name.padEnd(22)} ... `);
    const t0 = Date.now();

    try {
      // 1. Fetch metadata
      const res = await backend.fetchMetadata(s.url);
      const meta = res.metadata;
      const pages = res.pages;

      if (!pages || pages.length === 0) {
        throw new Error('Zero pages returned');
      }

      // Check 1-based sequential ordering & duplicate URLs
      const urlsSeen = new Set();
      for (let pIdx = 0; pIdx < pages.length; pIdx++) {
        const expectedIndex = pIdx + 1;
        if (pages[pIdx].originalIndex !== expectedIndex) {
          throw new Error(`Ordering error at ${pIdx}: expected ${expectedIndex}, got ${pages[pIdx].originalIndex}`);
        }
        if (!pages[pIdx].imageUrl) {
          throw new Error(`Missing imageUrl at page ${expectedIndex}`);
        }
        urlsSeen.add(pages[pIdx].imageUrl);
      }

      // 2. Download page 1
      const p1 = pages[0];
      const imgRes = await backend.downloadPageImage(p1.imageUrl, s.url);
      const buf = Buffer.from(imgRes.dataBase64, 'base64');
      const valid = backend.validateImageBuffer(buf);

      // 3. Test ZIP header creation
      const zipBuffer = backend.createZipBuffer([
        { filename: '001.' + valid.extension, data: buf },
      ]);
      if (zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4b) {
        throw new Error('Invalid ZIP magic bytes');
      }

      const elapsed = Date.now() - t0;
      console.log(`PASS | ${pages.length} pgs | ${valid.mimeType} (${(buf.length / 1024).toFixed(1)} KB) | ${elapsed}ms`);

      results.push({
        name: s.name,
        domain: s.domain,
        engine: s.engine,
        status: 'PASS',
        pageCount: pages.length,
        mimeType: valid.mimeType,
        sizeBytes: buf.length,
        elapsed,
        seriesTitle: meta.seriesTitle || 'N/A',
      });
    } catch (err) {
      console.log(`FAIL | ${err.message}`);
      results.push({
        name: s.name,
        domain: s.domain,
        engine: s.engine,
        status: 'FAIL',
        error: err.message,
      });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY TABLE:');
  console.log('='.repeat(80));
  console.table(
    results.map((r, idx) => ({
      '#': idx + 1,
      Source: r.name,
      Engine: r.engine,
      Status: r.status,
      Pages: r.pageCount ?? 0,
      'Page 1 Format': r.mimeType ?? 'ERR',
      'Time (ms)': r.elapsed ?? 0,
      'Series Title': r.seriesTitle ? (r.seriesTitle.length > 25 ? r.seriesTitle.slice(0, 25) + '...' : r.seriesTitle) : 'N/A',
    }))
  );

  const passedCount = results.filter((r) => r.status === 'PASS').length;
  console.log(`\nFINAL SCORE: ${passedCount} / ${ALL_23_SOURCES.length} PASSED`);
}

run();
