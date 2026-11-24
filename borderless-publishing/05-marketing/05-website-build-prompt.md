# Prompt: build the Borderless Publishing website

*Copy everything below the line into a new conversation with the model that will build the site. Fill in the three blanks in "Facts to fill in" first, or leave them as placeholders. Attach the logo files of the brand option you chose (`01-brand/options` or `01-brand/logo/svg`) and, if you can, the Markdown files of this kit (website text, submission guidelines, pricing policy, author guide).*

---

You are a senior web developer and designer who has built websites for independent book publishers. Build the complete website for **Borderless Publishing**, a small independent publisher in Sydney, Australia. Work carefully and completely: plan first, then build in phases, and check your own work with tests and screenshots at phone and desktop sizes before you call any phase finished.

## 1. The publisher

- Borderless Publishing is an independent publisher based in Sydney, New South Wales, founded by Dr Saad Islam, who is also one of its authors.
- It publishes fiction and nonfiction **in English and Bangla (Bengali)**, and translations between the two. Many of its readers and authors live in Australia and Bangladesh, or between both.
- **Reach First pricing.** Every price is set as close as practical to the lowest price each bookseller allows, plus the margins chosen by the author and the publisher (which may be nothing), so that books reach as many readers as possible. The publisher uses the same method for every book and does not raise prices when a book sells well.
- **For authors:** authors never pay to be published (no fees, no required purchases). They keep their copyright and grant a licence for five years from publication, then year to year. Each author chooses their own margin per copy (any amount, including nothing), and the publisher chooses its margin (also any amount, including nothing); the price is the lowest each store allows plus both margins, and what a copy earns is split in proportion to the two margins. Authors may also choose a free ebook (free wherever stores allow it) and open access (the ebook shared under a Creative Commons BY-NC-ND licence). Common choices: Shared ($0.50 each), Author first ($1 to the author, nothing to the publisher), Author earns more ($3 and $1), At cost (nothing and nothing), Free ebook, Open access. Statements every six months. No advances. The "For authors" page must explain the margins with a simple interactive example (two sliders or number fields for the two margins showing the price and both shares for one sample book, using fixed sample figures, not live store data) and a table of the common choices, and book pages for free and open access books must offer the free ebook download (EPUB, and PDF where supplied) directly on the site, with the licence shown for open access books. Authors can take their rights back if a book stops selling.
- **Formats:** paperback, hardcover, large print, ebook, and sometimes audiobook.
- **Where books are sold:** Amazon (Kindle, paperback, hardcover) in every Amazon store; Apple Books, Kobo, Barnes and Noble and library services (OverDrive and others) for ebooks; any bookshop or library worldwide can order the printed books through Ingram by ISBN. Some local bookshops stock copies directly.
- **Tone of voice:** warm, plain, honest, never salesy. Short sentences. Australian English spelling (colour, organise, travelled).

### Facts to fill in

- Contact email: [hello@____]
- Domain: [____]
- ABN: [____]

Where any other fact is missing (a book, a price, a biography, an event), use a clearly marked placeholder such as `[TO FILL: author biography]`. **Never invent** reviews, ratings, endorsements, awards, sales figures, testimonials, quotations, events, media coverage or people.

## 2. Things the site must never do

1. **No em dashes or en dashes anywhere**, in text, headings, buttons, metadata or code comments. Use commas, colons, brackets, or "to" for ranges (pages 12 to 18). The publisher's house style forbids them. Add an automated check that fails the build if the characters U+2013 or U+2014 appear in any content or template file.
2. **No statements about donations, charity or giving profits away.** Do not describe the business as "not for profit" or as a charity.
3. No invented social proof (see above), no fake scarcity, no countdowns, no pop ups, no dark patterns.
4. No tracking: no Google Analytics, no advertising pixels, no third party cookies, no fonts or scripts loaded from third party servers. Fonts are self hosted. If any analytics is wanted later, it must be a privacy friendly, cookie free option that is switched off by default.
5. No affiliate links unless the publisher adds them later through configuration.

## 3. Brand

Use the brand option attached to this message. If none is attached, use these values (Option 1, "Open Pages"):

| Role | Value |
| --- | --- |
| Primary colour | Delta navy #14213D |
| Accent | River gold #C8963E (decoration, large text and icons only: it does not have enough contrast for body text on white) |
| Background | Paper #F7F3EA and white |
| Body text | #1B1B1B |
| Typeface | EB Garamond for headings and reading text; Source Sans 3 for navigation, labels, forms and small text; Noto Serif Bengali (reading) and Noto Sans Bengali (interface) for Bangla. All are free under the SIL Open Font Licence; self host the WOFF2 files and subset them. |
| Tagline | Books priced for readers. |
| Logo | The attached SVG files: horizontal version in the header, stacked version in the footer, the mark alone as the favicon and app icon |

The feeling: a calm, beautiful bookshop with good light, not a startup. Generous white space, book covers as the main images, real typography (proper quotation marks, an ellipsis character, old style figures in running text where the font has them, small caps for abbreviations), a comfortable reading measure of 60 to 75 characters. Check every colour pair for WCAG AA contrast and adjust shades where needed, explaining any change.

