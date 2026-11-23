/**
 * The optional writing assistant, in the inspector. It works on the passage
 * that is selected (or the paragraph the cursor is in) and never changes the
 * text by itself: a revision arrives as tracked changes, an answer is shown
 * here and can be kept as a comment.
 */
import { useRef, useState } from 'react';
import { Loader2, MessageSquarePlus, Sparkles } from 'lucide-react';
import { AssistantError, MAX_PASSAGE_WORDS, REWRITE_TASKS, assistantAnswer, assistantRewrite, type AssistantReply, type RewriteTask } from '@borderless/core';
import { useStore } from '../state/store';
import type { EditorHandle } from '../editor/MarkdownEditor';
import { fmtNumber } from '../ui/kit';
import { assistantConfig } from './AssistantSettings';

interface Props {
  editor: React.RefObject<EditorHandle | null>;
  selectionWords: number;
  onReview(): void;
}

interface Passage {
  from: number;
  to: number;
  text: string;
}

/** The selected text, or the paragraph around the cursor when nothing is selected. */
function currentPassage(editor: EditorHandle | null): Passage | null {
  const view = editor?.view();
  if (!view) return null;
  const doc = view.state.doc.toString();
  let { from, to } = view.state.selection.main;
  if (from === to) {
    const before = doc.lastIndexOf('\n\n', from - 1);
    const after = doc.indexOf('\n\n', from);
    from = before < 0 ? 0 : before + 2;
    to = after < 0 ? doc.length : after;
  }
  const text = doc.slice(from, to);
  return text.trim() ? { from, to, text } : null;
}

