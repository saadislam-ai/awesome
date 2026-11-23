# Architecture

This note explains how Borderless Studio is put together, for whoever
maintains it next. It is written in plain English on purpose.

## The three layers

```
apps/desktop          the window: React interface + a small Rust program (Tauri 2)
packages/core         the engine: everything a book needs, in TypeScript, no access to the computer
packages/host-node    the same engine driven from a terminal, used by the tests and the command line
```

The engine never touches files, programs or the network directly. It asks a
`Host` (see `packages/core/src/host.ts`) to do it. There are three hosts:

| Host | Used by | How it reaches the computer |
| --- | --- | --- |
| Tauri host | the installed app | Rust commands in `apps/desktop/src-tauri/src/lib.rs` |
| Node host | tests, the `bstudio` command line | Node.js file and process functions |
| Bridge host | interface development in a browser | HTTP calls to a local Node host (`npm run bridge`) |

Why this matters: the exact code that builds a PDF in the app is the code the
tests run. A test that measures margins in a finished PDF is testing the real
product, not a copy of it.

The Rust part is deliberately small and dumb: read and write files safely,
run one of a fixed list of tools, talk to SQLite, open a file dialog. It runs
no book logic. The list of tools it may start is fixed in the code
(`TOOL_IDS`); the interface cannot ask it to run anything else.

## Folder structure

```
borderless-studio/
  apps/desktop/
    src/                    React interface
      editor/               the Markdown editor (CodeMirror 6) and its decorations
      views/                Library, Writer, Binder, Inspector, Book, Cover, Export, Settings
      state/store.ts        one small state store (zustand)
      host/                 Tauri host and browser bridge host
    src-tauri/              Rust host, window settings, icons, installer settings
  packages/core/src/
    model/                  book.json and design settings, with validation (zod)
    project/                book folders: create, open, save, snapshots, search
    library/                the library of books, settings, publisher profile, search index
    markdown/               Markdown dialect, tracked changes, typography, masking
    build/                  assembling a book from binder + documents; export pipeline
    typeset/                turning the assembled book into data for Typst; running Typst; page previews
    cover/                  cover geometry, barcode, cover design, cover files, 3D picture
    color/                  screen colour to press ink (CMYK) conversion
    preflight/              checks on finished files against the platform rules
    epub/                   EPUB 3 writer and the EPUBCheck runner
    pdf/                    PDF reader for measurements, print finishing step, PDF/X-1a
    specs/                  loading and checking the platform spec files
    calc/                   units, margins, page sizes
    image/                  image size and resolution, PNG read and write
    fonts/                  what each bundled typeface can do
    editor/                 typography cleaner and dash finder
    isbn.ts                 ISBN checks and the ISBN register
  packages/host-node/src/   Node host, command line, development bridge
  resources/
    typst/lib/              the book layout library, written in Typst
    fonts/                  bundled open fonts
    icc/                    colour profile for print output
    lookups/                Thema categories, ONIX code lists
  specs/                    platform rules (editable), currency and tax tables
  sample-book/              the sample book used by the tests
  scripts/                  tool download, bundling, sample book generator, spec checker
  docs/                     this note and the spec research
```

## Data model

A book folder holds four kinds of data.

**`book.json`** describes the book and its editions:

* title, subtitle, series, contributors, language, imprint, copyright details
* `style`: spelling variety, quote style, and the dash policy
  (`allow`, `flag` or `replace`, with the replacement to use)
* `design`: template, typefaces, type size, line height, paragraph style,
  chapter openers, running heads, page numbers, notes, table of contents
* `formats`: one entry per edition (ebook, paperback, hardcover, large
  print). Each has its own ISBN, trim size, paper, ink, bleed, cover finish,
  the platforms it goes to, and optional design overrides. A 6 x 9 hardcover
  can use a larger type size than the 5.5 x 8.5 paperback without copying the
  book.
* `history`: a line for every export, so you can see which files were
  uploaded when.

**`manuscript/binder.json`** is a tree of nodes. A node is a group, a part, a
chapter or a document. Each has a `kind` (chapter, dedication, epigraph,
foreword, appendix, about the author and so on), a title, status, labels,
synopsis, word target, and either a Markdown file or the flag `generated`
(title page, copyright page, contents and index are built from data).

**`manuscript/*.md`** holds the text. File names are stable ids, so renaming
a chapter in the app never renames a file and git history stays readable.

**Library level files** live in the library folder, not in a book:
`publisher.json` (imprint, city, default author, base currency),
`isbns.json` (the ISBN register: which ISBN went to which book and edition),
and `specs/` (your edited copies of the platform spec files).

Every file is validated when it is read, and missing values are filled with
defaults, so a book made with an older version of the app opens in a newer
one.

## From manuscript to print PDF