## 4. Who the site is for, and what each must be able to do in under a minute

| Visitor | Tasks |
| --- | --- |
| Reader | Find a book, read about it, read a sample chapter, see the price and formats, and go to their preferred store in their country; find the book in a library; follow an author |
| Bangla reader | Use the whole site in Bangla, and find Bangla books first |
| Author thinking of submitting | Understand the terms in plain words, see what the publisher does, read the guidelines, and submit |
| Bookshop or library buyer | Find ISBNs, formats, prices, publication dates and how to order (Ingram, or directly); download a one page sell sheet |
| Journalist, reviewer, event organiser | Download covers, author photos, press releases and logos; request a review copy; contact the publisher |
| Rights buyer or translator | Find which rights are available and whom to ask |

## 5. Pages

1. **Home:** the latest and forthcoming books, a short statement of what Borderless is (Reach First pricing, two languages, authors never pay), a featured author, latest news, upcoming events, newsletter sign up.
2. **Books (catalogue):** every book as a cover grid with title, author and formats. Filter by genre, language, format, series and availability (out now, forthcoming); sort by newest and title; search by title, author or ISBN. Filters must be links that work without JavaScript and can be bookmarked.
3. **Book page** (one for each book), with:
   - cover (zoomable), title, subtitle, author(s) and contributors (translator, illustrator), series and number;
   - description, a short pitch, content notes where given, and quotations from the book (never invented praise);
   - formats table: format, ISBN (with a "copy" button), page count, trim size, publication date, price;
   - **buy buttons per country**: a country selector (default Australia, remembered on the device in local storage only) that shows the right Amazon store and other stores for that country, plus "Ask your local bookshop" (shows the ISBN and that bookshops can order through Ingram) and "Find it in a library" (links to Trove for Australia and WorldCat elsewhere, by ISBN);
   - **read a sample**: the first chapter shown in a clean, accessible in-page reader (from an HTML or EPUB sample file supplied with the book), with adjustable text size and light, sepia and dark themes;
   - reading group questions and the sell sheet as downloadable PDFs when supplied;
   - "more by this author", "more in this series";
   - structured data and a sharing image (see section 7).
4. **Series page** for each series, with books in reading order.
5. **Authors** list and an **author page** for each: photo, biography, books, events, links, and a short interview if supplied.
6. **Bangla books (বাংলা বই):** a landing page for Bangla and bilingual books and translations.
7. **How we price (Reach First):** the policy in plain words, with an interactive example for one real book: drag or choose a format and store and see where the price goes (store share, printing, author, publisher). The figures come from the book's data, never typed into the page.
8. **For authors:** what we offer, how authors choose their margin (common choices table with a worked example), the terms in plain words, the road from contract to publication (a simple timeline), frequently asked questions, the submission guidelines, and the **submission form** (section 6).
9. **For bookshops and libraries:** how to order through Ingram or directly, trade information for every title in a sortable table, a download of all titles as a CSV file (title, author, ISBN, format, price, publication date), sell sheets, and a contact for direct and consignment orders.
10. **News:** articles with dates, tags and author; RSS feed.
11. **Events:** launches, readings and festival appearances, past and upcoming, each with date, time, place, map link, and an "add to calendar" (.ics) download.
12. **Media kit:** logos (SVG and PNG, light and dark), author photographs with credits, cover images in print resolution, press releases, a contact for review copies.
13. **Rights and permissions:** which rights the publisher can license (translation, audio, film are usually kept by authors: say so), and how to request permission to quote.
14. **About:** the story of the press and its founder, the two languages, how the press works.
15. **Contact:** email, a simple contact form, the city, the ABN.
16. **Newsletter** sign up and confirmation pages.
17. **Privacy statement**, **accessibility statement**, **terms of use**, and a helpful **404** page with search.

## 6. Features in detail

- **Two languages.** Full English and Bangla versions of the interface and of every page that has a translation, with a language switcher on every page, correct `lang` attributes, `hreflang` links, URLs such as `/bn/books/...`, and Bengali digits where the Bangla text uses them. Book titles and descriptions appear in the language of the book, with the other language where supplied. Check that Bangla conjuncts and vowel signs render correctly in the self hosted fonts.
- **Submission form:** name, email, country, title, genre, language, word count, a short pitch, synopsis, the first three chapters as a file upload (Word or PDF, at most 10 MB), whether it is a translation and who holds the rights, a question about use of artificial intelligence tools, and consent to the privacy statement. Show what happens next and the expected reply time. Protect it from spam without third party trackers (honeypot field and a time check, plus rate limiting where the host allows). Deliver submissions by email to the publisher through a simple serverless function or a privacy friendly form service; make the destination configurable and document it. Send an automatic acknowledgement email.
- **Newsletter:** double opt in, the publisher's name and contact in every email, and a one click unsubscribe (as Australia's Spam Act 2003 requires). Use a provider that can be swapped; keep subscriber data out of the site's code.
- **Search:** fast static search across books, authors and news (for example Pagefind), working in both languages.
- **Prices:** show the price in Australian dollars by default and the price in the visitor's chosen country where the book's data includes it. Never convert currencies in the browser; show only prices from the data, with the date they were last updated.
- **Forthcoming books:** pre-order links where they exist, otherwise "coming [month year]" and a "tell me when it is out" sign up.
- **Accessibility:** WCAG 2.2 AA throughout: keyboard navigation, visible focus, skip link, alt text for every cover (title and author at least), captions for any video, no information by colour alone, respects reduced motion, text that can be enlarged to 200 percent without breaking.
- **Print:** a print stylesheet for book pages and the trade table.
- **Social sharing:** an Open Graph image for every book (cover on the brand background with title and author), generated at build time.

