/**
 * Loads the bundled book fonts into the web view so that the editor shows
 * text in the same typeface the book is printed in. The font files are read
 * through the Host, so nothing is fetched from the internet.
 */
import { FONT_CATALOG, joinPath, type Host } from '@borderless/core';

const loaded = new Set<string>();

async function loadFamily(host: Host, family: string): Promise<void> {
  if (loaded.has(family)) return;
  const info = FONT_CATALOG.find((f) => f.family === family);
  if (!info) return;
  loaded.add(family);
  const { resources } = await host.paths();
  const add = async (file: string | undefined, style: 'normal' | 'italic', weight: '400' | '700') => {
    if (!file) return;
    try {
      const data = await host.readBinary(joinPath(resources, 'fonts', info.dir, file));
      const face = new FontFace(family, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, { style, weight });
      await face.load();
      document.fonts.add(face);
    } catch {
      /* a missing font file only means the editor falls back to a system serif */
    }
  };
  await Promise.all([
    add(info.files.regular, 'normal', '400'),
    add(info.files.italic, 'italic', '400'),
    add(info.files.bold, 'normal', '700'),
    add(info.files.boldItalic, 'italic', '700'),
  ]);
}

/** Load the chosen editor font plus the Bangla fallback, so Bengali text always shapes correctly. */
export async function loadEditorFonts(host: Host, family: string): Promise<void> {
  await Promise.all([loadFamily(host, family), loadFamily(host, 'Noto Serif Bengali')]);
}

export function editorFontStack(family: string): string {
  return `"${family}", "Noto Serif Bengali", Georgia, "Times New Roman", serif`;
}
