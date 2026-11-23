/**
 * A quick look at a finished EPUB inside the app: the pages of the file,
 * shown at the width of a phone, an e-reader or a tablet, in light, sepia or
 * dark. The frame is locked down: no scripts, no files, no network.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { PREVIEW_THEME_MARKER, epubPreview, type EpubPreview as Preview } from '@borderless/core';
import { useStore } from '../state/store';
import { Modal, Seg } from '../ui/kit';

const DEVICES = {
  phone: { label: 'Phone', width: 360, height: 640 },
  ereader: { label: 'E-reader', width: 480, height: 640 },
  tablet: { label: 'Tablet', width: 640, height: 640 },
} as const;
type Device = keyof typeof DEVICES;
const THEMES = {
  light: { label: 'Light', bg: '#ffffff', fg: '#1a1a1a' },
  sepia: { label: 'Sepia', bg: '#f6eedb', fg: '#3b2f20' },
  dark: { label: 'Dark', bg: '#121212', fg: '#dddddd' },
} as const;
type Theme = keyof typeof THEMES;
const SIZES = [85, 100, 120, 145];

export function EpubPreview(props: { path: string; onClose: () => void }) {
  const host = useStore((s) => s.host);
  const [book, setBook] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [device, setDevice] = useState<Device>('phone');
  const [theme, setTheme] = useState<Theme>('light');
  const [size, setSize] = useState(1);

  useEffect(() => {
    let cancelled = false;
    host.readBinary(props.path)
      .then((bytes) => { if (!cancelled) setBook(epubPreview(bytes)); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [host, props.path]);

  // The page with the chosen colours and text size, as an address the frame can load.
  const url = useMemo(() => {
    if (!book) return '';
    const t = THEMES[theme];
    const css = `html{background:${t.bg} !important;}body{background:${t.bg} !important;color:${t.fg} !important;font-size:${SIZES[size]}% !important;margin:0 !important;padding:6% 8% !important;}a{color:inherit;}img,svg{max-width:100%;height:auto;}`;
    return URL.createObjectURL(new Blob([book.docs[index].xhtml.replace(PREVIEW_THEME_MARKER, css)], { type: 'application/xhtml+xml' }));
  }, [book, index, theme, size]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const d = DEVICES[device];
  const current = book ? book.toc.reduce((best, entry, i) => (entry.doc <= index ? i : best), 0) : 0;
  return (
    <Modal title={book ? `Ebook preview: ${book.title}` : 'Ebook preview'} onClose={props.onClose} wide>
      {error && <div className="notice fail selectable">{error}</div>}
      {!book && !error && <div className="row dim"><Loader2 size={15} className="spin" /> Opening the ebook...</div>}
      {book && (
        <div className="epub-preview">
          <div className="epub-toc">
            {book.toc.map((entry, i) => (
              <button key={i} className={i === current ? 'on' : ''} onClick={() => setIndex(entry.doc)} title={entry.title}>{entry.title}</button>
            ))}
          </div>
          <div className="epub-stage">
            <div className="row wrap" style={{ justifyContent: 'center', gap: 10 }}>
              <Seg value={device} options={(Object.keys(DEVICES) as Device[]).map((k) => ({ value: k, label: DEVICES[k].label }))} onChange={setDevice} />
              <Seg value={theme} options={(Object.keys(THEMES) as Theme[]).map((k) => ({ value: k, label: THEMES[k].label }))} onChange={setTheme} />
              <Seg value={String(size)} options={SIZES.map((_, i) => ({ value: String(i), label: <span style={{ fontSize: 10 + i * 2 }}>A</span>, title: 'Text size' }))} onChange={(v) => setSize(Number(v))} />
            </div>
            <div className="row" style={{ justifyContent: 'center', gap: 12, marginTop: 12 }}>
              <button className="btn small" disabled={index === 0} onClick={() => setIndex(index - 1)} title="Previous page of the file"><ChevronLeft size={15} /></button>
              <div className={`epub-device ${device}`} style={{ width: d.width, height: d.height, background: THEMES[theme].bg }}>
                <iframe key={url} title="Ebook page" sandbox="" src={url} />
              </div>
              <button className="btn small" disabled={index >= book.docs.length - 1} onClick={() => setIndex(index + 1)} title="Next page of the file"><ChevronRight size={15} /></button>
            </div>
            <div className="small faint" style={{ textAlign: 'center', marginTop: 10 }}>
              File {index + 1} of {book.docs.length} in reading order. This is a quick look: reading apps use their own fonts and margins, so finish with Kindle Previewer and one real phone.
            </div>
            {book.notes.map((n, i) => <div key={i} className="notice small" style={{ marginTop: 8 }}>{n}</div>)}
          </div>
        </div>
      )}
    </Modal>
  );
}
