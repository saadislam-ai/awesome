// End-to-end test of the Analysis screen in a real browser engine: the quick
// check, the full AI analysis, findings and "Show in text", the Book Bible,
// the report downloads and PDF export.
//
// A small stand-in AI server answers with prepared notes, the way a model
// reading the sample novel would, so results are exact and the test is fast.
// Run "npm run build" first.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { fixtures, start } from './harness.mjs';

const AI_PORT = 1425;
const AI_URL = `http://127.0.0.1:${AI_PORT}`;

const NOTES = {
  1: {
    summary: 'A letter arrives at the dark lighthouse, addressed to a keeper who no longer exists.',
    characters: [], relationships: [], settings: [{ name: 'Marrow Point', description: 'a village with a disused lighthouse' }],
    events: [{ when: 'eleven years after the lamp went dark', what: 'The first letter arrives.' }], terms: [],
    pov: 'third person, omniscient', tense: 'past', tension: 3, pace: 'slow', issues: [],
  },
  2: {
    summary: 'Mara refuses to sell the lighthouse and finds a letter asking her to light the lamp on the ninth.',
    characters: [{ name: 'Mara Ellison', aliases: ['Mara'], description: 'inherited the lighthouse key from her grandfather' }, { name: 'Tomas', aliases: [], description: "Mara's brother, who wants to sell" }],
    relationships: [{ a: 'Mara Ellison', b: 'Tomas', relation: 'sister and brother' }], settings: [], events: [{ when: '', what: 'Mara finds the letter with the drawing of a ship.' }],
    terms: [{ term: 'the Keeper', meaning: 'the title of whoever tends the lamp' }],
    pov: 'third person, Mara', tense: 'past', tension: 5, pace: 'steady',
    issues: [{ type: 'show-tell', severity: 'medium', quote: 'It is not for sale, Tomas.', problem: 'The refusal is stated flatly.', suggestion: 'Let her action carry it.' }],
  },
  3: {
    summary: 'The harbour master says the ship in the drawing was lost in sixty-one. Mara buys lamp oil anyway.',
    characters: [{ name: 'Mara Ellison', aliases: ['Mara'], description: 'stubborn and quiet' }, { name: 'Agnes Thorne', aliases: ['Agnes'], description: 'the harbour master, never surprised' }],
    relationships: [], settings: [], events: [{ when: 'winter of sixty-one', what: 'The Corriveau was lost with all hands.' }],
    terms: [{ term: 'Corriveau', meaning: "the grandfather's lost ship" }], pov: 'third person, Mara', tense: 'past', tension: 6, pace: 'steady', issues: [],
  },
  4: {
    summary: 'On the ninth the village gathers. Mara lights the lamp and a second light answers from the sea.',
    characters: [{ name: 'Mara Ellison', aliases: ['Mara'], description: 'lights the lamp' }, { name: 'Tomas', aliases: [], description: 'brings tea and says nothing' }],
    relationships: [], settings: [], events: [{ when: 'the ninth', what: 'Mara lights the lamp. A second light answers.' }], terms: [],
    pov: 'third person, Mara', tense: 'past', tension: 9, pace: 'fast',
    issues: [{ type: 'weak-ending', severity: 'medium', quote: 'a second light answered', problem: 'The ending stops on the reveal.', suggestion: 'Consider one more beat.' }],
  },
};

const SYNTHESIS = {
  summary: 'A woman inherits a dark lighthouse and is asked by an unsigned letter to light it for a ship lost decades ago.',
  structure: { parts: [{ name: 'Setup', chapters: '1-2', summary: 'The letter and the refusal to sell.' }, { name: 'Answer', chapters: '3-4', summary: 'The lamp is lit.' }], assessment: 'A clean three-movement shape.' },
  themes: ['inheritance', 'faith'], tone: 'quiet, uncanny', audience: 'adult readers of literary mystery',
  arcs: [{ name: 'Mara Ellison', arc: 'From avoiding her inheritance to accepting it.', strength: 7 }],
  ratings: [
    { aspect: 'structure', score: 7, reason: 'Clear.' }, { aspect: 'characters', score: 6, reason: 'Tomas is thin.' }, { aspect: 'pacing', score: 7, reason: 'Steady build.' },
    { aspect: 'prose', score: 8, reason: 'Controlled.' }, { aspect: 'opening', score: 8, reason: 'Strong hook.' }, { aspect: 'ending', score: 8, reason: 'Lands well.' },
  ],
  strengths: ['Restraint: the story trusts the reader.'], priorities: [{ title: 'Deepen Tomas', detail: 'Give him a reason to want the sale.' }],
  voice: { description: 'Plain, measured sentences with one precise image per paragraph.', dialogueStyle: 'Short, dry exchanges.', devices: ['lists of three'] },
  bookIssues: [{ type: 'plot-hole', severity: 'high', chapter: 0, problem: 'Who sent the letter is never hinted.', suggestion: 'Plant a clue.' }],
};

