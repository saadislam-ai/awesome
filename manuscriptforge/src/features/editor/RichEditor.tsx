import TextAlign from '@tiptap/extension-text-align';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  AlignCenter, Bold, Heading2, Heading3, Italic, List, ListOrdered, Minus, Pilcrow, Quote, Redo2, Strikethrough, Underline, Undo2,
} from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import type { Block } from '../../core/model/blocks';
import { countWords } from '../../core/text/words';
import { IconButton } from '../../ui/components';
import { MOD } from '../../ui/format';
import { blockCount, blocksToDoc, docToBlocks, type PmNode } from './convert';

export interface RichEditorHandle {
  /** The chapter text as it currently stands in the editor. */
  getBlocks(): Block[];
  /** Index of the stored block that contains the cursor. */
  cursorBlockIndex(): number;
  /** The stored blocks covered by the selection, or null when nothing is selected. */
  selectionRange(): { from: number; to: number; words: number } | null;
  focus(): void;
  /** Scrolls to a stored block and selects the quoted words in it, if they are found. */
  reveal(blockIndex: number | null, quote: string): void;
}

interface Props {
  initialBlocks: Block[];
  /** Called on every change to the text. */
  onChange(): void;
  onWordCount(words: number): void;
  /** Extra toolbar buttons supplied by the surrounding screen. */
  toolbarEnd?: ReactNode;
  showToolbar: boolean;
  dir?: 'rtl' | 'ltr';
  lang?: string;
}

function Toolbar({ editor, end }: { editor: Editor; end?: ReactNode }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      paragraph: e.isActive('paragraph') && !e.isActive('blockquote') && !e.isActive('bulletList') && !e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      center: e.isActive({ textAlign: 'center' }),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
      <IconButton label={`Undo (${MOD}+Z)`} disabled={!state.canUndo} onClick={() => chain().undo().run()}><Undo2 size={16} /></IconButton>
      <IconButton label={`Redo (${MOD}+Shift+Z)`} disabled={!state.canRedo} onClick={() => chain().redo().run()}><Redo2 size={16} /></IconButton>
      <span className="toolbar-sep" />
      <IconButton label={`Bold (${MOD}+B)`} active={state.bold} onClick={() => chain().toggleBold().run()}><Bold size={16} /></IconButton>
      <IconButton label={`Italic (${MOD}+I)`} active={state.italic} onClick={() => chain().toggleItalic().run()}><Italic size={16} /></IconButton>
      <IconButton label={`Underline (${MOD}+U)`} active={state.underline} onClick={() => chain().toggleUnderline().run()}><Underline size={16} /></IconButton>
      <IconButton label="Strikethrough" active={state.strike} onClick={() => chain().toggleStrike().run()}><Strikethrough size={16} /></IconButton>
      <span className="toolbar-sep" />
      <IconButton label="Normal paragraph" active={state.paragraph} onClick={() => chain().setParagraph().run()}><Pilcrow size={16} /></IconButton>
      <IconButton label="Section heading" active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></IconButton>
      <IconButton label="Sub-heading" active={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}><Heading3 size={16} /></IconButton>
      <IconButton label="Quotation" active={state.quote} onClick={() => chain().toggleBlockquote().run()}><Quote size={16} /></IconButton>
      <IconButton label="Bulleted list" active={state.bullet} onClick={() => chain().toggleBulletList().run()}><List size={16} /></IconButton>
      <IconButton label="Numbered list" active={state.ordered} onClick={() => chain().toggleOrderedList().run()}><ListOrdered size={16} /></IconButton>
      <IconButton label="Centre this paragraph" active={state.center} onClick={() => (state.center ? chain().unsetTextAlign().run() : chain().setTextAlign('center').run())}>
        <AlignCenter size={16} />
      </IconButton>
      <IconButton label="Insert a scene break" onClick={() => chain().setHorizontalRule().run()}><Minus size={16} /></IconButton>
      <span className="grow" />
      {end}
    </div>
  );
}

