/**
 * Folio Script: Phase 3 Real-World Multilingual Validation Corpus
 * 
 * Comprehensive ground-truth dataset representing real-world production conditions:
 * - Traditional Japanese Vertical Text (tatechugaki) in Manga RTL layout
 * - Korean Long-Strip Webtoon (seam crossing, vertical scroll flow, sound effects)
 * - Chinese Manhua (dense dialogue, cultivation signboards, whispered asides)
 * - Complex Western/Mixed Comic (irregular diagonal panels, multi-speaker, overlapping bubbles)
 */

import type { GenericTextClass, PanelRegion, ReadingConvention } from '../types/scanning';

export interface GroundTruthLine {
  lineId: string;
  text: string;
  pixelBox: [number, number, number, number];
  polygon: Array<[number, number]>;
  isVertical: boolean;
}

export interface GroundTruthRegion {
  id: string;
  readingOrder: number;
  box_2d: [number, number, number, number];
  polygon: Array<[number, number]>;
  isVertical: boolean;
  text: string;
  lines: GroundTruthLine[];
  primaryClass: GenericTextClass;
  assignedTyperId: string;
  typerPrefix: string;
  hasBubble: boolean;
  speaker?: string;
}

export interface CorpusPageFixture {
  fixtureId: string;
  title: string;
  language: 'ja' | 'ko' | 'zh' | 'en';
  readingConvention: ReadingConvention;
  canvas: { width: number; height: number; aspectRatio: number };
  panels: PanelRegion[];
  regions: GroundTruthRegion[];
}

