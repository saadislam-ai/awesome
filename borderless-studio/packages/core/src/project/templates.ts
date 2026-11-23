/**
 * Starting structures for the New Book wizard. Each genre template gives a
 * sensible binder (front matter, body, back matter) and a design preset.
 */
import type { BinderNode, Genre, SectionKind } from '../model/book';
import type { TemplateId } from '../model/design';
import { prefixedId } from '../util/ids';

export interface GenreTemplate {
  label: string;
  description: string;
  design: TemplateId;
  /** Suggested trim size id. */
  trim: string;
  paper: 'white' | 'cream';
}

export const GENRE_TEMPLATES: Record<Genre, GenreTemplate> = {
  novel: {
    label: 'Novel',
    description: 'Chapters made of scenes. Half title, title page, copyright, dedication, then the story.',
    design: 'literary',
    trim: '5.5x8.5',
    paper: 'cream',
  },
  nonfiction: {
    label: 'Nonfiction',
    description: 'Contents page, introduction, chapters with headings, notes, bibliography and index.',
    design: 'nonfiction',
    trim: '6x9',
    paper: 'white',
  },
  memoir: {
    label: 'Memoir',
    description: 'Like a novel, with a note to readers and room for photographs.',
    design: 'literary',
    trim: '5.5x8.5',
    paper: 'cream',
  },
  childrens: {
    label: "Children's book",
    description: 'Large type and full page pictures. Works best with a colour interior and bleed.',
    design: 'childrens',
    trim: '8.5x8.5',
    paper: 'white',
  },
  poetry: {
    label: 'Poetry',
    description: 'One poem per section, contents page, quiet page design.',
    design: 'poetry',
    trim: '5.5x8.5',
    paper: 'cream',
  },
};

/** Default display titles for section kinds (English). */
export const KIND_TITLES: Partial<Record<SectionKind, string>> = {
  'half-title': 'Half title',
  'title-page': 'Title page',
  copyright: 'Copyright',
  dedication: 'Dedication',
  epigraph: 'Epigraph',
  toc: 'Contents',
  foreword: 'Foreword',
  preface: 'Preface',
  introduction: 'Introduction',
  prologue: 'Prologue',
  epilogue: 'Epilogue',
  afterword: 'Afterword',
  acknowledgements: 'Acknowledgements',
  'about-author': 'About the Author',
  'also-by': 'Also by the Author',
  'note-to-readers': 'A Note to Readers',
  'reading-group': 'Reading Group Questions',
  endnotes: 'Notes',
  bibliography: 'Bibliography',
  index: 'Index',
  appendix: 'Appendix',
  glossary: 'Glossary',
};

/** Sections produced from metadata rather than from a text file. */
export const GENERATED_KINDS: ReadonlySet<SectionKind> = new Set<SectionKind>([
  'half-title', 'title-page', 'copyright', 'toc', 'also-by', 'index', 'endnotes',
]);

export const FRONT_KINDS: SectionKind[] = [
  'half-title', 'title-page', 'copyright', 'dedication', 'epigraph', 'toc', 'foreword', 'preface', 'introduction', 'prologue',
];
export const BACK_KINDS: SectionKind[] = [
  'epilogue', 'afterword', 'acknowledgements', 'about-author', 'also-by', 'note-to-readers', 'reading-group',
  'endnotes', 'bibliography', 'index', 'appendix', 'glossary',
];

export interface NewNodeSpec {
  type: BinderNode['type'];
  kind: SectionKind;
  title?: string;
  generated?: boolean;
  /** Starter text for the document, if it has one. */
  text?: string;
  children?: NewNodeSpec[];
  numbered?: boolean;
  data?: Record<string, unknown>;
}

const sec = (kind: SectionKind, text?: string): NewNodeSpec => ({
  type: 'doc',
  kind,
  title: KIND_TITLES[kind] ?? kind,
  generated: GENERATED_KINDS.has(kind),
  text: GENERATED_KINDS.has(kind) ? undefined : (text ?? ''),
});

const chapter = (title: string, scenes?: string[]): NewNodeSpec => ({
  type: 'chapter',
  kind: 'chapter',
  title,
  numbered: true,
  ...(scenes
    ? { children: scenes.map((s) => ({ type: 'doc' as const, kind: 'scene' as const, title: s, text: '' })) }
    : { text: '' }),
});

/** The front, body and back matter a new book of each genre starts with. */
export function genreStructure(genre: Genre): { front: NewNodeSpec[]; body: NewNodeSpec[]; back: NewNodeSpec[] } {
  switch (genre) {
    case 'novel':
      return {
        front: [sec('half-title'), sec('title-page'), sec('copyright'), sec('dedication', 'For ...')],
        body: [chapter('Chapter title', ['Opening scene'])],
        back: [sec('acknowledgements'), sec('about-author'), sec('also-by')],
      };
    case 'memoir':
      return {
        front: [sec('half-title'), sec('title-page'), sec('copyright'), sec('dedication', 'For ...'), sec('note-to-readers')],
        body: [chapter('Chapter title')],
        back: [sec('acknowledgements'), sec('about-author'), sec('also-by')],
      };
    case 'nonfiction':
      return {
        front: [sec('half-title'), sec('title-page'), sec('copyright'), sec('dedication', 'For ...'), sec('toc'), sec('introduction')],
        body: [chapter('Chapter title')],
        back: [sec('acknowledgements'), sec('about-author'), sec('bibliography'), sec('index')],
      };
    case 'childrens':
      return {
        front: [sec('title-page'), sec('copyright')],
        body: [{ type: 'chapter', kind: 'chapter', title: 'Story', numbered: false, text: '' }],
        back: [sec('about-author')],
      };
    case 'poetry':
      return {
        front: [sec('half-title'), sec('title-page'), sec('copyright'), sec('dedication', 'For ...'), sec('toc')],
        body: [{ type: 'chapter', kind: 'chapter', title: 'First poem', numbered: false, text: ':::verse\nFirst line\nSecond line\n:::\n' }],
        back: [sec('acknowledgements'), sec('about-author')],
      };
  }
}

/** Turn a node spec into a binder node, collecting the files that need to be created. */
export function instantiate(
  spec: NewNodeSpec,
  makeFileName: (title: string, id: string) => string,
  files: { file: string; text: string }[],
): BinderNode {
  const id = prefixedId(spec.type === 'chapter' ? 'ch' : spec.type === 'part' ? 'pt' : 'd');
  const node: BinderNode = {
    id,
    type: spec.type,
    kind: spec.kind,
    title: spec.title ?? KIND_TITLES[spec.kind] ?? '',
    include: true,
  };
  if (spec.generated) node.generated = true;
  if (spec.numbered !== undefined) node.numbered = spec.numbered;
  if (spec.data) node.data = spec.data;
  if (spec.text !== undefined && !spec.generated) {
    node.file = makeFileName(node.title, id);
    files.push({ file: node.file, text: spec.text });
  }
  if (spec.type === 'doc') node.status = 'draft';
  if (spec.children) node.children = spec.children.map((c) => instantiate(c, makeFileName, files));
  return node;
}