export function AssistantPanel(props: Props) {
  const host = useStore((s) => s.host);
  const project = useStore((s) => s.project)!;
  const settings = useStore((s) => s.settings);
  const setView = useStore((s) => s.setView);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<{ kind: 'ok' | 'info' | 'fail'; text: string; review?: boolean } | null>(null);
  const [proposal, setProposal] = useState('');
  const [answer, setAnswer] = useState<{ text: string; at: number } | null>(null);
  const [usage, setUsage] = useState<AssistantReply | null>(null);
  // Each request gets a number; an answer that arrives after "Stop waiting" or a newer request is ignored.
  const run = useRef(0);

  if (!settings.ai.enabled) {
    return (
      <div>
        <p className="dim">The writing assistant is switched off. The app makes no contact with any service.</p>
        <p className="dim small">It can proofread, tighten or smooth a passage, or answer a question about it, using a model on this computer (Ollama) or Claude with your own key. Its proposals always arrive as tracked changes for you to accept or reject.</p>
        <button className="btn" onClick={() => setView('settings')}><Sparkles size={14} /> Set it up in Settings</button>
      </div>
    );
  }

  const fail = (e: unknown) => setNote({ kind: 'fail', text: e instanceof AssistantError || e instanceof Error ? e.message : String(e) });
  const begin = (what: string): number => {
    setBusy(what);
    setNote(null);
    setProposal('');
    setAnswer(null);
    setUsage(null);
    return ++run.current;
  };

  const rewrite = async (task: RewriteTask) => {
    const passage = currentPassage(props.editor.current);
    if (!passage) return setNote({ kind: 'info', text: 'Select the passage you want help with, or put the cursor in a paragraph.' });
    const id = begin(task);
    try {
      const out = await assistantRewrite(host, await assistantConfig(), project.book, task, instruction, passage.text);
      if (id !== run.current) return;
      setUsage(out.reply);
      if (!out.suggestion.ok) {
        setProposal(out.proposed);
        return setNote({ kind: 'fail', text: out.suggestion.message });
      }
      if (out.suggestion.changes === 0) return setNote({ kind: 'ok', text: 'The assistant found nothing to change in this passage.' });
      // The text may have moved while the answer was on its way: the passage is looked up again before anything is put in.
      const view = props.editor.current?.view();
      if (!view) return;
      const doc = view.state.doc.toString();
      let from = passage.from;
      if (doc.slice(from, passage.to) !== passage.text) {
        from = doc.indexOf(passage.text);
        if (from < 0 || doc.indexOf(passage.text, from + 1) >= 0) {
          setProposal(out.proposed);
          return setNote({ kind: 'fail', text: 'The text was edited while the assistant was working, so its changes were not put in. Its proposal is shown below.' });
        }
      }
      const markup = out.suggestion.markup;
      // Not an "input" event: with suggesting switched on, this must not be wrapped in tracked changes a second time.
      view.dispatch({ changes: { from, to: from + passage.text.length, insert: markup }, selection: { anchor: from, head: from + markup.length }, userEvent: 'borderless.assistant', scrollIntoView: true });
      const n = out.suggestion.changes;
      setNote({ kind: 'ok', text: `${n} change${n === 1 ? '' : 's'} proposed. Nothing is final: accept or reject each one.`, review: true });
    } catch (e) {
      if (id === run.current) fail(e);
    } finally {
      if (id === run.current) setBusy('');
    }
  };

  const ask = async () => {
    const passage = currentPassage(props.editor.current);
    if (!passage) return setNote({ kind: 'info', text: 'Select the passage your question is about, or put the cursor in a paragraph.' });
    const id = begin('ask');
    try {
      const reply = await assistantAnswer(host, await assistantConfig(), project.book, instruction, passage.text);
      if (id !== run.current) return;
      setUsage(reply);
      setAnswer({ text: reply.text, at: passage.to });
    } catch (e) {
      if (id === run.current) fail(e);
    } finally {
      if (id === run.current) setBusy('');
    }
  };

  const keepAsComment = () => {
    const view = props.editor.current?.view();
    if (!view || !answer) return;
    const body = answer.text.replace(/\s+/g, ' ').replace(/<<\}/g, '< <}').trim();
    const at = Math.min(answer.at, view.state.doc.length);
    view.dispatch({ changes: { from: at, insert: `{>>@ai: ${body}<<}` }, userEvent: 'borderless.assistant', scrollIntoView: true });
    setAnswer(null);
    setNote({ kind: 'ok', text: 'Kept as a comment after the passage. Comments are never exported.', review: true });
  };

  const working = busy !== '';
  const provider = settings.ai.provider === 'claude' ? 'Claude' : 'the model on this computer';
  return (
    <div className="assistant">
      <div className="small dim">
        {props.selectionWords > 0
          ? <>{fmtNumber(props.selectionWords)} words selected{props.selectionWords > MAX_PASSAGE_WORDS ? <span style={{ color: 'var(--warn)' }}> (more than {fmtNumber(MAX_PASSAGE_WORDS)}: select less for a revision)</span> : null}</>
          : 'Nothing is selected: the paragraph at the cursor is used.'}
      </div>
      <div className="assistant-tasks">
        {(Object.keys(REWRITE_TASKS) as (keyof typeof REWRITE_TASKS)[]).map((task) => (
          <button key={task} className="btn" disabled={working} title={REWRITE_TASKS[task].hint} onClick={() => void rewrite(task)}>
            {busy === task ? <Loader2 size={14} className="spin" /> : null} {REWRITE_TASKS[task].label}
            <span className="small faint">{REWRITE_TASKS[task].hint}</span>
          </button>
        ))}
      </div>
      <textarea className="textarea" rows={3} value={instruction} placeholder={'Your own instruction or question, for example:\nMake this paragraph calmer.\nIs it clear who is speaking here?'} onChange={(e) => setInstruction(e.target.value)} />
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn small" disabled={working || !instruction.trim()} onClick={() => void rewrite('custom')}>{busy === 'custom' ? <Loader2 size={13} className="spin" /> : null} Change the text this way</button>
        <button className="btn small" disabled={working || !instruction.trim()} onClick={() => void ask()}>{busy === 'ask' ? <Loader2 size={13} className="spin" /> : null} Just answer</button>
      </div>
      {working && (
        <div className="notice small" style={{ marginTop: 10 }}>
          Waiting for {provider}. This can take up to a minute for a long passage.{' '}
          <button className="btn ghost small" onClick={() => { run.current++; setBusy(''); setNote({ kind: 'info', text: 'Stopped waiting. If an answer still arrives, it is ignored.' }); }}>Stop waiting</button>
        </div>
      )}
      {note && (
        <div className={`notice small selectable ${note.kind === 'fail' ? 'fail' : note.kind === 'ok' ? 'ok' : ''}`} style={{ marginTop: 10 }}>
          {note.text} {note.review && <button className="btn small" onClick={props.onReview}>Review</button>}
        </div>
      )}
      {proposal && <div className="assistant-text selectable">{proposal}</div>}
      {answer && (
        <>
          <div className="assistant-text selectable">{answer.text}</div>
          <button className="btn small" onClick={keepAsComment}><MessageSquarePlus size={13} /> Keep as a comment</button>
        </>
      )}
      {usage && <div className="small faint" style={{ marginTop: 8 }}>{usage.model}{usage.inputTokens !== undefined ? `: ${fmtNumber(usage.inputTokens)} tokens sent, ${fmtNumber(usage.outputTokens ?? 0)} received` : ''}</div>}
      <p className="small faint" style={{ marginTop: 14 }}>
        {settings.ai.provider === 'claude'
          ? 'Only the passage, your instruction and the house style of the book are sent to Anthropic, and only when you press a button.'
          : 'The passage goes to the Ollama program on this computer and nowhere else.'}
      </p>
    </div>
  );
}
