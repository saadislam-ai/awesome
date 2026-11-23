/**
 * Shows a picture file from the disk. The bytes are read through the host and
 * handed to the web view as an object URL, which works the same in the
 * installed app and in the browser used for development, and never shows a
 * stale cached copy.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useStore } from '../state/store';

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

export function useFileUrl(path: string | null | undefined, version: unknown = 0): string | null {
  const host = useStore((s) => s.host);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    if (!path) {
      setUrl(null);
      return;
    }
    void host.readBinary(path).then(
      (bytes) => {
        if (!alive) return;
        const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
        made = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: TYPES[ext] ?? 'application/octet-stream' }));
        setUrl(made);
      },
      () => alive && setUrl(null),
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [host, path, version]);
  return url;
}

export function FileImage(props: { path: string | null | undefined; version?: unknown; alt: string; className?: string; style?: CSSProperties }) {
  const url = useFileUrl(props.path, props.version);
  if (!url) return null;
  return <img src={url} alt={props.alt} className={props.className} style={props.style} draggable={false} />;
}
