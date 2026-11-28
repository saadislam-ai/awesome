import { runsToMarkup } from '../edit/markup';
import { runsText, type Block } from '../model/blocks';
import { hasPrintableTitle, type ExportBook } from './common';

function markdownRuns(block: Exclude<Block, { type: 'break' }>): string {
  // Markdown has no underline: "__text__" would mean bold, so underline is written as a tag.
  let open = false;
  return runsToMarkup(block.runs)
    .replace(/__/g, () => ((open = !open) ? '<u>' : '</u>'))
    .replace(/\n/g, '  \n');
}

/** The book as Markdown. Chapter titles are level-one headings. */
export function exportMarkdown(book: ExportBook): string {
  const out: string[] = ['---', `title: ${JSON.stringify(book.title)}`];
  if (book.author) out.push(`author: ${JSON.stringify(book.author)}`);
  if (book.language && book.language !== 'und') out.push(`lang: ${book.language}`);
  out.push('---', '');
  for (const chapter of book.chapters) {
    if (hasPrintableTitle(chapter)) out.push(`# ${chapter.title}`, '');
    let ordinal = 0;
    chapter.blocks.forEach((block, index) => {
      const previous = chapter.blocks[index - 1];
      if (block.type === 'list' && block.ordered) ordinal = previous?.type === 'list' && previous.ordered ? ordinal + 1 : 1;
      if (block.type === 'break') out.push('* * *', '');
      else if (block.type === 'heading') out.push(`${'#'.repeat(Math.min(block.level + 1, 6))} ${markdownRuns(block)}`, '');
      else if (block.type === 'quote') out.push(`> ${markdownRuns(block).replace(/\n/g, '\n> ')}`, '');
      else if (block.type === 'list') {
        out.push(`${block.ordered ? `${ordinal}.` : '-'} ${markdownRuns(block)}`);
        const next = chapter.blocks[index + 1];
        if (!(next?.type === 'list' && next.ordered === block.ordered)) out.push('');
      } else out.push(markdownRuns(block), '');
    });
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** The book as plain text, one paragraph per line with a blank line between. */
export function exportText(book: ExportBook): string {
  const out: string[] = [];
  for (const chapter of book.chapters) {
    if (hasPrintableTitle(chapter)) out.push(chapter.title, '');
    let ordinal = 0;
    chapter.blocks.forEach((block, index) => {
      const previous = chapter.blocks[index - 1];
      if (block.type === 'list' && block.ordered) ordinal = previous?.type === 'list' && previous.ordered ? ordinal + 1 : 1;
      if (block.type === 'break') out.push('* * *', '');
      else if (block.type === 'list') out.push(`${block.ordered ? `${ordinal}.` : '-'} ${runsText(block.runs)}`, '');
      else out.push(runsText(block.runs), '');
    });
    out.push('');
  }
  return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}
