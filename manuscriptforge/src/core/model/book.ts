import type { Block } from './blocks';
import type { SourceFormat } from '../import/common';

export type BookCategory = 'mine' | 'submission';
export type BookType = 'fiction' | 'nonfiction' | 'children';
export type BookStatus = 'imported' | 'analyzed' | 'editing' | 'reviewed' | 'approved' | 'exported';
export type Decision = 'under_review' | 'needs_work' | 'accept' | 'decline';
export type VersionKind = 'original' | 'manual' | 'auto' | 'safety';

export const BOOK_STATUSES: { value: BookStatus; label: string }[] = [
  { value: 'imported', label: 'Imported' },
  { value: 'analyzed', label: 'Analyzed' },
  { value: 'editing', label: 'In Editing' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'approved', label: 'Approved' },
  { value: 'exported', label: 'Exported' },
];

export const BOOK_TYPES: { value: BookType; label: string }[] = [
  { value: 'fiction', label: 'Fiction' },
  { value: 'nonfiction', label: 'Non-fiction' },
  { value: 'children', label: "Children's" },
];

export const DECISIONS: { value: Decision; label: string }[] = [
  { value: 'under_review', label: 'Under Review' },
  { value: 'needs_work', label: 'Needs Work' },
  { value: 'accept', label: 'Accept' },
  { value: 'decline', label: 'Decline' },
];

export function statusLabel(status: BookStatus): string {
  return BOOK_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function typeLabel(type: BookType): string {
  return BOOK_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function decisionLabel(decision: Decision | null): string {
  return DECISIONS.find((d) => d.value === decision)?.label ?? 'Under Review';
}

export interface Book {
  id: string;
  category: BookCategory;
  title: string;
  author: string;
  bookType: BookType;
  genre: string;
  language: string;
  status: BookStatus;
  wordCount: number;
  tags: string[];
  /** The publisher's private notes about this book. */
  notes: string;
  /** Custom instructions applied to every AI pass on this book. */
  instructions: string;
  /** When true, this book's text may never be sent to a cloud AI. */
  neverCloud: boolean;
  sourceName: string | null;
  sourceFormat: SourceFormat | null;
  /** Path of the untouched original file, relative to the data folder. */
  originalPath: string | null;
  // Submission-only fields.
  authorContact: string;
  receivedAt: string | null;
  decision: Decision | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface ChapterHead {
  id: string;
  bookId: string;
  position: number;
  title: string;
  wordCount: number;
  updatedAt: string;
}

export interface Chapter extends ChapterHead {
  blocks: Block[];
}

export interface Version {
  id: string;
  bookId: string;
  name: string;
  kind: VersionKind;
  note: string;
  wordCount: number;
  chapterCount: number;
  createdAt: string;
}

export interface VersionChapter {
  position: number;
  title: string;
  wordCount: number;
  blocks: Block[];
}

export interface SearchHit {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  snippet: string;
}
