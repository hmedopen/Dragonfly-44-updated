import test from 'node:test';
import assert from 'node:assert/strict';

import { sourceRegistry } from '../core/sourceRegistry';
import { GigaViewerDriver } from '../drivers/gigaviewerDriver';
import { MangaThemesiaDriver } from '../drivers/mangathemesiaDriver';
import { MadaraDriver } from '../drivers/madaraDriver';
import { WebtoonsAdapter } from '../sources/webtoonsAdapter';
import {
  isSsrfSafeUrl,
  ALLOWED_SOURCE_DOMAINS,
  ALLOWED_IMAGE_DOMAINS,
} from '../../../../electron/chapterSnatchBackend.cjs';

// =========================================================================
// SECTION 1: CATALOGUE URL RECOGNITION & SOURCE RESOLUTION
// =========================================================================

test('SourceRegistry recognizes Korean platforms', () => {
  // Webtoons
  const webtoons = sourceRegistry.resolve('https://www.webtoons.com/en/fantasy/tower-of-god/viewer?title_no=95&episode_no=1');
  assert.equal(webtoons.adapter.id, 'webtoons');
  assert.equal(webtoons.info.sourceChapterId, '95-1');

  // Naver (Restricted)
  const naver = sourceRegistry.resolve('https://comic.naver.com/webtoon/detail?titleId=183559&no=1');
  assert.equal(naver.adapter.id, 'naver-webtoon');

  // Kakao (Restricted)
  const kakao = sourceRegistry.resolve('https://page.kakao.com/content/12345/viewer/67890');
  assert.equal(kakao.adapter.id, 'kakaopage');
});

test('SourceRegistry recognizes Chinese platforms', () => {
  // Tencent Comic (Restricted)
  const qq = sourceRegistry.resolve('https://ac.qq.com/ComicView/index/id/505430/cid/1');
  assert.equal(qq.adapter.id, 'tencent-comic');

  // Kuaikan (Restricted)
  const kuaikan = sourceRegistry.resolve('https://kuaikanmanhua.com/web/comic/12345/');
  assert.equal(kuaikan.adapter.id, 'kuaikan');
});

test('SourceRegistry recognizes Japanese Raw manga platforms', () => {
  // Tonari no Young Jump (GigaViewer)
  const tonari = sourceRegistry.resolve('https://tonarinoyj.jp/episode/13933686331619391000');
  assert.equal(tonari.adapter.id, 'tonarinoyj');
  assert.equal(tonari.info.sourceChapterId, '13933686331619391000');

  // Shonen Jump+ (GigaViewer)
  const sj = sourceRegistry.resolve('https://shonenjumpplus.com/episode/17106371896173044034');
  assert.equal(sj.adapter.id, 'shonenjumpplus');
  assert.equal(sj.info.sourceChapterId, '17106371896173044034');

  // Kurage Bunch (GigaViewer)
  const kurage = sourceRegistry.resolve('https://kuragebunch.com/episode/10834108156630452392');
  assert.equal(kurage.adapter.id, 'kuragebunch');
  assert.equal(kurage.info.sourceChapterId, '10834108156630452392');

  // Comic Walker (Restricted)
  const cw = sourceRegistry.resolve('https://comic-walker.com/contents/detail/KDCW_FS01000001010000_68/');
  assert.equal(cw.adapter.id, 'comic-walker');
});

test('SourceRegistry recognizes MangaThemesia family sources', () => {
  const targets = [
    { url: 'https://kingofshojo.com/series-name-chapter-1/', id: 'kingofshojo' },
    { url: 'https://rawkuma.net/manga/one-piece/chapter-1100/', id: 'rawkuma' },
    { url: 'https://en-thunderscans.com/series/title/chapter-5/', id: 'thunderscans' },
    { url: 'https://qiscans.com/manga/test-series/chapter-10/', id: 'qiscans' },
    { url: 'https://vortexscans.org/series/vortex-manga/chapter-1/', id: 'vortexscans' },
    { url: 'https://rinkocomics.com/manga/rinko/chapter-2/', id: 'rinkocomics' },
    { url: 'https://flamecomics.xyz/series/flame-series/chapter-50/', id: 'flamecomics' },
    { url: 'https://demonicscans.org/manga/demonic-title/chapter-3/', id: 'demonicscans' },
  ];

  for (const t of targets) {
    const res = sourceRegistry.resolve(t.url);
    assert.equal(res.adapter.id, t.id, `Failed for ${t.url}`);
    assert.ok(res.info.sourceChapterId, `Missing chapter ID for ${t.url}`);
  }
});

