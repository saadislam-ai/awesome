/**
 * Creates the sample book project in sample-book/: about 200 pages of
 * placeholder prose in three parts, with scenes, footnotes, pictures, a
 * table, a call-out box, verse and index terms. It exists to prove that every
 * export works and as a playground for trying the app.
 *
 *   npx tsx scripts/make-sample-book.ts
 *
 * The text is produced from word lists with a fixed random seed, so the
 * result is the same on every run. It is meant to look like prose on the
 * page; it is not meant to make sense.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBook, encodePng, joinPath, isbn13CheckDigit, type RasterImage } from '../packages/core/src/index';
import { NodeHost } from '../packages/host-node/src/index';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');
const host = new NodeHost();

/* ------------------------------------------------------------------ */
/* Deterministic random numbers                                        */
/* ------------------------------------------------------------------ */

let seed = 20261123;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
const chance = (p: number) => rand() < p;
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

const PEOPLE = ['Amina', 'Rafiq', 'Noor', 'Farid', 'Layla', 'Idris', 'Shirin', 'Tariq', 'Mrs Halloran', 'the ferryman', 'her grandmother', 'the schoolteacher', 'Dr Rahman'];
const PLACES = ['the harbour', 'the salt flats', 'the ferry landing', 'the old customs house', 'the river mouth', 'the night market', 'the border post', 'the lighthouse road', 'the mangroves', 'the railway yard', 'Khulna', 'the Sydney wharves'];
const THINGS = ['a tin lantern', 'the blue ledger', 'a bundle of letters', 'the brass compass', 'a sack of coarse salt', 'her mother\'s shawl', 'the tide tables', 'a cracked teacup', 'the map of the delta', 'a second-hand radio', 'the ferry ticket', 'a jar of tamarind'];
const NATURE = ['the tide', 'the monsoon wind', 'the evening light', 'a low bank of cloud', 'the smell of rain', 'the first cold morning', 'the long white road', 'the sound of the water', 'a line of herons', 'the dust of the dry season'];
const VERBS_PAST = ['carried', 'remembered', 'counted', 'watched', 'followed', 'unfolded', 'put away', 'waited for', 'asked about', 'kept', 'lost sight of', 'wrote down', 'turned towards', 'listened for'];
const VERBS_INTR = ['waited', 'walked on', 'said nothing', 'looked away', 'laughed quietly', 'kept walking', 'slept badly', 'woke before dawn', 'stood at the window', 'went down to the water'];
const ADJ = ['quiet', 'salt-white', 'half-forgotten', 'narrow', 'well-worn', 'slow', 'patient', 'borrowed', 'unfinished', 'far-off', 'ordinary', 'bright', 'grey', 'careful'];
const TIMES = ['That evening', 'In the morning', 'Years later', 'By the third day', 'Before the rains', 'At low tide', 'For a long time', 'On the last night', 'Each winter', 'After the ferry left'];
const TAILS = [
  'as if nothing had changed', 'though nobody had asked', 'and the road went on without them', 'while the kettle cooled on the sill',
  'the way her father used to', 'until the lamps were lit', 'because there was nothing else to do', 'and for once the wind was still',
  'long after the others had gone', 'with the patience of someone who had crossed before',
];
const SAYINGS = [
  'You can\'t carry a border in your pocket', 'It isn\'t far, only slow', 'The river doesn\'t keep accounts', 'We\'ll go when the salt is dry',
  'Nobody owns the tide', 'I didn\'t come all this way to turn back', 'Tell me again how the house looked', 'There\'s tea, if you\'ll wait',
  'Some roads only run one way', 'Ask me in the morning', 'It was never about the money', 'You remember it better than it was',
];
const SAID = ['said', 'said', 'said', 'asked', 'answered', 'murmured', 'replied', 'called'];
const THOUGHTS = ['home', 'enough', 'not yet', 'tomorrow', 'the same river', 'almost'];
const INDEX_TERMS = ['salt trade', 'ferries', 'borders', 'monsoon', 'letters', 'tide tables', 'Khulna', 'lighthouses', 'memory', 'customs house'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sentence(): string {
  const r = rand();
  if (r < 0.22) return `${pick(TIMES)}, ${pick(PEOPLE)} ${pick(VERBS_PAST)} ${pick(THINGS)} ${pick(TAILS)}.`;
  if (r < 0.4) return `${cap(pick(NATURE))} came in over ${pick(PLACES)}, ${pick(ADJ)} and ${pick(ADJ)}, ${pick(TAILS)}.`;
  if (r < 0.58) return `${cap(pick(PEOPLE))} ${pick(VERBS_INTR)}.`;
  if (r < 0.74) return `At ${pick(PLACES)} there was ${pick(THINGS)}, and beside it ${pick(THINGS)}, ${pick(ADJ)} with use.`;
  if (r < 0.88) return `${cap(pick(PEOPLE))} ${pick(VERBS_PAST)} ${pick(NATURE)} and thought of ${pick(PLACES)}, of the ${pick(ADJ)} years, of ${pick(THINGS)}.`;
  return `It was a ${pick(ADJ)} thing to want, ${pick(PEOPLE)} thought: *${pick(THOUGHTS)}*.`;
}

function dialogue(): string {
  const who = pick(PEOPLE.slice(0, 8));
  const line = pick(SAYINGS);
  const r = rand();
  if (r < 0.4) return `"${line}," ${who} ${pick(SAID)}.`;
  if (r < 0.7) return `"${line}," ${who} ${pick(SAID)}, and ${pick(VERBS_INTR)}.`;
  return `${cap(who)} ${pick(VERBS_INTR)}. "${line}."`;
}

let noteNo = 0;
let indexNo = 0;

function paragraph(notes: string[]): string {
  if (chance(0.26)) return dialogue();
  const n = between(3, 7);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(sentence());
  let text = parts.join(' ');
  if (chance(0.05)) {
    noteNo++;
    const id = `n${noteNo}`;
    text += `[^${id}]`;
    notes.push(`[^${id}]: ${cap(pick(NATURE))} is described this way in the ${pick(ADJ)} records kept at ${pick(PLACES)}; see also the note on ${pick(INDEX_TERMS)}.`);
  }
  if (chance(0.09)) {
    indexNo++;
    text += ` :index[${pick(INDEX_TERMS)}]`;
  }
  return text;
}

function scene(words: number): string {
  const paras: string[] = [];
  const notes: string[] = [];
  let count = 0;
  while (count < words) {
    const p = paragraph(notes);
    paras.push(p);
    count += p.split(/\s+/).length;
  }
  return paras.join('\n\n') + (notes.length ? '\n\n' + notes.join('\n\n') : '') + '\n';
}

/* ------------------------------------------------------------------ */
/* Pictures (generated, so the repository needs no stock images)        */
/* ------------------------------------------------------------------ */

function mapImage(): RasterImage {
  // A contour "map": smooth hills drawn as bands, with a river line.
  const w = 1500;
  const h = 1050;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const hill = Math.sin(u * 7.1 + Math.cos(v * 5.3) * 1.7) + Math.cos(v * 6.4 + Math.sin(u * 4.2) * 2.1) + 0.6 * Math.sin((u + v) * 11);
      const band = Math.abs(((hill * 3.2) % 1) + 1) % 1;
      let g = band < 0.07 ? 110 : 236 - Math.round((hill + 2.6) * 9);
      const river = Math.abs(v - (0.52 + 0.16 * Math.sin(u * 5.2) + 0.05 * Math.sin(u * 17)));
      if (river < 0.012) g = 60;
      else if (river < 0.02) g = 170;
      data[y * w + x] = Math.max(0, Math.min(255, g));
    }
  }
  return { width: w, height: h, channels: 1, data };
}

