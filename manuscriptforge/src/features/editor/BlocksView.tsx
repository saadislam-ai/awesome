import { Fragment, type ReactNode } from 'react';
import type { Block, Run } from '../../core/model/blocks';

function renderRuns(runs: Run[]): ReactNode {
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

export function BlockView({ block }: { block: Block }) {
  if (block.type === 'break') return <div className="ms-break" aria-label="Scene break">* * *</div>;
  const style = 'align' in block && block.align ? { textAlign: block.align } : undefined;
  if (block.type === 'heading') {
    const Tag = `h${Math.min(block.level + 1, 5)}` as 'h2';
    return <Tag style={style}>{renderRuns(block.runs)}</Tag>;
  }
  if (block.type === 'quote') return <blockquote>{renderRuns(block.runs)}</blockquote>;
  if (block.type === 'list') return <p className={block.ordered ? 'ms-li ms-ol' : 'ms-li'}>{renderRuns(block.runs)}</p>;
  return <p style={style}>{block.runs.length ? renderRuns(block.runs) : <br />}</p>;
}

/** Read-only rendering of manuscript blocks, used in previews. */
export function BlocksView({ blocks }: { blocks: Block[] }) {
  return (
    <div className="manuscript manuscript-readonly">
      {blocks.map((block, index) => (
        <div className="ms-block" key={index}>
          <BlockView block={block} />
        </div>
      ))}
    </div>
  );
}
