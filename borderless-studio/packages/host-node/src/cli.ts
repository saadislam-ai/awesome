#!/usr/bin/env node
/**
 * bstudio: the Borderless Studio command line tool. It runs the same engine
 * as the desktop app, which makes it useful for scripted builds, for the
 * automated tests, and for rebuilding the sample book.
 *
 *   bstudio tools                               show which external tools were found
 *   bstudio specs                               validate the platform spec files
 *   bstudio info <book folder>                  word counts, formats and warnings
 *   bstudio build <book folder> [options]       export files
 *       --format <id>          one format (default: every enabled format)
 *       --platform <id>        one platform (default: every platform of the format)
 *       --accept-changes       apply pending tracked changes instead of ignoring them
 *       --all                  every enabled format and platform (default)
 *       --no-cover             interiors and ebooks only
 *       --preview              also write a cover preview picture with guides
 *   bstudio new <parent folder> --title "..." --author "..." [--genre novel]
 */
import {
  assembleProject, bundledSpecsDir, coverKindsFor, createBook, exportCover, exportEbookCover, exportEpub, exportInterior, previewCover, isStale, loadSpecs, openBook, preflightCoverFile, preflightEpubFile, preflightInteriorFile, unverifiedSections,
  GENRES, type BuildContext, type BuildWarning, type Genre, type PlatformId, type PreflightReport, type ToolId,
} from '@borderless/core';
import * as nodePath from 'node:path';
import { NodeHost } from './nodeHost';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const fwd = (p: string) => p.replace(/\\/g, '/');
const abs = (p: string) => fwd(nodePath.resolve(p));

function printWarnings(list: BuildWarning[]): void {
  const order = { fail: 0, warn: 1, info: 2 } as const;
  const icon = { fail: 'FAIL', warn: 'warn', info: 'info' } as const;
  for (const w of [...list].sort((a, b) => order[a.severity] - order[b.severity])) {
    console.log(`    [${icon[w.severity]}] ${w.message}`);
  }
}

/** Print the outcome of a preflight: the verdict, then everything that is not a plain pass. */
function printPreflight(report: PreflightReport): void {
  const { pass, warn, fail } = report.counts;
  console.log(`    preflight: ${report.ready ? 'ready to upload' : 'NOT READY'} (${pass} passed, ${warn} to look at, ${fail} failed)`);
  for (const c of report.checks) {
    if (c.status === 'pass' || c.status === 'info') continue;
    console.log(`      [${c.status === 'fail' ? 'FAIL' : 'warn'}] ${c.title}: ${c.detail}`);
  }
}

async function context(host: NodeHost, dir: string): Promise<BuildContext> {
  const project = await openBook(host, abs(dir));
  const { resources } = await host.paths();
  const specs = await loadSpecs(host, bundledSpecsDir(resources));
  for (const p of specs.problems) console.log(`  [spec] ${p.message}`);
  return { host, project, specs, resourcesDir: resources };
}

async function cmdTools(host: NodeHost): Promise<number> {
  const tools: ToolId[] = ['typst', 'epubcheck', 'java', 'pandoc', 'git', 'kindle-previewer'];
  for (const t of tools) {
    const info = await host.toolInfo(t);
    console.log(`${t.padEnd(18)} ${info.found ? 'found  ' : 'missing'} ${info.version ?? ''} ${info.path ? `(${info.source}: ${info.path})` : (info.hint ?? '')}`);
  }
  return 0;
}

async function cmdSpecs(host: NodeHost): Promise<number> {
  const { resources } = await host.paths();
  const specs = await loadSpecs(host, bundledSpecsDir(resources));
  for (const p of specs.problems) console.log(`PROBLEM ${p.file}: ${p.message}`);
  for (const [id, spec] of Object.entries(specs.platforms)) {
    const unverified = unverifiedSections(spec!);
    console.log(`${id.padEnd(14)} last verified ${spec!.lastVerified}${isStale(spec!) ? '  (older than 6 months: please re-check)' : ''}, ${spec!.sources.length} sources, ${unverified.length} unverified section(s)`);
    for (const u of unverified) console.log(`    not verified: ${u.path}${u.note ? '  (' + u.note + ')' : ''}`);
  }
  if (specs.currencies) console.log(`currencies     base ${specs.currencies.base}, rates dated ${specs.currencies.date}`);
  return specs.problems.length ? 1 : 0;
}

