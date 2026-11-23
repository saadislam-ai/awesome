# AU publishing research notes (au-misc)

Compiled 2026-11-23 for an independent publisher in Sydney, NSW (ISBNs from Thorpe-Bowker Australia).

## Files in this folder

| Path | What it is |
|---|---|
| `facts.json` | Structured facts for tasks 1-8. Every fact has `source` (URL), `quote`, `page_file`, `verified`, `retrieval`. 179 facts: 168 verified, 11 not verified. |
| `rates.json` | AUD-base cross rates computed from the ECB reference rates dated **2026-11-20**. |
| `notes.md` | This file. |
| `pages/` | Plain text of every page read (78 files). Line 1 of each file is the URL. Files ending `.webfetch.txt` are transcripts of WebFetch answers, not raw page text. |
| `thema/` | Official Thema v1.7 English files (JSON, XML, XLSX, HTML), `thema_v1.7_en_simplified.json` (array of `{code, heading, parent?, notes?}`, 9,448 entries) and `THEMA_VERSION_AND_LICENCE.json` (version, URLs, verbatim licence header). |
| `onix-codelists/` | Official ONIX code lists Issue 75 (JSON, XML, CSV, JSON schema, changes PDF) and `subset/` with one JSON file per requested list. |
| `raw/` | Raw downloads (HTML, PDF, DOCX) behind the page texts, and `_fetchlog.tsv`. |
| `scripts/` | The fetch, conversion, build and check scripts. `check_facts.py` confirms each quote occurs in its page file. |

## Method

- Pages were fetched with `curl -sL --max-time 40` through the session proxy, then converted with lxml (HTML), pdftotext (PDF) or a small DOCX reader. The first batch (NLA, NED, State Library of NSW, University of Sydney, ABLIS, the Copyright Act) was fetched with a generic descriptive user-agent string; everything after that with curl's default identity. Those first-batch hosts were re-requested with the default identity afterwards and returned HTTP 200 with byte-identical sizes, so no access rule was involved.
- `scripts/check_facts.py` checks every `quote`, `quote2`, ... in `facts.json` against the saved page text after whitespace normalisation. Result: **220 of 220 quotes found**.
- Where a table was flattened by text extraction, the quote is the flattened row and the `note` explains how to read it.
- Nothing was filled from memory. Search-engine summaries were used only to find URLs; where a search summary is mentioned in a note it is labelled as not read on the official page.
- Two sites refused curl but could be read through the WebFetch tool (bisg.org, booknetcanada.ca). Those 12 facts carry `"retrieval": "webfetch"`: the page is official, but the quote was relayed by WebFetch's summarising model and is not byte-verified. Each BISG page was extracted two or three times with different prompts and the answers agree.

## Surprises (things that differ from common assumptions)

