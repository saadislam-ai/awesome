# Agreements and letters

Drafts for running Borderless Publishing. Each file is written in plain Markdown (the source) and is also built as a Word file (`.docx`) on the Borderless letterhead, ready to fill in and send.

**These are drafts, not legal advice.** They were written for an Australian (New South Wales) sole trader publisher that pays for publishing itself, prices books close to cost and donates its margin. Before you use any of them for the first time, have them read by an Australian lawyer. Two good, affordable places to start:

- **Arts Law Centre of Australia** (artslaw.com.au): legal advice and contract review for artists and arts organisations, at low cost for members.
- **Australian Society of Authors** (asauthors.org): publishes minimum terms for authors and reviews contracts for members. Reading their guidance tells you what authors will expect from you.

| File | Use it when |
| --- | --- |
| 01-author-publishing-agreement | You publish another author's book. Starts with a one page summary in plain words. |
| 02-translation-agreement | You commission a translation, for example Bangla to English. |
| 03-freelance-services-agreement | You hire an editor, proofreader, cover designer, illustrator or typesetter. |
| 04-audiobook-narration-agreement | A narrator records an audiobook. |
| 05-bookshop-consignment-agreement | A bookshop stocks your books and pays only for copies sold. |
| 06-charity-donation-arrangement | You set up the donation arrangement with Blessings Foundation Bangladesh. |
| 07-permission-request | A book quotes or reproduces someone else's material. |
| 08-rights-reversion-letters | An author asks for their rights back, and your confirmation. |

## Things to decide before the first author contract

1. **Royalty rate.** The draft offers 50 percent of Net Receipts on every format, with no advance. Because prices are close to cost, Net Receipts are small; a generous share keeps the arrangement fair. Change the number in Schedule 1 if you decide otherwise, but keep it the same for all authors.
2. **Term.** Five years from publication, then year to year. Authors can leave if the book stops selling. This is friendlier than "for the full period of copyright" and suits a press that does not pay advances.
3. **Sole trader or company.** The drafts name you trading as Borderless Publishing. If you later form a company, new contracts are made by the company, and existing ones are transferred with each author's consent (clause 17.5).
4. **The donation statement.** Clause 9.5 describes your donation policy but deliberately does not make it a promise the author can enforce. Ask your lawyer whether that is right for you.

## Rebuilding the Word files

After editing a Markdown file, run from the `borderless-publishing` folder:

    python3 tools/make-documents.py

Notes in grey boxes (lines that start with `>` in the Markdown) are reminders for you. Delete them from the Word file before you send it.
