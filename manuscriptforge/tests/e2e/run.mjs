// End-to-end test of the user interface in a real browser engine (Chromium).
// It builds nothing itself: run "npm run build" first. The app runs in its
// browser preview mode, with the same code as the desktop app except for the
// storage backend.
//
// Usage: npm run build && npm run test:e2e
// Needs Playwright: "npm i -D playwright" (and "npx playwright install chromium").
// End-to-end test of the library, import, editor and version history in a
// real browser engine. Run "npm run build" first.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures, out, start } from './harness.mjs';

rmSync(out, { recursive: true, force: true });
const { page, url: URL, check, step, finish, problems, external, shot } = await start({ port: 1421 });

try {
  const importFile = async (name) => {
    await page.getByTestId('import-input').setInputFiles(join(fixtures, name));
    await page.getByRole('dialog', { name: 'Review import' }).waitFor();
  };
  const chapterTitles = () => page.locator('.import-chapter-list input').evaluateAll((els) => els.map((e) => e.value));
  const editorChapters = () => page.locator('.chapter-list .chapter-title').allInnerTexts();
  const savedState = () => page.getByTestId('save-state').innerText();
  const waitSaved = () => page.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.textContent?.includes('Saved'));

  await step('First launch offers to set up the AI editor, and it can be done later', async () => {
    await page.goto(URL);
    const setup = page.getByRole('dialog', { name: 'Set up the AI editor' });
    await setup.waitFor();
    check(await setup.getByText('Runs on this computer. Private and fully offline').isVisible(), 'local AI is explained as private and offline');
    await page.getByTestId('setup-close').click();
    await setup.waitFor({ state: 'detached' });
    // The browser preview saves its database a moment after each change.
    await page.waitForTimeout(900);
    await page.reload();
    await page.getByRole('heading', { name: 'Library', level: 1 }).waitFor();
    check((await page.getByRole('dialog').count()) === 0, 'the set-up screen does not come back after "Set up later"');
  });

  await step('The app opens to an empty library', async () => {
    await page.goto(URL);
    await page.getByRole('heading', { name: 'Library', level: 1 }).waitFor();
    check(await page.getByText('No books here yet').isVisible(), 'empty state is shown');
    check(await page.getByText('Offline. Nothing leaves this computer.').isVisible(), 'offline status is shown');
    await shot('01-empty-library');
  });

  await step('Importing a Word manuscript shows the review screen', async () => {
    await importFile('novel.docx');
    check(JSON.stringify(await chapterTitles()) === JSON.stringify(['Title page', 'Prologue', 'Chapter One', 'Chapter Two', 'Chapter Three']), 'chapters were detected');
    check((await page.getByLabel('Title', { exact: true }).inputValue()) === 'The Lighthouse at Marrow Point', 'title was read from the file');
    check((await page.getByLabel('Author', { exact: true }).inputValue()) === 'Eleanor Vance', 'author was read from the file');
    check((await page.getByLabel('Language').inputValue()) === 'en', 'language was detected');
    await page.locator('.import-chapter-list li').nth(2).click();
    await shot('02-import-review');
  });

  await step('Chapter splits can be fixed by hand during import', async () => {
    const blocks = page.locator('.import-preview-body .ms-block');
    await blocks.nth(6).hover();
    await blocks.nth(6).getByRole('button', { name: 'Start a new chapter here' }).click();
    check((await chapterTitles()).length === 6, 'splitting adds a chapter');
    check((await chapterTitles())[3] === 'New chapter', 'the new chapter follows the split one');
    await page.getByRole('button', { name: 'Join chapter 4 onto the one above' }).click();
    check((await chapterTitles()).length === 5, 'joining removes it again');
    await page.getByLabel('How to split chapters').selectOption('none');
    check((await chapterTitles()).join('|') === 'Title page|Full text', '"Do not split" keeps the text together');
    await page.getByLabel('How to split chapters').selectOption('auto');
    check((await chapterTitles()).length === 5, 'automatic detection can be re-applied');
  });

  await step('The book is added to the library', async () => {
    await page.getByLabel('Genre').fill('Mystery');
    await page.getByLabel('Tags').fill('coastal, series one');
    await page.getByTestId('import-confirm').click();
    const card = page.getByTestId('book-card');
    await card.first().waitFor();
    const text = await card.first().innerText();
    check(text.includes('The Lighthouse at Marrow Point') && text.includes('Eleanor Vance'), 'card shows title and author');
    check(/Fiction · Mystery · English/.test(text), 'card shows type, genre and language');
    check(/\d{3} words/.test(text) && text.includes('Imported'), 'card shows word count and status');
    check(text.includes('coastal') && text.includes('series one'), 'card shows tags');
  });

  await step('A Spanish PDF is imported as a new author submission', async () => {
    await page.getByRole('tab', { name: /New Author Submissions/ }).click();
    check(await page.getByText('No submissions yet').isVisible(), 'the submissions shelf starts empty');
    await importFile('spanish.pdf');
    check((await page.getByLabel('Language').inputValue()) === 'es', 'Spanish was detected');
    check((await page.getByLabel('Shelf').inputValue()) === 'submission', 'the shelf defaults to the open tab');
    check(await page.getByText('PDF files do not store paragraphs').isVisible(), 'the PDF caveat is shown');
    await page.getByLabel('Author contact').fill('lucia@example.com');
    await page.getByTestId('import-confirm').click();
    const card = page.getByTestId('book-card').first();
    await card.waitFor();
    const text = await card.innerText();
    check(text.includes('El jardín de las horas') && text.includes('Under Review') && text.includes('Received'), 'submission card shows decision and date');
    await shot('03-submissions');
  });

  await step('Unsupported and broken files give a clear message', async () => {
    await page.getByTestId('import-input').setInputFiles({ name: 'old-book.doc', mimeType: 'application/msword', buffer: Buffer.from('not really a doc') });
    await page.getByRole('alert').filter({ hasText: 'Old .doc files are not supported' }).waitFor();
    check(true, 'an old .doc file is explained');
    await page.getByTestId('import-input').setInputFiles({ name: 'broken.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK\u0003\u0004garbage') });
    await page.getByRole('alert').filter({ hasText: /damaged/ }).waitFor();
    check(true, 'a damaged file is explained');
    check((await page.getByTestId('book-card').count()) === 1, 'nothing was added');
  });

  await step('Search finds text inside books and opens the right chapter', async () => {
    await page.getByRole('tab', { name: /My Books/ }).click();
    await page.getByLabel('Search the library').fill('harbour master');
    const hit = page.locator('.hit').first();
    await hit.waitFor();
    check((await hit.innerText()).includes('Chapter Two'), 'the match names its chapter');
    await shot('04-search');
    await hit.click();
    await page.locator('.chapter-heading h2').waitFor();
    check((await page.locator('.chapter-heading h2').innerText()) === 'Chapter Two', 'the editor opens on that chapter');
    check((await editorChapters()).length === 5, 'all chapters are listed');
  });

  let wordsBefore = 0;
  await step('Typing in the editor saves by itself and updates word counts', async () => {
    await page.locator('.ProseMirror').waitFor();
    wordsBefore = Number((await page.getByTestId('word-total').innerText()).replace(/\D/g, ''));
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Seven brand new words were added here.');
    check((await savedState()) !== 'Saved', 'the change is marked as unsaved at first');
    await waitSaved();
    const wordsAfter = Number((await page.getByTestId('word-total').innerText()).replace(/\D/g, ''));
    check(wordsAfter === wordsBefore + 7, `total went from ${wordsBefore} to ${wordsAfter}`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('Bold line.');
    await page.keyboard.press('Control+b');
    check((await page.locator('.ProseMirror p strong').last().innerText()) === 'Bold line.', 'bold formatting is applied');
    await waitSaved();
    check((await page.locator('.editor-toolbar').evaluate((el) => el.getBoundingClientRect().height)) < 48, 'the toolbar fits on one row');
    await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 15000 });
    await shot('05-editor');
  });

  await step('A named snapshot is saved to the history', async () => {
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Save snapshot' }).click();
    await page.getByLabel('Name this snapshot').fill('Second draft');
    await page.getByRole('button', { name: 'Save snapshot' }).click();
    await page.locator('.version-name', { hasText: 'Second draft' }).waitFor();
    const names = await page.locator('.version-name').allInnerTexts();
    check(names.includes('Original manuscript'), 'the original is listed');
    check(names[0].trim() === 'Second draft', 'the new snapshot is listed first');
  });

  await step('Chapters can be split, renamed and reordered in the editor', async () => {
    await page.locator('.ProseMirror p').nth(3).click();
    await page.getByRole('button', { name: 'Split chapter here' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chapter-list .chapter-title').length === 6);
    check((await editorChapters())[4] === 'New chapter', 'the split-off chapter appears after Chapter Two');
    check((await page.locator('.chapter-heading h2').innerText()) === 'New chapter', 'the new chapter is opened');
    await page.getByRole('button', { name: 'Actions for New chapter' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('Chapter title').fill('Chapter Two and a Half');
    await page.keyboard.press('Enter');
    await page.locator('.chapter-title', { hasText: 'Chapter Two and a Half' }).waitFor();
    await page.getByRole('button', { name: 'Actions for Chapter Two and a Half' }).click();
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chapter-list .chapter-title')[3]?.textContent === 'Chapter Two and a Half');
    check(true, 'the chapter moved up');
  });

  await step('The original manuscript can be restored, and the restore can be undone', async () => {
    await page.getByRole('button', { name: 'Actions for Original manuscript' }).click();
    check(await page.getByRole('menuitem', { name: 'Delete…' }).isDisabled(), 'the original cannot be deleted');
    await page.getByRole('menuitem', { name: 'Preview' }).click();
    await page.getByRole('dialog').getByText('Read-only preview').waitFor();
    await shot('06-version-preview');
    await page.getByRole('button', { name: 'Restore this version' }).click();
    await page.getByRole('dialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chapter-list .chapter-title').length === 5);
    const total = Number((await page.getByTestId('word-total').innerText()).replace(/\D/g, ''));
    check(total === wordsBefore, `word count is back to the original ${wordsBefore}`);
    const names = await page.locator('.version-name').allInnerTexts();
    check(names.some((n) => n.includes('Before restoring')), 'the text from before the restore was kept as a safety copy');
    await page.locator('.chapter-item', { hasText: 'Chapter Two' }).click();
    await page.waitForFunction(() => document.querySelector('.chapter-heading h2')?.textContent === 'Chapter Two');
    check(!(await page.locator('.ProseMirror').innerText()).includes('Seven brand new words'), 'the typed text is gone from the restored chapter');

    await page.getByRole('button', { name: /Actions for Before restoring/ }).click();
    await page.getByRole('menuitem', { name: 'Restore…' }).click();
    await page.getByRole('dialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chapter-list .chapter-title').length === 6);
    check((await editorChapters()).includes('Chapter Two and a Half'), 'undoing the restore brings the edits back');
  });

  await step('Nothing typed is lost when leaving the editor straight away', async () => {
    await page.locator('.chapter-item', { hasText: 'Prologue' }).click();
    await page.waitForFunction(() => document.querySelector('.chapter-heading h2')?.textContent === 'Prologue');
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Typed just before leaving.');
    // No waiting for the autosave: switch chapter at once, then leave the book at once.
    await page.locator('.chapter-item', { hasText: 'Chapter One' }).click();
    await page.waitForFunction(() => document.querySelector('.chapter-heading h2')?.textContent === 'Chapter One');
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' And this as well.');
    await page.locator('.sidebar nav').getByRole('button', { name: 'Library' }).click();
    await page.getByTestId('book-card').first().click();
    await page.locator('.ProseMirror').waitFor();
    await page.locator('.chapter-item', { hasText: 'Prologue' }).click();
    await page.waitForFunction(() => document.querySelector('.chapter-heading h2')?.textContent === 'Prologue');
    check((await page.locator('.ProseMirror').innerText()).includes('Typed just before leaving.'), 'text typed before switching chapter was saved');
    await page.locator('.chapter-item', { hasText: 'Chapter One' }).click();
    await page.waitForFunction(() => document.querySelector('.chapter-heading h2')?.textContent === 'Chapter One');
    check((await page.locator('.ProseMirror').innerText()).includes('And this as well.'), 'text typed before leaving the book was saved');
    const autos = (await page.getByRole('tab', { name: 'History' }).click(), await page.locator('.version-list .pill', { hasText: 'Auto-save' }).count());
    check(autos >= 1, 'leaving the book kept an automatic snapshot');
  });

  await step('Renaming a chapter does not disturb the text being edited', async () => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Mid-edit');
    // A row's menu button appears when the row is pointed at.
    await page.locator('.chapter-list li', { hasText: 'Chapter Three' }).hover();
    await page.getByRole('button', { name: 'Actions for Chapter Three' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByLabel('Chapter title').fill('Chapter Three: The Light');
    await page.keyboard.press('Enter');
    await page.locator('.chapter-title', { hasText: 'Chapter Three: The Light' }).waitFor();
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+z');
    check(!(await page.locator('.ProseMirror').innerText()).includes('Mid-edit'), 'undo still works after renaming another chapter');
    await waitSaved();
  });

  await step('Notes and per-book instructions are kept', async () => {
    await page.getByRole('tab', { name: 'Notes' }).click();
    await page.getByLabel('Notes').fill('Check the ship name with the author.');
    await page.getByRole('tab', { name: 'Rules' }).click();
    await page.getByLabel('Instructions for this book').fill('British spelling');
    await page.getByLabel('Never send this book to a cloud AI').check();
    await page.getByRole('tab', { name: 'Notes' }).click();
    check((await page.getByLabel('Notes').inputValue()) === 'Check the ship name with the author.', 'notes survive switching tabs');
    await page.getByRole('tab', { name: 'Rules' }).click();
    check((await page.getByLabel('Instructions for this book').inputValue()) === 'British spelling', 'instructions survive switching tabs');
    check(await page.getByLabel('Never send this book to a cloud AI').isChecked(), 'the cloud lock is kept');
  });

  await step('Distraction-free mode hides everything but the text', async () => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+Shift+F');
    await page.locator('.focus-bar').waitFor();
    check(!(await page.locator('.sidebar').isVisible()) && !(await page.locator('.chapter-list').isVisible()), 'sidebars are hidden');
    await shot('07-focus-mode');
    await page.keyboard.press('Escape');
    await page.locator('.chapter-list').waitFor();
    check(await page.locator('.sidebar').isVisible(), 'Escape brings the interface back');
  });

  await step('Themes, fonts and the self-check work in Settings', async () => {
    await page.locator('.sidebar nav').getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: 'Dark' }).click();
    check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark theme is applied');
    await page.getByLabel('Manuscript font').selectOption('georgia');
    check((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--manuscript-font'))).startsWith('Georgia'), 'font choice is applied');
    await page.waitForTimeout(400);
    await shot('08-settings-dark');
    await page.getByRole('button', { name: 'Run self-check' }).click();
    const result = page.getByTestId('selfcheck-result');
    await result.waitFor();
    check((await result.getAttribute('data-passed')) === 'true', 'self-check passed');
    await page.getByRole('radio', { name: 'Sepia' }).click();
    await page.locator('.sidebar nav').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('.ProseMirror').waitFor();
    await shot('09-editor-sepia');
    await page.locator('.sidebar nav').getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Reset appearance' }).click();
  });

  await step('The library is still there after closing and reopening', async () => {
    await page.locator('.sidebar nav').getByRole('button', { name: 'Library' }).click();
    await page.waitForTimeout(900);
    await page.reload();
    await page.getByTestId('book-card').first().waitFor();
    const text = await page.getByTestId('book-card').first().innerText();
    check(text.includes('The Lighthouse at Marrow Point') && text.includes('In Editing'), 'the edited book is back, now marked In Editing');
    check((await page.getByRole('tab', { name: /New Author Submissions/ }).innerText()).includes('1'), 'the submission is still counted');
    await shot('10-library');
  });

  await step('Filters narrow the shelf and a book can be deleted', async () => {
    await page.getByLabel('Filter by status').selectOption('approved');
    check(await page.getByText('No books match').isVisible(), 'a filter with no matches says so');
    await page.getByRole('button', { name: 'Clear search and filters' }).click();
    await page.getByRole('button', { name: 'Actions for The Lighthouse at Marrow Point' }).click();
    await page.getByRole('menuitem', { name: 'Details' }).click();
    await page.getByRole('dialog', { name: 'Book details' }).getByLabel('Status').selectOption('reviewed');
    await page.getByRole('button', { name: 'Save details' }).click();
    await page.getByTestId('book-card').filter({ hasText: 'Reviewed' }).waitFor();
    check(true, 'details can be edited');
    await page.getByRole('button', { name: 'Actions for The Lighthouse at Marrow Point' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByRole('dialog', { name: 'Delete this book?' }).getByRole('button', { name: 'Cancel' }).click();
    check((await page.getByTestId('book-card').count()) === 1, 'cancelling keeps the book');
    await page.getByRole('button', { name: 'Actions for The Lighthouse at Marrow Point' }).click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByRole('dialog', { name: 'Delete this book?' }).getByRole('button', { name: 'Delete book' }).click();
    await page.getByText('No books here yet').waitFor();
    check(true, 'the book was deleted after confirmation');
  });

  await step('No errors and no network use', async () => {
    check(problems.length === 0, problems.length ? `problems: ${problems.join(' | ')}` : 'no console or page errors');
    check(external.length === 0, external.length ? `external requests: ${external.join(', ')}` : 'no requests left the app');
  });
} finally {
  await finish();
}