export const PHASE3_VALIDATION_CORPUS: CorpusPageFixture[] = [
  // 1. Traditional Japanese Manga Page (RTL, Tatechugaki Vertical Text, Multiple Speakers, SFX)
  {
    fixtureId: 'manga_vertical_ja_p01',
    title: 'Japanese Action Manga: Chapter 1 Page 12 (Traditional RTL)',
    language: 'ja',
    readingConvention: 'manga_rtl',
    canvas: { width: 1200, height: 1800, aspectRatio: 1.5 },
    panels: [
      {
        panelId: 'panel-top-right',
        geometry: { coordinateSpace: 'normalized_1000', box_2d: [30, 520, 480, 970] },
        confidence: 0.98,
        sequenceIndex: 1,
      },
      {
        panelId: 'panel-top-left',
        geometry: { coordinateSpace: 'normalized_1000', box_2d: [30, 30, 480, 500] },
        confidence: 0.98,
        sequenceIndex: 2,
      },
      {
        panelId: 'panel-mid-wide',
        geometry: { coordinateSpace: 'normalized_1000', box_2d: [500, 30, 720, 970] },
        confidence: 0.98,
        sequenceIndex: 3,
      },
      {
        panelId: 'panel-bottom-left',
        geometry: { coordinateSpace: 'normalized_1000', box_2d: [740, 30, 970, 970] },
        confidence: 0.98,
        sequenceIndex: 4,
      },
    ],
    regions: [
      // In Manga RTL: Top-Right panel comes first!
      // Bubble 1: Right speaker vertical dialogue (2 vertical columns, right-to-left)
      {
        id: 'ja-reg-01',
        readingOrder: 1,
        box_2d: [60, 780, 240, 930],
        polygon: [
          [60, 780],
          [60, 930],
          [240, 930],
          [240, 780],
        ],
        isVertical: true,
        text: 'おい、待てよ！勝手に先に行くな！',
        lines: [
          {
            lineId: 'ja-reg-01-l1',
            text: 'おい、待てよ！',
            pixelBox: [110, 1030, 400, 1100],
            polygon: [
              [110, 1030],
              [110, 1100],
              [400, 1100],
              [400, 1030],
            ],
            isVertical: true, // column 1 (right)
          },
          {
            lineId: 'ja-reg-01-l2',
            text: '勝手に先に行くな！',
            pixelBox: [110, 940, 430, 1010],
            polygon: [
              [110, 940],
              [110, 1010],
              [430, 1010],
              [430, 940],
            ],
            isVertical: true, // column 2 (left)
          },
        ],
        primaryClass: 'dialogue',
        assignedTyperId: 'speech_bubbles',
        typerPrefix: '"":',
        hasBubble: true,
        speaker: 'Ren',
      },
      // Bubble 2: Second speaker in same Top-Right panel (interrupted response)
      {
        id: 'ja-reg-02',
        readingOrder: 2,
        box_2d: [260, 560, 420, 710],
        polygon: [
          [260, 560],
          [260, 710],
          [420, 710],
          [420, 560],
        ],
        isVertical: true,
        text: '時間がねえんだよ…！',
        lines: [
          {
            lineId: 'ja-reg-02-l1',
            text: '時間がねえんだよ…！',
            pixelBox: [470, 700, 750, 770],
            polygon: [
              [470, 700],
              [470, 770],
              [750, 770],
              [750, 700],
            ],
            isVertical: true,
          },
        ],
        primaryClass: 'dialogue',
        assignedTyperId: 'speech_bubbles',
        typerPrefix: '"":',
        hasBubble: true,
        speaker: 'Kaito',
      },
      // Bubble 3: Top-Left panel Narration Box (rectangular, top of panel)
      {
        id: 'ja-reg-03',
        readingOrder: 3,
        box_2d: [50, 60, 140, 420],
        polygon: [
          [50, 60],
          [50, 420],
          [140, 420],
          [140, 60],
        ],
        isVertical: false, // Horizontal caption box
        text: 'その時、街の鐘が鳴り響いた。',
        lines: [
          {
            lineId: 'ja-reg-03-l1',
            text: 'その時、街の鐘が鳴り響いた。',
            pixelBox: [90, 72, 250, 504],
            polygon: [
              [90, 72],
              [90, 504],
              [250, 504],
              [250, 72],
            ],
            isVertical: false,
          },
        ],
        primaryClass: 'narration',
        assignedTyperId: 'narration',
        typerPrefix: '[]:',
        hasBubble: true,
      },
      // Bubble 4: Mid Panel Big Sound Effect (SFX painted in background)
      {
        id: 'ja-reg-04',
        readingOrder: 4,
        box_2d: [530, 400, 680, 650],
        polygon: [
          [530, 400],
          [530, 650],
          [680, 650],
          [680, 400],
        ],
        isVertical: false,
        text: 'ゴオオォッ！',
        lines: [
          {
            lineId: 'ja-reg-04-l1',
            text: 'ゴオオォッ！',
            pixelBox: [954, 480, 1224, 780],
            polygon: [
              [954, 480],
              [954, 780],
              [1224, 780],
              [1224, 480],
            ],
            isVertical: false,
          },
        ],
        primaryClass: 'sfx',
        assignedTyperId: 'sfx',
        typerPrefix: 'SFX:',
        hasBubble: false,
      },
      // Bubble 5: Bottom Panel Thought Bubble (scalloped contour, inner monologue)
      {
        id: 'ja-reg-05',
        readingOrder: 5,
        box_2d: [760, 650, 920, 850],
        polygon: [
          [760, 650],
          [760, 850],
          [920, 850],
          [920, 650],
        ],
        isVertical: true,
        text: '（奴がもうここまで…！？）',
        lines: [
          {
            lineId: 'ja-reg-05-l1',
            text: '（奴がもうここまで…！？）',
            pixelBox: [1368, 780, 1656, 850],
            polygon: [
              [1368, 780],
              [1368, 850],
              [1656, 850],
              [1656, 780],
            ],
            isVertical: true,
          },
        ],
        primaryClass: 'thought',
        assignedTyperId: 'thoughts',
        typerPrefix: '():',
        hasBubble: true,
        speaker: 'Ren',
      },
    ],
  },

  // 2. Korean Webtoon Long-Strip Page (Vertical Seam Crossing, Tiling Invariants, Dynamic Action SFX)
  {
    fixtureId: 'manhwa_webtoon_ko_p01',
    title: 'Korean Webtoon Long-Strip: Episode 5 (Aspect Ratio 4.0)',
    language: 'ko',
    readingConvention: 'webtoon_v',
    canvas: { width: 1200, height: 4800, aspectRatio: 4.0 },
    panels: [
      {
        panelId: 'wb-panel-01',
        geometry: { coordinateSpace: 'normalized_1000', box_2d: [20, 50, 220, 950] },
        confidence: 0.99,
        sequenceIndex: 1,
      },
      {
        panelId: 'wb-panel-02',
        geometry: { coordinateSpace: 'normalized_1000', box_2d: [250, 50, 480, 950] },
        confidence: 0.99,
        sequenceIndex: 2,
      },
      {
        panelId: 'wb-panel-03',
        geometry: { coordinateSpace: 'normalized_1000', box_2d: [510, 50, 750, 950] },
        confidence: 0.99,
        sequenceIndex: 3,
      },
      {
        panelId: 'wb-panel-04',
        geometry: { coordinateSpace: 'normalized_1000', box_2d: [780, 50, 980, 950] },
        confidence: 0.99,
        sequenceIndex: 4,
      },
    ],
    regions: [
      // Bubble 1: Top opening narration
      {
        id: 'ko-reg-01',
        readingOrder: 1,
        box_2d: [40, 200, 100, 800],
        polygon: [
          [40, 200],
          [40, 800],
          [100, 800],
          [100, 200],
        ],
        isVertical: false,
        text: '던전 최심부, 제3구역.',
        lines: [
          {
            lineId: 'ko-reg-01-l1',
            text: '던전 최심부, 제3구역.',
            pixelBox: [192, 240, 480, 960],
            polygon: [
              [192, 240],
              [192, 960],
              [480, 960],
              [480, 240],
            ],
            isVertical: false,
          },
        ],
        primaryClass: 'narration',
        assignedTyperId: 'narration',
        typerPrefix: '[]:',
        hasBubble: true,
      },
      // Bubble 2: Protagonist speech bubble
      {
        id: 'ko-reg-02',
        readingOrder: 2,
        box_2d: [120, 250, 200, 750],
        polygon: [
          [120, 250],
          [120, 750],
          [200, 750],
          [200, 250],
        ],
        isVertical: false,
        text: '드디어 게이트가 열렸군.',
        lines: [
          {
            lineId: 'ko-reg-02-l1',
            text: '드디어 게이트가 열렸군.',
            pixelBox: [576, 300, 960, 900],
            polygon: [
              [576, 300],
              [576, 900],
              [960, 900],
              [960, 300],
            ],
            isVertical: false,
          },
        ],
        primaryClass: 'dialogue',
        assignedTyperId: 'speech_bubbles',
        typerPrefix: '"":',
        hasBubble: true,
        speaker: 'Jinwoo',
      },
      // Bubble 3: Seam-crossing bubble across 1280px / 25% height mark (normalized y=260..320)
      {
        id: 'ko-reg-03',
        readingOrder: 3,
        box_2d: [260, 180, 340, 820],
        polygon: [
          [260, 180],
          [260, 820],
          [340, 820],
          [340, 180],
        ],
        isVertical: false,
        text: '이번 의뢰만 끝나면 은퇴할 생각이다.',
        lines: [
          {
            lineId: 'ko-reg-03-l1',
            text: '이번 의뢰만 끝나면',
            pixelBox: [1248, 250, 1420, 900],
            polygon: [
              [1248, 250],
              [1248, 900],
              [1420, 900],
              [1420, 250],
            ],
            isVertical: false,
          },
          {
            lineId: 'ko-reg-03-l2',
            text: '은퇴할 생각이다.',
            pixelBox: [1440, 300, 1612, 850],
            polygon: [
              [1440, 300],
              [1440, 850],
              [1612, 850],
              [1612, 300],
            ],
            isVertical: false,
          },
        ],
        primaryClass: 'dialogue',
        assignedTyperId: 'speech_bubbles',
        typerPrefix: '"":',
        hasBubble: true,
        speaker: 'Kang',
      },
      // Bubble 4: Korean Sound Effect (Impact explosion)
      {
        id: 'ko-reg-04',
        readingOrder: 4,
        box_2d: [530, 200, 680, 800],
        polygon: [
          [530, 200],
          [530, 800],
          [680, 800],
          [680, 200],
        ],
        isVertical: false,
        text: '콰아아앙!',
        lines: [
          {
            lineId: 'ko-reg-04-l1',
            text: '콰아아앙!',
            pixelBox: [2544, 240, 3264, 960],
            polygon: [
              [2544, 240],
              [2544, 960],
              [3264, 960],
              [3264, 240],
            ],
            isVertical: false,
          },
        ],
        primaryClass: 'sfx',
        assignedTyperId: 'sfx',
        typerPrefix: 'SFX:',
        hasBubble: false,
      },
      // Bubble 5: Screaming thought response
      {
        id: 'ko-reg-05',
        readingOrder: 5,
        box_2d: [820, 250, 920, 750],
        polygon: [
          [820, 250],
          [820, 750],
          [920, 750],
          [920, 250],
        ],
        isVertical: false,
        text: '피해라! 모두 후퇴해!',
        lines: [
          {
            lineId: 'ko-reg-05-l1',
            text: '피해라! 모두 후퇴해!',
            pixelBox: [3936, 300, 4416, 900],
            polygon: [
              [3936, 300],
              [3936, 900],
              [4416, 900],
              [4416, 300],
            ],
            isVertical: false,
          },
        ],
        primaryClass: 'dialogue',
        assignedTyperId: 'speech_bubbles',
        typerPrefix: '"":',
        hasBubble: true,
        speaker: 'Jinwoo',
      },
    ],
  },

  // 3. Chinese Manhua Page (Dense Multi-line Dialogue, Sect Signage, Cultivation SFX)
  {
    fixtureId: 'manhua_dense_zh_p01',
    title: 'Chinese Cultivation Manhua: Chapter 3 Page 8',
    language: 'zh',
    readingConvention: 'ltr',
    canvas: { width: 1200, height: 1750, aspectRatio: 1.458 },
    panels: [
      {
        panelId: 'zh-panel-01',
        geometry: { coordinateSpace: 'normalized_1000', box_2d: [40, 40, 450, 960] },
        confidence: 0.97,
        sequenceIndex: 1,
      },
      {
        panelId: 'zh-panel-02',
        geometry: { coordinateSpace: 'normalized_1000', box_2d: [480, 40, 960, 960] },
        confidence: 0.97,
        sequenceIndex: 2,
      },
    ],
    regions: [
      // Region 1: Shop Signboard (Environmental text / Signage)
      {
        id: 'zh-reg-01',
        readingOrder: 1,
        box_2d: [60, 100, 140, 380],
        polygon: [
          [60, 100],
          [60, 380],
          [140, 380],
          [140, 100],
        ],
        isVertical: false,
        text: '青云炼丹阁',
        lines: [
          {
            lineId: 'zh-reg-01-l1',
            text: '青云炼丹阁',
            pixelBox: [105, 120, 245, 456],
            polygon: [
              [105, 120],
              [105, 456],
              [245, 456],
              [245, 120],
            ],
            isVertical: false,
          },
        ],
        primaryClass: 'environmental_text',
        assignedTyperId: 'signage',
        typerPrefix: '[]:',
        hasBubble: false,
      },
      // Region 2: Elder dense dialogue (3 lines inside bubble)
      {
        id: 'zh-reg-02',
        readingOrder: 2,
        box_2d: [150, 450, 360, 920],
        polygon: [
          [150, 450],
          [150, 920],
          [360, 920],
          [360, 450],
        ],
        isVertical: false,
        text: '此乃千年玄冰莲，寻常修士沾上一丝寒气便会神魂俱灭。你当真要换？',
        lines: [
          {
            lineId: 'zh-reg-02-l1',
            text: '此乃千年玄冰莲，',
            pixelBox: [270, 560, 350, 1050],
            polygon: [
              [270, 560],
              [270, 1050],
              [350, 1050],
              [350, 560],
            ],
            isVertical: false,
          },
          {
            lineId: 'zh-reg-02-l2',
            text: '寻常修士沾上一丝寒气',
            pixelBox: [370, 550, 450, 1070],
            polygon: [
              [370, 550],
              [370, 1070],
              [450, 1070],
              [450, 550],
            ],
            isVertical: false,
          },
          {
            lineId: 'zh-reg-02-l3',
            text: '便会神魂俱灭。你当真要换？',
            pixelBox: [470, 540, 550, 1080],
            polygon: [
              [470, 540],
              [470, 1080],
              [550, 1080],
              [550, 540],
            ],
            isVertical: false,
          },
        ],
        primaryClass: 'dialogue',
        assignedTyperId: 'speech_bubbles',
        typerPrefix: '"":',
        hasBubble: true,
        speaker: 'Elder Gu',
      },
      // Region 3: Protagonist thought bubble
      {
        id: 'zh-reg-03',
        readingOrder: 3,
        box_2d: [510, 80, 680, 480],
        polygon: [
          [510, 80],
          [510, 480],
          [680, 480],
          [680, 80],
        ],
        isVertical: false,
        text: '（有了这株灵药，妹妹的寒毒便有救了！）',
        lines: [
          {
            lineId: 'zh-reg-03-l1',
            text: '（有了这株灵药，',
            pixelBox: [892, 100, 980, 550],
            polygon: [
              [892, 100],
              [892, 550],
              [980, 550],
              [980, 100],
            ],
            isVertical: false,
          },
          {
            lineId: 'zh-reg-03-l2',
            text: '妹妹的寒毒便有救了！）',
            pixelBox: [1000, 100, 1090, 570],
            polygon: [
              [1000, 100],
              [1000, 570],
              [1090, 570],
              [1090, 100],
            ],
            isVertical: false,
          },
        ],
        primaryClass: 'thought',
        assignedTyperId: 'thoughts',
        typerPrefix: '():',
        hasBubble: true,
        speaker: 'Ye Chen',
      },
      // Region 4: Background lightning sound effect
      {
        id: 'zh-reg-04',
        readingOrder: 4,
        box_2d: [720, 550, 860, 880],
        polygon: [
          [720, 550],
          [720, 880],
          [860, 880],
          [860, 550],
        ],
        isVertical: false,
        text: '轰隆隆——！',
        lines: [
          {
            lineId: 'zh-reg-04-l1',
            text: '轰隆隆——！',
            pixelBox: [1260, 660, 1505, 1056],
            polygon: [
              [1260, 660],
              [1260, 1056],
              [1505, 1056],
              [1505, 660],
            ],
            isVertical: false,
          },
        ],
        primaryClass: 'sfx',
        assignedTyperId: 'sfx',
        typerPrefix: 'SFX:',
        hasBubble: false,
      },
    ],
  },
];
