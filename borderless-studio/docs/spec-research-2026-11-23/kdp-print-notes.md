# KDP print rules: research notes

Research date: 2026-11-23. Scope: Amazon KDP paperback and hardcover (print) rules, taken only from official Amazon pages.
Structured data with a source URL and a verbatim quote for every value: `facts.json` in this folder.

## How the data was collected

- 86 KDP help topics fetched from `https://kdp.amazon.com/en_US/help/topic/<id>`; 54 of them are quoted in facts.json. Plain text of each is in `pages/<id>.txt` (first line = URL), raw HTML in `raw/`.
- Three official Amazon tools were queried the way their own pages do it, with no login: the cover calculator (60 runs), its template generator (3 templates) and the printing cost and royalty calculator (64 runs plus its specification data). Their outputs are saved as `pages/cover-calculator*.txt`, `pages/cover-template-*.txt` and `pages/royalty-calculator*.txt`.
- facts.json holds 842 source/quote pairs. Each quote was cut by script from the saved page text and re-checked after the file was written; none failed.
- Values that are not printed on a help page but read from a tool are marked `"verified": "derived_from_official_tool"`. Values not found anywhere official are marked `"verified": false` with a note.
- No help page used carries a "last updated" date, so the table at the end has none to report.
- To re-check later: `python3 -I scripts/build_facts.py` rebuilds facts.json from the saved pages and re-verifies every quote; `scripts/fetch.py`, `scripts/calc_batch.py`, `scripts/royalty_batch.py` and `scripts/template.py` refetch the sources.

## Starting values: verdict

| Starting value | Official page today | Match |
|---|---|---|
| inside (gutter) margin 0.375 in for 24 to 150 pages | "24 to 150 pages \| 0.375" in (9.6 mm) \| at least 0.25 in (6.4 mm) \| at least 0.375 in (9.6 mm)" | yes |
| inside margin 0.5 in for 151 to 300 pages | "151 to 300 pages \| 0.5 in (12.7 mm) \| at least 0.25 in (6.4 mm) \| at least 0.375 in (9.6 mm)" | yes |
| inside margin 0.625 in for 301 to 500 pages | "301 to 500 pages \| 0.625 in (15.9 mm) \| at least 0.25 in (6.4 mm) \| at least 0.375 in (9.6 mm)" | yes |
| inside margin 0.75 in for 501 to 700 pages | "501 to 700 pages \| 0.75 in (19.1 mm) \| at least 0.25 in (6.4 mm) \| at least 0.375 in (9.6 mm)" | yes |
| inside margin 0.875 in for 701 to 828 pages | "701 to 828 pages \| 0.875 in (22.3 mm) \| at least 0.25 in (6.4 mm) \| at least 0.375 in (9.6 mm)" | yes |
| outside margins 0.25 in without bleed | "The top, bottom, and outside margins must be a minimum of 0.25 inches for books without bleed and 0.375 inches (9.6mm) for books with bleed." | yes |
| outside margins 0.375 in with bleed | "The top, bottom, and outside margins must be a minimum of 0.25 inches for books without bleed and 0.375 inches (9.6mm) for books with bleed." | yes |
| bleed 0.125 in | "When a book is printed, all pages are trimmed to the selected trim size by cutting 0.125" (3.2 mm) from the top, bottom, and outside edges." | yes |
| spine per page 0.002252 in, white paper | "- White paper: page count x 0.002252" (0.0572 mm)" | yes |
| spine per page 0.0025 in, cream paper | "- Cream paper: page count x 0.0025" (0.0635 mm)" | yes |
| spine per page 0.002347 in, premium colour | "- Premium Color paper: page count x 0.002347" (0.0596 mm)" | yes |
| spine text needs at least 79 pages | "Note: To include spine text, your book must have at least 79 pages." | partly |

