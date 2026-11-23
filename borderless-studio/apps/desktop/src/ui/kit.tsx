/** Small interface building blocks shared by every screen. */
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal${props.wide ? ' wide' : ''}`} role="dialog" aria-label={props.title}>
        <header>
          <h2>{props.title}</h2>
          <button className="btn ghost icon" onClick={props.onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="body">{props.children}</div>
        {props.footer && <footer>{props.footer}</footer>}
      </div>
    </div>
  );
}

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  separator?: boolean;
  heading?: string;
}

export function Menu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
    };
  });
  // Keep the menu inside the window.
  const left = Math.min(props.x, window.innerWidth - 230);
  const top = Math.min(props.y, window.innerHeight - props.items.length * 30 - 16);
  return (
    <div className="menu" ref={ref} style={{ left, top: Math.max(8, top) }} role="menu">
      {props.items.map((it, i) =>
        it.separator ? (
          <div className="sep" key={i} />
        ) : it.heading ? (
          <div className="heading" key={i}>{it.heading}</div>
        ) : (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? 'danger' : ''}
            onClick={() => {
              props.onClose();
              it.onClick?.();
            }}
          >
            {it.icon}
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  );
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button key={o.value} className={o.value === props.value ? 'on' : ''} title={o.title} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const fmtNumber = (n: number) => n.toLocaleString('en-AU');

export function timeAgo(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