test('SourceRegistry recognizes Madara family sources', () => {
  const targets = [
    { url: 'https://genztoons.com/manga/genz-series/chapter-1/', id: 'genztoons' },
    { url: 'https://elftoon.com/manga/elf-manga/chapter-12/', id: 'elftoon' },
    { url: 'https://en-hijala.com/manga/hijala-series/chapter-4/', id: 'hijala' },
    { url: 'https://kyanscans.com/manga/kyan-series/chapter-7/', id: 'kyanscans' },
    { url: 'https://nuviatoon.com/manga/nuvia-title/chapter-2/', id: 'nuviatoon' },
    { url: 'https://nyxscans.com/manga/nyx-title/chapter-1/', id: 'nyxscans' },
    { url: 'https://rokaricomics.com/manga/rokari-title/chapter-15/', id: 'rokaricomics' },
    { url: 'https://hivetoons.org/manga/hive-series/chapter-8/', id: 'hivetoons' },
    { url: 'https://twmanga.com/manga/tw-series/chapter-9/', id: 'twmanga' },
    { url: 'https://rumanhua2.com/manga/ru-series/chapter-1/', id: 'rumanhua2' },
  ];

  for (const t of targets) {
    const res = sourceRegistry.resolve(t.url);
    assert.equal(res.adapter.id, t.id, `Failed for ${t.url}`);
    assert.ok(res.info.sourceChapterId, `Missing chapter ID for ${t.url}`);
  }
});

// =========================================================================
// SECTION 2: WEBTOONS ADAPTER VERIFICATION
// =========================================================================

