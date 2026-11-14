import { MangaThemesiaDriver } from '../drivers/mangathemesiaDriver';
import { VastoDriver } from '../drivers/vastoDriver';
import { NextSpaDriver } from '../drivers/nextSpaDriver';
import { twMangaAdapter } from '../drivers/baozimhDriver';
import { ruManhua2Adapter } from '../drivers/rumanhuaDriver';

export { twMangaAdapter, ruManhua2Adapter };

export const genZToonsAdapter = new NextSpaDriver({
  id: 'genztoons',
  name: 'GenZ Toons',
  domain: 'genztoons.org',
  flavor: 'genz',
  extraDomains: ['genztoons.com', 'genzupdates.com'],
  imageDomains: ['cdn.meowing.org'],
});

export const elfToonAdapter = new NextSpaDriver({
  id: 'elftoon',
  name: 'ElfToon',
  domain: 'elftoon.net',
  flavor: 'elfkayn',
  extraDomains: ['elftoon.com'],
  imageDomains: ['elftoon.net', '*.elftoon.net'],
});

export const hijalaAdapter = new VastoDriver({
  id: 'hijala',
  name: 'Hijala',
  domain: 'en-hijala.com',
  extraDomains: ['hijala.com'],
  imageDomains: ['storage.en-hijala.com', '*.en-hijala.com'],
});

export const kyanScansAdapter = new NextSpaDriver({
  id: 'kyanscans',
  name: 'Kayn Scans',
  domain: 'kaynscans.com',
  flavor: 'elfkayn',
  extraDomains: ['kyanscans.com', 'kaynscan.org', 'kaynscan.com'],
  imageDomains: ['kaynscans.com', 'kaynscan.org'],
});

export const nuviaToonAdapter = new NextSpaDriver({
  id: 'nuviatoon',
  name: 'Nuvia Toon',
  domain: 'nuviatoon.org',
  flavor: 'nuvia',
  extraDomains: ['nuviatoon.com'],
  imageDomains: [
    'nuviatoon.a57a9ab619b3f91ead3c71426d0451c6.r2.cloudflarestorage.com',
    'media.nuviatoon.org',
  ],
});

export const nyxScansAdapter = new VastoDriver({
  id: 'nyxscans',
  name: 'Nyx Scans',
  domain: 'nyxscans.com',
  imageDomains: ['storage.nyxscans.com', 'storage.nyxscans.org', '*.nyxscans.com'],
});

export const rokariComicsAdapter = new MangaThemesiaDriver({
  id: 'rokaricomics',
  name: 'Rokari Comics',
  domain: 'rokaricomics.com',
  imageDomains: ['rokaricomics.com', '*.rokaricomics.com'],
});

export const hiveToonsAdapter = new VastoDriver({
  id: 'hivetoons',
  name: 'Hive Toons',
  domain: 'hivetoons.org',
  extraDomains: ['hivetoon.com'],
  imageDomains: ['storage.hivetoon.com', '*.hivetoons.org'],
});
