// Regenerates the sample manuscripts in every supported format.
// Needs pandoc and LibreOffice (soffice) on the PATH. The generated files are
// committed, so this only has to be run when the sources in ./src change.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'src');
const out = join(here, 'files');
mkdirSync(out, { recursive: true });

const pandoc = (args) => execFileSync('pandoc', args, { stdio: 'inherit' });
const soffice = (format, file, filter) =>
  execFileSync('soffice', ['--headless', ...(filter ? [`--infilter=${filter}`] : []), '--convert-to', format, '--outdir', out, file], { stdio: 'inherit' });

for (const name of ['novel', 'nonfiction', 'picturebook', 'spanish']) {
  const md = join(src, `${name}.md`);
  pandoc([md, '-o', join(out, `${name}.docx`)]);
  pandoc([md, '-o', join(out, `${name}.epub`)]);
}
// Plain text in both common shapes: hard-wrapped lines and one paragraph per line.
pandoc([join(src, 'novel.md'), '-t', 'plain', '--columns=72', '-o', join(out, 'novel-wrapped.txt')]);
pandoc([join(src, 'novel.md'), '-t', 'plain', '--wrap=none', '-o', join(out, 'novel.txt')]);
pandoc([join(src, 'spanish.md'), '-t', 'plain', '--wrap=none', '-o', join(out, 'spanish.txt')]);
pandoc([join(src, 'novel.md'), '-s', '-o', join(out, 'novel-pandoc.rtf')]);

// LibreOffice output is close to what Word produces.
soffice('rtf', join(out, 'novel.docx'));
soffice('pdf', join(out, 'novel.docx'));
soffice('pdf', join(out, 'spanish.docx'));
rmSync(join(out, 'manuscript.docx'), { force: true });
soffice('docx:MS Word 2007 XML', join(src, 'manuscript.html'), 'HTML (StarWriter)');
if (!existsSync(join(out, 'manuscript.docx'))) throw new Error('manuscript.docx was not created');
soffice('rtf', join(out, 'manuscript.docx'));
soffice('pdf', join(out, 'manuscript.docx'));
console.log('Fixtures written to', out);