function chartImage(): RasterImage {
  // A bar chart in colour, to exercise greyscale conversion for black ink interiors.
  const w = 1500;
  const h = 900;
  const data = new Uint8Array(w * h * 3).fill(255);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c[0], c[1], c[2]);
  };
  rect(120, 60, 126, 800, [40, 40, 40]);
  rect(120, 794, 1440, 800, [40, 40, 40]);
  const values = [0.35, 0.52, 0.44, 0.71, 0.63, 0.86, 0.58, 0.93];
  const colours: [number, number, number][] = [[31, 78, 121], [197, 90, 17], [56, 118, 29], [112, 48, 160]];
  values.forEach((val, i) => {
    const x0 = 180 + i * 155;
    const top = 794 - Math.round(val * 680);
    rect(x0, top, x0 + 105, 794, colours[i % colours.length]);
  });
  for (let k = 1; k <= 4; k++) rect(126, 794 - k * 170, 1440, 794 - k * 170 + 2, [205, 205, 205]);
  return { width: w, height: h, channels: 3, data };
}

function horizonImage(): RasterImage {
  // A soft horizon: sky gradient, a low sun and water lines.
  const w = 1800;
  const h = 1200;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = y / h;
      let g: number;
      if (v < 0.62) {
        const dx = (x - w * 0.68) / w;
        const dy = (y - h * 0.5) / h;
        const sun = Math.exp(-(dx * dx + dy * dy) * 60);
        g = 150 + v * 110 + sun * 80;
      } else {
        const ripple = Math.sin(y * 0.5 + Math.sin(x * 0.012) * 3) * 14 * (v - 0.55);
        g = 120 - (v - 0.62) * 140 + ripple * 6;
      }
      data[y * w + x] = Math.max(0, Math.min(255, Math.round(g)));
    }
  }
  return { width: w, height: h, channels: 1, data };
}

