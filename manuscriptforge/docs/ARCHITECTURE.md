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
      text/            word counting, language detection
      util/            hashing, ids
    platform/          storage adapters: tauri (desktop), browser (tests and preview)
    data/              schema and migrations, the Library (books, chapters, versions)
    features/          library, import review, editor, settings
    app/               app state, shell, self-check
    ui/                shared components and styles
  src-tauri/           Rust shell: data folder, SQLite, files, backups, close handling
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

## Long books

Nothing in the app loads or processes a whole book at once except import and snapshots, and both are fast: a 300,000-word, 100-chapter book imports in well under a second and snapshots in tens of milliseconds (see `tests/unit/large-book.test.ts`). The editor works on one chapter at a time.

From Milestone 2 the same chapter and scene structure is what the AI engine will chunk on, together with rolling summaries and the Book Bible, because a model can never be given a whole book in one prompt.

## Privacy

The desktop shell exposes only its own commands, a content security policy blocks every external connection from the interface, and there is no telemetry. In Milestone 1 the app makes no network connections at all.

## Closing the window

When the user closes the window, the shell asks the interface to save first (pending keystrokes, an automatic snapshot), waits up to four seconds, then closes and folds the SQLite write-ahead log back into `library.db`. The data folder is therefore always safe to copy while the app is closed.