## 7. Technical requirements

- **A static site, no database, content in files.** Recommended: Astro with content collections, TypeScript, and plain CSS with custom properties (or another static site generator if you have a strong reason, which you must explain). It must deploy to any static host (Cloudflare Pages, Netlify or Vercel) and run locally with one command.
- **Book data in one place.** The publisher makes its books with its own program, Borderless Studio, which keeps each book as a folder containing `book.json` (title, contributors, series, language, editions with ISBN, trim size, page count) and `metadata/listing.json` (description, keywords, categories), and can export ONIX 3.0 XML. Design the content schema so that a book page can be generated either from a simple Markdown file with front matter or from an ONIX 3.0 file placed in a `data/onix` folder. Write the importer for ONIX 3.0 (reference tag names: Product, RecordReference, ProductIdentifier with ISBN-13, DescriptiveDetail, ProductForm, Contributor, TitleDetail, Collection, Extent, Subject, CollateralDetail, PublishingDetail, ProductSupply with Price). Document both ways clearly.
- **Content schema for a book** (at least): slug; title; subtitle; contributors with roles; series name and number; language; genres; Thema and BISAC codes (optional); description (Markdown); short pitch; content notes; publication date; status (forthcoming, available, out of print); editions, each with format, ISBN, pages, trim size, prices per currency, and store links per country; cover image; sample file; downloads; quotations; related books.
- **Content schema for an author:** slug, name, name in Bangla, photo with credit, biography in each language, links, books.
- **Structured data** (JSON-LD, valid in Google's Rich Results test and the Schema.org validator): `Book` with `workExample` for each edition (`isbn`, `bookFormat`, `numberOfPages`, `inLanguage`, `offers` with price and currency), `Person` for authors, `Organization` for the publisher, `Event` for events, `BreadcrumbList`, and `WebSite` with a search action.
- **SEO:** unique titles and descriptions, canonical URLs, XML sitemap (both languages), robots.txt, clean URLs (`/books/the-salt-road/`), redirects for changed slugs.
- **Performance:** Lighthouse 95 or more for performance, accessibility, best practices and SEO on phone and desktop. Responsive images in AVIF and WebP with fixed dimensions (no layout shift), lazy loading below the fold, little or no client JavaScript (islands only where needed: country selector, sample reader, pricing example, search), and system font fallbacks with matched metrics to avoid layout shift.
- **Security:** a strict Content Security Policy, no secrets in the repository (form and newsletter keys in environment variables), and dependencies kept to a minimum.
- **Editing without a developer:** write a short guide for a non-developer explaining how to add a book, an author, a news post and an event, how to update prices, and how to publish. If you add a browser based editor (for example Decap CMS on top of the git repository), keep it optional.

## 8. Sample content

Seed the site so every page can be seen working:

- The book **The Salt Road: A Sample Book of Placeholder Text** by Dr Saad Islam (novel, English, 62,000 words; paperback 5.5 x 8.5 in, 204 pages; hardcover 6 x 9 in; ebook), clearly labelled as a sample, with placeholder ISBNs marked as not real.
- One forthcoming Bangla title and one translation, both marked `[TO FILL]`.
- The author page for Dr Saad Islam with `[TO FILL]` where facts are missing.
- One news post and one event, both clearly marked as examples.
- The text of the attached kit files where supplied (website text, submission guidelines, Reach First pricing policy, guide for authors), adapted to the web without changing their meaning.

## 9. How to work, and what to deliver

1. **Before coding**, write a short plan: site map, content schema, technology choices with reasons, and every assumption you are making. Then build.
2. Build in phases, each one runnable: (a) layout, brand, home, catalogue and book pages from sample data; (b) authors, series, Bangla, search; (c) authors' pages, submission form, bookshops and libraries, media kit; (d) news, events, newsletter, legal pages, ONIX import; (e) accessibility, performance and SEO pass.
3. **Automated checks** that run with one command and in continuous integration: build, HTML validation, a link checker, accessibility tests with axe on every page template in both languages, structured data validation, the dash check from section 2, and a test of the ONIX importer against a sample ONIX file.
4. **Screenshots** of every page template at 390 px and 1440 px wide, in English and Bangla.
5. **Deliver:** the full source code; a README covering local setup, deployment to a static host, configuring the form and newsletter, adding content, and importing ONIX; the editing guide for a non-developer; and a list of everything still marked `[TO FILL]`.

When something in this brief is unclear or contradicts itself, choose the option that best serves readers and authors, write down the choice in the plan, and carry on.
