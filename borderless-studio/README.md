# Borderless Studio

An offline desktop studio for writing, editing, typesetting and exporting
books. It produces print interiors, covers and ebooks that follow the upload
rules of Amazon KDP, IngramSpark and Draft2Digital, so that files pass the
platform checks the first time.

Built for Borderless Publishing, Sydney.

* Works fully offline. No account, no telemetry, no cloud. The optional
  online features are switched off until you turn them on.
* Every book is a plain folder of Markdown and JSON files plus your original
  images. You can read, edit, back up and version the folder without the app.
* No platform rule is hard coded. Trim sizes, margins, spine formulas,
  printing costs and royalty rates live in editable spec files, each with a
  "last verified" date and the official page it came from.
* Your writing is never destroyed: autosave, crash safe saves, automatic
  snapshots, and deleted documents go to a trash folder inside the book.

## Contents

1. [What works today](#what-works-today)
2. [Install on a Mac](#install-on-a-mac)
3. [Install on Windows](#install-on-windows)
4. [Run from the source code](#run-from-the-source-code)
5. [Build the installers](#build-the-installers)
6. [Signing the installers](#signing-the-installers)
7. [How a book is stored](#how-a-book-is-stored)
8. [Updating the platform spec files](#updating-the-platform-spec-files)
9. [Platform rules you should verify yourself](#platform-rules-you-should-verify-yourself)
10. [The optional writing assistant](#the-optional-writing-assistant)
11. [Backups and versions](#backups-and-versions)
12. [Tests](#tests)
13. [Design decisions in plain English](#design-decisions-in-plain-english)
14. [Licences of bundled material](#licences-of-bundled-material)

## What works today

The app is built in phases. After each phase it builds, runs and is usable.

| Phase | Contents | State |
| --- | --- | --- |
| 1 | Library and new book wizard, writer, binder, tracked changes and comments, snapshots, search and replace, typography cleaner with dash policy, EPUB 3 export with EPUBCheck, print interior PDF for KDP and IngramSpark trim sizes | Done |
| 2 | Book screen (details, editions, interior design with the six templates and a live preview of real pages, front and back matter), cover builder (paperback, hardcover case, dust jacket, barcode, ebook covers, 3D picture), PDF/X-1a for print files, preflight for interiors, covers and ebooks | Done |
| 3 | Publish screen: Reach First prices for every marketplace, listing editor with KDP preview and copy and paste sheets, Thema lookup, ONIX 3.0 export, ISBN register, publishing checklist with Australian legal deposit; Bangla books from typing to print | Done |
| 4 | Word export (manuscript format and a file for stores) and import of Word, Markdown, text, EPUB and Scrivener manuscripts; spellcheck (en-AU, en-GB, en-US), grammar check, style analysis and consistency check; outline, corkboard, story bible and split screen; backups, restore and optional Git history; samples, advance reader copies, in-app ebook preview and Kindle Previewer button; series manager; spec file editor; large print checks; marketing kit; audiobook preparation; optional writing assistant (off by default) | Done |
| 5 | Books in other languages: 39 languages in the language list (French, Spanish, Arabic, German, Portuguese, Italian, Dutch, Russian, Hindi, Persian, Urdu, Hebrew, Chinese, Japanese, Korean and more); each language's own quotation marks and French spacing; Chapter, Contents and the copyright page in English, French, Spanish, German, Italian, Portuguese, Dutch, Russian, Arabic, Hindi and Bangla; right to left books (Arabic, Persian, Urdu, Hebrew) bound on the right with mirrored page furniture and right to left ebooks; native digits; bundled Arabic, Hebrew and Devanagari fonts; French, Spanish, Portuguese, Dutch and Russian spellcheck | Done |

The engine also runs without the interface, from a terminal:

```
npm run cli -- build sample-book --all      build interiors, covers and ebooks of every edition, with preflight
npm run cli -- build sample-book --format paperback --platform kdp --preview
                                            one edition for one platform, plus a cover picture with guides
npm run cli -- word  sample-book            Word files: manuscript format, and one for stores that convert Word
npm run cli -- import draft.docx ~/Books    start a book from a Word, Markdown, text, EPUB or Scrivener file
npm run cli -- marketing sample-book        marketing copy, sell sheet and quote cards
npm run cli -- audiobook sample-book --narrator "Name"
                                            narration scripts, recording plan and pronunciation guide
npm run cli -- info  sample-book            show the structure, word counts and editions
npm run cli -- specs                        show the spec files and their age
npm run cli -- tools                        show which helper tools were found
```

### Where things are in the app

| Screen | What you do there |
| --- | --- |
| Library | All books; new book, import a manuscript, add an existing folder, series |
| Write | The text with binder and inspector (details, review of changes, spelling and style check, assistant, history, search). The switch at the top changes to the outline, the index cards or the story bible; the split screen button keeps a second document in view |
| Book | Details, editions (trim, paper, ISBN, large print), interior design with live pages, front and back matter, backups and versions |
| Cover | Cover design for every edition, ebook cover, 3D picture |
| Export | Interiors, covers and ebooks with their checks; samples and advance copies; Word files; ebook preview and Kindle Previewer |
| Publish | Prices, listing, ISBNs, checklist, marketing kit, audiobook preparation |
| Settings | Appearance, publisher details, the optional assistant, helper tools, platform rules (spec files) |

### What is different from the original plan

* **Grammar is checked by Harper**, an open source checker that runs inside
  the app with no connection to anything (Apache licence). It knows
  English only, in the Australian, British, American, Canadian and Indian
  varieties, and follows the spelling variety of the book. Rules that do
  not fit are switched off: its own spelling check (the app has one with
  your dictionary and the names in the story bible), the serial comma
  outside American English, and every rule that asks for a dash unless the
  book allows dashes. It adds about 8 MB to the installer. No checker
  catches everything, and some remarks will be wrong; each one is yours to
  take or leave.
* **No Bangla spelling dictionary is bundled**, because no dictionary with a
  clear licence was found. Put your own `index.aff` and `index.dic` in
  `dictionaries/bn/` inside the library folder and it is used.
* **Word files are written and read by the app itself**, not by Pandoc. Old
  `.doc` files must first be saved as `.docx`.
* **PDF/X-1a, not X-3**, is written for IngramSpark, which is what its file
  guide asks for.

## Install on a Mac

For a MacBook with Apple Silicon (M1 or later), macOS 13.3 or later.

1. Get `Borderless Studio_x.y.z_aarch64.dmg`. It is produced by the GitHub
   workflow (repository page, **Actions** tab, newest "Borderless Studio" run,
   **Artifacts** at the bottom of the page), or build it yourself, see below.
2. Open the `.dmg` and drag **Borderless Studio** to **Applications**.
3. First start. Unless the installer was signed with an Apple Developer ID
   (see [Signing the installers](#signing-the-installers)), macOS will say it
   cannot verify the app. Open **System Settings, Privacy and Security**,
   scroll down, and press **Open Anyway** next to Borderless Studio. This is
   needed once. A copy you built on the same Mac starts without this step.

Everything the app needs is inside it: the typesetting engine (Typst), the
fonts, EPUBCheck and a small Java runtime. Nothing else has to be installed.

## Install on Windows

For Windows 10 or 11, 64 bit.

1. Get `Borderless Studio_x.y.z_x64_en-US.msi` or
   `Borderless Studio_x.y.z_x64-setup.exe` from the same place as above. Both
   install the same app; the `.exe` installs for the current user without
   administrator rights.
2. Run it. Unless the installer was signed, Windows SmartScreen shows "Windows
   protected your PC". Press **More info**, then **Run anyway**.
3. Windows 11 already contains the WebView2 component the app uses. On an old
   Windows 10 computer the installer downloads it if it is missing (this is
   the only time the installer needs the internet).

## Run from the source code

You need:

* [Node.js](https://nodejs.org) 22.13 or later
* [Rust](https://rustup.rs) (stable)
* Java 17 or later, for EPUBCheck while developing (the installers bundle
  their own runtime). [Temurin](https://adoptium.net) works well.
* macOS: the Xcode command line tools (`xcode-select --install`)
* Windows: "Desktop development with C++" from the Visual Studio Build Tools
* Linux: the WebKitGTK 4.1 development packages (see the Tauri prerequisites)

Then, inside the `borderless-studio` folder:

```
npm install
npm run fetch-tools     downloads Typst and EPUBCheck (pinned versions, checksums verified)
npm run dev             starts the app with live reload
```

Other useful commands:

```
npm test                all automated tests
npm run typecheck       type checks
npm run sample          builds every edition of the sample book into sample-book/exports
npm run bridge          lets the interface run in a normal browser for development
```

`npm run fetch-tools` is the only step that uses the internet. After it, both
development and the finished app work offline.

## Build the installers

On the computer you are building for:

```
npm install
npm run fetch-tools
node scripts/build-jre.mjs      optional: packs a small Java runtime into the installer
npm run build
```

The results are written to `apps/desktop/src-tauri/target/release/bundle/`:

| System | Files |
| --- | --- |
| macOS | `dmg/Borderless Studio_x.y.z_aarch64.dmg` and `macos/Borderless Studio.app` |
| Windows | `msi/Borderless Studio_x.y.z_x64_en-US.msi` and `nsis/Borderless Studio_x.y.z_x64-setup.exe` |
| Linux | `deb/`, `rpm/` and `appimage/` |

A Mac installer has to be built on a Mac and a Windows installer on Windows.
If you do not want to set up both, let GitHub do it: the workflow in
`.github/workflows/borderless-studio.yml` builds the macOS `.dmg` and the
Windows `.msi` and `.exe` on every push, and attaches them to a draft release
when you push a tag such as `borderless-studio-v0.1.0`.

If the **Actions** tab of the repository shows a button asking you to enable
workflows (GitHub does this on some forks), press it once. After that, use
**Run workflow** on the "Borderless Studio" workflow, or push a commit. The
workflow has been run on this repository: it produced the macOS `.dmg`
(about 96 MB) and the Windows `.msi` and `.exe` (about 90 MB each).

If you skip `build-jre.mjs` the app still works, but exporting ebooks then
needs a Java installed on the computer (EPUBCheck is a Java program).

## Signing the installers

The installers are ready to be signed, and they also work unsigned.

**Without any setup**

* macOS: the app gets an "ad-hoc" signature, which Apple Silicon requires for
  any program to run. Gatekeeper asks for the one time **Open Anyway** step
  described above.
* Windows: the installers are unsigned and SmartScreen asks for
  **More info, Run anyway**.

For a tool you use yourself this is enough.

**With an Apple Developer ID** (Apple Developer Program membership)

Add these repository secrets (Settings, Secrets and variables, Actions) and
the workflow signs and notarises the `.dmg`:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | your "Developer ID Application" certificate exported as `.p12`, base64 encoded |
| `APPLE_CERTIFICATE_PASSWORD` | the password of that `.p12` |
| `APPLE_SIGNING_IDENTITY` | for example `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple ID, an app specific password, and the team ID, for notarisation |

To sign a local build instead, set `APPLE_SIGNING_IDENTITY` in the terminal
before `npm run build`; it replaces the ad-hoc identity.

Not yet tested, please check on the first signed build: notarisation
inspects every program inside the app, including the bundled Java runtime.
The runtime comes signed by its vendor, which Apple normally accepts. If
notarisation complains about it, build without `build-jre.mjs` and install
Java on the Mac instead.

**With a Windows code signing certificate**

Add `WINDOWS_CERTIFICATE` (the `.pfx` file, base64 encoded) and
`WINDOWS_CERTIFICATE_PASSWORD`. Certificates issued since 2023 usually live
on a hardware key or in a cloud service and cannot be exported as `.pfx`. For
those, set `bundle.windows.signCommand` in
`apps/desktop/src-tauri/tauri.conf.json` to the signing command of your
provider (Tauri documents this under "Windows code signing").

## How a book is stored

A book is a folder. Nothing in it is in a private format.

```
my-book/
  book.json              title, author, language, style rules, editions (trim, paper, ISBN, platforms)
  manuscript/
    binder.json          the order and structure of the manuscript
    *.md                 one Markdown file per scene, chapter or section
    .trash/              documents you deleted in the app (never erased automatically)
  images/                your original images, untouched
  cover/                 cover design and artwork
  bible/                 story bible: characters, places, timeline
  metadata/              retail listing, pricing, publishing checklist
  stats/                 writing log (daily word counts)
  snapshots/             automatic and manual copies of earlier versions of each document
  exports/               the files to upload (safe to delete, rebuilt on demand)
  .borderless/           temporary build files (safe to delete)
  README.txt             explains the folder to a future reader
```

The manuscript is ordinary Markdown with a few additions:

| You type | Meaning |
| --- | --- |
| `***` on its own line | scene break |
| `[^1]` and `[^1]: text` | footnote |
| `{++added++}`, `{--deleted--}`, `{~~old~>new~~}` | tracked changes (CriticMarkup) |
| `{>>a comment<<}`, `{==highlight==}` | comments and highlights |
| `::image[Caption]{src="images/map.png" width="80%"}` | image with caption |
| `:::verse` ... `:::` | poetry, line breaks kept |
| `:::callout` ... `:::` | boxed note (also `note`, `tip`, `warning`) |
| `:index[Term]` | index entry |
| `:sc[Small Caps]` | small capitals |
| `::pagebreak` | forced page break |

The folder is friendly to git: text files only, stable ordering, and the
`exports` folder and the app's working files are left out by a `.gitignore`.

The app also keeps a small search index (SQLite) in its own data folder. It
is only a cache and is rebuilt from the book folders whenever needed.

## Updating the platform spec files

The rules of each platform live in `specs/`:

| File | Contents |
| --- | --- |
| `kdp.json` | Amazon KDP: trim sizes, page limits, margins, bleed, spine formulas, cover rules, printing costs, royalty rules, ebook rules |
| `ingramspark.json` | IngramSpark: the same, plus PDF/X rules, wholesale discount limits and fees |
| `draft2digital.json` | Draft2Digital ebook and D2D Print rules and fees |
| `currencies.json` | exchange rates used by the pricing calculator, with their date |
| `tax.json` | GST and VAT rates by market |
| `publishing-checklist.json` | the steps of the publishing checklist, including Australian legal deposit |
| `large-print.json` | what a large print edition is checked against: type size, line spacing, alignment (from UKAAF guidance G003) |
| `audiobook.json` | audio file requirements, wording of the credits, and the reading speed used for length estimates |

Each file starts with `lastVerified` and a list of `sources` (official pages).
Each section carries a `_meta` entry: `verified` says whether the values were
confirmed on an official page, `sources` points to that page, and `note`
explains anything uncertain. The app warns when a file is older than six
months.

To change a rule:

1. Open **Settings** in the app and find the file under "Platform rules
   (spec files)". Press **Open**. You see the text of the file, its sources
   as links, and the parts that are not yet confirmed against an official
   page.
2. Change the value. The app checks the file as you type and says in plain
   words what is wrong; a file with a mistake cannot be saved.
3. After comparing the file with its sources, press **I checked the sources
   today**. That sets the date and clears the six month warning.
4. Press **Save as my copy**. Your copy is stored in the `specs` folder of
   your library and used from then on. The file that came with the app is
   never changed: **Go back to the shipped file** deletes your copy.

From the source code you can check all spec files with
`npx tsx scripts/validate-specs.ts`.

The research behind the current numbers (22 to 23 November 2026), with page
by page notes, is kept in `docs/spec-research-2026-11-23/`.

## Platform rules you should verify yourself

These points could not be fully confirmed from public official pages, could
not be tried on a real Mac or Windows computer, or differ from what you told
me. Where they concern a platform rule they are marked in the spec files too.

1. **IngramSpark wholesale discount of 30 percent.** Every published minimum
   is higher: 40 percent for the US and Canada, 35 percent for the UK, EU and
   Australia. Check on the title setup page what your account really allows.
   The pricing calculator will use your 30 percent but warn about it.
2. **IngramSpark spine width and template size.** IngramSpark publishes no
   spine formula. Take the spine width from its cover template generator for
   the exact page count and paper, and enter it for the edition (Book screen,
   Editions). IngramSpark also asks that the cover file keeps the document
   size of its template. When you enter that size, or let the app read it
   from the template PDF, the cover is exported on a sheet of that size with
   the cover in the centre. A real template could not be examined while this
   was written, so lay the first export over your template once and confirm
   that the trim marks line up. Without a template size the file has the
   size of the cover with bleed.
3. **KDP hardcover spine and case sizes.** The help page figures contradict
   each other, so the spec follows the official calculator. Check the
   calculator before ordering a hardcover proof.
4. **Languages other than English.** Each store accepts its own list of
   languages, and the lists differ for ebooks and print. KDP does not
   support Bengali at all and does not print Arabic or Hindi; D2D Print
   states Latin based languages only; IngramSpark prints any language whose
   fonts are embedded. The lists are in the spec files, the new book dialog
   and the Details tab warn you, and preflight refuses an edition a store
   will not take. Check the store's current list before you publish in a
   new language. The words the app prints for you (Chapter, Contents, the
   copyright page) were translated for this app; ask a native speaker to
   read the copyright page of your first book in each language. For
   Chinese, Japanese and Korean, put an OpenType font in the book's
   `fonts` folder: those fonts are too large to bundle.
5. **Price barcodes.** The five digit price add-on exists for US and Canadian
   dollars only. There is no Australian dollar code, so Australian editions
   use `90000` (no price) or no add-on. The barcodes the app draws are read
   back by a scanner library in the tests, but scan the barcode on your first
   printed proof with a phone as well.
6. **Colour on covers.** Pictures for IngramSpark are converted to CMYK by
   the app, inside the 240 percent ink limit. Screen colours that no press
   can print (very bright blues and greens) become duller. For a colour
   critical cover, order a proof before you approve the title.
7. **KDP hardcovers are not sold on Amazon Australia.**
8. **IngramSpark ebook rules and cover pixel limits.** The help centre could
   not be read; a 1600 x 2560 pixel cover is used as a safe size.
9. **Draft2Digital Print** publishes no margin rules and no spine formula;
   the values in its spec are cautious placeholders and its own template
   decides.
10. **KDP interior colour space.** KDP states CMYK for covers only. Black text
   is exported as pure black (K only), which is correct either way.
11. **Printing costs, royalty thresholds and fees change.** They are dated in
    the spec files. Compare one book with each platform's own calculator
    before you set prices.
12. **Audiobook file requirements.** `audiobook.json` holds the long
    standing ACX figures (loudness, peaks, noise floor, MP3 format, room
    tone, file length), but the official page needs a web browser and could
    not be read while the file was made. The file says so itself. Compare
    it with the ACX page before you record.
13. **Large print.** The thresholds follow one guideline (UKAAF G003, read
    on the date in the file). Library services and charities may follow
    another; ask them and change the numbers.
14. **Things that could only be tested on Linux.** The installers are built
    on GitHub for macOS and Windows, but nobody has clicked through them on
    a real Mac or Windows computer yet. Check in particular: saving the
    assistant's API key (macOS Keychain, Windows Credential Manager), the
    Kindle Previewer button, Git version history, and opening exported
    files from the app.
15. **The writing assistant was tested against stand-ins, not the live
    services.** The requests to Claude and to Ollama are checked in the
    tests by a function that plays the part of each service. Press "Test
    the connection" in Settings before you rely on it.
16. **Word import guesses.** Title pages, dedications, epigraphs and
    copyright pages are recognised by their shape, and chapter titles by
    the "Heading 1" style or lines such as "Chapter Seven". The import
    dialog lists what it found before anything is created; read that list.

## The optional writing assistant

The assistant is switched off when the app is installed, and while it is off
the app contacts no service of any kind. Switch it on under **Settings,
Writing assistant**. There are two ways to run it:

* **A model on this computer (Ollama).** Install the free Ollama program
  from ollama.com, download a model in a terminal (for example
  `ollama pull llama3.2`), then press "Find installed models" in Settings.
  The selected text goes to that program and nowhere else.
* **Claude (online).** Make an API key in the Anthropic Console and paste it
  into Settings. The key is kept in the keychain of your computer (macOS
  Keychain, Windows Credential Manager), never in a book or settings file.
  When you press an assistant button, the passage you selected, your
  instruction and the house style of the book are sent to Anthropic under
  your own account. Nothing else from the book is sent. You pay Anthropic
  for what you use. The model is Claude Opus 5.5 unless you choose another
  in Settings. If a model wrongly declines an ordinary request, the API may
  hand it to another Claude model so that you still get an answer.

In the Writer, open the **Assistant** tab of the inspector, select a passage
(or put the cursor in a paragraph) and press Proofread, Tighten or Smooth, or
type your own instruction. The answer is compared with your text word by
word and every difference is put into the text as a tracked change signed
`{>>@ai<<}`. Nothing is replaced silently: accept or reject each change in
the Review tab. "Just answer" replies beside the text and changes nothing.
The house style of the book, including your rule about dashes, goes with
every request.

## Backups and versions

Under **Book, Backups** you can pack the whole book folder into one zip file
(with a note such as "before the big edit"), and the app makes one such
backup a day by itself when the book has changed, keeping the newest ten.
Choose a backup folder on another drive or in a synced folder. Restoring
always unpacks into a new folder and adds it to the library; it never writes
over a book. If Git is installed you can also keep a version history in the
book folder; the app runs Git only in folders you switched it on for.

## Tests

`npm test` runs the automated tests:

* margin rules by page count, bleed and page size calculations
* ISBN check digits, conversion, register rules (an ISBN is never reused)
* the Markdown dialect, tracked changes, typography and the dash policy
* the spec files: structure, sources, dates, and spot checks against the
  official figures
* colour conversion: paper white stays free of ink, black stays inside the
  ink limit, printable colours are reproduced within 2 delta E
* cover geometry for KDP and IngramSpark paperbacks, hardcover cases and dust
  jackets, worked out by hand from the published formulas
* barcodes: bar patterns, sizes, quiet zones; where the zbar tool is
  installed the barcode on the finished cover is read back by it
* preflight: deliberately broken files (wrong page size, text in the gutter,
  a font that is not embedded, a coarse RGB picture) must each be reported
* pricing: printing cost, royalty and minimum list price for KDP (including
  the 50 and 60 percent price thresholds), IngramSpark and Draft2Digital,
  ebook plans, tax, price endings and currency conversion, all against
  figures worked out by hand
* listing tools: KDP description limits, keyword checks, listing sheets, and
  the ONIX 3.0 export. Set the environment variable `ONIX_XSD` to the
  official reference schema file from EDItEUR and the test also validates
  the ONIX file against it (it validates; the schema is not bundled)
* a Bangla book built from start to finish, with Bangla letters in its file
  names
* crash safe saving, snapshots and the trash folder
* Word export and the importers: both Word layouts are written and read
  back (chapters, parts, footnotes, italics, pictures), Word tracked
  changes become suggestions, hand typed manuscripts without styles are
  split correctly, and the app's own EPUB is read back
* backups: what goes into the zip, restoring into a new folder, entries
  that try to write outside the folder, the daily backup and pruning; Git
  history, including that hooks stored in a folder are not run
* samples, advance copies and the in-app ebook preview
* the story bible (mentions in any script, wrong spellings, timeline) and
  the series manager
* the grammar check with the real checker: mistakes are found at their
  exact place past Markdown and notes, Australian spelling is accepted,
  struck out text is not checked, and no dash is ever proposed
* the spec file editor: every shipped file is valid, dated and names
  https sources; a broken file is refused with the reason
* large print checks on a real large print build
* the marketing kit (the finished sell sheet and quote cards are measured)
  and the audiobook plan
* the writing assistant, without any network: word by word differences as
  tracked changes, the prompts, and both services played by a stand-in,
  including a wrong key, a busy service and a declined request
* end to end exports of the sample book with the real tools. The produced
  PDFs are opened again and measured: page size, the real margins on every
  page, embedded fonts, pure black text, no transparency, PDF/X-1a markers,
  greyscale or CMYK pictures. The EPUB is run through EPUBCheck.

The sample book (`sample-book/`, about 62,000 words of placeholder text with
footnotes, images and an index, about 200 pages) is built at 5.5 x 8.5 in and
at 6 x 9 in. `npx tsx scripts/make-sample-book.ts` regenerates it.

## Design decisions in plain English

The suggested stack was Tauri, TypeScript and React with Typst for print, and
that is what the app uses. Four things differ from the suggestion, each for a
reason:

1. **No Ghostscript.** Ghostscript is the usual way to make PDF/X files, but
   its licence (AGPL) and its size make it a poor thing to bundle. Typst
   already writes clean, fully embedded, K only text, and the app finishes
   the file itself (page boxes, document information, removal of links and
   transparency, output intent). Trade-off: colour images are converted to
   CMYK by the app's own converter instead of a colour management engine.
   For black and white interiors, which is nearly all books, this makes no
   difference.
2. **No Pandoc.** Word files are read and written by the app itself, which
   keeps the installer small and avoids a 150 MB dependency. Trade-off:
   the old `.doc` format and unusual formats are not read; save them as
   `.docx` first.
3. **The editor works directly on Markdown files** (CodeMirror), and tracked
   changes are stored as CriticMarkup inside the text. Trade-off: it is not a
   page-like word processor view. Gain: the manuscript is always a plain,
   readable file, changes survive outside the app, and nothing can corrupt a
   hidden document format.
4. **SQLite is only an index.** The files in the book folder are the truth.
   The database can be deleted at any time.
5. **Spelling and grammar are checked inside the app.** Spelling uses
   Hunspell dictionaries, grammar uses Harper. Both run in the background,
   so typing never waits for them, and neither sends a word anywhere.
6. **The assistant goes through one door.** Requests to Claude are made with
   Anthropic's official library, but they leave the app through the same
   small host function as every other outside contact, which only talks to
   https addresses and to this computer. The web view itself cannot reach
   the internet. The API key lives in the system keychain.

How the layout engine is driven: the manuscript is converted to a neutral
structure and handed to Typst as data. No manuscript text is ever pasted into
typesetting code, so odd characters in a book cannot break a build. Body text
sits on a baseline grid, so lines on facing pages align.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Licences of bundled material

* Fonts (EB Garamond, Crimson Pro, Libre Baskerville, Source Sans 3, Noto
  Serif Bengali, Noto Sans Bengali, Tiro Bangla, Amiri, Noto Naskh Arabic,
  Noto Serif Hebrew, Noto Serif Devanagari): SIL Open Font Licence. The
  licence texts are in `resources/fonts/`.
* Typst: Apache 2.0. EPUBCheck: BSD 3 clause. Both are downloaded by
  `npm run fetch-tools` at pinned versions and checked against known
  checksums.
* Colour profile for print output: CC0, see `resources/icc/`.
* Thema subject categories v1.7: EDItEUR, bundled unmodified under its
  licence, see `resources/lookups/`.
* Spelling dictionaries (Australian, British and American English):
  from the Hunspell dictionary collection, MIT and BSD licences. French
  (MPL 2.0), Spanish (GPL, LGPL or MPL, used under MPL), Brazilian
  Portuguese (LGPL or MPL, used under MPL), Dutch (BSD) and Russian (BSD)
  from the LibreOffice dictionaries. The licence texts are in each folder
  of `resources/dictionaries/`.
* Harper, the grammar checker: Apache 2.0.
* Anthropic's SDK for the optional assistant: MIT.
* BISAC subject codes are not bundled. The full list needs a licence from
  BISG and may not be redistributed. You can type or paste the codes you use.
