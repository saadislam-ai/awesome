# ManuscriptForge

An offline book improvement and editing studio for publishers, for Windows and macOS.

**Status: Milestone 3 of 6.** You can import manuscripts, manage a library, edit, keep a full version history, have a local AI model analyse a book and proofread or line edit it, review every proposed change, and export the book and its analysis report.

## What works today

- **Import** Word (.docx), plain text, Markdown, RTF, EPUB and text-based PDF. Headings, bold, italic, underline, scene breaks, lists and quotes are kept.
- **Chapter detection** from headings, "Chapter 1" style lines (in many languages) or page breaks, with a review screen where you can split, join and rename chapters before the book is added.
- **Library** with two shelves (My Books, New Author Submissions), search across titles and the full text of every book, filters, tags and sorting.
- **Editor** with autosave, undo and redo, live word counts, chapter management and a distraction-free mode.
- **Version history.** The original import is locked and always kept. Named snapshots, automatic snapshots, preview, compare any two versions, and one-click restore that can itself be undone.
- **Local AI editing.** A language model runs on your own computer through llama.cpp. Two kinds of edit so far: proofread, and line and copy edit, each at light, medium or heavy strength, for a whole book, chosen chapters, one chapter or selected paragraphs.
- **Review.** Nothing in the book changes until you accept it. Every proposed change is shown as a tracked change, inline or side by side, by word, sentence or paragraph. Accept, reject, undo, edit the proposal, or have the AI redo it with a note. Accept or reject in bulk by kind of change (spelling, punctuation, wording and so on).
- **Safety checks.** Each proposal is checked for changed names, changed numbers, lost italics, changed quotation marks and suspicious length changes, and flagged for you. Replies that cannot be trusted are discarded and the author's text is kept.
- **Model manager.** Detects memory and graphics card, recommends models that fit, downloads them (with pause and resume), loads them and measures their speed.
- **Analysis, quick check.** Runs by itself when a book is imported and takes about a second even for a 300,000-word book, with no AI: word, sentence and chapter counts, reading level (school grade and reading ease for English, LIX for every language), share of dialogue, a pace estimate per chapter, and language findings such as repeated words and phrases, overlong sentences, filler, adverb and passive overuse, clichés, doubled words and tense slips. Children's books also get reading age, fit to the usual length of the format, rhyme and refrains.
- **Analysis, full.** The AI model reads the book passage by passage, keeping a running summary so that it knows what came before, and then assesses the whole. Fiction: structure, plot holes, continuity, point of view, pacing and tension by chapter, character arcs, showing versus telling, openings and endings. Non-fiction: order and flow of the argument, gaps, repetition between chapters, claims that need support, missing examples. Children's books: fit for the age group, read-aloud rhythm. It can be paused, resumed and stopped, and survives closing the app.
- **Dashboard.** Scores, charts by chapter (tension, length, pace, reading level, dialogue), strengths and a ranked list of what to fix first. Every finding has an importance, an explanation, a suggestion and a **Show in text** button that opens the chapter with the words selected. Findings can be filtered and dismissed.
- **Book Bible.** Characters (with other names, descriptions and arcs), relationships, places, timeline, special terms, themes, point of view, tense, tone and a Voice Profile of how the author writes. It is filled in by the full analysis, can be edited by hand (your corrections are kept when the analysis runs again), is shown beside the editor, and is given to the AI with every later editing request so that names, facts and voice stay consistent.
- **Reports.** The whole analysis as a PDF or Word document, with the charts, ready to file or send to an author.
- **Export** to Word (clean, or with real tracked changes against any earlier version), EPUB, PDF, Markdown and plain text.
- **Per-book instructions and a reusable style guide** that the AI follows.
- **Themes** (light, sepia, dark), adjustable manuscript font, size and line width.
- **Safety.** Daily automatic backups, the original file stored untouched, and no network use except when you choose to download a model.

## Run it on Windows 11

