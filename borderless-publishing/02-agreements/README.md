# Agreements and letters

Drafts for running Borderless Publishing. Each file is written in plain Markdown (the source) and is also built as a Word file (`.docx`) on the Borderless letterhead, ready to fill in and send.

**These are drafts, not legal advice.** They were written for an Australian (New South Wales) sole trader publisher that pays for publishing itself and prices books close to cost. Before you use any of them for the first time, have them read by an Australian lawyer. Two good, affordable places to start:

- **Arts Law Centre of Australia** (artslaw.com.au): legal advice and contract review for artists and arts organisations, at low cost for members.
- **Australian Society of Authors** (asauthors.org): publishes minimum terms for authors and reviews contracts for members. Reading their guidance tells you what authors will expect from you.

| File | Use it when |
| --- | --- |
| 01-author-publishing-agreement | You publish another author's book. Starts with a one page summary in plain words. |
| 02-translation-agreement | You commission a translation, for example Bangla to English. |
| 03-freelance-services-agreement | You hire an editor, proofreader, cover designer, illustrator or typesetter. |
| 04-audiobook-narration-agreement | A narrator records an audiobook. |
| 05-bookshop-consignment-agreement | A bookshop stocks your books and pays only for copies sold. |
| 06-permission-request | A book quotes or reproduces someone else's material. |
| 07-rights-reversion-letters | An author asks for their rights back, and your confirmation. |

## Things to decide before the first author contract

1. **Margins.** Schedule 2 of the author agreement lets the author choose the Author's Margin and you choose the Publisher's Margin, each any amount including nothing, plus optional free ebook and open access (Creative Commons). What a copy earns is shared in proportion to the two margins. Enter the same two amounts on the Prices screen of Borderless Studio, which shows both shares for every store. Give every author `04-authors/05-publishing-models` with the agreement. With a Publisher's Margin of nothing you never recover your costs, so decide how many such books you can afford each year.
2. **Term.** Five years from publication, then year to year. Authors can leave if the book stops selling. This is friendlier than "for the full period of copyright" and suits a press that does not pay advances.
3. **Sole trader or company.** The drafts name you trading as Borderless Publishing. If you later form a company, new contracts are made by the company, and existing ones are transferred with each author's consent (clause 17.5).

## Rebuilding the Word files

After editing a Markdown file, run from the `borderless-publishing` folder:

    python3 tools/make-documents.py

Notes in grey boxes (lines that start with `>` in the Markdown) are reminders for you. Delete them from the Word file before you send it.
