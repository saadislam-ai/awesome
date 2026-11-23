# Research notes: Amazon KDP ebooks and Draft2Digital

Researched on 2026-11-23. All facts were read on official pages fetched that day. Nothing was filled in from memory or from third-party sites.

## Files

- KDP facts: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/kdp-ebook-facts.json
- Draft2Digital facts: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/d2d-facts.json
- These notes: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/notes.md
- Saved page texts (123 files, first line of each is its URL): /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages
- Raw HTML as downloaded: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/raw
- Downloaded PDFs and the calculator script: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/downloads

## How to read the fact files

- Each fact carries `source` (the exact URL), `saved_page` (the text file it was read from) and `quote` (verbatim, with runs of whitespace collapsed to one space). Table rows are quoted with cells joined by ` | `.
- `"verified": false` means the item is not on any official page that could be read. It has a `note` and no value.
- `"derived": true` marks a conclusion drawn here from quoted facts. It is not a statement by Amazon or Draft2Digital.
- Keys named `contradiction`, `contradictions`, `difference` or `possibly_stale` record places where official pages disagree with each other.
- 444 quotes in the KDP file and 207 in the Draft2Digital file were checked by script against the saved page text, with no failures. The KDP file quotes 58 distinct pages and the Draft2Digital file 23.
- The KDP list price numbers and delivery costs were also re-read from the raw HTML tables by a second script and matched in all 9 currency tables and all 13 delivery-cost rows.

## Things that differ from older documentation

These are the findings most likely to contradict what an existing spec file or older guide says.

### KDP

