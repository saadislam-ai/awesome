# ManuscriptForge

An offline book improvement and editing studio for publishers, for Windows and macOS.

**Status: Milestone 1 of 6.** You can import manuscripts, manage a library, edit, and keep a full version history. AI editing arrives in Milestone 2.

## What works today

- **Import** Word (.docx), plain text, Markdown, RTF, EPUB and text-based PDF. Headings, bold, italic, underline, scene breaks, lists and quotes are kept.
- **Chapter detection** from headings, "Chapter 1" style lines (in many languages) or page breaks, with a review screen where you can split, join and rename chapters before the book is added.
- **Library** with two shelves (My Books, New Author Submissions), search across titles and the full text of every book, filters, tags and sorting.
- **Editor** with autosave, undo and redo, live word counts, chapter management and a distraction-free mode.
- **Version history.** The original import is locked and always kept. Named snapshots, automatic snapshots, preview, and one-click restore that can itself be undone.
- **Themes** (light, sepia, dark), adjustable manuscript font, size and line width.
- **Safety.** Daily automatic backups, the original file stored untouched, and no network connections at all.

## Run it on Windows 11

Install these once:

1. **Node.js 22 LTS**: `winget install OpenJS.NodeJS.LTS`
2. **Rust**: `winget install Rustlang.Rustup`, then open a new terminal and run `rustup default stable`
3. **Visual Studio C++ Build Tools**: `winget install Microsoft.VisualStudio.2022.BuildTools`, then in the installer tick **Desktop development with C++**
4. **WebView2** is already part of Windows 11. On Windows 10, install the "Evergreen" runtime from Microsoft.

Then, in the `manuscriptforge` folder:

```
npm install
npm run app:dev      # run the app with live reload
npm run app:build    # build the installers
```

The first build compiles the Rust shell and takes several minutes. Installers land in `src-tauri/target/release/bundle/` (`nsis/*.exe` and `msi/*.msi`).

## Run it on macOS

```
xcode-select --install
brew install node rustup-init && rustup-init -y
npm install
npm run app:dev
npm run app:build    # creates a .dmg in src-tauri/target/release/bundle/dmg/
```

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
library.db                         every book, chapter, version and setting
books/<id>/original/<your file>    the untouched file each book was imported from
backups/library-<date>.db          daily automatic backups (newest 14 kept)
```

Close the app and copy this folder to back up or move your whole library. To store it elsewhere, set the environment variable `MANUSCRIPTFORGE_DATA_DIR` to a folder before starting the app.

## Tests

```
npm test                 # unit tests: importers, chapter detection, library, version history
npm run test:rust        # the Rust storage layer
npm run build && npm run test:e2e                              # the interface, in a real browser engine
npx tauri build --debug --no-bundle && npm run test:desktop    # launches the real app and runs its self-check
```

The app also has a self-check you can run yourself under **Settings, Self-check**.

## Known limits in this milestone

- No AI features yet, and no export yet. Both arrive in Milestone 2.
- Images are not imported. The app works on the text of a book.
- Word footnotes become numbered notes in a "Notes" chapter. RTF footnotes are skipped, with a warning.
- Tables are flattened to lines of text.
- PDF import rebuilds paragraphs from the page layout, so check the result. Scanned PDFs (no text layer) and multi-column layouts are not supported.
- Old `.doc`, `.odt`, Pages and Kindle files must be saved as `.docx` first.

## Roadmap

1. **Done:** project setup, import, library, editor, version history.
2. Local AI engine (llama.cpp with Vulkan), model manager, proofread and line edit with tracked changes, exports.
3. Analysis engine, Book Bible, Voice Profile, reports.
4. Developmental editing and the Expand and lengthen workflow.
5. New Author Submissions workflow, assessments, editorial letters.
6. Cloud mode, overnight batch mode, multilingual polish, signed installers.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the app is put together.