```
binder + .md files
   -> assemble        (build/assemble.ts)   ordered sections, generated pages, footnotes resolved
   -> interior spec   (typeset/interior.ts) page size, margins from the platform rules, fonts, all text as data
   -> build.json + resources/typst/lib      Typst lays the book out
   -> finishing step  (pdf/finalize.ts)     page count rules, page boxes, document information, no links
   -> inspection      (pdf/inspect.ts)      the app opens its own PDF and measures it
```

Points worth knowing:

* **Margins depend on the page count, and the page count depends on the
  margins.** The builder lays the book out, reads the page count, looks up
  the required inside margin in the spec file, and repeats until it is
  stable. The inside margin only ever grows during this loop, so it cannot
  swing back and forth.
* **Rules for several platforms can be combined.** One interior can be built
  to satisfy KDP and IngramSpark together; the strictest value of each rule
  wins.
* **Text is data.** The manuscript is passed to Typst as JSON. It is never
  written into Typst code, so no character in a book can break or hijack a
  build.
* **Baseline grid.** Body lines sit on a fixed grid. Headings, images, block
  quotes and tables are padded to whole lines, so facing pages line up.
* **Black is pure black.** Text is written as CMYK 0/0/0/100, which is what
  printers want. Rich black is never used for text.

## Print files: PDF/X-1a and colour

`pdf/pdfx.ts` turns the typeset PDF into PDF/X-1a:2001 when the platform's
spec file lists that standard. It changes as little as possible: text and
line work are left exactly as typeset (they are already pure black or CMYK),
pictures are relabelled as plain greyscale or converted to CMYK, every page
gets a TrimBox, and the file states the printing condition it was prepared
for (CGATS TR 001, the one IngramSpark's own export settings name).

`color/` holds the conversion from screen colours to ink. The bundled
profile says which colour each ink mix produces on paper; `color/cmyk.ts`
searches, for a grid of screen colours, the ink mix that comes closest while
staying under the ink limit from the spec file (240 percent for IngramSpark)
and using black ink for dark and grey areas. Pictures are converted by
looking colours up in that grid. The trade-off is stated in the file: it is
a careful approximation, not a colour management system, and very bright
screen colours become duller in print.

Pictures are prepared for print on a copy in the build folder (greyscale for
black and white interiors, transparency flattened). Original files in the
book folder are never changed.

## Covers

```
cover/cover.json + spec file + page count
   -> geometry   (cover/geometry.ts)  size of the file, panels, folds, safe zones, barcode area
   -> barcode    (cover/barcode.ts)   EAN-13 and price add-on as plain black rectangles
   -> cover spec (cover/build.ts)     colours as ink values, texts, pictures: all as data
   -> resources/typst/lib/cover.typ   Typst draws the cover
   -> finishing and preflight         TrimBox, PDF/X-1a where asked for, checks
```

One design serves every edition: the panels are worked out again for each
trim size, page count and platform. The spine width comes from the formula a
platform publishes, or from the value the user copies from the platform's
template when there is no formula. The ebook cover is the same front design
laid out again for the pixel proportions each store asks for, so nothing is
stretched. Previews are drawn by the same Typst code as the print file, with
guide lines added.

## Preflight

`preflight/index.ts` opens the finished file and checks it against the spec
file: it does not trust the settings that produced the file. Margins are
measured from the ink actually drawn on each page; fonts, picture resolution,
colour format, transparency, page count and file size are read from the PDF.
Each check returns a status and a sentence saying what to do. The tests feed
it deliberately broken files to prove that every fault is reported.

## From manuscript to EPUB

The same assembled book goes to `epub/build.ts`, which writes EPUB 3 with a
navigation document, a fallback NCX, landmarks, accessibility metadata,
linked footnotes and an optional index. `epub/epubcheck.ts` runs the official
EPUBCheck and translates each message into plain English, with a link back to
the manuscript document it came from.

## Never losing work

* **Crash safe writes.** A file is written to a temporary file in the same
  folder, flushed to the disk, then renamed over the old file. A power cut
  leaves the old or the new version, never a broken one.
* **Autosave** after a short pause in typing, and when the window loses
  focus or a document is closed.
* **Snapshots.** A copy of a document is kept at most every ten minutes
  while you write, before every "replace all", before a restore, and
  whenever a save would remove a large part of the text.
* **Trash.** Deleting a document moves its file to `manuscript/.trash`.
* **Undo** history in the editor, per document.

## Platform rules

`specs/*.json` are the only place where platform numbers live. The code asks
questions of a spec ("inside margin for 320 pages?", "spine width for 204
pages on cream paper?") and never contains the answers. `specs/schema.ts`
describes the format and rejects a file with missing or impossible values,
telling the user which value is wrong.

A spec can describe a spine in two ways: a formula (KDP publishes one) or
"template only" (IngramSpark does not publish one, so the width must be
entered from its template generator). The app never invents a number that a
platform has not published.

## Tests

`packages/core/test` holds unit tests with fixed spec fixtures, so a change
in a real spec file does not break a calculation test.
`packages/host-node/test` holds the end to end tests, which run Typst and
EPUBCheck on the sample book and measure the results.