All margin, bleed and spine numbers match. Two additions the starting list lacks: standard colour spine 0.002252 in per page and groundwood spine 0.00235 in per page.
Spine text: the pages say "at least 79 pages", "more than 79 pages" and, for Cover Creator and Cover Studio, 80 pages. KDP rounds the page count up to an even number, so 80 is the working minimum.

## Key numbers

**Interior margins (paperback and hardcover), minimum**

| Pages | Inside (gutter) | Outside, no bleed | Outside, with bleed |
|---|---|---|---|
| 24 to 150 | 0.375 in | 0.25 in | 0.375 in |
| 151 to 300 | 0.5 in | 0.25 in | 0.375 in |
| 301 to 500 | 0.625 in | 0.25 in | 0.375 in |
| 501 to 700 | 0.75 in | 0.25 in | 0.375 in |
| 701 to 828 | 0.875 in | 0.25 in | 0.375 in |

"Outside" means top, bottom and the outer side. Bleed is 0.125 in on top, bottom and outside only, so a bleed page is trim width + 0.125 in by trim height + 0.25 in. Bleed needs a PDF, and one bleed page makes the whole file a bleed file.

**Paperback cover**

- Spine width per page: white 0.002252 in, cream 0.0025 in, groundwood 0.00235 in, premium colour 0.002347 in, standard colour 0.002252 in.
- Cover width = 2 x trim width + spine + 0.25 in; cover height = trim height + 0.25 in (0.125 in bleed on every side).
- Text at least 0.125 in inside the trim line (0.25 in from the file edge); spine text at least 0.0625 in from each spine edge.
- Barcode: KDP adds one if the cover has none, in a 2 x 1.2 in white box, lower right of the back cover. On the official template the box sits 0.25 in from the spine fold and 0.25 in above the bottom trim line.

**Hardcover cover (case laminate). Read from the official calculator, not printed on a help page**

- Spine = pages x paper thickness + 4.8 mm (0.189 in); thickness as for paperback (white 0.002252, cream 0.0025, premium colour 0.002347 in).
- Cover width = 2 x 15 mm wrap + 2 x (trim width + 5 mm) + spine; cover height = trim height + 6 mm + 2 x 15 mm. Hinge 10 mm each side of the spine, inside the cover width.
- 75 to 550 pages, five trim sizes, no standard colour, no groundwood, not on Amazon.co.jp.

**Printing cost = fixed cost + pages x per-page cost** (regular trim; large trim in brackets; large = wider than 6.12 in or taller than 9 in)

| Paperback | Amazon.com (USD) | Amazon.com.au (AUD) |
|---|---|---|
| Black ink, white or cream, short book | 2.30 flat (2.84) up to 108 pages | 4.74 flat (5.28) up to 106 pages |
| Black ink, white or cream, longer | 1.00 + 0.012 x pages (0.017) from 110 pages | 2.42 + 0.022 x pages (0.027) from 108 pages |
| Groundwood, short book (page says up to 112 pages; calculator up to 108, AU 106) | 2.23 flat (2.75) | 4.62 flat (5.14) |
| Groundwood, longer | 1.00 + 0.0114 x pages (0.0162) | 2.42 + 0.0209 x pages (0.0257) |
| Premium colour, 24 to 40 pages | 3.60 flat (4.20) | 5.82 flat (6.42) |
| Premium colour, 42 pages and up | 1.00 + 0.065 x pages (0.08) | 2.42 + 0.085 x pages (0.100) |
| Standard colour, 72 to 600 pages | 1.00 + 0.0255 x pages (0.0402) | not offered |

Hardcover on Amazon.com: 6.80 flat (7.49) for 75 to 108 pages, then 5.65 + 0.012 x pages (0.017); premium colour 5.65 + 0.065 x pages (0.080). No hardcover on Amazon.com.au.
All eight marketplace rows (US, CA, UK, EUR group, PL, SE, AU, JP) are in facts.json. The official calculator returned 772 marketplace costs in my runs and the help tables reproduce every one.

**Royalty = rate x tax-exclusive list price - printing cost**