test('WebtoonsAdapter parses html with data-url and requires Referer', async () => {
  const adapter = new WebtoonsAdapter();

  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Tower of God - Ep. 1</title>
      </head>
      <body>
        <div class="header">
          <a class="subj" href="...">Tower of God</a>
          <h1 class="subj_episode">Ep. 1 - Ball</h1>
        </div>
        <div id="_imageList" class="viewer_img">
          <img src="placeholder.jpg" data-url="https://webtoon-phinf.pstatic.net/20200101_1/1.jpg" alt="1" />
          <img src="placeholder.jpg" data-url="https://webtoon-phinf.pstatic.net/20200101_1/2.jpg" alt="2" />
          <img src="placeholder.jpg" data-url="https://webtoon-phinf.pstatic.net/20200101_1/3.jpg" alt="3" />
        </div>
      </body>
    </html>
  `;

  const info = adapter.resolve('https://www.webtoons.com/en/fantasy/tower-of-god/viewer?title_no=95&episode_no=1');
  const manifest = adapter.parseHtml(sampleHtml, info);

  assert.equal(manifest.metadata.source, 'webtoons');
  assert.equal(manifest.metadata.seriesTitle, 'Tower of God');
  assert.equal(manifest.metadata.chapterTitle, 'Ep. 1 - Ball');
  assert.equal(manifest.metadata.chapterNumber, '1');
  assert.equal(manifest.pages.length, 3);
  assert.equal(manifest.pages[0].imageUrl, 'https://webtoon-phinf.pstatic.net/20200101_1/1.jpg');
  assert.equal(manifest.pages[0].filename, '001.jpg');

  // Verify headers mandate Referer
  const headers = adapter.getImageHeaders(manifest.pages[0].imageUrl);
  assert.equal(headers.Referer, 'https://www.webtoons.com/');
});

test('WebtoonsAdapter rejects malformed Webtoons URLs missing title_no or episode_no', () => {
  const adapter = new WebtoonsAdapter();
  assert.throws(
    () => adapter.resolve('https://www.webtoons.com/en/fantasy/tower-of-god/viewer'),
    /Missing title_no/
  );
  assert.throws(
    () => adapter.resolve('https://www.webtoons.com/en/fantasy/tower-of-god/viewer?title_no=95'),
    /Missing episode_no/
  );
});

// =========================================================================
// SECTION 3: GIGAVIEWER DRIVER VERIFICATION
// =========================================================================

test('GigaViewerDriver parses readableProduct JSON and filters main pages', () => {
  const driver = new GigaViewerDriver({
    id: 'tonarinoyj',
    name: 'Tonari no Young Jump',
    domain: 'tonarinoyj.jp',
  });

  const sampleJson = {
    readableProduct: {
      title: 'Episode 1: The Strongest Man',
      number: 1,
      series: {
        title: 'One-Punch Man',
      },
      pageStructure: {
        pages: [
          { type: 'main', src: 'https://cdn-img.tonarinoyj.jp/public/page/1.jpg' },
          { type: 'blank' },
          { type: 'main', src: 'https://cdn-img.tonarinoyj.jp/public/page/2.jpg' },
          { type: 'ad', src: 'https://cdn-img.tonarinoyj.jp/ad.jpg' },
          { type: 'main', src: 'https://cdn-img.tonarinoyj.jp/public/page/3.jpg' },
        ],
      },
    },
  };

  const info = driver.resolve('https://tonarinoyj.jp/episode/13933686331619391000');
  const manifest = driver.parseGigaViewerJson(sampleJson, info);

  assert.equal(manifest.metadata.source, 'tonarinoyj');
  assert.equal(manifest.metadata.seriesTitle, 'One-Punch Man');
  assert.equal(manifest.metadata.chapterTitle, 'Episode 1: The Strongest Man');
  assert.equal(manifest.metadata.chapterNumber, '1');
  assert.equal(manifest.pages.length, 3);
  assert.equal(manifest.pages[0].imageUrl, 'https://cdn-img.tonarinoyj.jp/public/page/1.jpg');
  assert.equal(manifest.pages[0].filename, '001.jpg');
  assert.equal(manifest.pages[1].imageUrl, 'https://cdn-img.tonarinoyj.jp/public/page/2.jpg');
  assert.equal(manifest.pages[2].imageUrl, 'https://cdn-img.tonarinoyj.jp/public/page/3.jpg');

  // Verify headers include Referer
  const headers = driver.getImageHeaders(manifest.pages[0].imageUrl);
  assert.equal(headers.Referer, 'https://tonarinoyj.jp/');
});

test('GigaViewerDriver handles restricted episode error 400', async () => {
  const driver = new GigaViewerDriver({
    id: 'shonenjumpplus',
    name: 'Shonen Jump+',
    domain: 'shonenjumpplus.com',
  });

  const mockFetch = async () => {
    return new Response(JSON.stringify({ error: { message: 'wrong feature' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const info = driver.resolve('https://shonenjumpplus.com/episode/17106371896173044034');
  await assert.rejects(
    () => driver.fetchManifest(info, mockFetch as any),
    /GigaViewer: Episode "17106371896173044034" is restricted on Shonen Jump\+ \(wrong feature\)/
  );
});

// =========================================================================
// SECTION 4: MANGATHEMESIA DRIVER VERIFICATION
// =========================================================================

test('MangaThemesiaDriver extracts images from ts_reader.run JSON payload', () => {
  const driver = new MangaThemesiaDriver({
    id: 'kingofshojo',
    name: 'King of Shojo',
    domain: 'kingofshojo.com',
  });

  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Great Doctor Ling Ran Chapter 1 - King of Shojo</title>
      </head>
      <body>
        <h1 class="entry-title">Great Doctor Ling Ran Chapter 1</h1>
        <script>
          ts_reader.run({
            "prevUrl": "",
            "nextUrl": "https://kingofshojo.com/chapter-2/",
            "sources": [
              {
                "source": "Default",
                "images": [
                  "https://kingofshojo.com/wp-content/uploads/001.webp",
                  "https://kingofshojo.com/wp-content/uploads/002.webp",
                  "https://kingofshojo.com/wp-content/uploads/003.webp"
                ]
              }
            ]
          });
        </script>
      </body>
    </html>
  `;

  const info = driver.resolve('https://kingofshojo.com/great-doctor-ling-ran-chapter-1/');
  const manifest = driver.parseHtml(sampleHtml, info);

  assert.equal(manifest.metadata.source, 'kingofshojo');
  assert.equal(manifest.metadata.seriesTitle, 'Great Doctor Ling Ran');
  assert.equal(manifest.metadata.chapterNumber, '1');
  assert.equal(manifest.pages.length, 3);
  assert.equal(manifest.pages[0].imageUrl, 'https://kingofshojo.com/wp-content/uploads/001.webp');
  assert.equal(manifest.pages[0].filename, '001.webp');

  const headers = driver.getImageHeaders(manifest.pages[0].imageUrl);
  assert.equal(headers.Referer, 'https://kingofshojo.com/');
});

