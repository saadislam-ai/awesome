/**
 * Exports that go beside the book itself: the audiobook kit (script, plan,
 * pronunciation guide, requirements).
 */
import { audioPlan, loadAudiobookSpec, pronunciationText, recordingPlanCsv, requirementsText, type AudioOptions, type AudioPlan, type AudiobookSpec } from '../audio/prep';
import { LAYOUT } from '../project/layout';
import { bundledSpecsDir } from '../specs';
import { joinPath } from '../util/paths';
import { assembleProject, type BuildContext } from './pipeline';

export interface AudiobookKit {
  plan: AudioPlan;
  spec: AudiobookSpec;
  /** Folder the files were written to; empty when nothing was written. */
  dir: string;
  files: string[];
}

/** The edition whose text the audiobook follows: the ebook when there is one (it has no page furniture), else the first edition. */
const sourceFormat = (ctx: BuildContext): string => (ctx.project.book.formats.find((f) => f.type === 'ebook') ?? ctx.project.book.formats[0]).id;

/** Work out the recording plan without writing anything. */
export async function planAudiobook(ctx: BuildContext, opts: AudioOptions): Promise<{ plan: AudioPlan; spec: AudiobookSpec }> {
  const spec = await loadAudiobookSpec(ctx.host, bundledSpecsDir(ctx.resourcesDir), ctx.userSpecsDir);
  if (!spec) throw new Error('The audiobook requirements file (audiobook.json) was not found or has errors. Check it under Settings, Platform rules.');
  const assembled = await assembleProject(ctx, { formatId: sourceFormat(ctx), criticView: 'original' });
  return { plan: audioPlan(assembled, ctx.project.bible, spec, opts), spec };
}

/**
 * Write the audiobook kit into exports/audiobook: one script file for each
 * audio file, the retail sample, the recording plan as a spreadsheet, the
 * pronunciation guide and the requirements. Earlier script files are
 * replaced, so the folder always matches the current text.
 */
export async function exportAudiobookKit(ctx: BuildContext, opts: AudioOptions): Promise<AudiobookKit> {
  const { plan, spec } = await planAudiobook(ctx, opts);
  const host = ctx.host;
  const dir = ctx.project.path(LAYOUT.exportsDir, 'audiobook');
  const scripts = joinPath(dir, 'script');
  if (await host.exists(scripts)) await host.remove(scripts);
  await host.mkdirp(scripts);
  const files: string[] = [];
  const write = async (path: string, text: string) => {
    await host.writeText(path, text.endsWith('\n') ? text : text + '\n');
    files.push(path);
  };
  for (const f of plan.files) await write(joinPath(scripts, `${f.name}.txt`), f.script);
  if (plan.sample) await write(joinPath(scripts, `${plan.sample.name}.txt`), plan.sample.script);
  await write(joinPath(dir, 'recording-plan.csv'), recordingPlanCsv(plan));
  await write(joinPath(dir, 'pronunciation-guide.txt'), pronunciationText(plan, ctx.project.book));
  await write(joinPath(dir, 'requirements.txt'), requirementsText(spec));
  return { plan, spec, dir, files };
}
