import { ArrowDown, ArrowUp, ArrowUpToLine, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ChapterHead } from '../../core/model/book';
import { formatCount } from '../../core/text/words';
import { Button, Menu } from '../../ui/components';

interface Props {
  heads: ChapterHead[];
  activeId: string | null;
  /** Live word count of the chapter being edited. */
  activeWords: number | null;
  onOpen(id: string): void;
  onRename(id: string, title: string): void;
  onMove(id: string, direction: -1 | 1): void;
  onMerge(id: string): void;
  onDelete(head: ChapterHead): void;
  onAdd(): void;
}

export function ChapterList({ heads, activeId, activeWords, onOpen, onRename, onMove, onMerge, onDelete, onAdd }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commit = () => {
    if (renaming && draft.trim()) onRename(renaming, draft.trim());
    setRenaming(null);
  };

  return (
    <nav className="chapter-list" aria-label="Chapters">
      <div className="panel-head">
        <span>Chapters</span>
        <span className="muted">{heads.length}</span>
      </div>
      <ol>
        {heads.map((head, index) => (
          <li key={head.id} className={head.id === activeId ? 'is-active' : ''}>
            {renaming === head.id ? (
              <input
                className="chapter-rename"
                value={draft}
                autoFocus
                aria-label="Chapter title"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <button
                className="chapter-item"
                onClick={() => onOpen(head.id)}
                onDoubleClick={() => {
                  setDraft(head.title);
                  setRenaming(head.id);
                }}
                aria-current={head.id === activeId ? 'true' : undefined}
              >
                <span className="chapter-title">{head.title}</span>
                <span className="chapter-words">{formatCount(head.id === activeId && activeWords !== null ? activeWords : head.wordCount)}</span>
              </button>
            )}
            <Menu
              label={`Actions for ${head.title}`}
              trigger={<MoreHorizontal size={16} />}
              items={[
                { label: 'Rename', icon: <Pencil size={15} />, onSelect: () => { setDraft(head.title); setRenaming(head.id); } },
                { label: 'Move up', icon: <ArrowUp size={15} />, disabled: index === 0, onSelect: () => onMove(head.id, -1) },
                { label: 'Move down', icon: <ArrowDown size={15} />, disabled: index === heads.length - 1, onSelect: () => onMove(head.id, 1) },
                { label: 'Join onto chapter above', icon: <ArrowUpToLine size={15} />, disabled: index === 0, onSelect: () => onMerge(head.id) },
                { label: 'Delete chapter…', icon: <Trash2 size={15} />, danger: true, disabled: heads.length <= 1, onSelect: () => onDelete(head) },
              ]}
            />
          </li>
        ))}
      </ol>
      <Button variant="ghost" size="sm" icon={<Plus size={15} />} onClick={onAdd} className="add-chapter">
        Add chapter
      </Button>
    </nav>
  );
}