| Marketplace | 50% at or below | 60% at or above |
|---|---|---|
| Amazon.com | 9.98 USD | 9.99 USD |
| Amazon.de / Amazon.fr / Amazon.it / Amazon.es / Amazon.nl / Amazon.ie / Amazon.com.be | 9.98 EUR | 9.99 EUR |
| Amazon.co.uk | 7.98 GBP | 7.99 GBP |
| Amazon.ca | 13.98 CAD | 13.99 CAD |
| Amazon.com.au | 13.98 AUD | 13.99 AUD |
| Amazon.co.jp | 999 JPY | 1000 JPY |
| Amazon.pl | 39 PLN | 40 PLN |
| Amazon.se | 109 SEK | 110 SEK |

Paperback table shown; hardcover is identical except Amazon.se (see contradictions). Expanded Distribution pays 40% and is paperback only.
Minimum list price = printing cost / rate, enforced by KDP, so the lowest price earns about zero. Maximum: 250 USD, 250 EUR, 250 GBP, 350 CAD, 350 AUD, 30,000 JPY, 1,200 PLN, 2,500 SEK.
List prices are entered without tax. Amazon adds VAT in the UK and EU (reduced and standard rates per country are in facts.json), 10% consumption tax in Japan and "the applicable GST" in Australia.

**Languages.** 47 languages listed; 39 allow paperback, 38 allow hardcover, 8 are eBook only. **Bengali (Bangla) is not on the list at all**, and the Indian-language page says paperback publishing for Indian languages is not available.

## Surprises

1. **New paper type: groundwood.** Black ink only, 45 lb (60 GSM), about 5% cheaper per page, its own spine multiplier (0.00235) and its own page maximums (812 / 784 / 764 / 578). Paper can be switched between white, cream and groundwood after publishing; ink type and trim size cannot.
2. **Several topic IDs in the brief now hold other content.** G201857950 is Paperback Submission Guidelines; G201834170 is "What is an ISBN and Imprint?"; G201834230 is manuscript templates; G201834180 is Print Options (trim sizes and page counts, no margins); the margins live on GVBQ3CMEQW3W2VL6; Expanded Distribution is GQTT4W3T5AYK7L45 (GH4MVPMZ6ZHWB6U5 returns 404).
3. **The Print Options page is broken.** Its kdp.amazon.com paperback table shows only the 5 x 8 in row, in every language version. The full table is on two other pages.
4. **The hardcover cover help page disagrees with Amazon's own calculator** on wrap and barcode distances (0.51 in vs 15 mm). Size hardcover covers from the calculator.
5. **Weekly limits:** 2 new titles created and 2 first-time submissions per format per week, resetting Sunday 00:00 UTC.
6. **Page-count bands in the cost tables overlap** ("24-110" and "110-828"). The calculator switches to the per-page formula at exactly 110 pages (108 on Amazon.com.au), and it is a hard switch, not "whichever is higher".
7. **Transparency codes are retired** for books created after November 2025.
8. **Imprint rules are strict:** with an own ISBN the imprint must match the agency record exactly (case and trailing spaces count), limit 100 characters; a mismatch blocks publishing.
9. **Tool configuration contains a switched-off "Dust Jacket" hardcover option.** No help page announces it; the help text says dust jackets are not available. Recorded as an observation only.
10. **A stale "Hardcover (Beta) - Pricing & Royalties" page is still online** with old numbers (fixed 60%, 5.50 USD). Ignore it.
11. Proof copies: up to 5 per order, "Not for Resale" watermark, no ISBN barcode. Author copies: up to 999, at printing cost plus shipping, no royalty, no free shipping.
12. File limits: 650 MB for interior and cover (40 MB recommended for covers); PDF/X-1a preferred; no more than 4 blank pages in a row at the start or middle and 10 at the end.

## Contradictions between official sources