1. **The 70% price band is wider.** The list price page says: "Effective July 7, 2026, the 70% royalty option price band is $2.99-$12.99 on Amazon.com, expanding from the previous range of $2.99-$9.99, with equivalent changes in other KDP marketplaces." New 70% maximums: £12.99, €12.99, C$12.99, A$15.99, ₹599, ¥1,650, R$31.99, MXN $199.99. The 70% minimums and the whole 35% option are unchanged.
2. **Kindle Previewer is now version 4 (4.0.4).** Amazon says it no longer supports Previewer 2.94 or 3. The version 4 user guide (dated November 5, 2026) names the command `kindlepreviewer4` and uses two-dash options such as `--convert`, `--output`, `--log`, `--qualitychecks` and `--showpreview`. The documented Windows default folder is `c:\Users\[user]\AppData\Local\Amazon\Kindle Previewer 4\`. Import of .mobi, .azw and .prc files was removed.
3. **New title limits.** KDP now allows up to 2 new titles created and up to 2 first-time submissions per book format each week, resetting Sunday 12:00 AM UTC. This matters for any automated publishing flow.
4. **MOBI is gone.** KDP stopped accepting MOBI for reflowable books on August 1, 2021 and for fixed-layout books on March 18, 2025. Use EPUB, DOCX or KPF.
5. **Cover images are validated at upload.** The Kindle Publishing Guidelines web page now lists hard requirements (JPEG, PNG, non-animated GIF or TIFF; at least 500 px on the longest side; at most 10,000 px per side; 50 MB; aspect ratio no more than 500:1) and says files that fail are rejected.
6. **"Kindle+" is the name used for the subscription programme** on KDP help pages and in the Terms. Links on those pages still point to /kindleunlimited addresses. "Kindle+" and "KDP Select" are listed among keywords to avoid.
7. **Reading age.** An "18+" maximum is no longer offered. The bands are 0-2, 3-5, 6-8, 9-12 and 13-17. No separate grade range field is documented.
8. **DRM-free downloads.** Since January 20, 2026 verified purchasers can download EPUB and PDF files of DRM-free books.
9. **Dates of the contractual pages.** KDP Terms and Conditions: last updated October 21, 2026. Digital Book Pricing Page: last updated April 21, 2026. Kindle Publishing Guidelines PDF: version 2026.3.
10. **Bengali is not on any official KDP language list.** The supported Indian languages are Gujarati, Hindi, Malayalam, Marathi and Tamil, ebook only. The supported-languages page warns that ebook content in an unsupported language "won’t display properly on Kindle devices and will be removed from sale." No page names Bengali, so this is a conclusion from its absence, not a quoted refusal.

### Draft2Digital

1. **Draft2Digital now charges fees.** Announced April 14, 2026: a one-time, non-refundable $20 activation fee for new accounts before they can publish, and a $12 annual maintenance fee for accounts earning under $100 in the previous 12 months (charged from May 14, 2026, first year covered by the activation fee). A tax form is required "even if you intend to list your book(s) for free." A catalogue of only free books earns nothing, so the annual fee would apply from the second year.
2. **Amazon through Draft2Digital is invitation only.** Draft2Digital cannot send a free price to Amazon; a free book is submitted there at $0.99 and "Amazon may price-match to free." Books sent to Amazon this way cannot be in KDP Select and cannot have pre-orders.
3. **Print page limits changed.** The current FAQ and the live calculator say 32 to 1,050 pages. Blog posts from 2022 and 2023 say 64 to 740 pages or a 64-page minimum.
4. **Commission wording.** The Terms of Service (effective April 14, 2026) say Draft2Digital deducts 15% of the payments it receives from stores. The FAQ describes the same thing as "approximately 10% of the retail price."
5. **Abandoned accounts.** Since April 2026 an account with no login for 12 months may be closed and its books removed from distribution.
6. **Print costs are published as data.** The print calculator page carries the base cost and per-page cost for USD, AUD, CAD, EUR and GBP in its HTML, and its script shows the formula. There is no written specification page for print files.

## Contradictions between official pages

### KDP

- **Cover formats.** KDP help page: "TIFF (.tif/.tiff) or JPEG (.jpeg/.jpg) format". Guidelines web page: "Accepted formats: JPEG, PNG, GIF (non-animated), TIFF."
- **Cover minimum size.** KDP help page: 1000 x 625 px minimum. Guidelines web page: at least 500 px on the longest side. Guidelines PDF: under 500 px on the shortest side is not displayed.
- **Cover file size.** KDP help page: less than 50MB. Guidelines web page: 50 MB. Guidelines PDF: "File size: 5MB or fewer".
- **Cover CMYK.** Guidelines web page: CMYK is accepted and converted. Guidelines PDF: "Kindle does not support CMYK."
- **Cover DPI.** The KDP help page has a row "72 dpi" and, in the next row, recommends a minimum of 300 PPI.
- **Interior image colour profile.** Guidelines web page: "Use sRGB color profile for all your images." Guidelines PDF: "Kindle does not support sRGB or CMYK."
- **Internal cover size.** Web page: at least 1200 pixels in width or height. PDF: at least 1200 pixels in width or 1800 pixels in height. The PDF also says the internal cover guidance "doesn’t apply to KDP eBooks."
- **page-break-inside.** The web pages list it as supported ("Kindle now supports CSS attributes for page-break-inside:avoid and break-inside:avoid"). The PDF lists it among ignored attributes.
- **text-decoration: line-through.** The web table of supported attributes lists line-through as a supported value, while the same page and the PDF list it as unsupported and say to remove it.
- **Table size advice.** Web page: fewer than 100 rows and 10 columns. PDF: below 100 rows and 11 columns.
- **Spain delivery cost.** The eBook Royalties page uses €0.10/MB in an example. The Pricing Page lists Amazon.es at €0,12/MB. The Pricing Page is the contractual one.
- **EU VAT table.** For the United Kingdom at 0% VAT the "without VAT" maximums (£125.00 and £9.99) differ from the "with VAT" maximums (£150.00 and £12.99). The list price page gives £150.00 and £12.99.
- **MOBI.** The supported-languages page still lists MOBI (.mobi) as an upload format. The MOBI FAQ says it is no longer accepted.
- **Title and subtitle length.** One page says "200 characters or less", another "fewer than 200 characters".
- **Kindle Previewer on macOS.** The KDP help page and the download box say macOS 12 and above. The user guide and the product-page FAQ say macOS 10.15 (Intel) or macOS 11 (Apple silicon).
- **Kindle Previewer command name.** The version 4 user guide says `kindlepreviewer4`. The product-page FAQ still says `kindlepreviewer --help` and links the old version 3 guide.
- **Enhanced Typesetting language lists.** The KDP Kindle Previewer page omits Hindi and Arabic; the guidelines PDF includes them. Neither includes Bengali.
- **Typos in Amazon's own samples.** The cover manifest sample prints the property as "cover- image" on the web and "coverimage" in the PDF. The toc nav sample prints "mediatype". These are recorded as printed.

### Draft2Digital

- **Ebook file size.** FAQ: "ebooks must be under 100 MB". Knowledge Base: "Epub files larger than 90MB may not be accepted."
- **Accepted file types.** Two answers print "RTF, OTF, TXT" (OTF is a font format). Another answer on the same page prints "doc, docx, odt, rtf, or epub". The Knowledge Base print answer says "ODT or RTF".
- **Tax in prices.** Knowledge Base: USD and CAD prices are tax-exclusive, all other currencies tax-inclusive. Terms of Service: the List Price "will be exclusive of sales, value-added or similar taxes".
- **Store list.** Fable is on the Partners page and in the royalty table but not in the FAQ and Knowledge Base store list.
- **Print limits and sizes over time.** A 2022 post lists a 5.25" x 8.5" trim and 64 to 740 pages. Current pages list 5.25" x 8" and 32 to 1,050 pages.
- **Amazon royalty band.** Draft2Digital still states $2.99 to $9.99 for the higher Amazon royalty. KDP's own band has been $2.99 to $12.99 since July 7, 2026. No Draft2Digital page mentions the change.
- **Maintenance fee waiver wording.** Terms and blog: "$100 or more". The How to Publish page: "more than $100".
- **"No up-front cost".** A 2023 print post says there is no up-front cost to publishing with D2D Print. That predates the 2026 activation fee.

## What could not be verified

No value was recorded for any of these.

### KDP

- `3_vat.list_price_includes_tax.Amazon.ca_Amazon.com.mx_Amazon.com.br`: None of the fetched KDP pages says whether CAD, MXN or BRL eBook list prices include tax, or gives a rate for Canada, Mexico or Brazil.
- `3_vat.other_countries`: The EU VAT page lists only the United Kingdom, Germany, France, Italy, Spain and the Netherlands. No official page fetched lists eBook VAT rates for other EU countries (for example Ireland, Belgium, Austria) or for Canada, Mexico or Brazil.
- `4_free_pricing_and_price_matching.price_matching.how_to_request_a_price_match`: No fetched official KDP page documents a procedure for asking Amazon to match a lower or free price at another retailer.
- `6_manuscript_formats_and_epub_rules.maximum_file_size.kdp_upload_page_limit`: The eBook upload help pages (G200641240, G200634390) do not state a size limit. The 650 MB figure comes from the Kindle Publishing Guidelines PDF and the Kindle Previewer FAQ. A separate KDP page ('Save Your Manuscript File', G202145060) gives 650MB for conversion but it is a paperback page.
- `6_manuscript_formats_and_epub_rules.epub_rules_for_a_generator.embedded_fonts.woff_or_other_formats`: The guidelines name only OTF and TTF. They do not mention WOFF/WOFF2 either way.
- `7_book_description.supported_html_tags.not_in_the_table`: `<strong>`, `<a>`, `<span>`, `<div>`, `<blockquote>` and `<hr>` do not appear in the supported-HTML table. The page does not list them as rejected either; only the tags above are documented as supported.
- `8_keywords_categories_title_series_age.keywords.character_limit_per_keyword`: The help pages say only 'Keep an eye on the character limit in the text field'. No official help page that was fetched states the number, so none is recorded here.
- `8_keywords_categories_title_series_age.title_and_subtitle.separate_title_only_limit`: No separate limit for the title field alone is stated on the fetched pages.
- `8_keywords_categories_title_series_age.series.series_field_limits`: No character limits for the series title or series number are stated on the fetched pages.
- `8_keywords_categories_title_series_age.primary_audience_and_reading_age.grade_range_field`: The Book Detail Resources hub still has a tile named 'AGE & GRADE RANGES', but it only says 'Select an age range' and the linked page documents reading age only. No US grade range field is described on any fetched page.
- `9_supported_languages.bengali.explicit_negative_statement_about_bengali`: No official page names Bengali at all. The 'not supported' conclusion rests on its absence from every official list plus the stated consequence for unsupported languages.
- `10_kindle_previewer.default_install_paths.windows.executable_file_name`: The user guide gives the install folder and the command name 'kindlepreviewer4' but not the executable file name inside the folder.
- `10_kindle_previewer.default_install_paths.macos`: The user guide (v4.0.4) does not document a macOS install path; it only says to pick the disk in the .pkg installer. No official page fetched states /Applications or an app bundle name.

Also note for KDP:

- A match to free is never promised. The Pricing Page wording is "we may also make it available for free". No page describes how to ask for a match.
- The 650 MB figure for ebooks comes from the guidelines PDF ("The maximum file size of an EPUB is 650 MB") and the Kindle Previewer FAQ. The ebook upload help pages themselves give no number.
- The eBook VAT rates on the EU page are stated "As of 5/1/2020". No newer rate table was found.

### Draft2Digital

- `1_ebook.accepted_source_formats.pdf_for_ebook`: No D2D page lists PDF as an ebook source format. PDF is documented only as a print interior upload.
- `1_ebook.epub_requirements.epub_version_or_other_technical_rules`: Apart from 'must pass EpubCheck' and the size limit, no public D2D page states an EPUB version, a required cover-in-EPUB rule, font rules or image limits.
- `1_ebook.cover_image.minimum_size_max_file_size_colour_profile`: No public D2D page gives a minimum pixel size, a maximum cover file size or a colour profile for ebook covers.
- `2_pricing_royalties_stores.free_price.stores_that_do_not_take_free.full_list_of_exceptions`: The public pages name Amazon and libraries only. The per-vendor 'Special Considerations' text is inside the logged-in publishing screen and was not readable, so which other stores (if any) refuse free is not confirmed.
- `2_pricing_royalties_stores.using_a_free_d2d_listing_to_trigger_an_amazon_price_match.d2d_guidance_on_requesting_a_match`: No D2D page gives instructions for getting Amazon to price match (for example reporting a lower price).
- `3_d2d_print.paper_options.paper_weight_or_thickness`: No public D2D page states paper weight, thickness or pages-per-inch for cream or white paper.
- `3_d2d_print.interior_file.margins_fonts_pdf_standard_resolution`: No public D2D page states required margins or gutter, font embedding, a PDF/X standard or image resolution for an uploaded interior PDF.
- `3_d2d_print.cover_file.colour_profile_and_exact_dimensions`: No public D2D page gives cover bleed, safe-zone sizes, colour profile or a formula for the full cover width. They come from the per-book template in the logged-in tool.
- `3_d2d_print.spine.how_calculated`: D2D does not publish a spine-width formula or a pages-per-inch figure. The spine is sized by D2D's tool and by the downloadable template, from the interior page count and the paper choice.
- `3_d2d_print.spine.minimum_pages_for_spine_text`: Not stated on any public D2D page.
- `3_d2d_print.fees_for_changes.paid_token_price`: The price of a purchased Print Change Token is shown only on a logged-in account page. The one figure on a public official page is a spoken remark that D2D's print partner charges D2D $25 per change.
- `4_languages.ebook.official_language_list`: No public D2D page lists the ebook languages it accepts. The language is picked from a drop-down inside the logged-in 'Create New Ebook' screen, which was not readable.
- `4_languages.bengali.ebook_supported`: Bengali (Bangla) is not mentioned on any D2D page fetched. Whether it is in the language drop-down, and whether partner stores accept it, could not be confirmed from public pages.

Also note for Draft2Digital:

- The only published language rule is for print, in a blog post dated August 15, 2022: "We accept all books written in a Latin-based language." Other details in that post are out of date, and no current page repeats or withdraws the rule.
- What each store keeps is not published. Only the author's share per store is. The store share in the fact file is marked as derived.
- The remark that the print partner charges $25 per file change is a spoken comment in a podcast transcript dated October 17, 2024. It is the partner's charge to Draft2Digital, not a published token price.

## Pages and hosts that could not be reached, or that redirect

- **help.draft2digital.com**: the connection failed (no HTTP status). It was not retried through any other route. All Draft2Digital facts come from draft2digital.com.
- **Draft2Digital pages behind a login** were not readable: the Print Change Token purchase page, the per-store "Special Considerations" text on the publishing screen, and the language drop-down on the new-book screen.
- **KDP topic IDs from the brief that return HTTP 404** ("This page is unavailable"): G201644210 and GHKDSCW2KQVVVZPH.
- **KDP topic IDs from the brief that are a different page than expected**: G201723080 is "Pricing Resources", a hub page, not KDP Select (KDP Select is G200798990). G200641240 is "Upload and Preview Book Content", not price matching (price matching is section D of the Digital Book Pricing Page, G200634500).
- **KDP topics that redirect to another topic**: G201723100 to G200735480; G7EAT8SEW569CMYA to GQ2WJ2EXJUMPXEGQ; GPST5EKFJ6MX5UPK to G6GTK3T3NUHKLEFX; GY6SCWBEHVEGCLCN to GPNJPYK298J8TRRV; GYYTLKG3RPMJYT83 to GNY87A6WM6EK6YEE; G202131100 to a page titled "Redirect!".
- **The "HTML and CSS Guidelines" web topic (GP2Z9DD4F2N4QKCY)** answers with HTTP 301 to "Format Your eBook" (G201723130). That section was read from the guidelines PDF instead (section 6).
- **https://kdp.amazon.com/terms-and-conditions** redirects to kdp-eu.amazon.com/agreement with a token. The text was saved from there.
- **The Draft2Digital print calculator** renders with JavaScript. Its numbers were read from the inline script in the page HTML and from the script file the page loads. The saved page text says which part is which.

## How the data was collected and checked

- Pages were fetched with curl and converted to text with lxml. Tables were kept as rows with cells joined by ` | `. Links that sit inside table cells are listed in a footer of each saved page.
- The two PDFs (Kindle Publishing Guidelines, Kindle Previewer user guide) were read with pypdf. Their quotes come from the PDF text layer, so a word broken across lines appears as extracted.
- Web search was used only to find addresses on kdp.amazon.com and draft2digital.com. Every fact was then read on the page itself. Community forum posts were not used.
- The build and check scripts are in /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/scripts. The check script re-verifies every quote against the saved pages without using the build scripts.

## Pages fetched

### KDP: pricing, royalties, tax, KDP Select (20 pages)

- **eBook List Price Requirements**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200634560
  - Date text on the page: No 'last updated' line. Banner: "Effective July 7, 2026, the 70% royalty option price band is $2.99-$12.99 on Amazon.com"
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200634560_ebook_list_price_requirements.txt
  - Quoted in: kdp-ebook-facts.json
- **Digital Book Pricing Page**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200634500
  - Date text on the page: Last Updated: April 21, 2026
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200634500_digital_book_pricing_page.txt
  - Quoted in: kdp-ebook-facts.json
- **eBook Royalties**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200644210
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200644210_ebook_royalties.txt
  - Quoted in: kdp-ebook-facts.json
- **Pricing Resources**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201723080
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201723080_pricing_resources.txt
  - Quoted in: not quoted (read for context only)
- **Price Your Book**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200641280
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200641280_price_your_book.txt
  - Quoted in: kdp-ebook-facts.json
- **Price Troubleshooting**
  - URL: https://kdp.amazon.com/en_US/help/topic/GQ8UH9SN83UFNVKR
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GQ8UH9SN83UFNVKR_price_troubleshooting.txt
  - Quoted in: kdp-ebook-facts.json
- **How Taxes Affect List Prices**
  - URL: https://kdp.amazon.com/en_US/help/topic/GR6ZLYMF5VLS27PY
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GR6ZLYMF5VLS27PY_how_taxes_affect_list_prices.txt
  - Quoted in: not quoted (read for context only)
- **How EU Taxes Affect eBooks List Price**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201645450
  - Date text on the page: 35% table headed "as of May 1, 2020"; 70% table headed "as of July 7, 2026"; VAT % column "As of 5/1/2020"
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201645450_how_eu_taxes_affect_ebooks_list_price.txt
  - Quoted in: kdp-ebook-facts.json
- **Goods and Services Tax (GST) for eBooks in Australia and India**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202169970
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202169970_goods_and_services_tax_gst_for_ebooks_in_australia_and_india.txt
  - Quoted in: kdp-ebook-facts.json
- **Taiwan VAT**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202183400
  - Date text on the page: "As of September 1, 2017"
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202183400_taiwan_vat.txt
  - Quoted in: kdp-ebook-facts.json
- **Setting Prices for Amazon Japan**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201849770
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201849770_setting_prices_for_amazon_japan.txt
  - Quoted in: kdp-ebook-facts.json
- **eBook Distribution Rights**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200652410
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200652410_ebook_distribution_rights.txt
  - Quoted in: kdp-ebook-facts.json
- **Kindle Direct Publishing Terms and Conditions**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200627430
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200627430_kindle_direct_publishing_terms_and_conditions.txt
  - Quoted in: not quoted (read for context only)
- **Kindle Direct Publishing Terms and Conditions (the URL redirects to kdp-eu.amazon.com/agreement?token=...)**
  - URL: https://kdp.amazon.com/terms-and-conditions
  - Date text on the page: Last Updated: October 21, 2026
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_terms_and_conditions.txt
  - Quoted in: kdp-ebook-facts.json
- **KDP Select**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200798990
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200798990_kdp_select.txt
  - Quoted in: not quoted (read for context only)
- **KDP Select Enrollment**
  - URL: https://kdp.amazon.com/en_US/help/topic/GD9PMU58BV24QFZ7
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GD9PMU58BV24QFZ7_kdp_select_enrollment.txt
  - Quoted in: kdp-ebook-facts.json
- **KDP Select Benefits**
  - URL: https://kdp.amazon.com/en_US/help/topic/GEZBMTMYGN9EBTLG
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GEZBMTMYGN9EBTLG_kdp_select_benefits.txt
  - Quoted in: not quoted (read for context only)
- **Free Book Promotions**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201298240
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201298240_free_book_promotions.txt
  - Quoted in: not quoted (read for context only)
- **Kindle Countdown Deals**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201293780
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201293780_kindle_countdown_deals.txt
  - Quoted in: not quoted (read for context only)
- **Kindle+**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201537300
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201537300_kindle.txt
  - Quoted in: kdp-ebook-facts.json

### KDP: cover, manuscript formats, upload, Kindle Publishing Guidelines (38 pages)

- **What criteria does my eBook's cover image need to meet?**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200645690
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200645690_what_criteria_does_my_ebook_s_cover_image_need_to_meet.txt
  - Quoted in: kdp-ebook-facts.json
- **Cover Image Guidelines for Kindle eBooks**
  - URL: https://kdp.amazon.com/en_US/help/topic/G6GTK3T3NUHKLEFX
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G6GTK3T3NUHKLEFX_cover_image_guidelines_for_kindle_ebooks.txt
  - Quoted in: kdp-ebook-facts.json
- **Update Your Cover**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200965970
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200965970_update_your_cover.txt
  - Quoted in: not quoted (read for context only)
- **Why is my cover image not updating on Amazon?**
  - URL: https://kdp.amazon.com/en_US/help/topic/GNAJS6UTKE9Q3PT9
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GNAJS6UTKE9Q3PT9_why_is_my_cover_image_not_updating_on_amazon.txt
  - Quoted in: kdp-ebook-facts.json
- **What file formats are supported for eBook manuscripts?**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200634390
  - Date text on the page: No date. Table says "Effective March 2025, we will no longer accept MOBI files for fixed-layout eBooks."
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200634390_what_file_formats_are_supported_for_ebook_manuscripts.txt
  - Quoted in: kdp-ebook-facts.json
- **Format Your eBook**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201723130
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201723130_format_your_ebook.txt
  - Quoted in: not quoted (read for context only)
- **Create a Table of Contents**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201605700
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201605700_create_a_table_of_contents.txt
  - Quoted in: not quoted (read for context only)
- **Create a Table of Contents with a Navigation Document**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201605710
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201605710_toc_navigation_document.txt
  - Quoted in: kdp-ebook-facts.json
- **Upload and Preview Book Content**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200641240
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200641240_upload_and_preview_book_content.txt
  - Quoted in: kdp-ebook-facts.json
- **Upload Book Resources**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202175860
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202175860_upload_book_resources.txt
  - Quoted in: not quoted (read for context only)
- **Digital Rights Management**
  - URL: https://kdp.amazon.com/en_US/help/topic/GDDXGH9VR22ACM8U
  - Date text on the page: "Effective January 20, 2026, verified purchasers can download the EPUB and PDF files of your confirmed DRM-free books."
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GDDXGH9VR22ACM8U_digital_rights_management.txt
  - Quoted in: kdp-ebook-facts.json
- **Enhanced Typesetting**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202087570
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202087570_enhanced_typesetting.txt
  - Quoted in: not quoted (read for context only)
- **KDP Tools and Resources**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200735480
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200735480_kdp_tools_and_resources.txt
  - Quoted in: not quoted (read for context only)
- **eBook Manuscript Formatting Guide**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200645680
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200645680_ebook_manuscript_formatting_guide.txt
  - Quoted in: not quoted (read for context only)
- **MOBI Support for eBooks Frequently Asked Questions**
  - URL: https://kdp.amazon.com/en_US/help/topic/GULSQMHU5MNH4EZM
  - Date text on the page: "Effective March 18, 2025, we no longer support MOBI files for fixed-layout eBooks."
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GULSQMHU5MNH4EZM_mobi_support_faq.txt
  - Quoted in: kdp-ebook-facts.json
- **Basic HTML Formatting Guidelines**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200673220
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200673220_basic_html_formatting_guidelines.txt
  - Quoted in: kdp-ebook-facts.json
- **Save Your Manuscript File**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202145060
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202145060_save_your_manuscript_file.txt
  - Quoted in: kdp-ebook-facts.json
- **Update Your Manuscript**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202176900
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202176900_update_your_manuscript.txt
  - Quoted in: not quoted (read for context only)
- **Guide to Kindle Content Quality**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200952510
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200952510_guide_to_kindle_content_quality.txt
  - Quoted in: not quoted (read for context only)
- **Accessibility for eBooks**
  - URL: https://kdp.amazon.com/en_US/help/topic/GBPE3QVZ2J3HLQ4B
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GBPE3QVZ2J3HLQ4B_accessibility_for_ebooks.txt
  - Quoted in: not quoted (read for context only)
- **Kindle Publishing Guidelines**
  - URL: https://kdp.amazon.com/en_US/help/topic/GU72M65VRFPH43L6
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GU72M65VRFPH43L6_kindle_publishing_guidelines.txt
  - Quoted in: not quoted (read for context only)
- **Introduction**
  - URL: https://kdp.amazon.com/en_US/help/topic/GQ2WJ2EXJUMPXEGQ
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GQ2WJ2EXJUMPXEGQ_introduction.txt
  - Quoted in: not quoted (read for context only)
- **Paths to Getting Your Content on Kindle**
  - URL: https://kdp.amazon.com/en_US/help/topic/G79CTKR8BX79E96L
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G79CTKR8BX79E96L_paths_to_getting_your_content_on_kindle.txt
  - Quoted in: kdp-ebook-facts.json
- **Comparing Formats**
  - URL: https://kdp.amazon.com/en_US/help/topic/G42HENP2VHSN8VW8
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G42HENP2VHSN8VW8_comparing_formats.txt
  - Quoted in: not quoted (read for context only)
- **Navigation Guidelines**
  - URL: https://kdp.amazon.com/en_US/help/topic/GY3AD8C6C6GAG42N
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GY3AD8C6C6GAG42N_navigation_guidelines.txt
  - Quoted in: kdp-ebook-facts.json
- **Hyperlink Guidelines**
  - URL: https://kdp.amazon.com/en_US/help/topic/GQ6JQ7FM6C72HE4X
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GQ6JQ7FM6C72HE4X_hyperlink_guidelines.txt
  - Quoted in: not quoted (read for context only)
- **QA Standards**
  - URL: https://kdp.amazon.com/en_US/help/topic/GGRXLC5USU4H67YM
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GGRXLC5USU4H67YM_qa_standards.txt
  - Quoted in: kdp-ebook-facts.json
- **Boxed and Bundles Edition Guidelines (eBook format only)**
  - URL: https://kdp.amazon.com/en_US/help/topic/GD4TJFW4JEESLH4B
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GD4TJFW4JEESLH4B_boxed_and_bundles_edition_guidelines_ebook_format_only.txt
  - Quoted in: not quoted (read for context only)
- **Creating Reflowable Books**
  - URL: https://kdp.amazon.com/en_US/help/topic/GPNJPYK298J8TRRV
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GPNJPYK298J8TRRV_creating_reflowable_books.txt
  - Quoted in: not quoted (read for context only)
- **Text Guidelines - Reflowable**
  - URL: https://kdp.amazon.com/en_US/help/topic/GH4DRT75GWWAGBTU
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GH4DRT75GWWAGBTU_text_guidelines_reflowable.txt
  - Quoted in: kdp-ebook-facts.json
- **Image Guidelines - Reflowable**
  - URL: https://kdp.amazon.com/en_US/help/topic/G75V4YX5X8GRGXWV
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G75V4YX5X8GRGXWV_image_guidelines_reflowable.txt
  - Quoted in: kdp-ebook-facts.json
- **Table Guidelines - Reflowable**
  - URL: https://kdp.amazon.com/en_US/help/topic/GZ8BAXASXKB5JVML
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GZ8BAXASXKB5JVML_table_guidelines_reflowable.txt
  - Quoted in: kdp-ebook-facts.json
- **Enhanced Typesetting and Page Flip**
  - URL: https://kdp.amazon.com/en_US/help/topic/GNY87A6WM6EK6YEE
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GNY87A6WM6EK6YEE_enhanced_typesetting_and_page_flip.txt
  - Quoted in: not quoted (read for context only)
- **Attributes and Tags Supported by Enhanced Typesetting**
  - URL: https://kdp.amazon.com/en_US/help/topic/GB5GDY7WAJDN9GFK
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GB5GDY7WAJDN9GFK_attributes_and_tags_supported_by_enhanced_typesetting.txt
  - Quoted in: kdp-ebook-facts.json
- **HTML and CSS Tags Supported in Kindle Format 8**
  - URL: https://kdp.amazon.com/en_US/help/topic/GG5R7N649LECKP7U
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GG5R7N649LECKP7U_html_and_css_tags_supported_in_kindle_format_8.txt
  - Quoted in: kdp-ebook-facts.json
- **Media Queries**
  - URL: https://kdp.amazon.com/en_US/help/topic/GR4KL488MXKPZ5BK
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GR4KL488MXKPZ5BK_media_queries.txt
  - Quoted in: kdp-ebook-facts.json
- **Guidelines for Creating a Source File**
  - URL: https://kdp.amazon.com/en_US/help/topic/GRWTKMGXU2MV5KKP
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GRWTKMGXU2MV5KKP_guidelines_for_creating_a_source_file.txt
  - Quoted in: not quoted (read for context only)
- **Amazon Kindle Publishing Guidelines (PDF)**
  - URL: https://kindlegen.s3.amazonaws.com/AmazonKindlePublishingGuidelines.pdf
  - Date text on the page: version 2026.3; PDF metadata creation date 2026-10-07; 132 pages (the copyright line still reads 2025)
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kindle_publishing_guidelines_pdf.txt
  - Quoted in: kdp-ebook-facts.json

### KDP: listing metadata (description, keywords, categories, titles, series, age) (27 pages)

- **Write a Book Description**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201189630
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201189630_write_a_book_description.txt
  - Quoted in: kdp-ebook-facts.json
- **Fixing errors or formatting with book descriptions**
  - URL: https://kdp.amazon.com/en_US/help/topic/GC4VASCGNQP6LQ7L
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GC4VASCGNQP6LQ7L_fixing_errors_or_formatting_with_book_descriptions.txt
  - Quoted in: kdp-ebook-facts.json
- **Make Your Book More Discoverable with Keywords**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201298500
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201298500_make_your_book_more_discoverable_with_keywords.txt
  - Quoted in: kdp-ebook-facts.json
- **How do I add/change my keywords?**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201743260
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201743260_how_do_i_add_change_my_keywords.txt
  - Quoted in: kdp-ebook-facts.json
- **KDP Categories**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200652170
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200652170_kdp_categories.txt
  - Quoted in: kdp-ebook-facts.json
- **Books Titles & Editions**
  - URL: https://kdp.amazon.com/en_US/help/topic/GW7J4WEKBVU25YEC
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GW7J4WEKBVU25YEC_books_titles_editions.txt
  - Quoted in: kdp-ebook-facts.json
- **Fixing typos on a book title or author name**
  - URL: https://kdp.amazon.com/en_US/help/topic/G26BXKD4QE4835CE
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G26BXKD4QE4835CE_fixing_typos_on_a_book_title_or_author_name.txt
  - Quoted in: not quoted (read for context only)
- **Authors & Contributors**
  - URL: https://kdp.amazon.com/en_US/help/topic/G2BWJN2BY98T5PV2
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G2BWJN2BY98T5PV2_authors_contributors.txt
  - Quoted in: not quoted (read for context only)
- **Metadata Guidelines for Books**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201097560
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201097560_metadata_guidelines_for_books.txt
  - Quoted in: kdp-ebook-facts.json
- **Primary Audience and Reading Age**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201506310
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201506310_primary_audience_and_reading_age.txt
  - Quoted in: kdp-ebook-facts.json
- **Start a Book Series**
  - URL: https://kdp.amazon.com/en_US/help/topic/GMFKBUS43QQ5AJ5A
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GMFKBUS43QQ5AJ5A_start_a_book_series.txt
  - Quoted in: kdp-ebook-facts.json
- **Update Your Series**
  - URL: https://kdp.amazon.com/en_US/help/topic/G6PVAHKQS87GVK6A
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G6PVAHKQS87GVK6A_update_your_series.txt
  - Quoted in: not quoted (read for context only)
- **Edit your Series**
  - URL: https://kdp.amazon.com/en_US/help/topic/GJ3E8KQDLQ3NH3T9
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GJ3E8KQDLQ3NH3T9_edit_your_series.txt
  - Quoted in: kdp-ebook-facts.json
- **Set the reading order for your series**
  - URL: https://kdp.amazon.com/en_US/help/topic/G29L44KLZ6RDYGDP
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G29L44KLZ6RDYGDP_set_the_reading_order_for_your_series.txt
  - Quoted in: kdp-ebook-facts.json
- **Create a Book**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202172740
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202172740_create_a_book.txt
  - Quoted in: kdp-ebook-facts.json
- **Book Detail Resources**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202105800
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202105800_book_detail_resources.txt
  - Quoted in: kdp-ebook-facts.json
- **Update your book details**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200736410
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200736410_update_your_book_details.txt
  - Quoted in: kdp-ebook-facts.json
- **Publishing Public Domain Content**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200743940
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200743940_publishing_public_domain_content.txt
  - Quoted in: not quoted (read for context only)
- **Release Date Options**
  - URL: https://kdp.amazon.com/en_US/help/topic/GZUV7SNV728WT4QE
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GZUV7SNV728WT4QE_release_date_options.txt
  - Quoted in: not quoted (read for context only)
- **Kindle eBook Pre-Order**
  - URL: https://kdp.amazon.com/en_US/help/topic/G201499380
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G201499380_kindle_ebook_pre_order.txt
  - Quoted in: not quoted (read for context only)
- **Content Guidelines**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200672390
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200672390_content_guidelines.txt
  - Quoted in: not quoted (read for context only)
- **Start publishing with KDP**
  - URL: https://kdp.amazon.com/en_US/help/topic/GHKDSCW2KQ3K4UU4
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GHKDSCW2KQ3K4UU4_start_publishing_with_kdp.txt
  - Quoted in: not quoted (read for context only)
- **Timelines**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202173620
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202173620_timelines.txt
  - Quoted in: not quoted (read for context only)
- **2 – Prepare Your Manuscript**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202187840
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202187840_2_prepare_your_manuscript.txt
  - Quoted in: not quoted (read for context only)
- **3 – Prepare Your Cover**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202187850
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202187850_3_prepare_your_cover.txt
  - Quoted in: not quoted (read for context only)
- **4 – Title Setup: Book Details, Content, & Pricing**
  - URL: https://kdp.amazon.com/en_US/help/topic/G73MVSZ5P69VVCN6
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G73MVSZ5P69VVCN6_4_title_setup_book_details_content_pricing.txt
  - Quoted in: kdp-ebook-facts.json
- **5 – Publishing & Review**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202187860
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202187860_5_publishing_review.txt
  - Quoted in: not quoted (read for context only)

### KDP: languages (7 pages)

- **Book Supported Languages**
  - URL: https://kdp.amazon.com/en_US/help/topic/G200673300
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G200673300_book_supported_languages.txt
  - Quoted in: kdp-ebook-facts.json
- **Indian-Language Publishing**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202124400
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202124400_indian_language_publishing.txt
  - Quoted in: kdp-ebook-facts.json
- **Troubleshooting File Conversion Errors**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202124410
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202124410_indian_language_manuscript_guidelines.txt
  - Quoted in: kdp-ebook-facts.json
- **Language & Reading direction**
  - URL: https://kdp.amazon.com/en_US/help/topic/GQSHRFWZ5CEY7XAC
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GQSHRFWZ5CEY7XAC_language_reading_direction.txt
  - Quoted in: kdp-ebook-facts.json
- **Arabic**
  - URL: https://kdp.amazon.com/en_US/help/topic/GUQT4C8J6RR6V8TY
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GUQT4C8J6RR6V8TY_arabic.txt
  - Quoted in: not quoted (read for context only)
- **Chinese (Traditional) (Beta)**
  - URL: https://kdp.amazon.com/en_US/help/topic/G27T64E65VM6JWKK
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G27T64E65VM6JWKK_chinese_traditional_beta.txt
  - Quoted in: kdp-ebook-facts.json
- **Publishing in Hebrew, Persian, and Yiddish**
  - URL: https://kdp.amazon.com/en_US/help/topic/GML3FXP998V8WS4U
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_GML3FXP998V8WS4U_publishing_in_hebrew_persian_and_yiddish.txt
  - Quoted in: kdp-ebook-facts.json

### Kindle Previewer (4 pages)

- **Kindle Previewer**
  - URL: https://kdp.amazon.com/en_US/help/topic/G202131170
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kdp_G202131170_kindle_previewer.txt
  - Quoted in: kdp-ebook-facts.json
- **Amazon.com: Kindle Previewer: Kindle Store**
  - URL: https://www.amazon.com/Kindle-Previewer/b?ie=UTF8&node=21381691011
  - Date text on the page: Undated. Download box reads "Kindle Previewer 4.0.4"
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/amazon_kindle_previewer_product_page.txt
  - Quoted in: kdp-ebook-facts.json
- **Kindle Previewer User Guide (PDF)**
  - URL: https://driz46fl8b4jf.cloudfront.net/UserGuideKPR4_EN.pdf
  - Date text on the page: "V4.0.4 English November 5, 2026"; 23 pages
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kindle_previewer4_user_guide_pdf.txt
  - Quoted in: kdp-ebook-facts.json
- **Kindle Previewer Release Notes (linked from the Kindle Previewer product page)**
  - URL: https://s3.amazonaws.com/kindlepreviewer/UG_ReleaseNotes_EN.txt
  - Date text on the page: Undated. Newest entry: "New in Kindle Previewer 4.0.4"
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/kindle_previewer_release_notes.txt
  - Quoted in: kdp-ebook-facts.json

### Draft2Digital (27 pages)

- **Understanding D2D's Activation and Maintenance Fees - Draft2Digital | Blog**
  - URL: https://draft2digital.com/blog/understanding-d2ds-activation-and-maintenance-fees/
  - Date text on the page: Blog post dated Apr 14, 2026
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_activation_maintenance_fees.txt
  - Quoted in: d2d-facts.json
- **D2D Print: How to Publish a Print Book - Draft2Digital | Blog**
  - URL: https://draft2digital.com/blog/d2d-print-how-to-publish-a-print-book/
  - Date text on the page: Blog post dated May 30, 2025
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_d2d_print_how_to.txt
  - Quoted in: d2d-facts.json
- **Touching Base with D2D - Ask Us Anything! // EP187**
  - URL: https://draft2digital.com/blog/touching-base-with-d2d-ask-us-anything-ep187/
  - Date text on the page: Blog post dated Aug 8, 2024
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_ep187_ask_us_anything.txt
  - Quoted in: d2d-facts.json
- **D2D Print Update & Walk Thru // EP197**
  - URL: https://draft2digital.com/blog/d2d-print-update-walk-thru-ep197/
  - Date text on the page: Blog post dated Oct 17, 2024
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_ep197_print_update.txt
  - Quoted in: d2d-facts.json
- **D2D Print: Everything You Need to Know - Draft2Digital | Blog**
  - URL: https://draft2digital.com/blog/everything-you-need-to-know-about-d2d-print/
  - Date text on the page: Blog post dated Sep 9, 2021
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_everything_about_d2d_print.txt
  - Quoted in: d2d-facts.json
- **How Does Print on Demand (POD) Work? - Draft2Digital | Blog**
  - URL: https://draft2digital.com/blog/how-does-print-on-demand-pod-work/
  - Date text on the page: Blog post dated May 24, 2023
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_how_does_pod_work.txt
  - Quoted in: not quoted (read for context only)
- **D2D Introduces Improved Automated Print Layout - Draft2Digital | Blog**
  - URL: https://draft2digital.com/blog/draft2digital-introduces-improved-automated-layout-for-print/
  - Date text on the page: Blog post dated Jun 10, 2017
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_improved_print_layout.txt
  - Quoted in: not quoted (read for context only)
- **The Pocket Guide to eBook Layout - Draft2Digital | Blog**
  - URL: https://www.draft2digital.com/blog/the-pocket-guide-to-ebook-layout/
  - Date text on the page: Blog post dated Dec 20, 2016
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_pocket_guide_ebook_layout.txt
  - Quoted in: not quoted (read for context only)
- **Press Release: Draft2Digital Opens D2D Print to Every Author - Draft2Digital | Blog**
  - URL: https://draft2digital.com/blog/press-release-draft2digital-opens-d2d-print-to-every-author/
  - Date text on the page: Blog post dated Mar 14, 2023
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_press_release_print_open.txt
  - Quoted in: d2d-facts.json
- **D2D Print Masterclass #1: D2D Print Basics**
  - URL: https://draft2digital.com/blog/d2d-print-masterclass-1-d2d-print-basics/
  - Date text on the page: Blog post dated Aug 15, 2022
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_print_masterclass_1.txt
  - Quoted in: d2d-facts.json
- **D2D Print Masterclass #3: Making Changes**
  - URL: https://draft2digital.com/blog/d2d-print-masterclass-3-making-changes/
  - Date text on the page: Blog post dated Aug 29, 2022
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_print_masterclass_3_making_changes.txt
  - Quoted in: d2d-facts.json
- **D2D Print Just Opened Up for Every Author, Everywhere! - Draft2Digital | Blog**
  - URL: https://draft2digital.com/blog/d2d-print-just-opened-up-for-every-author-everywhere/
  - Date text on the page: Blog post dated Mar 14, 2023
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_print_open_every_author.txt
  - Quoted in: not quoted (read for context only)
- **Draft2Digital Ebook Royalty Rates - Draft2Digital | Blog**
  - URL: https://draft2digital.com/blog/royalty-rates/
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_royalty_rates.txt
  - Quoted in: d2d-facts.json
- **Starting Your New Ebook with D2D Step-by-Step - Draft2Digital | Blog**
  - URL: https://draft2digital.com/blog/starting-your-new-ebook-with-d2d-step-by-step/
  - Date text on the page: Blog post dated Jul 12, 2023
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_starting_new_ebook_step_by_step.txt
  - Quoted in: d2d-facts.json
- **Your Top D2D Print Questions—Answered! Part 1**
  - URL: https://draft2digital.com/blog/your-top-d2d-print-questions-answered-part-1/
  - Date text on the page: Blog post dated Mar 21, 2023
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_top_print_questions_part1.txt
  - Quoted in: d2d-facts.json
- **Your Top D2D Print Questions—Answered! Part 2**
  - URL: https://draft2digital.com/blog/your-top-d2d-print-questions-answered-part-2/
  - Date text on the page: Blog post dated Mar 28, 2023
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_blog_top_print_questions_part2.txt
  - Quoted in: d2d-facts.json
- **Draft2Digital | Draft2Digital Content Guidelines**
  - URL: https://draft2digital.com/content-guidelines/
  - Date text on the page: Last Updated October 27, 2025
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_content_guidelines.txt
  - Quoted in: d2d-facts.json
- **Draft2Digital | FAQ**
  - URL: https://draft2digital.com/faq/
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_faq.txt
  - Quoted in: d2d-facts.json
- **Draft2Digital**
  - URL: https://draft2digital.com/
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_home.txt
  - Quoted in: d2d-facts.json
- **Draft2Digital | Knowledge Base**
  - URL: https://draft2digital.com/knowledge-base/
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_knowledge_base.txt
  - Quoted in: d2d-facts.json
- **Draft2Digital | Library Pricing**
  - URL: https://draft2digital.com/library-pricing/
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_library_pricing.txt
  - Quoted in: d2d-facts.json
- **Draft2Digital | Partners**
  - URL: https://draft2digital.com/partners/
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_partners.txt
  - Quoted in: d2d-facts.json
- **Draft2Digital | Amazon**
  - URL: https://draft2digital.com/partners/amazon/
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_partners_amazon.txt
  - Quoted in: d2d-facts.json
- **Draft2Digital | D2D Print Calculator (JavaScript page; saved text holds the inline data and script excerpts)**
  - URL: https://draft2digital.com/podcalc
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_podcalc.txt
  - Quoted in: d2d-facts.json
- **Draft2Digital | Step By Step**
  - URL: https://draft2digital.com/steps/
  - Date text on the page: none on page
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_steps.txt
  - Quoted in: d2d-facts.json
- **Draft2Digital | Terms of Service**
  - URL: https://draft2digital.com/terms-of-service/
  - Date text on the page: Effective April 14, 2026
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_terms_of_service.txt
  - Quoted in: d2d-facts.json
- **Draft2Digital | Terms of Service**
  - URL: https://draft2digital.com/terms-of-service/updates/
  - Date text on the page: Newest entry: April 2026
  - Saved text: /tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/kdp-ebook-d2d/pages/d2d_terms_of_service_updates.txt
  - Quoted in: d2d-facts.json

