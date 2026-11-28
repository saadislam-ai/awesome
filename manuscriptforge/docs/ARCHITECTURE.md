# ManuscriptForge architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | Tauri 2 (Rust) | Small installer and low memory use, which leaves RAM and VRAM for the local AI model. First-class support for running llama.cpp as a sidecar process. |
| Interface | React 19, TypeScript, Vite | The editor is built on TipTap (ProseMirror). |
| Domain logic | Plain TypeScript in `src/core` | No interface or desktop dependency, so it is fully unit-tested and identical on every platform. |
| Storage | SQLite (bundled, via rusqlite) plus plain files | One portable folder. WAL mode keeps the database consistent if the app is closed mid-write. |
| Local AI (Milestone 2) | llama.cpp `llama-server` sidecar | Vulkan on Windows (the development machine has an AMD GPU, so nothing depends on CUDA), Metal on macOS, CPU fallback. |
| Cloud AI (Milestone 6) | Anthropic and OpenAI-compatible | Behind the same provider interface as the local engine. |

Electron was the alternative. It was not chosen because it ships a whole browser (a much larger installer and several hundred megabytes more memory), and memory matters when a 20 GB model has to fit beside the app.

## Folder structure

```
manuscriptforge/
  src/
    core/              pure logic, no UI
      model/           blocks (the manuscript format) and book types
      import/          docx, txt, md, rtf, epub, pdf, chapter detection
      edit/            tracked-changes diff, passage chunking, prompts, reply parsing, safety checks
      analysis/        statistics, readability, rule-based checks, the AI reading, the Book Bible,
                       chart layout and the report
      export/          docx (clean and tracked changes), epub, pdf, markdown, text, the report as docx
      ai/              the provider interface and the model catalog
      text/            word counting, language detection
      util/            hashing, ids
    platform/          storage adapters: tauri (desktop), browser (tests and preview)
    data/              schema and migrations, the Library, editing jobs and suggestions,
                       analyses and findings, the job runner
    features/          library, import review, editor, AI set-up, review, analysis, export, settings
    app/               app state, shell, self-check
    ui/                shared components and styles
  src-tauri/           Rust shell: data folder, SQLite, files, backups, close handling,
                       hardware detection, model files and downloads, the engine process
  tests/
    unit/              Vitest tests
    fixtures/          sample manuscripts in every format (sources and generated files)
    e2e/               browser test of the interface, and the desktop smoke test
  docs/
```

## The manuscript format

Every importer produces **blocks**, and the editor, the version history and (later) the exporters and AI passes all consume blocks:

```ts
type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; runs: Run[]; align? }
  | { type: 'paragraph'; runs: Run[]; align? }
  | { type: 'quote'; runs: Run[] }
  | { type: 'list'; ordered: boolean; runs: Run[] }
  | { type: 'break' };                      // scene break
interface Run { text: string; b?: true; i?: true; u?: true; s?: true }
```

Keeping one small format in the middle means no part of the app depends on another part's file format. The editor converts blocks to and from its own document model (`features/editor/convert.ts`), and that round trip is tested to be lossless.

## Storage

- `books`, `chapters`: the current text. Each chapter stores its blocks as JSON, a content hash, and plain text for search.
- `versions`, `version_chapters`, `blobs`: version history. Chapter text is stored once per distinct content (keyed by SHA-256), so a snapshot of a 100-chapter book where one chapter changed stores one new chapter, not 100.
- The first version of every book is the untouched import. It cannot be renamed or deleted. The imported file itself is also kept on disk.
- Restoring a version first saves the current text as a safety copy, so a restore can be undone.
- Every multi-step change runs in one database transaction (`db.batch`), so a crash can never leave a book half-updated.

The interface talks to storage through a small `Db` and `FileStore` interface with two implementations: the Rust shell (real SQLite and files) and an in-browser SQLite used by automated tests. Both run the same SQL.

## The AI engine

```
 interface (TypeScript)                Rust shell                     llama.cpp
 AiProvider.chat() ──invoke──▶ ai_chat ──HTTP on 127.0.0.1──▶ llama-server ──▶ GPU (Vulkan / Metal) or CPU
        ▲                         │
        └──── streamed reply ◀────┘  (a Tauri channel, piece by piece)
```

- The engine is llama.cpp's own `llama-server`, run as a separate program. The Rust shell starts it on a random loopback port with a random key and with networking switched off, waits until the model has loaded, streams replies back to the interface, can cancel a reply part-way, and stops the engine when the app exits.
- Requests go through the Rust shell rather than straight from the webview. That keeps the content security policy closed (the interface cannot open network connections at all), avoids browser differences between Windows and macOS, and in Milestone 6 keeps cloud API keys out of the webview.
- Graphics card use is left to llama.cpp's own fitting logic unless the publisher sets a number of layers or chooses "processor only". If a model fails to load, the engine's log is turned into a plain explanation (not enough memory, damaged file, graphics driver).
- Everything that uses a model talks to one small interface, `AiProvider`. There are three implementations: the local engine, a direct HTTP one (browser preview and tests), and scripted stand-ins in unit tests. The cloud providers of Milestone 6 will be a fourth.

## How an edit works