test('MangaThemesiaDriver falls back to #readerarea and excludes banners/ads', () => {
  const driver = new MangaThemesiaDriver({
    id: 'rawkuma',
    name: 'Rawkuma',
    domain: 'rawkuma.net',
  });

  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>One Piece Chapter 1100 - Rawkuma</title>
      </head>
      <body>
        <h1 class="entry-title">One Piece Chapter 1100</h1>
        <div id="readerarea">
          <img src="https://rawkuma.net/ads/banner1.jpg" alt="Ad" />
          <img src="https://rawkuma.net/wp-content/uploads/op_01.jpg" alt="p1" />
          <img src="https://rawkuma.net/wp-content/uploads/op_02.jpg" alt="p2" />
          <img src="https://rawkuma.net/logo.svg" alt="logo" />
        </div>
      </body>
    </html>
  `;

  const info = driver.resolve('https://rawkuma.net/manga/one-piece/chapter-1100/');
  const manifest = driver.parseHtml(sampleHtml, info);

  assert.equal(manifest.pages.length, 2);
  assert.equal(manifest.pages[0].imageUrl, 'https://rawkuma.net/wp-content/uploads/op_01.jpg');
  assert.equal(manifest.pages[1].imageUrl, 'https://rawkuma.net/wp-content/uploads/op_02.jpg');
  assert.equal(manifest.metadata.chapterNumber, '1100');
});

// =========================================================================
// SECTION 5: MADARA DRIVER VERIFICATION
// =========================================================================

test('MadaraDriver parses reading-content images and attributes', () => {
  const driver = new MadaraDriver({
    id: 'genztoons',
    name: 'GenZ Toons',
    domain: 'genztoons.com',
  });

  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Solo Leveling - Chapter 150</title>
      </head>
      <body>
        <h1 id="chapter-heading">Solo Leveling - Chapter 150</h1>
        <div class="reading-content">
          <img class="wp-manga-chapter-img" data-src="https://genztoons.com/wp-content/uploads/sl_01.webp" />
          <img class="wp-manga-chapter-img" data-lazy-src="https://genztoons.com/wp-content/uploads/sl_02.webp" />
          <img class="wp-manga-chapter-img" src="https://genztoons.com/wp-content/uploads/sl_03.webp" />
        </div>
      </body>
    </html>
  `;

  const info = driver.resolve('https://genztoons.com/manga/solo-leveling/chapter-150/');
  const manifest = driver.parseHtml(sampleHtml, info);

  assert.equal(manifest.metadata.source, 'genztoons');
  assert.equal(manifest.metadata.chapterNumber, '150');
  assert.equal(manifest.pages.length, 3);
  assert.equal(manifest.pages[0].imageUrl, 'https://genztoons.com/wp-content/uploads/sl_01.webp');
  assert.equal(manifest.pages[1].imageUrl, 'https://genztoons.com/wp-content/uploads/sl_02.webp');
  assert.equal(manifest.pages[2].imageUrl, 'https://genztoons.com/wp-content/uploads/sl_03.webp');

  const headers = driver.getImageHeaders(manifest.pages[0].imageUrl);
  assert.equal(headers.Referer, 'https://genztoons.com/');
});