const mock = { requests: [], hold: null };
const ai = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    const request = JSON.parse(body || '{}');
    const messages = request.messages ?? [];
    const last = messages[messages.length - 1]?.content ?? '';
    const chapter = /\nChapter (\d+): [^\n]*\nPassage:/.exec(last);
    const kind = last.includes('Chapter notes (with') ? 'synthesis' : chapter ? 'segment' : 'other';
    mock.requests.push({ kind, request });
    const reply = kind === 'synthesis' ? JSON.stringify(SYNTHESIS) : kind === 'segment' ? JSON.stringify(NOTES[Number(chapter[1])] ?? NOTES[1]) : 'A lighthouse stands on the rocks. Its lamp turns all night.';
    if (mock.hold && kind !== 'other') await mock.hold;
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < reply.length; i += 60) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 60) } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 400, completion_tokens: 200 }, timings: { predicted_per_second: 64 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((resolve) => ai.listen(AI_PORT, '127.0.0.1', resolve));

const { page, url, check, step, finish, problems, external, shot } = await start({ port: 1424, allowed: [AI_URL] });

const nav = (name) => page.locator('.sidebar nav').getByRole('button', { name, exact: true }).click();
const tab = (name) => page.getByTestId(`tab-${name}`).click();
const waitSaved = () => page.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.textContent?.includes('Saved'));
const stripGone = () => page.waitForFunction(() => !document.querySelector('[data-testid="analysis-strip"]'), null, { timeout: 30000 });
const stripStatus = (status) => page.waitForFunction((s) => document.querySelector('[data-testid="analysis-strip"]')?.getAttribute('data-status') === s, status, { timeout: 30000 });
const download = async (action) => {
  const [file] = await Promise.all([page.waitForEvent('download'), action()]);
  return { name: file.suggestedFilename(), bytes: new Uint8Array(readFileSync(await file.path())) };
};
const isPdf = (bytes) => new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
const analysisRequests = () => mock.requests.filter((r) => r.kind !== 'other');