Install these once:

1. **Node.js 22 LTS**: `winget install OpenJS.NodeJS.LTS`
2. **Rust**: `winget install Rustlang.Rustup`, then open a new terminal and run `rustup default stable`
3. **Visual Studio C++ Build Tools**: `winget install Microsoft.VisualStudio.2022.BuildTools`, then in the installer tick **Desktop development with C++**
4. **WebView2** is already part of Windows 11. On Windows 10, install the "Evergreen" runtime from Microsoft.

Then, in the `manuscriptforge` folder:

```
npm install
npm run engine:fetch # download the AI engine (llama.cpp) for this computer, once
npm run app:dev      # run the app with live reload
npm run app:build    # build the installers
```

The first build compiles the Rust shell and takes several minutes. Installers land in `src-tauri/target/release/bundle/` (`nsis/*.exe` and `msi/*.msi`).

## Run it on macOS

```
xcode-select --install
brew install node rustup-init && rustup-init -y
npm install
npm run engine:fetch
npm run app:dev
npm run app:build    # creates a .dmg in src-tauri/target/release/bundle/dmg/
```

## Setting up the AI

1. **Engine.** `npm run engine:fetch` downloads llama.cpp into `src-tauri/resources/llama/`. On Windows it fetches the **Vulkan** build, which uses AMD, NVIDIA and Intel graphics cards alike (nothing here depends on NVIDIA's CUDA), plus a processor-only build as a fallback. On macOS it fetches the Metal build. Installers built afterwards include the engine.
2. **Model.** Open the app. The first-run screen (also under **Settings, AI editor**) shows your memory and graphics card and lists models with a note on how each would run. Press **Download** on the recommended one, or **Add a model file** if you already have a `.gguf` file.
3. **Load and try.** Press **Load**, wait for "ready", then **Run a sample edit**.

For a 24 GB graphics card, good choices are Gemma 3 27B or Qwen2.5 32B for everyday editing, Qwen2.5 14B or Gemma 3 12B for fast proofreading, and Llama 3.3 70B for slow overnight work (it runs partly on the processor). Any other chat model in GGUF format works too.

**Using your own llama.cpp build** (for example the ROCm/HIP build for AMD cards): download it from the llama.cpp releases page, then choose its folder under **Settings, AI editor, Use llama.cpp from another folder**.

**How it stays private.** The engine is a separate program on your computer. It listens only on the loopback address, on a random port, with a random key that only the app knows, and it is started with networking switched off. The app talks to it through its Rust shell, never over the internet.

## Installers without a Mac

`.github/workflows/manuscriptforge.yml` builds the Windows installer and the macOS `.dmg` (Apple Silicon and Intel) on GitHub's machines whenever the app changes. Download them from the run's **Artifacts** section in the repository's Actions tab.

### Unsigned app warnings

The installers are not code-signed yet, so both systems warn on first launch:

- **Windows:** SmartScreen shows "Windows protected your PC". Choose **More info**, then **Run anyway**.
- **macOS:** the app is ad-hoc signed only. Right-click the app and choose **Open**, or allow it under System Settings, Privacy & Security. If macOS says the app is damaged, run `xattr -cr /Applications/ManuscriptForge.app` once.

To remove the warnings you need a Windows code-signing certificate and an Apple Developer ID (about USD 99 per year) with notarization. Tauri supports both; this is planned for Milestone 6.

## Where your books live

Everything is in one folder: `Documents/ManuscriptForge/`.

```
library.db                         every book, chapter, version, suggestion and setting
books/<id>/original/<your file>    the untouched file each book was imported from
backups/library-<date>.db          daily automatic backups (newest 14 kept)
models/<name>.gguf                 AI models you downloaded
```

Close the app and copy this folder to back up or move your whole library. To store it elsewhere, set the environment variable `MANUSCRIPTFORGE_DATA_DIR` to a folder before starting the app.

## Tests

```
npm test                 # unit tests: importers, tracked changes, editing pipeline, exports, library
npm run test:rust        # the Rust shell: storage, model files, downloads, engine
npm run build && npm run test:e2e                              # the interface, in a real browser engine (library, AI editing, analysis)
npx tauri build --debug --no-bundle && npm run test:desktop    # launches the real app and runs its self-check
```

Some tests use a real engine and model when you point to them, and are skipped otherwise:

```
# Rust: start a real engine, stream a reply, cancel one, read a real model header
MF_TEST_LLAMA_SERVER=/path/to/llama-server MF_TEST_MODEL=/path/to/model.gguf npm run test:rust
# Analysis: have a real model (any OpenAI-compatible server, such as llama-server) read the sample novel, and print what it found
MF_TEST_AI_URL=http://127.0.0.1:8080 npm test -- analysis-deep
# Desktop app: load a real model, run a real edit and a real analysis inside the app
MANUSCRIPTFORGE_LLAMA_SERVER=/path/to/llama-server MF_SELFTEST_MODEL=/path/to/model.gguf npm run test:desktop
```

The app also has a self-check you can run yourself under **Settings, Self-check**.

## Known limits in this milestone

- **AI quality depends on the model.** Small models (under about 12B) catch typos but are timid or unreliable at rewording, and sometimes drop italics (the app puts those back). Use a 24B or larger model for line editing. Quality in languages other than English varies by model.
- **The analysis is one reader's opinion.** Ratings, tension scores and AI findings come from the model you loaded, and a small model over-reports problems and misses subtle ones. The app guards against the worst of it (a finding must quote words that really are in the passage, or it is dropped), but treat the result as a well-read assistant's notes, not a verdict. Use a 24B or larger model for analysis you intend to act on.
- **Continuity checking has limits.** The model reads each passage with a summary of the story so far and the list of known characters, not the full earlier text. It catches contradictions with what the summary recorded, and can miss ones that hinge on a small detail many chapters back.
- **Word-list checks are English only** (adverbs, passive voice, filler, clichés, reading grade). Counts, LIX readability, repetition, sentence length and the whole AI analysis work in other languages.
- **PDF files use one font family that covers Latin, Greek and Cyrillic alphabets.** For Chinese, Japanese, Korean, Arabic, Hebrew, Thai and Indic scripts the app warns you and you should export to Word or EPUB.
- **Editing is still proofreading and line editing.** Developmental editing, "Expand and lengthen" and the fact-check panel for non-fiction arrive in Milestone 4. The submission assessment with a publish, revise or decline recommendation and the editorial letter arrive in Milestone 5.
- **Reasons are per paragraph.** Each paragraph shows the model's one-line reason, and each change shows its kind. The model is not asked to justify every single word.
- **No cloud AI yet** (Milestone 6).
- **If the app is force-closed** while a model is loaded, the engine program (llama-server) can stay running and hold memory until you end it in Task Manager. Closing the app normally always stops it.
- Images are not imported. The app works on the text of a book.
- Word footnotes become numbered notes in a "Notes" chapter. RTF footnotes are skipped, with a warning.
- Tables are flattened to lines of text.
- PDF import rebuilds paragraphs from the page layout, so check the result. Scanned PDFs (no text layer) and multi-column layouts are not supported.
- Old `.doc`, `.odt`, Pages and Kindle files must be saved as `.docx` first.

## Roadmap

1. **Done:** project setup, import, library, editor, version history.
2. **Done:** local AI engine (llama.cpp, Vulkan), model manager, proofread and line edit with tracked changes, exports.
3. **Done:** analysis engine, Book Bible, Voice Profile, dashboard, reports, PDF export.
4. Developmental editing and the Expand and lengthen workflow.
5. New Author Submissions workflow, assessments, editorial letters.
6. Cloud mode, overnight batch mode, multilingual polish, signed installers.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the app is put together.
