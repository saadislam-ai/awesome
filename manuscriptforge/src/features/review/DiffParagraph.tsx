import { Check, RotateCcw, X } from 'lucide-react';
import { Fragment, useMemo, type ReactNode } from 'react';
import { CHANGE_KIND_LABELS, groupHunks, type ChangeGroup, type ChangeKind, type Decision, type Decisions, type Granularity, type Hunk } from '../../core/edit/diff';
import { markupSpans, sliceMarkup } from '../../core/edit/markup';
import type { Run } from '../../core/model/blocks';

function Styled({ runs }: { runs: Run[] }): ReactNode {
  return runs.map((run, index) => {
    let node: ReactNode = run.text.split('\n').map((part, i) => (
      <Fragment key={i}>
        {i > 0 && <br />}
        {part}
      </Fragment>
    ));
    if (run.b) node = <strong>{node}</strong>;
    if (run.i) node = <em>{node}</em>;
    if (run.u) node = <u>{node}</u>;
    if (run.s) node = <s>{node}</s>;
    return <Fragment key={index}>{node}</Fragment>;
  });
}

type GroupState = 'pending' | 'accepted' | 'rejected';

function stateOf(group: ChangeGroup, decisions: Decisions): GroupState {
  const all = group.hunks.map((h) => decisions[h]);
  if (all.every((d) => d === 'accept')) return 'accepted';
  if (all.every((d) => d === 'reject')) return 'rejected';
  return 'pending';
}

interface Props {
  original: string;
  revised: string;
  hunks: Hunk[];
  decisions?: Decisions;
  granularity?: Granularity;
  /** "inline" shows old and new together. "old" and "new" are the two halves of a side-by-side view. */
  mode?: 'inline' | 'old' | 'new';
  /** Only changes of these kinds are highlighted and can be decided. Others show their current text. */
  kinds?: ChangeKind[] | null;
  /** Called with a decision, or null to return the change to undecided. Omit for a read-only view. */
  onDecide?(hunks: number[], decision: Decision | null): void;
}

/** One paragraph with its tracked changes, and buttons to accept or reject each of them. */
export function DiffParagraph({ original, revised, hunks, decisions = {}, granularity = 'word', mode = 'inline', kinds = null, onDecide }: Props) {
  const { groups, originalSpans, revisedSpans, offsets } = useMemo(() => {
    const grouped = groupHunks(original, hunks, granularity);
    // Where each group begins and ends in the revised text.
    const shift = new Map<number, number>();
    let delta = 0;
    for (const hunk of hunks) {
      shift.set(hunk.index, delta);
      delta += hunk.after.length - hunk.before.length;
    }
    const ranges = grouped.map((group) => {
      const first = shift.get(group.hunks[0]) ?? 0;
      const lastHunk = hunks[group.hunks[group.hunks.length - 1]];
      const after = (shift.get(lastHunk.index) ?? 0) + lastHunk.after.length - lastHunk.before.length;
      return [group.start + first, group.end + after] as const;
    });
    return { groups: grouped, originalSpans: markupSpans(original), revisedSpans: markupSpans(revised), offsets: ranges };
  }, [original, revised, hunks, granularity]);

  const parts: ReactNode[] = [];
  let position = 0;
  groups.forEach((group, index) => {
    if (group.start > position) parts.push(<Styled key={`e${index}`} runs={sliceMarkup(originalSpans, position, group.start)} />);
    position = group.end;
    const state = stateOf(group, decisions);
    const before = <Styled runs={sliceMarkup(originalSpans, group.start, group.end)} />;
    const after = <Styled runs={sliceMarkup(revisedSpans, offsets[index][0], offsets[index][1])} />;
    const shown = !kinds || kinds.includes(group.kind);
    if (!shown) {
      // Not in the current filter: show the text as it currently stands, without marks.
      parts.push(<Fragment key={`g${index}`}>{state === 'accepted' ? after : before}</Fragment>);
      return;
    }
    const label = CHANGE_KIND_LABELS[group.kind];
    const controls = onDecide && mode !== 'old' && (
      <span className="chg-controls">
        {state === 'pending' ? (
          <>
            <button className="chg-btn chg-accept" title={`Accept (${label})`} aria-label={`Accept change: ${group.before || 'nothing'} to ${group.after || 'nothing'}`} onClick={() => onDecide(group.hunks, 'accept')}>
              <Check size={12} />
            </button>
            <button className="chg-btn chg-reject" title={`Reject (${label})`} aria-label={`Reject change: ${group.before || 'nothing'} to ${group.after || 'nothing'}`} onClick={() => onDecide(group.hunks, 'reject')}>
              <X size={12} />
            </button>
          </>
        ) : (
          <button className="chg-btn" title="Undo this decision" aria-label="Undo this decision" onClick={() => onDecide(group.hunks, null)}>
            <RotateCcw size={11} />
          </button>
        )}
      </span>
    );
    const hasBefore = group.before.length > 0;
    const hasAfter = group.after.length > 0;
    parts.push(
      <span key={`g${index}`} className={`chg chg-${state}`} data-kind={group.kind} title={label}>
        {mode === 'inline' && (
          <>
            {state !== 'accepted' && hasBefore && <del>{before}</del>}
            {state !== 'rejected' && hasAfter && <ins>{after}</ins>}
            {state === 'accepted' && !hasAfter && <span className="chg-gone" aria-label="Removed text" />}
          </>
        )}
        {mode === 'old' && (hasBefore ? <del>{before}</del> : <span className="chg-gone" />)}
        {mode === 'new' && (hasAfter ? <ins>{after}</ins> : <span className="chg-gone" aria-label="Removed text" />)}
        {controls}
      </span>,
    );
  });
  if (position < original.length) parts.push(<Styled key="tail" runs={sliceMarkup(originalSpans, position, original.length)} />);
  return <p className="diff-paragraph">{parts}</p>;
}

/** A whole paragraph that was added or removed (used when comparing versions). */
export function WholeParagraph({ markup, type }: { markup: string; type: 'added' | 'removed' | 'same' }) {
  const runs = sliceMarkup(markupSpans(markup), 0, markup.length);
  if (type === 'same') return <p className="diff-paragraph"><Styled runs={runs} /></p>;
  return (
    <p className={`diff-paragraph diff-${type}`}>
      {type === 'added' ? <ins><Styled runs={runs} /></ins> : <del><Styled runs={runs} /></del>}
    </p>
  );
}