- **C01 Print Options page: paperback trim table is truncated.** On the Print Options page the kdp.amazon.com paperback table currently contains only the 5 x 8 in row (the hardcover rows follow immediately). The same defect is present in every locale of that page. The full 16-size table is on 'Set Trim Size, Bleed, and Margins' and on 'Paperback Submission Guidelines'. *Use:* Use the tables from the trim-size page / submission guidelines.
- **C02 Premium colour maximum page count at 8.27 x 11.69 in (A4).** Help tables for kdp.amazon.com say 24-590; the kdp.amazon.co.jp table on the same pages says 24-780; the official royalty calculator accepts 780 and rejects 782. *Use:* Unresolved. 590 is the safe limit for premium colour A4 until verified in the KDP title-setup screen.
- **C03 Minimum page count for spine text: 79, more than 79, or 80.** *Use:* 80 pages (page counts are always even).
- **C04 Spine shift tolerance typo.** 0.0125 in is printed next to 3.2 mm; 3.2 mm is 0.125 in. *Use:* 0.125 in (3.2 mm).
- **C05 Hardcover wrap, text safe distance and barcode distance: help page vs calculator/template.** The hardcover cover help page prints wrap 0.51 in (15 mm), text 0.635 in (16 mm) from the edge and barcode at least 0.76 in (19 mm) from the bottom. 0.51 in is 13 mm, not 15 mm. The official calculator and template use a 15 mm (0.591 in) wrap, a live area starting 0.7156 in from the cover-file edge, and a barcode box whose bottom edge is 0.375 in above the cover (board) edge = 0.966 in above the bottom of the file. The inch figures on the help page are consistent with an older 0.51 in wrap (0.51 + 0.125 = 0.635; 0.51 + 0.25 = 0.76). *Use:* Calculator/template values (15 mm wrap, 10 mm hinge); they are what KDP's own template generator outputs today. Always size a hardcover cover from the calculator.
- **C06 Royalty threshold on Amazon.se.** *Use:* Paperback: 110 SEK (two sources agree). Hardcover: unresolved (99 vs 110).
- **C07 Printing-cost page-count bands overlap at the boundary (black ink).** The page prints '24-110 pages' for fixed-only and '110-828 pages' for the formula (and '24-108' for Amazon.com.au). The calculator charges the formula at exactly 110 pages (108 on AU). *Use:* Fixed-only through 108 pages (106 on AU); formula from 110 pages (108 on AU). The money difference at the boundary is 2 cents or less.
- **C08 Groundwood fixed-cost band: help page 24-112 vs calculator 24-108.** *Use:* Unresolved for 110 and 112 pages (2.23 flat per the page vs 2.254 / 2.2768 per the calculator). Use the higher figure to stay safe.
- **C09 Does trim size affect printing cost?.** The printing-cost pages and tables price regular and large trim differently, but three other pages still say trim size does not affect printing cost. *Use:* Trim class (regular/large) does affect cost; the calculator confirms it.
- **C10 Standard colour on Amazon.co.jp and for right-to-left books.** *Use:* Unresolved; treat standard colour as not reliably available for Japan/RTL.
- **C11 Standard-colour marketplaces.** The Color Ink Options page omits Amazon.nl, Amazon.pl and Amazon.se from the standard-colour marketplace list, but the printing-cost table has standard-colour rows for the EUR group including .nl, for Amazon.pl and for Amazon.se. Both agree that Amazon.com.au has no standard colour. *Use:* Follow the printing-cost table (more recent structure, matches the calculator).
- **C12 Colour spine multiplier on the Submission Guidelines page.** Submission Guidelines gives one 'Color paper' multiplier; Create a Paperback Cover separates premium (0.002347) and standard (0.002252). The Color Ink Options page also says both share the same cover sizing. *Use:* Standard colour 0.002252, premium colour 0.002347 (calculator agrees).
- **C13 Colour profile advice for covers.** *Use:* CMYK images without relying on an embedded profile; profiles are stripped anyway.
- **C14 Page-count limits shown by the cover calculator form.** The cover calculator form allows paperback 24-830 and hardcover 76-550; the help pages and the royalty calculator use 24-828 and 75-550 (830 is rejected by the royalty calculator, 75 accepted). *Use:* 828 maximum for paperback; hardcover 75 minimum (76 after rounding to even).
- **C15 Stale hardcover beta pricing page still online.** *Use:* Ignore the beta page.
- **C16 Cover Creator accepted image formats.** *Use:* Not relevant when uploading a print-ready PDF.
- **C17 Which languages may be uploaded as PDF.** *Use:* The first sentence appears to concern eBooks (it lists MOBI/ePub); for print the second applies. Not confirmed by an explicit statement.
- **C18 Hardcover royalty table lists marketplaces where hardcover is not sold directly.** *Use:* Hardcover marketplaces are those in the hardcover printing-cost table (US, UK, EUR group, PL, SE) plus Canada through Amazon.com enrolment.