1. **EAN-5 currency digits: only USD (5) and CAD (6) are supported by an authoritative source. There is no confirmed digit for AUD or NZD.**
   - BISG's own 2005 paper (read verbatim from the BISG asset host) says the 1980s design gave 0 and 1 to UK pounds, 5 to US dollars, 6 to Canadian dollars, and 2, 3 and 4 to "the currencies of other English speaking countries" without naming which. It then records that book industry groups in Australia, New Zealand, South Africa and India reported **no** price encoding with 2, 3 or 4, and that BISG therefore reassigned 10000-49999 to US$100.00-US$499.99 (approved September 2004).
   - So an add-on such as `32995` reads under current BISG rules as US$329.95, not A$29.95.
   - The live BISG guidelines page (last updated August 2025, via WebFetch) mentions no currency other than US dollars and says 60000-89999 have "no significance and meaning".
   - GS1 gives the add-on digits no meaning at all ("numeric data of any structure and meaning").
   - The International ISBN Agency (Users' Manual 7th ed., 13.3) says the price add-on is used in the United States and Canada and "should not be used for price information in other countries"; other countries may only use a 9-prefixed in-house code in 90000-98999.
   - Recommendation recorded in `facts.json`: plain EAN-13, or `90000` if an add-on is demanded. Never encode an AUD price.
2. **`90000` is verified**: BISG 2005, "90000 is understood to mean a net priced title or a title for which a list price is not suggested".
3. **NSW State Library wants every format.** The NLA wants one copy in one format and prefers the ebook; the State Library of NSW wants one copy of each format, so a title published in print and ebook needs an NED deposit plus a print copy to Sydney.
4. **No NSW deadline could be confirmed.** The State Library, NED and University of Sydney pages state none, and the Library Act 1939 (NSW) could not be read (see blocked hosts). Search summaries suggest the Act works through "legal deposit orders" that "may specify a reasonable time"; that is unverified.
5. **For ebooks sold online the Commonwealth offence only arises after an NLA request** (Copyright Act s 195CB(2), s 195CC). The NLA still asks for deposit within a month, and for print-only material the one-month duty is automatic (s 195CB(1)).
6. **ABLIS (business.gov.au) contradicts the State Library**: it lists "State Library of New South Wales (two copies)" and says either an electronic or a physical copy may be submitted. The State Library page is treated as authoritative.
7. **The NLA site has moved**: `www.nla.gov.au/using-library/services-publishers/...` now redirects to `www.library.gov.au/services/publishers-and-self-publishers/...`.
8. **Thema 1.7 was released on 28 October 2026** (file issue date 20261020), and **ONIX code lists Issue 75 on 12 October 2026**. Both are newer than most published references.
9. **ONIX list 26 does not exist in Issue 75** (the file jumps from 25 to 27). The other 24 requested lists are all present.
10. **The ISBN metadata table makes Contributor optional** at the international level (ISBN, product form, title, language, imprint, publisher, country and publication date are mandatory). What Thorpe-Bowker's own form requires is not confirmed.
11. **bisg.org is not blocked by the proxy.** Its own firewall rejects curl's default client with HTTP 403; robots.txt is served and allows these pages, and WebFetch could read them. BISG PDFs on `assets-002.noviams.com` are served to curl.
12. **BISAC is not bundle-able**: a product that ships or exposes the complete list needs a BISG licence and must verify each end user's licence (non-member fees start at US$590). Looking up individual codes on bisg.org is free.
13. **KDP print list prices are tax-exclusive, KDP ebook prices on Amazon.com.au are GST-inclusive.**

## Unverified items (explicit list)

Each has `"verified": false` and a note in `facts.json`.

| id | What could not be confirmed | Why |
|---|---|---|
| `ld.nsw.time_limit` | NSW deadline for deposit after publication | Library Act 1939 (NSW) unreadable: legislation.nsw.gov.au, AustLII and parliament.nsw.gov.au answer HTTP 403. No reachable official page states a deadline. |
| `ld.nsw.parliamentary_library_details` | NSW Parliamentary Library copies, address, process | parliament.nsw.gov.au answers HTTP 403. Only contact emails found. |
| `isbn.au.bowker_steps` | Thorpe-Bowker's steps to assign and register a title to an ISBN | myidentifiers.com.au answers HTTP 403 (Cloudflare challenge) to curl and WebFetch. Search summaries only. |
| `isbn.au.bowker_metadata` | The exact fields Thorpe-Bowker asks for | Same block. International minimum set is verified (`isbn.metadata.minimum`). |
| `isbn.au.bowker_format_statement` | Thorpe-Bowker's own "one ISBN per format" wording | Same block. The rule itself is verified from the International ISBN Agency and NED. |
| `isbn.au.bowker_barcode` | Thorpe-Bowker barcode guidance, and whether its Australian barcode carries a price add-on | Same block. Search summaries are inconsistent. |
| `bc.nominal.overall_height` | Overall nominal EAN-13 height including digits (often quoted as 25.93 mm) | GS1 gives it only in a drawing (image). Text-verified figures: 37.29 mm wide, 22.85 mm bar height. |
| `bc.currency.aud_digit` | A digit meaning Australian dollars | No authoritative source assigns one; see Surprise 1. |
| `bc.currency.nzd_digit` | A digit meaning New Zealand dollars | Same. |
| `gst.ato_unreachable` | The ATO's own wording on GST for books and e-books | www.ato.gov.au answers HTTP 403 to curl and WebFetch. Rate and treatment taken from the GST Act and business.gov.au. |
| `gst.kdp.other_marketplaces` | KDP tax rates for marketplaces other than EU/UK print, EU ebooks, AU/IN ebooks, JP and TW | No such KDP page exists in the help index. |

Also note two **inferences** flagged `"derived": true`:
- `gst.books_not_gst_free`: printed books are taxable at 10% because Division 38 of the GST Act has no GST-free category for books. No ATO sentence saying so was retrieved.
- The "practical summary" and "conclusion" blocks in tasks 1, 3, 4, 6 and 7 are my synthesis of the quoted facts.

## Facts verified through WebFetch only (quotes relayed, not byte-verified)

`bc.currency.usd_current_page`, `bc.currency.cad_digit`, `bc.90000.recommended`, `bc.bisg.size`, `bc.bisg.optional`, `bisac.free_lookup`, `bisac.paid_licence`, `bisac.no_redistribution`, `bisac.not_transferable`, `bisac.software_vendors`, `bisac.fees`, `bisac.edition`.

The barcode ones are backed by byte-verified BISG PDFs (`bc.currency.original_scheme`, `bc.currency.usd_current`, `bc.90000`). The BISAC licensing ones have no byte-verified backup: re-read the two BISG pages in a browser before quoting them in the app or relying on the fee figures.

## Hosts that could not be read

| Host | Result |
|---|---|
| www.myidentifiers.com.au, www.myidentifiers.com, www.bowker.com, www.isbn.org (thorpe.com.au redirects to bowker.com) | HTTP 403, Cloudflare "Just a moment..." challenge. WebFetch also 403. |
| www.ato.gov.au | HTTP 403 "Access Denied" (Akamai). WebFetch also 403. |
| legislation.nsw.gov.au | HTTP 403, Cloudflare challenge (HTML and PDF endpoints). WebFetch also 403. |
| www.parliament.nsw.gov.au | HTTP 403, Cloudflare challenge. |
| www8.austlii.edu.au, classic.austlii.edu.au | HTTP 403, Cloudflare challenge. |
| www.gs1.org | HTTP 403. Not needed: the General Specifications PDF comes from ref.gs1.org. |
| www.bisg.org | HTTP 403 from the site firewall for curl. Read through WebFetch. |
| www.booknetcanada.ca | Bot-verification interstitial for curl. One page read through WebFetch. |
| Public web archives | One attempt to read the NSW Library Act from a web archive was refused by the session permission system. Not retried. |

No block was worked around by changing client identity or by other means. Two things to know: (1) one early probe of bisg.org used a descriptive user agent before the firewall behaviour was known; it was used only to list the site's navigation links. (2) www.editeur.org dropped the connection (HTTP/2 PROTOCOL_ERROR) for that descriptive user-agent string and served curl's default identity normally, so the default identity, which is the method given in the brief, was used from then on.

## Task digest

**1. Legal deposit.** NLA: any Australian publisher including self-publishers; one copy; within one month of publication (Copyright Act 1968 ss 195CA-195CJ, max 10 penalty units); ebook preferred, through NED at https://ned.gov.au/ned/ (free, DRM-free, EPUB preferred, under 1 GB, ebook ISBN not print ISBN); print to Legal Deposit, National Library of Australia, Parkes Place, Canberra ACT 2600. NSW: State Library of NSW (one copy of each format; print to Legal Deposit, Level 2, 1 Shakespeare Place, Sydney NSW 2000; digital via NED), University of Sydney Library (offer print copy via form), NSW Parliamentary Library (contact). NSW deadline unverified. PDS: free, still offered, apply before publication at the NLA, gives a cataloguing statement for the imprint page.

**2. ISBN / Thorpe-Bowker.** Agency identity and contact verified from the NLA. Bowker's own steps and form fields unverified (site blocked). Verified from the International ISBN Agency: separate ISBN per edition and format (hardback, paperback, EPUB, PDF), no new ISBN for price or cover change or unchanged reprint, minimum metadata set, where to print the ISBN, barcode placement, and the rule that the price add-on is for the US and Canada only.

**3. Barcode.** See Surprise 1 and `task3_barcode` in `facts.json`. Nominal X 0.330 mm; 37.29 mm wide including quiet zones (31.35 mm bars only); bar height 22.85 mm; 80%-200% (X 0.264-0.660 mm); quiet zones 11X left, 7X right; add-on 7X-12X from the main symbol with 5X after it; EAN-13 + 5 is 165 modules; EAN-5 parity rule and table transcribed from GS1.

**4. GST / VAT.** GST 10% (GST Act s 9-70). E-books taxable as digital products; books named among taxable low-value imports (business.gov.au). KDP tables captured for EU/UK print VAT, EU ebook VAT, AU 10% and IN 18% ebook GST, JP 10%, TW 5%.

**5. Rates.** ECB feed date `2026-11-20`; 1 EUR = 1.6487 AUD; 29 currencies in `rates.json`, all 13 requested ones present.

**6. Thema.** v1.7 (v1.7.0, issue date 20261020, released 28 Oct 2026). Licence quotes in `facts.json` and `thema/THEMA_VERSION_AND_LICENCE.json`. The simplified array matches the official XML for all 9,448 codes.

**7. BISAC.** Paid licence for the full list; no redistribution; not scraped.

**8. ONIX.** 3.0.8 and 3.1.3; code lists Issue 75 (2026-10-12); official URLs in `facts.json`; 24 of 25 requested lists extracted.

## Pages fetched

Files ending `.webfetch.txt` are WebFetch transcripts. A few pages were fetched but hold little (`ned-contact.txt` and `nla-pds-application-form.txt` are JavaScript shells; `cth-*-latest.txt` are tables of contents; the Act extracts are in `cth-copyright-act-1968-legal-deposit-s195CA-195CJ.txt` and `cth-gst-act-1999-extract.txt`).

| File in `pages/` | URL |
|---|---|
| `abf-gst-importing.txt` | https://www.abf.gov.au/importing-exporting-and-manufacturing/importing/cost-of-importing-goods/gst-and-other-taxes |
| `ablis-nsw-legal-deposit.txt` | https://ablis.business.gov.au/service/nsw/legal-deposit/45672 |
| `bisg-barcoding-guidelines.webfetch.txt` | https://www.bisg.org/barcoding-guidelines-for-the-us-book-industry |
| `bisg-bisac-licensing.webfetch.txt` | https://www.bisg.org/purchasedownload-complete-bisac-list |
| `bisg-policy-0701.txt` | https://assets-002.noviams.com/novi-file-uploads/bisg/Policy_Statements/BISG_Policy_0701-79e55656.pdf |
| `bisg-price-increase-in-add-on.txt` | https://assets-002.noviams.com/novi-file-uploads/bisg/Barcoding_Guidelines/Price_Increase_in_Add-on-18cc22ae.pdf |
| `bisg-waf-403-response.txt` | https://www.bisg.org/ |
| `booknet-canada-barcode-price-extensions-2025.webfetch.txt` | https://www.booknetcanada.ca/blog/2025/9/8/updated-guidance-on-barcode-price-extensions |
| `business-gov-international-tax.txt` | https://business.gov.au/finance/tax/international-tax |
| `business-gov-register-gst.txt` | https://business.gov.au/registrations/register-for-taxes/register-for-goods-and-services-tax-gst |
| `cth-copyright-act-1968-legal-deposit-s195CA-195CJ.txt` | https://www.legislation.gov.au/C1968A00063/2026-04-02/2026-04-02/text/original/epub/OEBPS/document_1/document_1.html |
| `cth-copyright-act-latest.txt` | https://www.legislation.gov.au/C1968A00063/latest/text |
| `cth-gst-act-1999-extract.txt` | https://www.legislation.gov.au/C2004A00446/2026-01-01/2026-01-01/text/original/epub/OEBPS/document_1/document_1.html |
| `cth-gst-act-latest.txt` | https://www.legislation.gov.au/C2004A00446/latest/text |
| `ecb-eurofxref-daily.txt` | https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml |
| `editeur-licence-doi-10.4400-nwgj.txt` | https://www.editeur.org/files/about/EDItEUR%20IPR%20licence%2020260225.pdf |
| `editeur-onix-3-downloads.txt` | https://www.editeur.org/93/Release-3.0-and-3.1-Downloads/ |
| `editeur-onix-about-3.0-3.1.txt` | https://www.editeur.org/12/About-Release-3.0-and-3.1/ |
| `editeur-onix-codelists-issue75-changes.txt` | https://www.editeur.org/files/ONIX%20for%20books%20-%20code%20lists/ONIX_BookProduct_Codelists_Issue_75_Changes.pdf |
| `editeur-onix-codelists-issue75-xml-header.txt` | https://www.editeur.org/files/ONIX%20for%20books%20-%20code%20lists/ONIX_BookProduct_Codelists_Issue_75.xml |
| `editeur-onix-codelists.txt` | https://www.editeur.org/14/Code-Lists/ |
| `editeur-onix-overview.txt` | https://www.editeur.org/83/Overview/ |
| `editeur-terms-and-conditions.txt` | https://www.editeur.org/67/Terms-and-Conditions/ |
| `editeur-thema-executive-briefing.txt` | https://www.editeur.org/files/Thema/1.7/Using%20Thema%201%20Executive%20briefing_20261030.pdf |
| `editeur-thema-v1.7-en-xml-header.txt` | https://www.editeur.org/files/Thema/1.7/en/20261020_Thema_v1.7_en.xml |
| `editeur-thema.txt` | https://www.editeur.org/151/Thema/ |
| `gs1-general-specifications-r26.txt` | https://ref.gs1.org/standards/genspecs/ |
| `gs1au-1d-barcodes.txt` | https://www.gs1au.org/standards/barcodes/1d-barcodes |
| `gs1au-ean13-factsheet.txt` | https://assets.ctfassets.net/9uypwcnuzbqi/5IT2th65cxXq7qywp8feBK/41190020a596307942fab78e38857e9c/GS1au-fact-sheet-EAN-13-barcode.pdf |
| `gs1au-selling-on-amazon-faqs.txt` | https://www.gs1au.org/resources/frequently-asked-questions/selling-on-amazon-faqs |
| `isbn-faqs-7th-edition.txt` | https://www.isbn-international.org/sites/default/files/ISBN_FAQs_to_7ed_Manual_Absolutely_final.docx |
| `isbn-international-home.txt` | https://www.isbn-international.org/ |
| `isbn-intl-agencies.txt` | https://www.isbn-international.org/agencies |
| `isbn-intl-bar-coding.txt` | https://www.isbn-international.org/content/isbn-bar-coding |
| `isbn-intl-ebook-guidelines.txt` | https://www.isbn-international.org/content/guidelines-assignment-e-books/26 |
| `isbn-intl-how-get-isbn.txt` | https://www.isbn-international.org/content/how-get-isbn/24 |
| `isbn-intl-related-policies.txt` | https://www.isbn-international.org/content/related-policies-and-issues/27 |
| `isbn-intl-scope-and-assignment.txt` | https://www.isbn-international.org/content/scope-and-assignment-isbn/25 |
| `isbn-intl-users-manual-page.txt` | https://www.isbn-international.org/content/isbn-users-manual/29 |
| `isbn-users-manual-7th-edition.txt` | https://www.isbn-international.org/sites/default/files/ISBN%20International%20Users%20Manual%20-%207th%20edition_absolutely_final.docx |
| `kdp-barcodes.txt` | https://kdp.amazon.com/en_US/help/topic/G5HDYGP4BXLX4RUW |
| `kdp-digital-book-pricing-page.txt` | https://kdp.amazon.com/en_US/help/topic/G200634500 |
| `kdp-ebook-list-price-requirements.txt` | https://kdp.amazon.com/en_US/help/topic/G200634560 |
| `kdp-eu-taxes-ebooks.txt` | https://kdp.amazon.com/en_US/help/topic/G201645450 |
| `kdp-eu-uk-taxes-print-books.txt` | https://kdp.amazon.com/en_US/help/topic/GPQL5W3J6WNRCZTV |
| `kdp-gst-ebooks-australia-india.txt` | https://kdp.amazon.com/en_US/help/topic/G202169970 |
| `kdp-help-index.txt` | https://kdp.amazon.com/en_US/help |
| `kdp-how-taxes-affect-list-prices.txt` | https://kdp.amazon.com/en_US/help/topic/GR6ZLYMF5VLS27PY |
| `kdp-paperback-royalty.txt` | https://kdp.amazon.com/en_US/help/topic/G201834330 |
| `kdp-print-book-pricing-page.txt` | https://kdp.amazon.com/en_US/help/topic/G8BKPU9AGVZSF9QF |
| `kdp-setting-prices-amazon-japan.txt` | https://kdp.amazon.com/en_US/help/topic/G201849770 |
| `kdp-taiwan-vat.txt` | https://kdp.amazon.com/en_US/help/topic/G202183400 |
| `ned-about.txt` | https://ned.gov.au/resources/about.html |
| `ned-contact.txt` | https://ned.gov.au/ned/contact |
| `ned-deposit-step-1.txt` | https://ned.gov.au/resources/deposit-step-1.html |
| `ned-deposit-step-2.txt` | https://ned.gov.au/resources/deposit-step-2.html |
| `ned-deposit-step-3.txt` | https://ned.gov.au/resources/deposit-step-3.html |
| `ned-getting-started.txt` | https://ned.gov.au/resources/getting-started.html |
| `ned-legal-deposit-in-australia.txt` | https://ned.gov.au/resources/legal-deposit-in-australia.html |
| `ned-legal-deposit-obligations.txt` | https://ned.gov.au/resources/legal-deposit-obligations.html |
| `ned-make-an-edeposit.txt` | https://ned.gov.au/resources/make-an-edeposit.html |
| `ned-using-ned.txt` | https://ned.gov.au/resources/using-ned.html |
| `nla-how-to-deposit.txt` | https://www.library.gov.au/services/publishers-and-self-publishers/legal-deposit/how-make-legal-deposit |
| `nla-isbn.txt` | https://www.library.gov.au/services/publishers-and-self-publishers/international-standard-book-number-isbn |
| `nla-legal-deposit-factsheet.txt` | https://www.library.gov.au/sites/default/files/documents/2025-03/legal-deposit-fact-sheet-20250226.pdf |
| `nla-legal-deposit-faq.txt` | https://www.library.gov.au/services/publishers-and-self-publishers/legal-deposit/legal-deposit-questions-and-answers |
| `nla-legal-deposit.txt` | https://www.library.gov.au/services/publishers-and-self-publishers/legal-deposit |
| `nla-national-edeposit.txt` | https://www.library.gov.au/services/publishers-and-self-publishers/national-edeposit |
| `nla-pds-application-form.txt` | https://cipismnref.nla.gov.au/reft399.aspx?pmi=809120681935241919 |
| `nla-pds-general.txt` | https://www.library.gov.au/services/publishers-and-self-publishers/prepublication-data-service/general-prepublication-data |
| `nla-prepublication-data-service.txt` | https://www.library.gov.au/services/publishers-and-self-publishers/prepublication-data-service |
| `nla-publishers.txt` | https://www.library.gov.au/services/publishers-and-self-publishers |
| `nsla-home.txt` | https://www.nsla.org.au/ |
| `slnsw-how-deposit.txt` | https://www.sl.nsw.gov.au/research-and-collections/building-collections/legal-deposit/how-deposit |
| `slnsw-legal-deposit.txt` | https://www.sl.nsw.gov.au/research-and-collections/building-collections/legal-deposit |
| `slnsw-legislative-background.txt` | https://www.sl.nsw.gov.au/research-and-collections/building-collections/legal-deposit/legislative-background-legal-deposit |
| `usyd-legal-deposit-about.txt` | https://www.library.sydney.edu.au/about/legal-deposit |
| `usyd-legal-deposit.txt` | https://www.library.sydney.edu.au/about/legal-deposit/deposit-an-item |
