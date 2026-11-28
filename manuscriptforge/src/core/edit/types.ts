export type EditLevel = 'proofread' | 'line';
export type EditStrength = 'light' | 'medium' | 'heavy';

export const EDIT_LEVELS: { value: EditLevel; label: string; description: string }[] = [
  { value: 'proofread', label: 'Proofread', description: 'Spelling, grammar and punctuation only. Wording is left alone.' },
  { value: 'line', label: 'Line and copy edit', description: 'Clarity, flow, word choice, repetition and consistency, in the author\'s voice.' },
];

export const EDIT_STRENGTHS: { value: EditStrength; label: string; description: string }[] = [
  { value: 'light', label: 'Light', description: 'Only clear problems.' },
  { value: 'medium', label: 'Medium', description: 'A normal professional edit.' },
  { value: 'heavy', label: 'Heavy', description: 'Rework any sentence that can be better.' },
];

/** Things a human should double-check about a proposed change. */
export type Flag = 'names' | 'numbers' | 'length' | 'formatting' | 'dialogue' | 'beyond-proofread';

export const FLAG_LABELS: Record<Flag, string> = {
  names: 'A name may have changed',
  numbers: 'A number changed',
  length: 'Much longer or shorter than the original',
  formatting: 'Italics or bold changed',
  dialogue: 'Quotation marks changed',
  'beyond-proofread': 'Rewords more than a proofread should',
};

export interface EditOptions {
  level: EditLevel;
  strength: EditStrength;
  /** Language of the book as a short code, for example "en". */
  language: string;
  bookType: 'fiction' | 'nonfiction' | 'children';
  /** Per-book instructions from the publisher. */
  instructions?: string;
  /** The publisher's reusable style guide. */
  styleGuide?: string;
  /** A digest of the Book Bible: narration, voice, names and terms to keep consistent. */
  bible?: string;
  /** Names from the Book Bible that an edit must never alter. */
  names?: string[];
}

/** One paragraph handed to the model. */
export interface ChunkItem {
  /** 1-based number within the chunk, used to match the reply. */
  n: number;
  /** Position of the paragraph in the chapter when the job was created. */
  blockIndex: number;
  /** The paragraph in light Markdown. */
  markup: string;
  heading?: boolean;
}

export interface Chunk {
  items: ChunkItem[];
  /** The end of the text just before this passage, for continuity. It is not edited. */
  contextBefore: string;
  words: number;
}

export interface ParagraphEdit {
  blockIndex: number;
  original: string;
  revised: string;
  note: string;
  flags: Flag[];
}

export interface ChunkResult {
  edits: ParagraphEdit[];
  /** Paragraphs whose reply was unusable and was discarded for safety. */
  discarded: number;
  /** Paragraphs the model did not return at all. */
  missing: number;
  completionTokens: number;
  tokensPerSecond?: number;
}