## Items I could NOT verify on an official page

- **Date from which the current printing-cost tables apply** (not verified). No date, 'effective' or 'last updated' text on the Paperback Printing Cost or Hardcover Printing Cost page (raw HTML scanned). Not found on the help home announcements either.
- **Date of the 50%/60% royalty change (given to me as 10 June 2025)** (not verified). Current tiered state is confirmed; the date itself appears on no fetched official page.
- **Announced future change to printing cost or royalty** (not verified). None found on any fetched page; the royalty calculator returns only 'current' pricing. kdpcommunity.com (official forum) is a JavaScript app and could not be read from this sandbox.
- **GST rate Amazon applies to PRINT books on Amazon.com.au** (not verified). Print pages say only 'the applicable GST'. The 10% figure is printed only for eBooks (page G202169970).
- **Whether list prices on Amazon.com and Amazon.ca include any tax, and which rate** (not verified). Not mentioned on the print pricing, royalty or tax pages. General rule on the pricing page: list price is entered excluding tax.
- **Hardcover spine-width formula** (derived from an official tool, not printed on a help page). Not printed on any help page. pages x paper thickness + 4.8 mm reproduces all saved outputs of the official cover calculator.
- **Hardcover wrap/safe-zone/barcode distances** (derived from an official tool, not printed on a help page). Help page figures conflict with the calculator and template (contradiction C05).
- **Exact position of the barcode KDP places on a paperback** (derived from an official tool, not printed on a help page). Help text says only 'lower right-hand corner' and '.25 in from the spine and trim' for own barcodes; the 0.25 in offsets for KDP's box were measured on the official template PDF.
- **Premium colour maximum pages at 8.27 x 11.69 in (590 or 780)** (not verified). Contradiction C02.
- **Hardcover 60% royalty threshold on Amazon.se (99 or 110 SEK)** (not verified). Contradiction C06.
- **Groundwood printing cost for 110 and 112 pages (flat vs formula)** (not verified). Contradiction C08.
- **Standard colour availability on Amazon.co.jp and for right-to-left books** (not verified). Contradiction C10.
- **Minimum list price formula under Expanded Distribution** (not verified). Pages say only that the minimum 'will be different'; the 40% arithmetic is not printed.
- **Colour space (RGB vs CMYK) required for interior files** (not verified). No statement for interiors on any fetched page; CMYK guidance exists only for covers.
- **Minimum page count for spine text on hardcover** (not verified). Not stated on the hardcover cover page; the 79-page rule is written on paperback pages and generic checklists.
- **What happens to a paperback uploaded in a language not on the supported list (e.g. Bengali)** (not verified). Bengali is not on the list. The page describes rejection/removal only for eBooks and for a language-selection mismatch.
- **Japanese-language help site (kdp.amazon.co.jp/ja_JP)** (not verified). Only the English pages (which carry the kdp.amazon.co.jp tables) were read.
- **Which VAT rate (reduced or standard) Amazon applies to a particular book** (not verified). The page gives both rates per country and says the rate depends on book type and customer location.
- **Rounding rule for spine width / cover size** (not verified). Not stated; the calculator displays 3 decimals in inches and 2 in millimetres.

