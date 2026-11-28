// End-to-end test of AI editing in a real browser engine: set-up, starting
// an edit, reviewing tracked changes, comparing versions and exporting.
//
// A small stand-in AI server answers the requests. It fixes a known list of
// typos, the way a proofreading model would, so results are exact and the
// test is fast. Run "npm run build" first.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { fixtures, start } from './harness.mjs';

const AI_PORT = 1423;
const AI_URL = `http://127.0.0.1:${AI_PORT}`;
const TYPOS = [[/\bTeh\b/g, 'The'], [/\bteh\b/g, 'the'], [/\bclimed\b/g, 'climbed'], [/\bforgoten\b/g, 'forgotten'], [/\bwich\b/g, 'which'], [/\s+,/g, ',']];

const mock = { delay: 0, requests: [], hold: null };
const ai = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    const request = JSON.parse(body || '{}');
    mock.requests.push(request);
    const messages = request.messages ?? [];
    const last = messages[messages.length - 1]?.content ?? '';
    let reply;
    if (last.includes('The publisher was not happy')) reply = '<p id="1">The sea was still that night, and the gulls made no sound.</p>\n<note id="1">simpler wording as asked</note>';
    else if (!last.includes('<p id=')) reply = 'A lighthouse stands on the rocks. Its lamp turns all night. Ships see it from far away. It keeps them safe.';
    else {
      reply = [...last.matchAll(/<p id="(\d+)">([\s\S]*?)<\/p>/g)]
        .map(([, id, text]) => {
          let fixed = text;
          for (const [pattern, replacement] of TYPOS) fixed = fixed.replace(pattern, replacement);
          return `<p id="${id}">${fixed}</p>\n<note id="${id}">${fixed === text ? 'no change' : 'fixed typos'}</note>`;
        })
        .join('\n');
    }
    if (mock.delay) await new Promise((r) => setTimeout(r, mock.delay));
    if (mock.hold) await mock.hold;
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < reply.length; i += 24) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 24) } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 80 }, timings: { predicted_per_second: 64 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((resolve) => ai.listen(AI_PORT, '127.0.0.1', resolve));

const { page, url, check, step, finish, problems, external, shot } = await start({ port: 1422, allowed: [AI_URL] });

const stats = () => page.getByTestId('review-stats').innerText();
const waitStats = (text) => page.waitForFunction((t) => document.querySelector('[data-testid="review-stats"]')?.textContent?.includes(t), text);
const jobStatus = () => page.getByTestId('job-strip').first().getAttribute('data-status');
const waitJob = (status) => page.waitForFunction((s) => document.querySelector('[data-testid="job-strip"]')?.getAttribute('data-status') === s, status, { timeout: 30000 });
const suggestions = () => page.getByTestId('suggestion');
const download = async (action) => {
  const [file] = await Promise.all([page.waitForEvent('download'), action()]);
  return { name: file.suggestedFilename(), bytes: new Uint8Array(readFileSync(await file.path())) };
};

try {
  await step('The AI editor is set up from the first-run screen', async () => {
    await page.goto(url);
    const setup = page.getByRole('dialog', { name: 'Set up the AI editor' });
    await setup.waitFor();
    check((await page.getByTestId('ai-status').getAttribute('data-state')) === 'none', 'no model is loaded at first');
    check(await page.getByTestId('sample-edit').isDisabled(), 'the sample edit waits for a model');
    await page.getByLabel('Server address').fill(AI_URL);
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="ai-status"]')?.getAttribute('data-state') === 'ready');
    await page.getByText('running at about 64 tokens per second').waitFor();
    check(true, 'the model is ready and its speed was measured');
    await page.getByTestId('sample-edit').click();
    const result = page.getByTestId('sample-result');
    await result.waitFor();
    check((await result.locator('del').allInnerTexts()).includes('forgoten') && (await result.locator('ins').allInnerTexts()).includes('forgotten'), 'the sample edit shows a tracked correction');
    await shot('20-ai-setup');
    await page.getByTestId('setup-close').click();
    check((await page.getByTestId('ai-chip').innerText()).includes('Local AI ready'), 'the sidebar shows that the AI is ready');
  });

  await step('A book is imported and a proofread of the whole book is started', async () => {
    await page.getByTestId('import-input').setInputFiles(join(fixtures, 'typos.md'));
    await page.getByTestId('import-confirm').click();
    await page.getByTestId('book-card').first().click();
    await page.locator('.ProseMirror').waitFor();
    await page.getByRole('tab', { name: 'Rules' }).click();
    await page.getByLabel('Instructions for this book').fill('Keep the old-fashioned tone');
    await page.getByRole('tab', { name: 'Notes' }).click();
    await page.getByRole('button', { name: 'Improve with AI' }).click();
    const dialog = page.getByRole('dialog', { name: 'Improve with AI' });
    await dialog.getByText('The whole book').click();
    check(await dialog.getByText(/Using Custom server \(64 tokens per second\)/).isVisible(), 'the dialog names the model in use');
    check(/\d+ words · about \d+ seconds/.test(await dialog.locator('.modal-footer').innerText()), 'the dialog estimates how long it will take');
    await shot('21-improve-dialog');
    mock.requests.length = 0;
    await page.getByTestId('improve-start').click();
    await page.getByRole('heading', { name: 'Review', level: 1 }).waitFor();
    await waitJob('done');
    check((await page.getByTestId('job-strip').first().innerText()).includes('Finished: 3 suggestions'), 'the job reports three suggestions');
    const system = mock.requests.find((r) => r.messages?.[1]?.content.includes('<p id='))?.messages[0].content ?? '';
    check(system.includes('Keep the old-fashioned tone'), "the book's own instructions were sent to the model");
    check(system.includes('professional proofreader') && system.includes('written in English'), 'the model was told the kind of edit and the language');
  });

  await step('Suggestions are shown as tracked changes, and the book is not changed yet', async () => {
    await waitStats('6 to review');
    check((await suggestions().count()) === 2, 'two paragraphs of Chapter One have suggestions');
    const first = suggestions().first();
    check(JSON.stringify(await first.locator('del').allInnerTexts()) === JSON.stringify(['Teh', 'climed', 'wich']), 'removed words are struck out');
    check(JSON.stringify(await first.locator('ins').allInnerTexts()) === JSON.stringify(['The', 'climbed', 'which']), 'new words are marked as insertions');
    check((await first.locator('.why').innerText()).includes('Fixed typos'), 'each paragraph shows the reason for its changes');
    check((await suggestions().nth(1).locator('em').first().innerText()) === 'very', 'italics are kept in the tracked view');
    check((await page.locator('.review-chapters .count-badge').allInnerTexts()).join(',') === '2,1', 'the chapter list counts what is left to review');
    await shot('22-review');
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click().catch(() => undefined);
    await page.keyboard.press('Escape');
    await page.locator('.sidebar').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('.ProseMirror').waitFor();
    check((await page.locator('.ProseMirror').innerText()).includes('Teh keeper climed'), "the author's text is untouched until a change is accepted");
    check((await page.getByTestId('pending-link').innerText()) === '3 AI suggestions to review', 'the editor points to the waiting suggestions');
    await page.getByTestId('pending-link').click();
    await waitStats('6 to review');
  });

  await step('Single changes can be accepted, rejected and undone', async () => {
    const first = suggestions().first();
    await first.getByRole('button', { name: 'Accept change: Teh to The' }).click();
    await waitStats('5 to review · 1 accepted');
    await first.getByRole('button', { name: 'Reject change: climed to climbed' }).click();
    await waitStats('4 to review · 1 accepted · 1 rejected');
    check((await first.locator('del').allInnerTexts()).join(',') === 'climed,wich', 'the accepted change now shows only the new word');
    await page.locator('.sidebar').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('.ProseMirror').waitFor();
    check((await page.locator('.ProseMirror p').first().innerText()) === 'The keeper climed the stairs, wich were steep and narrow.', 'the book holds exactly the accepted change');
    await page.locator('.sidebar').getByRole('button', { name: 'Review' }).click();
    await waitStats('4 to review');
    await suggestions().first().getByRole('button', { name: 'Undo this decision' }).first().click();
    await waitStats('5 to review · 0 accepted · 1 rejected');
    check(true, 'a decision can be undone');
  });

  await step('Changes can be viewed by word, sentence or paragraph, inline or side by side', async () => {
    const acceptButtons = () => page.locator('.chg-accept').count();
    const words = await acceptButtons();
    await page.getByRole('button', { name: 'Sentences' }).click();
    const sentences = await acceptButtons();
    await page.getByRole('button', { name: 'Paragraphs' }).click();
    const paragraphs = await acceptButtons();
    check(words === 5 && sentences === 2 && paragraphs === 2, `finer detail gives more separate decisions (${words}, ${sentences}, ${paragraphs})`);
    await page.getByRole('button', { name: 'Side by side' }).click();
    check((await page.locator('.side-by-side').count()) === 2, 'side by side shows the original next to the improved text');
    check((await page.locator('.side-by-side').first().locator('p').first().locator('ins').count()) === 0, 'the left side shows only the original');
    await shot('23-review-side-by-side');
    await page.getByRole('button', { name: 'Inline' }).click();
    await page.getByRole('button', { name: 'Words' }).click();
  });

  await step('All changes of one kind, or all changes, can be accepted at once', async () => {
    await page.getByLabel('Filter by type of change').selectOption('spacing');
    check((await suggestions().count()) === 1, 'the filter shows only paragraphs with that kind of change');
    await page.getByRole('button', { name: 'Accept all spacing' }).click();
    await page.getByLabel('Filter by type of change').selectOption('');
    await waitStats('4 to review');
    await page.getByRole('button', { name: 'Accept all', exact: true }).click();
    await page.getByText('Everything here is decided').waitFor();
    await page.locator('.sidebar').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('.ProseMirror').waitFor();
    const text = await page.locator('.ProseMirror').innerText();
    check(text.includes('The keeper climed the stairs, which were steep and narrow.'), 'accepted changes are in the book and the rejected one is not');
    check(text.includes('It was very dark, and he had forgotten the lamp.'), 'the second paragraph was corrected');
    check((await page.locator('.ProseMirror em').first().innerText()) === 'very', 'italics survived the edit');
    await page.locator('.sidebar').getByRole('button', { name: 'Review' }).click();
  });

  await step('A proposal can be rewritten by hand or redone by the AI with a note', async () => {
    await page.locator('.review-chapters button', { hasText: 'Chapter Two' }).click();
    await waitStats('2 to review');
    await suggestions().first().getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Proposed paragraph').fill('The sea lay calm that night, and the gulls were quiet.');
    await page.getByRole('button', { name: 'Use this text' }).click();
    await page.locator('.why', { hasText: 'Edited by hand' }).waitFor();
    check((await suggestions().first().locator('ins').allInnerTexts()).includes('lay'), 'the hand-edited proposal is shown as tracked changes');
    await suggestions().first().getByRole('button', { name: 'Redo with a note' }).click();
    await page.getByLabel('What should be different?').fill('simpler words');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.locator('.why', { hasText: 'Simpler wording as asked' }).waitFor();
    const sent = mock.requests[mock.requests.length - 1].messages;
    check(sent[sent.length - 1].content.includes('simpler words'), 'the note was passed to the model');
    await suggestions().first().getByRole('button', { name: 'Reject', exact: true }).click();
    await page.getByText('Everything here is decided').waitFor();
    check(true, 'rejecting the paragraph keeps the original text');
  });

  await step('A job can be paused and resumed, and survives the app being closed', async () => {
    await page.getByRole('button', { name: 'Improve with AI' }).click();
    const dialog = page.getByRole('dialog', { name: 'Improve with AI' });
    await dialog.getByText('The whole book').click();
    await dialog.getByText('Line and copy edit.').click();
    let release;
    mock.hold = new Promise((resolve) => (release = resolve));
    await page.getByTestId('improve-start').click();
    await waitJob('running');
    await page.getByRole('button', { name: 'Pause' }).click();
    await waitJob('paused');
    check((await page.getByTestId('job-strip').first().innerText()).includes('On hold after 0 of 2 passages'), 'the job is on hold');
    release();
    mock.hold = null;
    mock.delay = 2500;
    await page.getByRole('button', { name: 'Resume' }).click();
    await waitJob('running');
    // Close and reopen the app in the middle of the job. (The browser preview
    // saves its database a moment after each change, so give it that moment.)
    await page.waitForTimeout(900);
    await page.reload();
    await page.getByText('An AI editing job was interrupted').waitFor();
    await page.getByTestId('book-card').first().click();
    await page.locator('.sidebar').getByRole('button', { name: 'Review' }).click();
    await waitJob('paused');
    check((await page.getByTestId('job-strip').first().innerText()).includes('The app was closed while this job was running'), 'after reopening, the job waits and says why');
    mock.delay = 0;
    await page.getByRole('button', { name: 'Resume' }).click();
    await waitJob('done');
    check(true, 'the job finished after being resumed');
  });

  await step('Two versions of the book can be compared', async () => {
    await page.locator('.sidebar').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('.ProseMirror').waitFor();
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Actions for Original manuscript' }).click();
    await page.getByRole('menuitem', { name: 'Compare…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Compare versions' });
    await dialog.getByTestId('compare-totals').filter({ hasText: 'paragraphs edited' }).waitFor();
    check((await dialog.getByTestId('compare-totals').innerText()).includes('2 paragraphs edited, 0 added, 0 removed'), 'the summary counts what changed since the original');
    check((await dialog.locator('.version-text del').allInnerTexts()).includes('Teh'), 'removed words are shown');
    check((await dialog.locator('.version-text ins').allInnerTexts()).includes('forgotten'), 'new words are shown');
    await shot('24-compare');
    await dialog.locator('.modal-footer').getByRole('button', { name: 'Close' }).click();
  });

  await step('The book is exported in every format', async () => {
    await page.locator('.sidebar').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('heading', { name: 'Export', level: 1 }).waitFor();
    const docx = await download(() => page.getByTestId('export-run').click());
    check(docx.name === 'The Keeper.docx', 'the Word file is named after the book');
    const xml = strFromU8(unzipSync(docx.bytes)['word/document.xml']);
    check(xml.includes('The keeper climed the stairs, which were steep and narrow.') && !xml.includes('<w:ins '), 'the Word file holds the current text, without tracked changes');

    await page.getByText('Word document with tracked changes').click();
    await page.getByTestId('compare-summary').filter({ hasText: '2 paragraphs edited' }).waitFor();
    const tracked = await download(() => page.getByTestId('export-run').click());
    const trackedXml = strFromU8(unzipSync(tracked.bytes)['word/document.xml']);
    check(tracked.name === 'The Keeper (tracked changes).docx', 'the tracked file has its own name');
    check(trackedXml.includes('<w:delText xml:space="preserve">Teh</w:delText>') && /<w:ins [^>]*><w:r><w:t xml:space="preserve">The<\/w:t>/.test(trackedXml), 'changes since the original are real Word tracked changes');
    await shot('25-export');

    for (const [label, extension, marker] of [['EPUB e-book', 'epub', 'PK'], ['Markdown', 'md', '# Chapter One'], ['Plain text', 'txt', 'Chapter One']]) {
      await page.getByText(label, { exact: true }).click();
      const file = await download(() => page.getByTestId('export-run').click());
      check(file.name === `The Keeper.${extension}` && new TextDecoder().decode(file.bytes).includes(marker), `${label} was saved`);
    }
  });

  await step('The style guide is sent with every job', async () => {
    await page.locator('.sidebar').getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Style guide').fill('Use the serial comma.');
    await page.getByLabel('Style guide').blur();
    await page.locator('.sidebar').getByRole('button', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Improve with AI' }).click();
    const dialog = page.getByRole('dialog', { name: 'Improve with AI' });
    check(await dialog.getByLabel('Also follow my style guide').isChecked(), 'the style guide is applied by default');
    mock.requests.length = 0;
    await page.getByTestId('improve-start').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="job-strip"]').length >= 1);
    await waitJob('done');
    const system = mock.requests.find((r) => r.messages?.[1]?.content.includes('<p id='))?.messages[0].content ?? '';
    check(system.includes('Use the serial comma.'), 'the style guide reached the model');
  });

  await step('No errors, and nothing was contacted except the AI server', async () => {
    check(problems.length === 0, problems.length ? `problems: ${problems.join(' | ')}` : 'no console or page errors');
    check(external.length === 0, external.length ? `unexpected requests: ${external.join(', ')}` : 'no other requests left the app');
  });
} finally {
  ai.close();
  await finish();
}
