This folder is a Borderless Studio book project. Everything is plain files.

book.json                 Title, author, formats (trim size, paper, ISBN), design settings.
manuscript/binder.json    The order of parts, chapters and scenes.
manuscript/*.md           The text, one Markdown file per chapter, scene or section.
                          Tracked changes use CriticMarkup: {++added++} {--deleted--}
                          {~~old~>new~~} and comments look like {>>comment<<}.
bible/bible.json          Story bible: characters, places, objects, timeline.
images/                   Pictures used inside the book (original files).
cover/                    Cover design and artwork.
metadata/                 Retail listing, pricing and the publishing checklist.
stats/                    Writing log (daily word counts).
snapshots/                Automatic copies of earlier versions of each document.
exports/                  PDFs, EPUBs and reports produced by the app.
.borderless/              Temporary build files. Safe to delete.

You can back this folder up, zip it, or keep it in git. Nothing here needs
Borderless Studio to be read.