try {
  await step('A new book gets the quick check on import, without any AI request', async () => {
    await page.goto(url);
    await page.getByRole('dialog', { name: 'Set up the AI editor' }).waitFor();
    await page.getByLabel('Server address').fill(AI_URL);
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="ai-status"]')?.getAttribute('data-state') === 'ready');
    await page.getByTestId('setup-close').click();

    await page.getByTestId('import-input').setInputFiles(join(fixtures, 'novel.docx'));
    check(!(await page.getByTestId('import-full-analysis').isChecked()), 'the full analysis is not started unless asked for');
    await page.getByTestId('import-confirm').click();
    await page.getByTestId('book-card').first().click();
    await page.locator('.ProseMirror').waitFor();
    await nav('Analysis');
    await page.getByRole('heading', { name: 'Analysis', level: 1 }).waitFor();
    await page.locator('.stat-row').waitFor();
    check((await page.locator('.view-sub').innerText()).includes('Quick check'), 'the Analysis screen opens on the quick check made at import');
    const tiles = await page.locator('.stat-tile').allInnerTexts();
    check(tiles.some((t) => /Words\s+5\d\d/.test(t)) && tiles.some((t) => /Chapters\s+4/.test(t)), `the overview shows the size of the book (${tiles[0].replace(/\s+/g, ' ')})`);
    check(tiles.some((t) => /Reading level\s+Grade \d/.test(t)), 'the reading level is given as a school grade');
    check(analysisRequests().length === 0, 'the quick check sent nothing to the AI');
    check((await page.getByTestId('assessment').count()) === 0, 'there is no AI assessment yet');
  });

  await step('Charts show one value per chapter, with exact values on hover and by keyboard', async () => {
    const charts = page.getByTestId('chart');
    const titles = await charts.locator('figcaption').allInnerTexts();
    check(titles.length === 4 && titles[0] === 'Words per chapter', `four charts are shown for a quick check (${titles.length})`);
    const words = charts.first();
    check((await words.locator('path.chart-mark').count()) === 4, 'the words chart has one column per chapter');
    const frame = words.locator('.chart-frame');
    const box = await frame.boundingBox();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2);
    const tip = words.getByTestId('chart-tip');
    await tip.waitFor();
    check(/\d+ words/.test(await tip.innerText()) && (await tip.innerText()).includes('Chapter One'), `pointing at a column shows its value and chapter (${(await tip.innerText()).replace(/\s+/g, ' ')})`);
    await page.mouse.move(box.x - 40, box.y - 40);
    check((await tip.count()) === 0, 'the tooltip goes away when the pointer leaves');
    const pace = charts.nth(1);
    await pace.locator('.chart-frame').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    check((await pace.getByTestId('chart-tip').innerText()).includes('Chapter One'), 'arrow keys step through the chapters');
    await shot('30-analysis-quick');
    await page.keyboard.press('Escape');

    await tab('chapters');
    const rows = await page.getByTestId('chapter-table').locator('tbody tr').allInnerTexts();
    check(rows.length === 4 && rows[0].includes('Prologue'), 'the Chapters tab lists every value in a table');
  });

  await step('Editing the text marks the analysis as out of date, and a finding leads back to its passage', async () => {
    await nav('Edit');
    await page.locator('.chapter-item', { hasText: 'Chapter Two' }).click();
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' She paid at at the counter.');
    await waitSaved();
    await nav('Analysis');
    await page.getByTestId('stale-notice').waitFor();
    check(true, 'a notice says the text has changed since the analysis');
    await page.getByTestId('run-quick').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="stale-notice"]'));
    await tab('findings');
    await page.getByTestId('filter-category').selectOption('doubled-word');
    const finding = page.getByTestId('finding');
    check((await finding.count()) === 1 && (await finding.innerText()).includes('at at'), 'the new quick check found the doubled word');
    check((await finding.innerText()).includes('Chapter Two'), 'the finding names its chapter');
    await shot('31-findings');
    await finding.getByTestId('show-in-text').click();
    await page.locator('.ProseMirror').waitFor();
    await page.waitForFunction(() => window.getSelection()?.toString() === 'at at', null, { timeout: 5000 });
    check((await page.locator('.chapter-item.is-active, .chapter-item[aria-current]').first().innerText()).includes('Chapter Two'), 'Show in text opens the right chapter');
    check(true, 'and selects the exact words');
    await shot('32-show-in-text');

    await nav('Analysis');
    await tab('findings');
    const before = Number((await page.getByTestId('tab-findings').locator('.tab-count').innerText()).trim());
    await page.getByTestId('filter-category').selectOption('doubled-word');
    await page.getByTestId('dismiss-finding').click();
    check((await page.locator('[data-testid="finding"][data-category="doubled-word"]').count()) === 0, 'a dismissed finding leaves the list');
    check((await page.getByTestId('filter-category').inputValue()) === 'all', 'the filter falls back to all types when its last finding is gone');
    check(Number((await page.getByTestId('tab-findings').locator('.tab-count').innerText()).trim()) === before - 1, 'and the count of open findings goes down');
  });

  await step('The full analysis reads the book passage by passage and can be paused', async () => {
    let release;
    mock.hold = new Promise((resolve) => (release = resolve));
    mock.requests.length = 0;
    await tab('overview');
    await page.getByTestId('run-full').first().click();
    await stripStatus('running');
    check((await page.getByTestId('ai-chip-analysis').innerText()).startsWith('Analysing'), 'the sidebar shows that an analysis is running');
    check(await page.getByTestId('run-full').first().isDisabled(), 'a second analysis cannot be started meanwhile');
    await page.getByTestId('analysis-strip').getByRole('button', { name: 'Pause' }).click();
    await stripStatus('paused');
    check(true, 'the analysis can be put on hold');
    release();
    mock.hold = null;
    await page.waitForTimeout(300);
    await shot('33-analysis-paused');
    await page.getByTestId('analysis-strip').getByRole('button', { name: 'Resume' }).click();
    await stripGone();
    await page.getByTestId('assessment').waitFor();
    const segments = mock.requests.filter((r) => r.kind === 'segment');
    check(segments.length >= 4 && mock.requests.filter((r) => r.kind === 'synthesis').length === 1, `each chapter was read and one assessment written (${segments.length} passages)`);
    check(segments.every((r) => r.request.response_format?.type === 'json_schema'), 'each request asks for structured notes');
    const lastSegment = segments[segments.length - 1].request.messages[1].content;
    check(lastSegment.includes('The book so far:') && lastSegment.includes('Characters already met:') && lastSegment.includes('Mara Ellison'), 'later passages are read with a summary of the story so far and the known characters');
    check(segments.every((r) => r.request.messages[1].content.split(/\s+/).length < 2600), 'no request contains more than a passage of the book');
  });

  await step('The overview shows the assessment, ratings and the tension curve', async () => {
    check((await page.locator('.view-sub').innerText()).includes('Full analysis'), 'the header says this is a full analysis');
    const assessment = await page.getByTestId('assessment').innerText();
    check(assessment.includes('A woman inherits a dark lighthouse') && assessment.includes('Deepen Tomas'), 'the summary and priorities are shown');
    const meters = page.getByTestId('ratings').locator('.meter');
    check((await meters.count()) === 6 && (await meters.first().innerText()).includes('Plot and structure') && (await meters.first().innerText()).includes('7 / 10'), 'six ratings are shown as meters with their scores');
    const titles = await page.getByTestId('chart').locator('figcaption').allInnerTexts();
    check(titles.length === 5 && titles[0].startsWith('Tension by chapter'), 'the tension chart is added');
    const tension = page.getByTestId('chart').first();
    await tension.scrollIntoViewIfNeeded();
    const box = await tension.locator('.chart-frame').boundingBox();
    await page.mouse.move(box.x + box.width - 30, box.y + 40);
    check((await tension.getByTestId('chart-tip').innerText()).includes('9 / 10'), 'the last chapter has the highest tension');
    await page.mouse.move(0, 0);
    await shot('34-analysis-full');
    // The charts use their own tested colour on the dark theme.
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    check((await tension.locator('.chart-line').evaluate((el) => getComputedStyle(el).stroke)) === 'rgb(51, 140, 237)', 'charts switch to the dark-theme colour');
    await shot('34-analysis-dark');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));

    await tab('findings');
    const texts = await page.getByTestId('finding').allInnerTexts();
    check(texts.some((t) => t.includes('Telling instead of showing') && t.includes('It is not for sale, Tomas.')), 'AI findings quote the passage they are about');
    check(texts.some((t) => t.includes('Plot hole') && t.includes('Whole book') && t.includes('Important')), 'whole-book findings are listed with their importance');
    await tab('chapters');
    check((await page.getByTestId('chapter-table').locator('tbody tr').last().innerText()).includes('9 / 10'), 'the Chapters table includes tension and summaries');
  });

  await step('The Book Bible is filled in, can be corrected, and corrections are kept', async () => {
    await tab('bible');
    const editor = page.getByTestId('bible-editor');
    await editor.waitFor();
    const names = await editor.getByTestId('bible-character').locator('input.bible-name').evaluateAll((inputs) => inputs.map((i) => i.value));
    check(names.join('|') === 'Mara Ellison|Tomas|Agnes Thorne' || names.slice().sort().join('|') === 'Agnes Thorne|Mara Ellison|Tomas', `the characters were collected (${names.join(', ')})`);
    check((await editor.getByLabel('Other names for Mara Ellison').inputValue()) === 'Mara', 'short names are merged into one character');
    check((await editor.getByLabel('Summary').inputValue()).startsWith('A woman inherits'), 'the summary is filled in');
    check((await editor.getByLabel('Tense').inputValue()) === 'past', 'the narration is recorded');
    check((await editor.getByLabel('How the author writes').inputValue()).startsWith('Plain, measured sentences'), 'the voice profile is filled in');
    await editor.getByLabel('Description of Tomas').fill('Mara\'s younger brother. Practical, short of money.');
    await page.waitForFunction(() => document.querySelector('[data-testid="bible-save-state"]')?.textContent === 'Saved');
    await shot('35-bible');
    await page.waitForTimeout(700);
    await page.reload();
    await nav('Library');
    await page.getByTestId('book-card').first().click();
    await page.locator('.ProseMirror').waitFor();
    await page.getByRole('tab', { name: 'Bible' }).click();
    const side = await page.getByTestId('side-bible').innerText();
    check(side.includes('Mara Ellison') && side.includes('Practical, short of money.') && side.includes('Corriveau'), 'the editor side panel shows the Bible, with the correction, after a restart');
    await shot('36-side-bible');
  });

  await step('AI editing is told the facts in the Book Bible', async () => {
    mock.requests.length = 0;
    await page.getByRole('button', { name: 'Improve with AI' }).click();
    const dialog = page.getByRole('dialog', { name: 'Improve with AI' });
    await dialog.getByText('The whole book').click();
    await page.getByTestId('improve-start').click();
    await page.getByRole('heading', { name: 'Review', level: 1 }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="job-strip"]')?.getAttribute('data-status') === 'done', null, { timeout: 30000 });
    const prompt = mock.requests.map((r) => r.request.messages.map((m) => m.content).join('\n')).find((text) => text.includes('<p id='));
    check(!!prompt && prompt.includes('Facts about this book') && prompt.includes('Mara Ellison') && prompt.includes('Plain, measured sentences'), 'editing prompts carry the names and the voice from the Bible');
  });

  await step('The report is saved as PDF and as a Word document', async () => {
    await nav('Analysis');
    await tab('report');
    const pdf = await download(() => page.getByTestId('report-pdf').click());
    check(pdf.name === 'The Lighthouse at Marrow Point (analysis report).pdf' && isPdf(pdf.bytes) && pdf.bytes.length > 20000, `the PDF report was saved (${Math.round(pdf.bytes.length / 1024)} KB)`);
    const docx = await download(() => page.getByTestId('report-docx').click());
    const xml = strFromU8(unzipSync(docx.bytes)['word/document.xml']);
    check(docx.name.endsWith('(analysis report).docx') && xml.includes('Assessment') && xml.includes('Deepen Tomas') && xml.includes('Book Bible'), 'the Word report contains the assessment and the Book Bible');
    await shot('37-report');
  });

  await step('Running the full analysis again keeps corrected Bible entries', async () => {
    await tab('overview');
    await page.getByTestId('run-full').first().click();
    await page.getByRole('dialog', { name: 'Run the full analysis again?' }).getByRole('button', { name: 'Run again' }).click();
    await page.getByTestId('analysis-strip').waitFor();
    await stripGone();
    await tab('bible');
    const editor = page.getByTestId('bible-editor');
    check((await editor.getByLabel('Description of Tomas').inputValue()) === 'Mara\'s younger brother. Practical, short of money.', 'the corrected description survived the new analysis');
    check((await editor.getByTestId('bible-character').filter({ has: page.locator('.lock-mark') }).count()) === 1, 'the corrected entry is marked as kept');
  });

  await step('A second book can be queued for full analysis from the import screen, and the manuscript exports as PDF', async () => {
    await nav('Library');
    await page.getByTestId('import-input').setInputFiles(join(fixtures, 'nonfiction.docx'));
    await page.getByRole('dialog', { name: 'Review import' }).getByLabel('Book type').selectOption('nonfiction');
    await page.getByTestId('import-full-analysis').check();
    await page.getByTestId('import-confirm').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="ai-chip-analysis"]'), null, { timeout: 30000 });
    await page.getByTestId('book-card').first().click();
    await page.locator('.ProseMirror').waitFor();
    await nav('Analysis');
    await page.getByTestId('assessment').waitFor();
    check((await page.locator('.view-sub').innerText()).includes('Full analysis'), 'the book imported with the option ticked has a full analysis');
    check((await page.getByRole('heading', { name: 'Argument and structure' }).count()) === 1, 'a non-fiction book is assessed as an argument, not as a story');
    await shot('38-analysis-nonfiction');

    await nav('Export');
    await page.getByText('PDF', { exact: true }).click();
    const pdf = await download(() => page.getByTestId('export-run').click());
    check(pdf.name.endsWith('.pdf') && isPdf(pdf.bytes), 'the manuscript was exported as a PDF');
  });

  await step('Nothing left the computer and nothing went wrong', async () => {
    check(external.length === 0, `no requests to the outside (${external.slice(0, 3).join(', ') || 'none'})`);
    check(problems.length === 0, `no errors in the page (${problems.slice(0, 3).join(' | ') || 'none'})`);
  });
} finally {
  ai.close();
  await finish();
}
