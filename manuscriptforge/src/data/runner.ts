import { AiError, isAbort, type AiProvider } from '../core/ai/provider';

/** A piece of queued work: an editing job or an analysis. */
export interface WorkItem {
  id: string;
  status: string;
  createdAt: string;
}

/** Something that has jobs for the AI: the editing store, the analysis store. */
export interface WorkSource<T extends WorkItem = WorkItem> {
  owns(id: string): boolean;
  /** The job that should run next: one already running, else the oldest queued one. */
  nextRunnable(): Promise<T | null>;
  setStatus(id: string, status: 'queued' | 'running' | 'paused' | 'done' | 'cancelled', error?: string | null): Promise<void>;
  /** Runs one step. Returns false when the job has nothing left to do. */
  runNextTask(job: T, provider: AiProvider, signal: AbortSignal, onToken?: (text: string) => void): Promise<boolean>;
}

export interface RunnerState {
  /** The job being worked on, if any. */
  jobId: string | null;
  /** Text of the reply as it streams in, for a live preview. */
  preview: string;
  /** Why the queue stopped, when it stopped because of a problem. */
  problem: string | null;
}

/**
 * Works through AI jobs one step at a time. Only one request runs at once (a
 * local model serves one request at a time), whichever kind of job it
 * belongs to. Jobs can be paused, resumed and cancelled, and because every
 * step is stored in the database, a job can be continued after the app has
 * been closed.
 */
export class JobRunner {
  state: RunnerState = { jobId: null, preview: '', problem: null };
  private abort: AbortController | null = null;
  private loop: Promise<void> | null = null;
  private readonly sources: WorkSource[];

  constructor(
    sources: WorkSource | WorkSource[],
    /** Returns the model to use, or null when none is ready. */
    private readonly getProvider: () => AiProvider | null,
    private readonly onChange: () => void = () => undefined,
  ) {
    this.sources = Array.isArray(sources) ? sources : [sources];
  }

  get busy(): boolean {
    return this.loop !== null;
  }

  /** Starts working if there is work and nothing is running. Safe to call at any time. */
  kick(): void {
    if (this.loop) return;
    this.loop = this.run().finally(() => {
      this.loop = null;
      this.abort = null;
      this.state = { ...this.state, jobId: null, preview: '' };
      this.onChange();
    });
  }

  /** Resolves when the queue has stopped (finished, paused or blocked). */
  async idle(): Promise<void> {
    while (this.loop) await this.loop;
  }

  private sourceOf(id: string): WorkSource {
    return this.sources.find((s) => s.owns(id)) ?? this.sources[0];
  }

  /** Across all kinds of work: finish what is running first, then take the oldest waiting job. */
  private async next(): Promise<{ source: WorkSource; job: WorkItem } | null> {
    let best: { source: WorkSource; job: WorkItem } | null = null;
    for (const source of this.sources) {
      const job = await source.nextRunnable();
      if (!job) continue;
      const better = !best || (job.status === 'running' && best.job.status !== 'running') || (job.status === best.job.status && job.createdAt < best.job.createdAt);
      if (better) best = { source, job };
    }
    return best;
  }

  private async run(): Promise<void> {
    for (;;) {
      const found = await this.next();
      if (!found) return;
      const { source, job } = found;
      const provider = this.getProvider();
      if (!provider) {
        this.state = { ...this.state, problem: 'No AI model is loaded. Load a model in Settings, then resume.' };
        await source.setStatus(job.id, 'paused', this.state.problem);
        continue;
      }
      if (job.status !== 'running') await source.setStatus(job.id, 'running');
      this.state = { jobId: job.id, preview: '', problem: null };
      this.abort = new AbortController();
      this.onChange();
      try {
        const more = await source.runNextTask(job, provider, this.abort.signal, (text) => {
          this.state = { ...this.state, preview: (this.state.preview + text).slice(-600) };
          this.onChange();
        });
        if (!more) await source.setStatus(job.id, 'done');
      } catch (e) {
        if (isAbort(e)) {
          // pause() or cancel() already recorded the new status.
        } else if (e instanceof AiError && e.engineDown) {
          // The engine is not answering: stop here rather than failing step after step.
          this.state = { ...this.state, problem: e.message };
          await source.setStatus(job.id, 'paused', e.message);
        }
        // Any other failure was recorded on the step itself; the job moves on.
      }
      this.state = { ...this.state, preview: '' };
      this.onChange();
    }
  }

  /** Puts a job on hold. The step in progress is stopped and will be redone on resume. */
  async pause(jobId: string): Promise<void> {
    await this.sourceOf(jobId).setStatus(jobId, 'paused');
    if (this.state.jobId === jobId) this.abort?.abort();
    await this.settle(jobId);
    this.onChange();
  }

  async resume(jobId: string): Promise<void> {
    await this.sourceOf(jobId).setStatus(jobId, 'queued');
    this.state = { ...this.state, problem: null };
    this.kick();
    this.onChange();
  }

  /** Stops a job for good. Whatever it already produced is kept. */
  async cancel(jobId: string): Promise<void> {
    await this.sourceOf(jobId).setStatus(jobId, 'cancelled');
    if (this.state.jobId === jobId) this.abort?.abort();
    await this.settle(jobId);
    this.onChange();
  }

  private async settle(jobId: string): Promise<void> {
    // Give the step in progress a moment to wind down, so callers see a settled state.
    for (let i = 0; i < 50 && this.state.jobId === jobId && this.loop; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