async function cmdInfo(host: NodeHost, dir: string): Promise<number> {
  const ctx = await context(host, dir);
  const { book } = ctx.project;
  console.log(`${book.title}${book.subtitle ? ': ' + book.subtitle : ''}`);
  console.log(`  ${await ctx.project.manuscriptWords()} words in the manuscript`);
  for (const f of book.formats) {
    console.log(`  ${f.id.padEnd(16)} ${f.type.padEnd(10)} ${f.enabled ? 'enabled ' : 'disabled'} ${f.type === 'ebook' ? '' : f.trim + ' ' + f.paper + ' ' + f.ink} ISBN ${f.isbn || '(none)'} -> ${f.platforms.join(', ') || 'no platform'}`);
  }
  const first = book.formats.find((f) => f.enabled);
  if (first) {
    const assembled = await assembleProject(ctx, { formatId: first.id });
    console.log(`  ${assembled.sections.length} sections, ${assembled.stats.chapters} chapters, ${assembled.stats.notes} notes, ${assembled.stats.images.length} pictures`);
    printWarnings(assembled.warnings);
  }
  return 0;
}

async function cmdBuild(host: NodeHost, dir: string): Promise<number> {
  const ctx = await context(host, dir);
  const { book } = ctx.project;
  const onlyFormat = flag('format');
  const onlyPlatform = flag('platform') as PlatformId | undefined;
  const criticView = has('accept-changes') ? 'accepted' : 'original';
  let failures = 0;
  const formats = book.formats.filter((f) => (onlyFormat ? f.id === onlyFormat : f.enabled));
  if (formats.length === 0) {
    console.error(onlyFormat ? `No format called "${onlyFormat}" in this book.` : 'No enabled formats.');
    return 1;
  }
  for (const f of formats) {
    if (f.type === 'ebook') {
      // The cover first, so the EPUB embeds the current one.
      for (const platform of f.platforms.filter((p) => ctx.specs.platforms[p]?.ebook)) {
        const cover = await exportEbookCover(ctx, { formatId: f.id, platform });
        console.log(`\n${f.id} for ${platform}: ebook cover ${cover.ok ? 'OK' : 'FAILED'}${cover.ok ? ` (${cover.widthPx} x ${cover.heightPx} pixels, ${(cover.sizeBytes / 1024).toFixed(0)} KB)` : ''}`);
        if (cover.jpgPath) console.log(`    ${cover.jpgPath}`);
        printWarnings(cover.warnings);
      }
      const t0 = Date.now();
      const res = await exportEpub(ctx, { formatId: f.id, criticView });
      console.log(`\n${f.id}: EPUB ${res.ok ? 'OK' : 'FAILED'} (${(res.sizeBytes / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      console.log(`    ${res.epubPath}`);
      if (res.check.ran) {
        console.log(`    ${res.check.checker}: ${res.check.errors} error(s), ${res.check.warnings} warning(s)`);
        for (const i of res.check.issues.slice(0, 20)) {
          console.log(`      ${i.severity.toUpperCase()} ${i.id} ${i.path ?? ''}${i.line ? ':' + i.line : ''}  ${i.message}`);
          console.log(`        ${i.explanation}${i.nodeTitle ? `  (in "${i.nodeTitle}"${i.srcLine ? ', line ' + i.srcLine : ''})` : ''}`);
        }
      }
      printWarnings(res.warnings);
      for (const platform of f.platforms.filter((p) => ctx.specs.platforms[p]?.ebook)) {
        const pre = await preflightEpubFile(ctx, res, platform);
        console.log(`    for ${platform}:`);
        printPreflight(pre);
      }
      if (!res.ok) failures++;
      continue;
    }
    const platforms = (onlyPlatform ? [onlyPlatform] : f.platforms).filter((p) => ctx.specs.platforms[p]?.print);
    if (platforms.length === 0) console.log(`\n${f.id}: no print platform with a spec file; nothing built.`);
    for (const platform of platforms) {
      const t0 = Date.now();
      const res = await exportInterior(ctx, { formatId: f.id, platform, criticView });
      const m = res.margins.margins;
      console.log(`\n${f.id} for ${platform}: interior ${res.ok ? 'OK' : 'FAILED'} (${res.pageCount} pages, ${res.passes} pass${res.passes === 1 ? '' : 'es'}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      if (res.pdfPath) console.log(`    ${res.pdfPath}`);
      if (res.pageCount) {
        console.log(`    trim ${res.page.trimWidthIn} x ${res.page.trimHeightIn} in, margins inside ${m.inside} outside ${m.outside} top ${m.top} bottom ${m.bottom} in${res.blankPagesAdded ? `, ${res.blankPagesAdded} blank page(s) added` : ''}`);
      }
      printWarnings(res.warnings.filter((w) => w.severity === 'info'));
      const pre = await preflightInteriorFile(ctx, res, platform);
      printPreflight(pre);
      if (!res.ok || !pre.ready) failures++;
      if (has('no-cover') || !res.ok) continue;
      for (const kind of coverKindsFor(ctx.specs.platforms[platform]!, f)) {
        const cover = await exportCover(ctx, { formatId: f.id, platform, kind, pages: res.pageCount });
        const g = cover.plan.geometry;
        console.log(`  ${kind} cover: ${cover.ok ? 'OK' : 'FAILED'}${g && cover.pdfPath ? ` (${g.widthIn} x ${g.heightIn} in, spine ${g.spineWidthIn} in: ${g.spineBasis}${cover.pdfStandard ? ', ' + cover.pdfStandard : ''})` : ''}`);
        if (cover.pdfPath) console.log(`    ${cover.pdfPath}`);
        printWarnings(cover.warnings.filter((w) => w.severity === 'info'));
        const coverPre = await preflightCoverFile(ctx, cover, { formatId: f.id, platform, kind });
        printPreflight(coverPre);
        if (!cover.ok || !coverPre.ready) failures++;
        if (cover.ok && has('preview')) {
          const prev = await previewCover(ctx, { formatId: f.id, platform, kind, pages: res.pageCount });
          if (prev.ok) console.log(`    preview with guides: ${prev.pngPath}`);
        }
      }
    }
  }
  return failures ? 1 : 0;
}

async function cmdNew(host: NodeHost, parent: string): Promise<number> {
  const title = flag('title');
  const author = flag('author');
  const genre = (flag('genre') ?? 'novel') as Genre;
  if (!title || !author) {
    console.error('Usage: bstudio new <parent folder> --title "Title" --author "Name" [--genre novel|nonfiction|memoir|childrens|poetry]');
    return 1;
  }
  if (!GENRES.includes(genre)) {
    console.error(`Unknown genre "${genre}". Choose one of: ${GENRES.join(', ')}.`);
    return 1;
  }
  const project = await createBook(host, { parentDir: abs(parent), title, author, genre, language: flag('language') });
  console.log(`Created ${project.dir}`);
  return 0;
}

async function main(): Promise<number> {
  const host = new NodeHost();
  const [cmd, target] = args;
  switch (cmd) {
    case 'tools':
      return cmdTools(host);
    case 'specs':
      return cmdSpecs(host);
    case 'info':
      if (!target) break;
      return cmdInfo(host, target);
    case 'build':
      if (!target) break;
      return cmdBuild(host, target);
    case 'new':
      if (!target) break;
      return cmdNew(host, target);
    default:
      break;
  }
  console.log('Usage: bstudio <tools | specs | info <book> | build <book> [--format id] [--platform id] | new <folder> --title .. --author ..>');
  return cmd ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
