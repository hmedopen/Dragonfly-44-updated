# Local OCR Validation Corpus Provenance

This directory defines the Phase 1.1 multilingual image-backed validation suite for Folio Script's local OCR foundation. No third-party binary comic images are committed into the Git repository; instead, verified open-licensed fixtures are downloaded on demand into the external cache directory (`%TEMP%\folio-script-validation-cache` on Windows or `$TMPDIR/folio-script-validation-cache`, overridable via `FOLIO_OCR_VALIDATION_CACHE_DIR`) and validated against pinned SHA-256 checksums before execution.

## License and Attribution

All 10 image fixtures in [multilingualValidationCorpus.json](multilingualValidationCorpus.json) come from **Pepper&Carrot** by **David Revoy** (<https://www.peppercarrot.com/>), licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)**.

Language-specific lettering and translation credits belong to the respective Pepper&Carrot community translators listed in each episode's upstream SVG layer on Framagit (`svgSourceUrl`).

## Ground-Truth Methodology

1. **Text transcripts**: Extracted from the canonical Pepper&Carrot comic pages and checked against the upstream Inkscape SVG dialogue sources (`svgSourceUrl`), preserving original punctuation, line breaks, and mixed-script spans (e.g., `60Ko*`, `2:00 AM`, `WWW.PEPPERCARROT.COM 2014년 5월`).
2. **Coordinates (`box_2d`)**: Verified directly against the rendered low-resolution JPEG/PNG images converted at native dimensions (`1200x1660` for standard pages and `1200x5291` for the vertical webtoon strip `E01XXL_kr`) and expressed in Folio Script's normalized `[ymin, xmin, ymax, xmax]` `0..1000` coordinate space.
3. **Speech bubble vs. caption/SFX labels (`hasBubble`)**: Assigned independently from visual inspection of each page (`hasBubble: true` for enclosed speech/thought balloons; `hasBubble: false` for location headers, footers, titles, and bare/painted SFX).

## Fixture Manifest (10 Pages, 49 Regions)

| Fixture ID | Lang | Route ID | Convention | Dimensions | Regions | SHA-256 (source JPEG) |
| --- | --- | --- | --- | --- | --- | --- |
| `peppercarrot_E03P01_en` | `en` | `en_ppocrv6_small` | `ltr` | `1200x1660` | 5 | `9e75470c8065b95ef65f4b4431f21b4db9ffeebb0c1836280bd59c1b32bffbed` |
| `peppercarrot_E04P01_en` | `en` | `en_ppocrv6_small` | `ltr` | `1200x1660` | 4 | `d033675b2117fc02e03ffc115c74481a8c4b55a3ef210e6a4b0c1f85f7581930` |
| `peppercarrot_E03P01_kr` | `ko` | `ko_ppocrv5_mobile` | `ltr` | `1200x1660` | 5 | `7b179f647b173da4dcae8eefecf396cf1fecde412bed3c0abafcc243d363809a` |
| `peppercarrot_E04P01_kr` | `ko` | `ko_ppocrv5_mobile` | `ltr` | `1200x1660` | 4 | `ab493bbaace01e961ff59f16e0868f8866b08554c2921c1e2a42ca6ec375f8f8` |
| `peppercarrot_E01XXL_kr` | `ko` | `ko_ppocrv5_mobile` | `webtoon_v` | `1200x5291` | 8 | `80fe4da3478b549bc301575dd54766e46059eead9d30500979680d1100913c3d` |
| `peppercarrot_E03P01_ja` | `ja` | `ja_zh_ppocrv6_manga` | `ltr` | `1200x1660` | 5 | `f538aeb90f39c787b16fe08d2278dfd39fdfeffa4683bfe5c6e90eed88e015ef` |
| `peppercarrot_E04P01_ja` | `ja` | `ja_zh_ppocrv6_manga` | `ltr` | `1200x1660` | 4 | `2ba94c233d18fc9aaa738da29f725328082174fdcda59d982df39a849f4aacdb` |
| `peppercarrot_E01P01_ja` | `ja` | `ja_zh_ppocrv6_manga` | `ltr` | `1200x1660` | 5 | `3bef9922e09cea66ab12271da0070025768ae9bc5d286f41ced617468131267e` |
| `peppercarrot_E03P01_cn` | `zh` | `ja_zh_ppocrv6_manga` | `ltr` | `1200x1660` | 5 | `9754fc0c9c5f5350b6213a46ea50dc50cfb02f7e424dea5f3a4f51b2da12cf54` |
| `peppercarrot_E04P01_cn` | `zh` | `ja_zh_ppocrv6_manga` | `ltr` | `1200x1660` | 4 | `43c23244b160f0e4cfdb21c502a61dc4dc05c2e037c02c48212b3c5121817cc1` |

### Exact Upstream URLs

- `peppercarrot_E03P01_en`: `https://www.peppercarrot.com/0_sources/ep03_The-secret-ingredients/low-res/en_Pepper-and-Carrot_by-David-Revoy_E03P01.jpg` (SVG: `https://framagit.org/peppercarrot/webcomics/-/raw/master/ep03_The-secret-ingredients/lang/en/E03P01.svg`)
- `peppercarrot_E04P01_en`: `https://www.peppercarrot.com/0_sources/ep04_Stroke-of-genius/low-res/en_Pepper-and-Carrot_by-David-Revoy_E04P01.jpg` (SVG: `https://framagit.org/peppercarrot/webcomics/-/raw/master/ep04_Stroke-of-genius/lang/en/E04P01.svg`)
- `peppercarrot_E03P01_kr`: `https://www.peppercarrot.com/0_sources/ep03_The-secret-ingredients/low-res/kr_Pepper-and-Carrot_by-David-Revoy_E03P01.jpg` (SVG: `https://framagit.org/peppercarrot/webcomics/-/raw/master/ep03_The-secret-ingredients/lang/kr/E03P01.svg`)
- `peppercarrot_E04P01_kr`: `https://www.peppercarrot.com/0_sources/ep04_Stroke-of-genius/low-res/kr_Pepper-and-Carrot_by-David-Revoy_E04P01.jpg` (SVG: `https://framagit.org/peppercarrot/webcomics/-/raw/master/ep04_Stroke-of-genius/lang/kr/E04P01.svg`)
- `peppercarrot_E01XXL_kr`: `https://www.peppercarrot.com/0_sources/ep01_Potion-of-Flight/low-res/single-page/kr_Pepper-and-Carrot_by-David-Revoy_E01XXL.jpg` (SVG dir: `https://framagit.org/peppercarrot/webcomics/-/tree/master/ep01_Potion-of-Flight/lang/kr`)
- `peppercarrot_E03P01_ja`: `https://www.peppercarrot.com/0_sources/ep03_The-secret-ingredients/low-res/ja_Pepper-and-Carrot_by-David-Revoy_E03P01.jpg` (SVG: `https://framagit.org/peppercarrot/webcomics/-/raw/master/ep03_The-secret-ingredients/lang/ja/E03P01.svg`)
- `peppercarrot_E04P01_ja`: `https://www.peppercarrot.com/0_sources/ep04_Stroke-of-genius/low-res/ja_Pepper-and-Carrot_by-David-Revoy_E04P01.jpg` (SVG: `https://framagit.org/peppercarrot/webcomics/-/raw/master/ep04_Stroke-of-genius/lang/ja/E04P01.svg`)
- `peppercarrot_E01P01_ja`: `https://www.peppercarrot.com/0_sources/ep01_Potion-of-Flight/low-res/ja_Pepper-and-Carrot_by-David-Revoy_E01P01.jpg` (SVG: `https://framagit.org/peppercarrot/webcomics/-/raw/master/ep01_Potion-of-Flight/lang/ja/E01P01.svg`)
- `peppercarrot_E03P01_cn`: `https://www.peppercarrot.com/0_sources/ep03_The-secret-ingredients/low-res/cn_Pepper-and-Carrot_by-David-Revoy_E03P01.jpg` (SVG: `https://framagit.org/peppercarrot/webcomics/-/raw/master/ep03_The-secret-ingredients/lang/cn/E03P01.svg`)
- `peppercarrot_E04P01_cn`: `https://www.peppercarrot.com/0_sources/ep04_Stroke-of-genius/low-res/cn_Pepper-and-Carrot_by-David-Revoy_E04P01.jpg` (SVG: `https://framagit.org/peppercarrot/webcomics/-/raw/master/ep04_Stroke-of-genius/lang/cn/E04P01.svg`)

## Documented Coverage Limitations

- **No open-licensed traditional vertical-text Japanese manga fixture**: Pepper&Carrot Japanese pages typeset dialogue horizontally inside LTR panels rather than traditional vertical RTL columns. A candidate CC0 Wikimedia Commons manga sample (`Manga_page_publicdomainq.png`) was inspected and excluded because it depicts an inkwell and pen over blank panels with no dialogue.
- **Japanese/Korean handwritten SFX & stylized headers**: `peppercarrot_E01P01_ja` includes painted SFX (`ぱらぱら`, `ざぶん`, `どばどば`) and `peppercarrot_E01XXL_kr` includes a stylized brush title (`후추와 당근`), intentionally testing out-of-bubble and stylized lettering limits without filtering them out.
- **No external network access assumed if cache populated**: Running `npm run validate:local-ocr` offline succeeds once `.jpg` and `.png` files are present in `FOLIO_OCR_VALIDATION_CACHE_DIR` with valid SHA-256 digests.