1. **Plan.** `chunkChapter` cuts the chosen chapters into passages of whole paragraphs (about 450 words), each carrying the last lines before it for continuity. The passages are stored as tasks in the database, so a job can be paused, resumed, or continued after the app was closed.
2. **Ask.** Each paragraph is sent in a light Markdown form (`*italic*`, `**bold**`) inside numbered tags, with rules that depend on the kind of edit, its strength, the book's type and language, the book's own instructions and the house style guide.
3. **Read the reply.** The parser tolerates missing closing tags, code fences, visible "thinking" and commentary. Paragraphs that are missing, cut off by the token limit, wildly different in length, or in a different script are discarded: the author's text stays.
4. **Check.** Italics or bold that the model dropped are put back automatically. Then each proposal is checked for changed names, numbers, quotation marks, formatting and length, and flagged where a person should look.
5. **Suggest.** The result is stored as a suggestion: the original paragraph, the proposed one, a reason and flags. The book itself is untouched.
6. **Decide.** The word-level diff between original and proposal gives the tracked changes. Accepting or rejecting a change rewrites just that paragraph from the original plus the decisions so far, in the same database transaction that records the decision. A snapshot is saved before the first change, so a whole review can be undone. If a paragraph was edited by hand after the suggestion was made, the suggestion is marked out of date instead of being applied.

## How an analysis works

There are two layers, and the first never needs a model.

1. **Quick check** (`core/analysis/stats.ts`, `rules.ts`). Plain code over the text: counts, readability (Flesch reading ease and Flesch-Kincaid grade for English, LIX for any language), dialogue share, a pace estimate, the numbers of the author's voice, and rule-based findings. It runs when a book is imported and whenever asked, in about a second for 300,000 words.
2. **Full analysis** (`core/analysis/deep.ts`, `data/analysis.ts`). Each chapter is cut into passages of about 1,200 words. For each passage the model is given the passage, a rolling summary of the book so far (the most recent 320 words of summaries) and the characters met so far, and returns structured notes as JSON: a summary, characters, relationships, places, events, terms, point of view, tense, a tension score, pace and issues. The request carries a JSON schema, which llama.cpp enforces while generating, so even small models return usable notes. A final step gives the model the per-chapter notes, the statistics and three excerpts, and asks for the assessment of the whole book: structure, ratings, strengths, priorities, arcs or takeaways, and the voice.

Notes are folded into the **Book Bible** as they arrive (`core/analysis/bible.ts`): a character called "Mara" in one passage and "Mara Ellison" in another becomes one entry with an alias, descriptions are merged, and roles follow from how much of the book a character appears in. Entries the publisher edited are locked and survive later analyses.

Model output is not trusted as it stands. A finding must quote words that are really in its passage (matched loosely for quotation marks and spacing) or it is dropped, except for kinds that concern a whole passage, such as pacing. "Weak opening" is only accepted at the start of a chapter and "weak ending" at its end. Only one finding per kind per passage is kept, and only a few kinds may be marked important. These rules came from watching a 3B model report a weak opening in every passage.

A digest of the Bible (`bibleBrief`: narration, tone, voice, names, places, terms, 200 words at most) is added to every later editing prompt, and its names are added to the "changed names" safety check.

Analyses and editing jobs share one queue (`data/runner.ts`): a local model serves one request at a time, so the runner takes the job already in progress, then the oldest waiting one, whichever kind it is. Every step is a row in the database, which is what makes pause, resume and "continue after the app was closed" work.

**Charts** are single-series by design: one measure per chart, one colour, no legend to decode, never two scales on one chart. The same layout code (`core/analysis/charts.ts`) draws the interactive charts on screen and the static ones in the PDF report. The series colour was checked for contrast against each theme's surface (a different step of the same blue is used on the dark theme). Every chart has hover and keyboard access to exact values, and the Chapters tab holds all the numbers as a table.

**PDF** files are made with pdfmake, loaded only when the first PDF is requested, with DejaVu Serif embedded (Latin, Greek and Cyrillic). The library rewrites the document definition it is given, so it is always handed copies, never data the screen still uses (there is a test for this).

## Long books

Nothing in the app loads or processes a whole book at once except import and snapshots, and both are fast: a 300,000-word, 100-chapter book imports in well under a second and snapshots in tens of milliseconds (see `tests/unit/large-book.test.ts`). The editor works on one chapter at a time.

The same chapter and paragraph structure is what the AI engine works on: a model is never given a whole book. Planning a line edit of a 300,000-word book (about 700 passages) takes a fraction of a second. The full analysis of such a book is about 260 passages plus one closing step. The rolling summary and the Book Bible are what keep distant chapters consistent: no request ever grows with the length of the book.

## Privacy

The desktop shell exposes only its own commands, a content security policy blocks every external connection from the interface, and there is no telemetry. The one thing that uses the network is downloading a model, which happens only when the publisher presses Download, over https, into the library's `models` folder.

## Closing the window

When the user closes the window, the shell asks the interface to save first (pending keystrokes, an automatic snapshot), waits up to four seconds, then closes and folds the SQLite write-ahead log back into `library.db`. The data folder is therefore always safe to copy while the app is closed.
