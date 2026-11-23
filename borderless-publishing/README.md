# Borderless Publishing: business kit

Everything needed to run Borderless Publishing as a small, honest, independent publisher in Sydney, alongside Borderless Studio (the program that makes the books).

Each document is written in Markdown (plain text you can read anywhere and keep in version control) and is also built as a Word file on the Borderless letterhead, ready to fill in, print or send.

## What is here

| Folder | Contents |
| --- | --- |
| `01-brand` | The logo in every version (SVG, PNG, print PDF), brand guidelines, a print-ready business card, letterhead logo, social media images (avatar, banners, link preview) |
| `02-agreements` | Author publishing agreement, translation, freelance services (editor, cover designer, illustrator), audiobook narration, bookshop consignment, the arrangement with Blessings Foundation Bangladesh, permission request, rights reversion letters |
| `03-business` | Setup checklist for New South Wales, one page business plan, Reach First pricing policy, donation and transparency policy with the yearly statement, yearly calendar, money tracker (royalties, costs, donations), invoice |
| `04-authors` | Submission guidelines, guide for authors, house style, author information form |
| `05-marketing` | Website text, email templates, press release, launch checklist |
| `tools` | The script that builds the Word files |

## Where to start

1. **Read `03-business/01-setup-checklist-australia.md`** and work through sections 1 to 3: the name, ABN, business name, bank account, and the questions for your accountant about tax and the donations.
2. **Settle the donation arrangement** with Blessings Foundation Bangladesh (`02-agreements/06-charity-donation-arrangement`) before you print any statement about donations on a book or website.
3. **Fill in your details** (email, website, ABN) in `01-brand/source/brand-details.json`, rebuild the brand files, and order business cards.
4. **Have the agreements reviewed by an Australian lawyer** before the first time you use each one. The Arts Law Centre of Australia and the Australian Society of Authors are good, affordable places to start. The drafts are a careful starting point, not legal advice.
5. **Set up the yearly calendar** (`03-business/05-yearly-calendar.md`) in your phone.

## Things only you can decide

- The royalty rate (the drafts offer authors 50 percent of net receipts) and the length of the licence (five years, then year to year).
- Whether to stay a sole trader or form a company later.
- The exact wording of the donation promise, after advice.
- Your email address, website address and phone number.

## Rebuilding the files

    python3 01-brand/source/make-brand.py     # logos, business card, social images
    python3 tools/make-documents.py            # Word files from the Markdown

Both need Python 3; the first also uses the Typst program and the fonts that come with Borderless Studio, and the second needs the `python-docx` package (`pip install python-docx`).
