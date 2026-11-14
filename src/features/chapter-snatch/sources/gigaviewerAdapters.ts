import { GigaViewerDriver } from '../drivers/gigaviewerDriver';

export const tonariNoYoungJumpAdapter = new GigaViewerDriver({
  id: 'tonarinoyj',
  name: 'Tonari no Young Jump',
  domain: 'tonarinoyj.jp',
  imageDomains: ['cdn-img.tonarinoyj.jp'],
});

export const shonenJumpPlusAdapter = new GigaViewerDriver({
  id: 'shonenjumpplus',
  name: 'Shonen Jump+',
  domain: 'shonenjumpplus.com',
  imageDomains: ['cdn-img.shonenjumpplus.com'],
});

export const kurageBunchAdapter = new GigaViewerDriver({
  id: 'kuragebunch',
  name: 'Kurage Bunch',
  domain: 'kuragebunch.com',
  imageDomains: ['cdn-img.kuragebunch.com'],
});