## Pages fetched

None of these pages shows a "last updated" date.

### Quoted in facts.json

| Topic ID | Title | URL |
|---|---|---|
| G200641280 | Price Your Book | https://kdp.amazon.com/en_US/help/topic/G200641280 |
| G200673300 | Book Supported Languages | https://kdp.amazon.com/en_US/help/topic/G200673300 |
| G200735480 | KDP Tools and Resources | https://kdp.amazon.com/en_US/help/topic/G200735480 |
| G200736410 | Update your book details | https://kdp.amazon.com/en_US/help/topic/G200736410 |
| G201113520 | Cover Creator | https://kdp.amazon.com/en_US/help/topic/G201113520 |
| G201274690 | Tax Withholding | https://kdp.amazon.com/en_US/help/topic/G201274690 |
| G201834170 | What is an ISBN and Imprint? | https://kdp.amazon.com/en_US/help/topic/G201834170 |
| G201834180 | Print Options | https://kdp.amazon.com/en_US/help/topic/G201834180 |
| G201834230 | Paperback and Hardcover Manuscript Templates | https://kdp.amazon.com/en_US/help/topic/G201834230 |
| G201834260 | Fix Paperback and Hardcover Formatting Issues | https://kdp.amazon.com/en_US/help/topic/G201834260 |
| G201834280 | Paperback and Hardcover Distribution Rights | https://kdp.amazon.com/en_US/help/topic/G201834280 |
| G201834330 | Paperback Royalty | https://kdp.amazon.com/en_US/help/topic/G201834330 |
| G201834340 | Paperback Printing Cost | https://kdp.amazon.com/en_US/help/topic/G201834340 |
| G201849770 | Setting Prices for Amazon Japan | https://kdp.amazon.com/en_US/help/topic/G201849770 |
| G201857950 | Paperback Submission Guidelines | https://kdp.amazon.com/en_US/help/topic/G201857950 |
| G201953020 | Create a Paperback Cover | https://kdp.amazon.com/en_US/help/topic/G201953020 |
| G202124400 | Indian-Language Publishing | https://kdp.amazon.com/en_US/help/topic/G202124400 |
| G202145060 | Save Your Manuscript File | https://kdp.amazon.com/en_US/help/topic/G202145060 |
| G202145450 | Paperback Fonts | https://kdp.amazon.com/en_US/help/topic/G202145450 |
| G202169030 | Format Images in Your Book | https://kdp.amazon.com/en_US/help/topic/G202169030 |
| G202169970 | Goods and Services Tax (GST) for eBooks in Australia and India | https://kdp.amazon.com/en_US/help/topic/G202169970 |
| G202172740 | Create a Book | https://kdp.amazon.com/en_US/help/topic/G202172740 |
| G202173620 | Timelines | https://kdp.amazon.com/en_US/help/topic/G202173620 |
| G202176900 | Update Your Manuscript | https://kdp.amazon.com/en_US/help/topic/G202176900 |
| G202188020 | Convert a Paperback Word File to PDF | https://kdp.amazon.com/en_US/help/topic/G202188020 |
| G2MYNEKHT443C2H2 | How much do proof or author copies cost? | https://kdp.amazon.com/en_US/help/topic/G2MYNEKHT443C2H2 |
| G5HDYGP4BXLX4RUW | Barcodes | https://kdp.amazon.com/en_US/help/topic/G5HDYGP4BXLX4RUW |
| G73MVSZ5P69VVCN6 | 4 – Title Setup: Book Details, Content, & Pricing | https://kdp.amazon.com/en_US/help/topic/G73MVSZ5P69VVCN6 |
| G77F3WPD3KQLJTFS | Hardcover Royalty | https://kdp.amazon.com/en_US/help/topic/G77F3WPD3KQLJTFS |
| G7BBN68RYX5UMDZF | Proof and Author Copies | https://kdp.amazon.com/en_US/help/topic/G7BBN68RYX5UMDZF |
| G8BKPU9AGVZSF9QF | Print Book Pricing Page | https://kdp.amazon.com/en_US/help/topic/G8BKPU9AGVZSF9QF |
| G8BYTM8CVK74676V | Change or view your ISBN | https://kdp.amazon.com/en_US/help/topic/G8BYTM8CVK74676V |
| G99WKT9FARBGHBJF | Groundwood Paper | https://kdp.amazon.com/en_US/help/topic/G99WKT9FARBGHBJF |
| GAVW3FZZAKA2KY3B | Hardcover | https://kdp.amazon.com/en_US/help/topic/GAVW3FZZAKA2KY3B |
| GDTKFJPNQCBTMRV6 | Create a Hardcover Cover | https://kdp.amazon.com/en_US/help/topic/GDTKFJPNQCBTMRV6 |
| GG6GRS7TKXVG6AGW | What is the cost to ship my proof or author copy? | https://kdp.amazon.com/en_US/help/topic/GG6GRS7TKXVG6AGW |
| GGE5T76TWKA85DJM | Low-Content Books | https://kdp.amazon.com/en_US/help/topic/GGE5T76TWKA85DJM |
| GHT976ZKSKUXBB6H | Hardcover Printing Cost | https://kdp.amazon.com/en_US/help/topic/GHT976ZKSKUXBB6H |
| GKYZRXFBZH2LDXAK | Format Your Hardcover | https://kdp.amazon.com/en_US/help/topic/GKYZRXFBZH2LDXAK |
| GKZVNAAFYWVKZWL8 | Hardcover Print Elements | https://kdp.amazon.com/en_US/help/topic/GKZVNAAFYWVKZWL8 |
| GML3FXP998V8WS4U | Publishing in Hebrew, Persian, and Yiddish | https://kdp.amazon.com/en_US/help/topic/GML3FXP998V8WS4U |
| GPQL5W3J6WNRCZTV | How EU and the UK Taxes Affect Print Books List Price | https://kdp.amazon.com/en_US/help/topic/GPQL5W3J6WNRCZTV |
| GQ8UH9SN83UFNVKR | Price Troubleshooting | https://kdp.amazon.com/en_US/help/topic/GQ8UH9SN83UFNVKR |
| GQSHRFWZ5CEY7XAC | Language & Reading direction | https://kdp.amazon.com/en_US/help/topic/GQSHRFWZ5CEY7XAC |
| GQTT4W3T5AYK7L45 | Expanded Distribution | https://kdp.amazon.com/en_US/help/topic/GQTT4W3T5AYK7L45 |
| GRBXANE8Q9P9V2FL | Troubleshoot ISBN errors | https://kdp.amazon.com/en_US/help/topic/GRBXANE8Q9P9V2FL |
| GRWEDYN53XPNMFPN | EU Regulation on Deforestation-free Products (EUDR) | https://kdp.amazon.com/en_US/help/topic/GRWEDYN53XPNMFPN |
| GSQF43YAMUPFTMSP | Printing Cost & Royalty Calculator | https://kdp.amazon.com/en_US/help/topic/GSQF43YAMUPFTMSP |
| GTJ8LBXL6Z4WV5QX | Get an ISBN | https://kdp.amazon.com/en_US/help/topic/GTJ8LBXL6Z4WV5QX |
| GTTMJWM4H3BLQA9A | Hardcover (Beta) - Pricing & Royalties | https://kdp.amazon.com/en_US/help/topic/GTTMJWM4H3BLQA9A |
| GVBQ3CMEQW3W2VL6 | Set Trim Size, Bleed, and Margins | https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6 |
| GVEG4YA9G2T7N6DR | How do I order a proof or author copy? | https://kdp.amazon.com/en_US/help/topic/GVEG4YA9G2T7N6DR |
| GX56BFPW4BKNPGFW | Color Ink Options | https://kdp.amazon.com/en_US/help/topic/GX56BFPW4BKNPGFW |
| GZCSY2RL5G699Y4D | Cover Studio | https://kdp.amazon.com/en_US/help/topic/GZCSY2RL5G699Y4D |

