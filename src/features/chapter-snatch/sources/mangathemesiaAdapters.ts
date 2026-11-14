import { MangaThemesiaDriver } from '../drivers/mangathemesiaDriver';
import { VastoDriver } from '../drivers/vastoDriver';
import { NextSpaDriver } from '../drivers/nextSpaDriver';
import { rinkoComicsAdapter } from '../drivers/comicWorldDriver';
import { demonicScansAdapter } from '../drivers/demonicDriver';

export { rinkoComicsAdapter, demonicScansAdapter };

export const kingOfShojoAdapter = new MangaThemesiaDriver({
  id: 'kingofshojo',
  name: 'King of Shojo',
  domain: 'kingofshojo.com',
  imageDomains: ['kingofshojo.com', '*.kingofshojo.com'],
});

export const rawkumaAdapter = new MangaThemesiaDriver({
  id: 'rawkuma',
  name: 'Rawkuma',
  domain: 'rawkuma.net',
  extraDomains: ['rawkuma.com'],
  imageDomains: ['rawkuma.net', '*.rawkuma.net', 'cdn.rawkuma.com'],
});

export const thunderScansAdapter = new MangaThemesiaDriver({
  id: 'thunderscans',
  name: 'Thunder Scans',
  domain: 'en-thunderscans.com',
  extraDomains: ['thunderscans.com'],
  imageDomains: ['en-thunderscans.com', '*.en-thunderscans.com'],
});

export const qiScansAdapter = new VastoDriver({
  id: 'qiscans',
  name: 'Qi Manga',
  domain: 'qimanga.com',
  extraDomains: ['qiscans.com'],
  imageDomains: ['media.qimanga.com', '*.qimanga.com'],
});

export const vortexScansAdapter = new VastoDriver({
  id: 'vortexscans',
  name: 'Vortex Scans',
  domain: 'vortexscans.org',
  imageDomains: ['storage.vortexscans.org', '*.vortexscans.org'],
});

export const flameComicsAdapter = new NextSpaDriver({
  id: 'flamecomics',
  name: 'Flame Comics',
  domain: 'flamecomics.xyz',
  flavor: 'flame',
  extraDomains: ['flamecomics.com', 'flamescans.org'],
  imageDomains: ['cdn.flamecomics.xyz', '*.flamecomics.xyz'],
});
