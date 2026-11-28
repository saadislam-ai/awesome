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
  focus(): void;
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
    () => ({
      getBlocks: () => (editor ? docToBlocks(editor.getJSON() as PmNode) : initialBlocks),
      cursorBlockIndex: () => {
        if (!editor) return 0;
        const { $from } = editor.state.selection;
        const doc = editor.getJSON() as PmNode;
        const top = $from.index(0);
        let index = 0;
        (doc.content ?? []).slice(0, top).forEach((node) => (index += blockCount(node)));
        const node = doc.content?.[top];
        if (node && (node.type === 'blockquote' || node.type === 'bulletList' || node.type === 'orderedList') && $from.depth >= 1) {
          index += $from.index(1);
        }
        return index;
      },
      focus: () => editor?.commands.focus(),
    }),
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