/* ------------------------------------------------------------------ */
/* Build the project                                                   */
/* ------------------------------------------------------------------ */

const isbn = (first12: string) => first12 + isbn13CheckDigit(first12);

async function main() {
  const dir = joinPath(root, 'sample-book');
  if (await host.exists(dir)) await host.remove(dir);
  const project = await createBook(host, {
    parentDir: root,
    folderName: 'sample-book',
    title: 'The Salt Road',
    subtitle: 'A Sample Book of Placeholder Text',
    author: 'Dr Saad Islam',
    genre: 'novel',
    language: 'en-AU',
    trim: '5.5x8.5',
    paper: 'cream',
  });
  const book = project.book;
  book.publicationDate = '2026-11-23';
  book.copyright.extraLines = [
    'This is a sample produced by Borderless Studio. The text is placeholder prose generated from word lists; any resemblance to real people or events is accidental.',
    'Any profit from Borderless Publishing books is donated to Blessings Foundation Bangladesh.',
  ];
  // Example ISBNs with valid check digits. They are NOT registered numbers.
  const paperback = book.formats.find((f) => f.id === 'paperback')!;
  paperback.isbn = isbn('978123456789');
  paperback.platforms = ['kdp', 'ingramspark'];
  const hardcover = book.formats.find((f) => f.id === 'hardcover')!;
  hardcover.isbn = isbn('978123456790');
  hardcover.enabled = true;
  hardcover.trim = '6x9';
  const ebook = book.formats.find((f) => f.id === 'ebook')!;
  ebook.isbn = isbn('978123456791');
  ebook.platforms = ['kdp', 'draft2digital', 'ingramspark'];
  book.formats.push({
    ...paperback,
    id: 'paperback-6x9',
    label: 'Paperback 6 x 9',
    trim: '6x9',
    paper: 'white',
    isbn: isbn('978123456792'),
    platformOptions: {},
  });
  book.formats.push({
    ...paperback,
    id: 'large-print',
    label: 'Large print',
    trim: '6x9',
    paper: 'white',
    largePrint: true,
    isbn: isbn('978123456793'),
    enabled: false,
    designOverride: { fontSizePt: 16, lineHeight: 1.4, hyphenate: false, justify: false },
    platformOptions: {},
  });
  book.design.chapterOpener.dropCap = { enabled: true, lines: 3 };
  book.design.toc = { depth: 1, leaders: false, includeFrontMatter: false };
  await project.saveBook();

  const front = project.binder.roots[0];
  const body = project.binder.roots[1];
  const back = project.binder.roots[2];

  // Front matter texts
  const dedication = front.children!.find((n) => n.kind === 'dedication')!;
  await project.writeDoc(dedication.id, 'For everyone who has waited for a ferry\n');
  await project.addNode(front.id, {
    type: 'doc', kind: 'epigraph', title: 'Epigraph',
    text: 'The sea does not reward those who are too anxious, too greedy, or too impatient.\n\n- Anne Morrow Lindbergh, *Gift from the Sea*\n',
  }, front.children!.length);
  await project.addNode(front.id, { type: 'doc', kind: 'toc', title: 'Contents', generated: true });

  // Remove the starter chapter and build three parts.
  for (const child of [...(body.children ?? [])]) await project.removeNode(child.id);
  await host.remove(project.path('manuscript/.trash'));

  const PARTS = [
    { title: 'The Crossing', chapters: ['The River', 'A House of Paper', 'Salt', 'The Customs House', 'Low Tide', 'What the Ferryman Knew'] },
    { title: 'The Long Dry Season', chapters: ['Borders', 'The Blue Ledger', 'Letters Home', 'The Night Market', 'A Borrowed Radio', 'Herons', 'The Lighthouse Road'] },
    { title: 'Harbour Lights', chapters: ['The Long Winter', 'Tamarind', 'The Map of the Delta', 'Tide Tables', 'An Ordinary Morning', 'Harbour Lights'] },
  ];
  await host.mkdirp(project.path('images'));
  await host.writeBinary(project.path('images/delta-map.png'), encodePng(mapImage(), 300));
  await host.writeBinary(project.path('images/salt-harvest-chart.png'), encodePng(chartImage(), 300));
  await host.writeBinary(project.path('images/horizon.png'), encodePng(horizonImage(), 300));

  let chapterIndex = 0;
  for (const part of PARTS) {
    const partNode = await project.addNode(body.id, { type: 'part', kind: 'part', title: part.title });
    for (const title of part.chapters) {
      chapterIndex++;
      const sceneCount = between(2, 3);
      const sceneSpecs = [];
      for (let s = 0; s < sceneCount; s++) {
        let text = scene(between(1000, 1480));
        // A few chapters carry the special content.
        if (chapterIndex === 3 && s === 0) {
          text += '\n![A contour map of a river delta, with the main channel drawn as a dark line](images/delta-map.png "The delta, as the old survey drew it")\n\n' + scene(300);
        }
        if (chapterIndex === 8 && s === 1) {
          text +=
            '\nThe ledger gave the figures plainly.\n\n| Season | Pans worked | Salt (tonnes) |\n|:-------|------------:|--------------:|\n| Dry, first year | 14 | 212 |\n| Dry, second year | 19 | 287 |\n| Dry, third year | 23 | 341 |\n\n' +
            '::image[Salt harvested in each of the eight seasons the ledger records]{src="images/salt-harvest-chart.png" width="85%" alt="A bar chart with eight bars rising unevenly from left to right"}\n\n' +
            scene(250);
        }
        if (chapterIndex === 12 && s === 0) {
          text +=
            '\nHer grandmother had a rhyme for it.\n\n:::verse\nThe river keeps its counsel\nunder the bridge of names,\nand we who cross it\n\ncarry salt in our pockets\nfor the road.\n:::\n\n' +
            scene(250);
        }
        if (chapterIndex === 16 && s === 0) {
          text +=
            '\n:::note[How to read the tide tables]\nTimes are given for the river mouth. Add forty minutes for the ferry landing and an hour for the customs house.\n\nA height printed in bold means the flats will be covered.\n:::\n\n' +
            '![A pale horizon over water with a low sun](images/horizon.png "The horizon from the lighthouse road")\n\n' +
            scene(250);
        }
        sceneSpecs.push({ type: 'doc' as const, kind: 'scene' as const, title: `Scene ${s + 1}`, text });
      }
      await project.addNode(partNode.id, { type: 'chapter', kind: 'chapter', title, numbered: true, children: sceneSpecs });
    }
  }

  // Back matter
  const ack = back.children!.find((n) => n.kind === 'acknowledgements')!;
  await project.writeDoc(ack.id, `${scene(140).trim()}\n\nThis sample exists to test typesetting. Thank you for reading a book that does not mean anything.\n`);
  const about = back.children!.find((n) => n.kind === 'about-author')!;
  await project.writeDoc(about.id, 'Dr Saad Islam writes fiction and nonfiction and publishes under his imprint, Borderless Publishing, in Sydney, Australia. His books are priced as close to cost as the printers allow, because the goal is readers, not profit.\n');
  const alsoBy = back.children!.find((n) => n.kind === 'also-by')!;
  await project.updateNode(alsoBy.id, { data: { groups: [{ label: 'Fiction', titles: ['A Sample Novel', 'Another Placeholder'] }, { label: 'Nonfiction', titles: ['The Example Handbook'] }] } });
  await project.addNode(back.id, { type: 'doc', kind: 'index', title: 'Index', generated: true });
  await project.addNode(back.id, {
    type: 'doc', kind: 'reading-group', title: 'Reading Group Questions',
    text: '1. Who is waiting for whom at the ferry landing, and does the answer change?\n2. What does the blue ledger record that the letters leave out?\n3. Why does the book return so often to salt?\n4. Which border in the story is the hardest to cross?\n',
  }, 1);

  await project.saveBinder();
  const words = await project.manuscriptWords();
  await project.addHistory(`Sample book generated: ${words} words, ${chapterIndex} chapters, ${noteNo} notes, ${indexNo} index markers.`);
  console.log(`Sample book written to ${dir}`);
  console.log(`  ${words} words, ${chapterIndex} chapters in ${PARTS.length} parts, ${noteNo} footnotes, ${indexNo} index markers, 3 pictures`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
