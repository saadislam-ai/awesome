/** What the model returned for one paragraph. */
export interface ParsedParagraph {
  text: string;
  note: string;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

function clean(text: string, keepLineBreaks: boolean): string {
  let out = text.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m]);
  out = keepLineBreaks ? out.replace(/[ \t]*\n[ \t]*/g, '\n') : out.replace(/\s*\n\s*/g, ' ');
  return out.trim();
}

/**
 * Reads the model's reply. Models, small ones especially, do not always
 * follow a format to the letter, so this accepts missing closing tags, code
 * fences, visible "thinking" and stray commentary, and simply ignores what
 * it cannot use. Paragraphs that are absent stay absent: the caller keeps
 * the original text for those.
 */
export function parseEditReply(reply: string, lineBreakIds: Set<number> = new Set()): Map<number, ParsedParagraph> {
  let text = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
  text = text.replace(/```[a-z]*\n?/gi, '');

  const result = new Map<number, ParsedParagraph>();
  const paragraph = /<p\s+id\s*=\s*["']?(\d+)["']?\s*>([\s\S]*?)(?:<\/p>|(?=<p\s+id\s*=)|(?=<note\b)|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = paragraph.exec(text))) {
    const id = Number(m[1]);
    if (!result.has(id)) result.set(id, { text: clean(m[2], lineBreakIds.has(id)), note: '' });
    if (m[0].length === 0) paragraph.lastIndex++;
  }
  const note = /<note\s+id\s*=\s*["']?(\d+)["']?\s*>([\s\S]*?)(?:<\/note>|(?=<p\s+id\s*=)|(?=<note\b)|$)/gi;
  while ((m = note.exec(text))) {
    const entry = result.get(Number(m[1]));
    if (entry && !entry.note) entry.note = clean(m[2], false).replace(/\s+/g, ' ').slice(0, 200);
    if (m[0].length === 0) note.lastIndex++;
  }
  return result;
}

export function isNoChangeNote(note: string): boolean {
  return /^(?:no changes?(?: needed| made| required)?|none|unchanged|n\/a)?[.!]?$/i.test(note.trim());
}