### Official tools

| Saved file | What it is | URL |
|---|---|---|
| pages/cover-calculator-config.txt | KDP Cover Calculator | https://kdp.amazon.com/en_US/cover-calculator |
| pages/cover-calculator.txt | KDP Cover Calculator (official tool) | https://kdp.amazon.com/en_US/cover-calculator |
| pages/cover-template-hardcover-6x9-100-white-ltr.txt | Official KDP cover template generated by the cover calculator ("Download template") | https://kdp.amazon.com/en_US/cover-calculator |
| pages/cover-template-paperback-6x9-100-white-ltr.txt | Official KDP cover template generated by the cover calculator ("Download template") | https://kdp.amazon.com/en_US/cover-calculator |
| pages/cover-template-paperback-6x9-100-white-rtl.txt | Official KDP cover template generated by the cover calculator ("Download template") | https://kdp.amazon.com/en_US/cover-calculator |
| pages/royalty-calculator-specs.txt | KDP Printing Cost & Royalty Calculator | https://kdp.amazon.com/en_US/royalty-calculator |
| pages/royalty-calculator.txt | KDP Printing Cost & Royalty Calculator (official tool) | https://kdp.amazon.com/en_US/royalty-calculator |

### Fetched and searched for relevant statements, not quoted

G200627430 (Kindle Direct Publishing Terms and Conditions), G200627450 (Book Status), G200634280 (KDP Help Center Home), G200641050 (KDP Payments), G200641240 (Upload and Preview Book Content), G200672390 (Content Guidelines), G200965970 (Update Your Cover), G201097560 (Metadata Guidelines for Books), G201645410 (Setting European Union List Prices), G201645450 (How EU Taxes Affect eBooks List Price), G201723080 (Pricing Resources), G201723290 (Tax Information), G201834190 (Format Your Paperback), G202145400 (Build Your Book - Format a Paperback Manuscript (Word for Windows)), G202175860 (Upload Book Resources), G202181110 (Royalties), G202187840 (2 – Prepare Your Manuscript), G202187850 (3 – Prepare Your Cover), G27T64E65VM6JWKK (Chinese (Traditional) (Beta)), G3TQWMMGK8528NDZ (Build Your Book – Format a Paperback Manuscript (Pages for Mac)), G4QJH4ENN4FZRFMP (Remove or unpublish a book), G6BZ4M9PVJ8YSCW8 (Royalties Estimator), G7YLXK7MAGCQFGBK (I’m getting an error ordering my author copy), GDDYZG2C7RVF5N9J (Format Front Matter, Body Matter, and Back Matter), GGTUGK894PSSL9K9 (My proof or author copy came damaged), GL9S534PE857E2CN (When will my proof or author copy arrive?), GLRF8JDXY5LPE3TX (Build Your Book - Format a Paperback Manuscript (Word for Mac)), GR6ZLYMF5VLS27PY (How Taxes Affect List Prices), GUQT4C8J6RR6V8TY (Arabic), GUU6HFZG3BZ5GRTY (My proof or author copy has printing errors), GW7J4WEKBVU25YEC (Books Titles & Editions), GYJLDRTEXRQQA9BY (I’m getting an error ordering my proof copy).

### Redirects and missing

- Old IDs that redirect: GPGVYM9KWTYLD2GD -> G8BKPU9AGVZSF9QF, G200634540 -> G200672390, G202131440 -> G7BBN68RYX5UMDZF, G202132360 -> G7BBN68RYX5UMDZF, GYEKAVKMSE23PFTM -> G202145060, A1OYGQ0E1L4WBS -> G201834330, ATZHCE8PIQQR5 -> G201834340, A30464Q6OVH578 -> G201645410.
- Not found (404): GH4MVPMZ6ZHWB6U5.
- kdpcommunity.com (official forum) loads only through JavaScript and could not be read; no bypass attempted.