export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { initialBlocks, onChange, onWordCount, toolbarEnd, showToolbar, dir, lang },
  ref,
) {
  const callbacks = useRef({ onChange, onWordCount });
  callbacks.current = { onChange, onWordCount };
  const countTimer = useRef<number | undefined>(undefined);
  const loaded = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, code: false, link: false, heading: { levels: [1, 2, 3, 4] } }),
      TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'], defaultAlignment: null as unknown as string }),
    ],
    content: blocksToDoc(initialBlocks),
    editorProps: {
      attributes: { class: 'manuscript', spellcheck: 'true', 'aria-label': 'Chapter text', ...(lang ? { lang } : {}), ...(dir ? { dir } : {}) },
    },
    onUpdate: ({ editor: e, transaction }) => {
      // Changes the editor makes to its own freshly loaded document are not user edits.
      if (!loaded.current || !transaction.docChanged) return;
      callbacks.current.onChange();
      window.clearTimeout(countTimer.current);
      countTimer.current = window.setTimeout(() => callbacks.current.onWordCount(countWords(e.getText())), 250);
    },
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loaded.current = true;
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(countTimer.current);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => {
      /** Index of the stored block at a position in the editor's document. */
      const blockIndexAt = (position: { index(depth: number): number; depth: number }): number => {
        const doc = editor!.getJSON() as PmNode;
        const top = position.index(0);
        let index = 0;
        (doc.content ?? []).slice(0, top).forEach((node) => (index += blockCount(node)));
        const node = doc.content?.[top];
        if (node && (node.type === 'blockquote' || node.type === 'bulletList' || node.type === 'orderedList') && position.depth >= 1) {
          index += position.index(1);
        }
        return index;
      };
      return {
      getBlocks: () => (editor ? docToBlocks(editor.getJSON() as PmNode) : initialBlocks),
      cursorBlockIndex: () => (editor ? blockIndexAt(editor.state.selection.$from) : 0),
      selectionRange: () => {
        if (!editor || editor.state.selection.empty) return null;
        const { $from, $to, from, to } = editor.state.selection;
        const words = countWords(editor.state.doc.textBetween(from, to, ' '));
        return words ? { from: blockIndexAt($from), to: blockIndexAt($to), words } : null;
      },
      focus: () => editor?.commands.focus(),
      reveal: (blockIndex, quote) => {
        if (!editor) return;
        // Walk the document's text blocks in the same order as the stored blocks.
        const blocks: { pos: number; text: string }[] = [];
        let counted = 0;
        editor.state.doc.forEach((node, offset) => {
          if (node.type.name === 'horizontalRule') {
            counted++;
            return;
          }
          if (node.isTextblock) {
            blocks[counted++] = { pos: offset, text: node.textBetween(0, node.content.size, undefined, '\n') };
            return;
          }
          node.descendants((child, childPos) => {
            if (!child.isTextblock) return true;
            blocks[counted++] = { pos: offset + 1 + childPos, text: child.textBetween(0, child.content.size, undefined, '\n') };
            return false;
          });
        });
        const normalise = (text: string) => text.toLowerCase().replace(/[“”„«»"]/g, '"').replace(/[‘’]/g, "'");
        // Long quotes are stored cut short with an ellipsis: search for the part that is there.
        const needle = normalise(quote.trim().replace(/…$/, '').trimEnd());
        const candidates = blockIndex !== null && blocks[blockIndex] ? [blocks[blockIndex], ...blocks] : blocks;
        let target = blockIndex !== null ? blocks[blockIndex] : undefined;
        let from = -1;
        if (needle) {
          for (const block of candidates) {
            if (!block) continue;
            const at = normalise(block.text).indexOf(needle);
            if (at >= 0) {
              target = block;
              from = at;
              break;
            }
          }
        }
        if (!target) return;
        const start = target.pos + 1 + Math.max(from, 0);
        const end = from >= 0 ? start + needle.length : start;
        editor.chain().focus().setTextSelection({ from: start, to: end }).scrollIntoView().run();
        // Bring the passage to the middle of the screen rather than its edge.
        window.setTimeout(() => {
          const dom = editor.view.domAtPos(start).node;
          (dom instanceof Element ? dom : dom.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 30);
      },
      };
    },
    [editor, initialBlocks],
  );

  if (!editor) return null;
  return (
    <div className="rich-editor">
      {showToolbar && <Toolbar editor={editor} end={toolbarEnd} />}
      <div className="editor-scroll" onClick={(e) => e.target === e.currentTarget && editor.commands.focus('end')}>
        <EditorContent editor={editor} className="editor-page" />
      </div>
    </div>
  );
});