// =========================================================================
// SECTION 6: RESTRICTED PLATFORMS HONEST ERROR REPORTING
// =========================================================================

test('Restricted platforms cleanly report exact restrictions without bypassing DRM/auth', async () => {
  const restrictedCases = [
    {
      url: 'https://comic.naver.com/webtoon/detail?titleId=183559&no=1',
      expectedKeyword: 'Naver account session',
    },
    {
      url: 'https://page.kakao.com/content/12345/viewer/67890',
      expectedKeyword: 'Kakao OAuth authorization tokens',
    },
    {
      url: 'https://ac.qq.com/ComicView/index/id/505430/cid/1',
      expectedKeyword: 'QQ user authentication',
    },
    {
      url: 'https://kuaikanmanhua.com/web/comic/12345/',
      expectedKeyword: 'mobile app API tokens',
    },
    {
      url: 'https://tappytoon.com/en/book/sample-title/1',
      expectedKeyword: 'tokenized DRM image encryption',
    },
    {
      url: 'https://comic-walker.com/contents/detail/KDCW_FS01000001010000_68/',
      expectedKeyword: 'SpeedBinb',
    },
  ];

  for (const c of restrictedCases) {
    const { adapter, info } = sourceRegistry.resolve(c.url);
    await assert.rejects(
      () => adapter.fetchManifest(info),
      (err: any) => {
        assert.ok(err.message.includes('Access Restricted'));
        assert.ok(err.message.includes(c.expectedKeyword), `Expected "${c.expectedKeyword}" in "${err.message}"`);
        return true;
      }
    );
  }
});

// =========================================================================
// SECTION 7: BACKEND ALLOWLISTS & SSRF SAFEGUARDS
// =========================================================================

test('Backend ALLOWED_SOURCE_DOMAINS and ALLOWED_IMAGE_DOMAINS cover the catalogue', () => {
  // Verify source domains
  assert.ok(isSsrfSafeUrl('https://www.webtoons.com/en/fantasy/viewer', ALLOWED_SOURCE_DOMAINS));
  assert.ok(isSsrfSafeUrl('https://tonarinoyj.jp/episode/123.json', ALLOWED_SOURCE_DOMAINS));
  assert.ok(isSsrfSafeUrl('https://kingofshojo.com/chapter-1/', ALLOWED_SOURCE_DOMAINS));
  assert.ok(isSsrfSafeUrl('https://rawkuma.net/ch/1/', ALLOWED_SOURCE_DOMAINS));
  assert.ok(isSsrfSafeUrl('https://genztoons.com/ch/1/', ALLOWED_SOURCE_DOMAINS));

  // Verify image domains
  assert.ok(isSsrfSafeUrl('https://webtoon-phinf.pstatic.net/2020/image.jpg', ALLOWED_IMAGE_DOMAINS));
  assert.ok(isSsrfSafeUrl('https://cdn-img.tonarinoyj.jp/public/1.jpg', ALLOWED_IMAGE_DOMAINS));
  assert.ok(isSsrfSafeUrl('https://kingofshojo.com/wp-content/1.webp', ALLOWED_IMAGE_DOMAINS));

  // SSRF guard still rejects internal, loopback, private, or unauthorized domains
  assert.equal(isSsrfSafeUrl('http://127.0.0.1/test.jpg', ALLOWED_IMAGE_DOMAINS), false);
  assert.equal(isSsrfSafeUrl('http://169.254.169.254/latest/meta-data', ALLOWED_SOURCE_DOMAINS), false);
  assert.equal(isSsrfSafeUrl('https://malicious-site.com/image.jpg', ALLOWED_IMAGE_DOMAINS), false);
  assert.equal(isSsrfSafeUrl('http://[::1]/secret', ALLOWED_SOURCE_DOMAINS), false);
});
