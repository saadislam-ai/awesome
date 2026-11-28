import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CatalogModel } from '../core/ai/catalog';
import { HttpProvider, isAbort, type AiProvider } from '../core/ai/provider';
import { AnalysisStore, type Analysis } from '../data/analysis';
import { EditStore, JobRunner, type EditJob, type NewJob, type RunnerState } from '../data/edits';
import type { EngineBinary, Hardware, ModelFile } from '../platform/types';
import { describeError } from '../ui/format';
import { useApp } from './context';

export interface AiSettings {
  /** A folder with the publisher's own build of llama.cpp, when they use one. */
  engineDir: string;
  /** Model files that live outside the library's models folder. */
  extraModels: string[];
  /** The model loaded most recently, loaded again when a job needs one. */
  lastModel: string | null;
  /** Context size in tokens. */
  context: number;
  /** Layers on the graphics card. null lets the engine decide. */
  gpuLayers: number | null;
  cpuOnly: boolean;
  /** Address of an OpenAI-compatible server, used by the browser preview. */
  serverUrl: string;
  /** The publisher's reusable style guide, applied to every job that opts in. */
  styleGuide: string;
  setupDismissed: boolean;
  /** Measured speed per model file, in tokens per second. */
  speeds: Record<string, number>;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  engineDir: '', extraModels: [], lastModel: null, context: 8192, gpuLayers: null, cpuOnly: false, serverUrl: '', styleGuide: '',
  setupDismissed: false, speeds: {},
};

export type ModelState =
  | { state: 'none' }
  | { state: 'loading'; path: string; name: string }
  | { state: 'ready'; path: string; name: string; speed?: number }
  | { state: 'error'; path?: string; name?: string; message: string };

export interface DownloadState {
  fileName: string;
  name: string;
  received: number;
  total: number;
  error?: string;
  cancel(): void;
}

interface AiState {
  /** True in the desktop app, where the built-in engine exists. */
  hasEngine: boolean;
  settings: AiSettings;
  updateSettings(patch: Partial<AiSettings>): void;
  hardware: Hardware | null;
  engines: EngineBinary[];
  models: ModelFile[];
  scanning: boolean;
  refresh(): Promise<void>;
  model: ModelState;
  provider: AiProvider | null;
  loadModel(path: string, overrides?: { cpuOnly?: boolean }): Promise<boolean>;
  unloadModel(): Promise<void>;
  measureSpeed(): Promise<number | null>;
  downloads: Record<string, DownloadState>;
  startDownload(entry: CatalogModel): void;
  addModelFile(): Promise<void>;
  removeModel(model: ModelFile): Promise<void>;
  chooseEngineFolder(): Promise<void>;
  edits: EditStore;
  runner: JobRunner;
  jobs: EditJob[];
  runnerState: RunnerState;
  refreshJobs(): Promise<void>;
  startJob(input: Omit<NewJob, 'model' | 'styleGuide'> & { useStyleGuide: boolean }): Promise<EditJob | null>;
  analyses: AnalysisStore;
  /** Runs the quick check, and queues the AI reading of the book when `deep` is set. */
  startAnalysis(bookId: string, deep: boolean, automatic?: boolean): Promise<Analysis | null>;
  /** True when a model is loaded, or one can be loaded on demand. */
  canRunAi: boolean;
  /** The analysis that is waiting, running or on hold, if any. */
  activeAnalysis: Analysis | null;
  /** Changes whenever suggestions may have changed, so screens showing them can reload. */
  suggestionsVersion: number;
  touchSuggestions(): void;
}

const Ctx = createContext<AiState | null>(null);

export function useAi(): AiState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useAi must be used inside AiProvider');
  return value;
}

export function modelName(model: ModelFile | undefined, path: string): string {
  return model?.meta?.name || model?.fileName || path.split(/[\\/]/).pop() || 'Model';
}

export function AiProvider({ initialSettings, children }: { initialSettings: AiSettings; children: ReactNode }) {
  const { platform, library, notify, reportError, refreshBooks } = useApp();
  const host = platform.ai;
  const [settings, setSettings] = useState(initialSettings);
  const [hardware, setHardware] = useState<Hardware | null>(null);
  const [engines, setEngines] = useState<EngineBinary[]>([]);
  const [models, setModels] = useState<ModelFile[]>([]);
  const [scanning, setScanning] = useState(false);
  const [engineModel, setEngineModel] = useState<ModelState>({ state: 'none' });
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [jobs, setJobs] = useState<EditJob[]>([]);
  const [runnerState, setRunnerState] = useState<RunnerState>({ jobId: null, preview: '', problem: null });
  const [suggestionsVersion, setSuggestionsVersion] = useState(0);
  const [activeAnalysis, setActiveAnalysis] = useState<Analysis | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const enginesRef = useRef(engines);
  enginesRef.current = engines;

  const updateSettings = useCallback(
    (patch: Partial<AiSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        void library.setSetting('ai', next).catch(() => undefined);
        return next;
      });
    },
    [library],
  );

  // In the browser preview there is no built-in engine: a server address stands in for it.
  const model: ModelState = useMemo(() => {
    if (host) return engineModel;
    return settings.serverUrl ? { state: 'ready', path: settings.serverUrl, name: 'Custom server', speed: settings.speeds[settings.serverUrl] } : { state: 'none' };
  }, [host, engineModel, settings.serverUrl, settings.speeds]);

  const provider = useMemo<AiProvider | null>(() => {
    if (model.state !== 'ready') return null;
    if (host) return host.provider(model.name);
    return new HttpProvider({ baseUrl: settings.serverUrl, kind: 'custom', label: model.name });
  }, [host, model, settings.serverUrl]);
  const providerRef = useRef(provider);
  providerRef.current = provider;

  const edits = useMemo(() => new EditStore(platform.db, library), [platform.db, library]);
  const analyses = useMemo(() => new AnalysisStore(platform.db, library), [platform.db, library]);

  const refreshJobs = useCallback(async () => {
    setJobs(await edits.listJobs());
    setActiveAnalysis(await analyses.active());
  }, [edits, analyses]);

  const timers = useRef<{ state?: number; jobs?: number }>({});
  const runner = useMemo(
    () =>
      new JobRunner(
        [edits, analyses],
        () => providerRef.current,
        () => {
          // The runner reports on every word of a reply: keep screen updates modest.
          if (timers.current.state === undefined) {
            timers.current.state = window.setTimeout(() => {
              timers.current.state = undefined;
              setRunnerState(runnerRef.current!.state);
            }, 120);
          }
          window.clearTimeout(timers.current.jobs);
          timers.current.jobs = window.setTimeout(() => {
            void refreshJobs();
            setSuggestionsVersion((v) => v + 1);
          }, 250);
        },
      ),
    [edits, analyses, refreshJobs],
  );
  const runnerRef = useRef<JobRunner | null>(null);
  runnerRef.current = runner;

  const refresh = useCallback(async () => {
    if (!host) return;
    setScanning(true);
    try {
      const dir = settingsRef.current.engineDir || undefined;
      const [foundEngines, foundModels, info, status] = await Promise.all([
        host.findEngines(dir),
        host.listModels(settingsRef.current.extraModels),
        host.hardware(dir),
        host.engineStatus(),
      ]);
      setEngines(foundEngines);
      setModels(foundModels);
      setHardware(info);
      setEngineModel((current) => {
        if (status.running && status.model) {
          const found = foundModels.find((m) => m.path === status.model);
          return { state: 'ready', path: status.model, name: modelName(found, status.model), speed: settingsRef.current.speeds[status.model] };
        }
        return current.state === 'ready' ? { state: 'none' } : current;
      });
    } catch (e) {
      reportError('ai', e, 'Could not check the AI engine.');
    } finally {
      setScanning(false);
    }
  }, [host, reportError]);

  useEffect(() => {
    void (async () => {
      const interrupted = await edits.recoverInterrupted();
      const interruptedAnalyses = await analyses.recoverInterrupted();
      await refreshJobs();
      if (interrupted) notify('info', 'An AI editing job was interrupted when the app closed. Open Review to resume it.');
      if (interruptedAnalyses) notify('info', 'An analysis was interrupted when the app closed. Open Analysis to resume it.');
    })().catch((e) => reportError('ai', e));
    void refresh();
    // Runs once when the app starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const measureSpeed = useCallback(async (): Promise<number | null> => {
    const current = providerRef.current;
    if (!current) return null;
    try {
      const started = Date.now();
      const result = await current.chat({ messages: [{ role: 'user', content: 'Write four sentences describing a lighthouse at night.' }], maxTokens: 120, temperature: 0.7 });
      const speed = result.tokensPerSecond ?? (result.completionTokens ? result.completionTokens / ((Date.now() - started) / 1000) : null);
      return speed ? Math.round(speed * 10) / 10 : null;
    } catch (e) {
      if (!isAbort(e)) reportError('ai', e, 'The speed test failed.');
      return null;
    }
  }, [reportError]);

  const loadModel = useCallback(
    async (path: string, overrides: { cpuOnly?: boolean } = {}): Promise<boolean> => {
      if (!host) return false;
      const engine = enginesRef.current[0];
      const found = modelsRef.current.find((m) => m.path === path);
      const name = modelName(found, path);
      if (!engine) {
        setEngineModel({ state: 'error', path, name, message: 'The AI engine (llama.cpp) is not installed. See "AI engine" in Settings.' });
        return false;
      }
      setEngineModel({ state: 'loading', path, name });
      try {
        const s = settingsRef.current;
        const limit = found?.meta?.contextLength ?? s.context;
        await host.startEngine({
          binary: engine.path,
          model: path,
          context: Math.min(s.context, limit),
          gpuLayers: s.gpuLayers,
          cpuOnly: overrides.cpuOnly ?? s.cpuOnly,
        });
        setEngineModel({ state: 'ready', path, name, speed: s.speeds[path] });
        updateSettings({ lastModel: path, ...(overrides.cpuOnly !== undefined ? { cpuOnly: overrides.cpuOnly } : {}) });
        void library.addLog('info', 'ai', `Loaded model ${name}`, path).catch(() => undefined);
        return true;
      } catch (e) {
        const message = describeError(e);
        setEngineModel({ state: 'error', path, name, message });
        void library.addLog('error', 'ai', `Could not load model ${name}`, message).catch(() => undefined);
        return false;
      }
    },
    [host, library, updateSettings],
  );

  // Measure the speed of a newly loaded model once, in the background.
  useEffect(() => {
    if (model.state !== 'ready' || model.speed !== undefined || !provider) return;
    let cancelled = false;
    void measureSpeed().then((speed) => {
      if (cancelled || speed === null) return;
      updateSettings({ speeds: { ...settingsRef.current.speeds, [model.path]: speed } });
      if (host) setEngineModel((current) => (current.state === 'ready' && current.path === model.path ? { ...current, speed } : current));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.state, model.state === 'ready' ? model.path : '', provider]);

  const unloadModel = useCallback(async () => {
    if (host) {
      await host.stopEngine();
      setEngineModel({ state: 'none' });
    } else updateSettings({ serverUrl: '' });
  }, [host, updateSettings]);

  const startDownload = useCallback(
    (entry: CatalogModel) => {
      if (!host) return;
      const handle = host.downloadModel(entry.url, entry.fileName, (p) =>
        setDownloads((all) => (all[entry.id] ? { ...all, [entry.id]: { ...all[entry.id], received: p.received, total: p.total || entry.sizeBytes } } : all)),
      );
      setDownloads((all) => ({ ...all, [entry.id]: { fileName: entry.fileName, name: entry.name, received: 0, total: entry.sizeBytes, cancel: handle.cancel } }));
      void library.addLog('info', 'ai', `Started downloading ${entry.name}`, entry.url).catch(() => undefined);
      handle.promise
        .then(async () => {
          setDownloads(({ [entry.id]: _done, ...rest }) => rest);
          notify('success', `${entry.name} was downloaded.`);
          await refresh();
        })
        .catch((e) => {
          const message = describeError(e);
          if (message === 'cancelled') {
            setDownloads(({ [entry.id]: _stopped, ...rest }) => rest);
            notify('info', `Download of ${entry.name} was stopped. Start it again to continue where it left off.`);
          } else {
            setDownloads((all) => (all[entry.id] ? { ...all, [entry.id]: { ...all[entry.id], error: message } } : all));
            void library.addLog('error', 'ai', `Download of ${entry.name} failed`, message).catch(() => undefined);
          }
        });
    },
    [host, library, notify, refresh],
  );

  const addModelFile = useCallback(async () => {
    if (!host) return;
    const path = await host.pickModelFile();
    if (!path) return;
    if (!settingsRef.current.extraModels.includes(path)) updateSettings({ extraModels: [...settingsRef.current.extraModels, path] });
    settingsRef.current = { ...settingsRef.current, extraModels: [...new Set([...settingsRef.current.extraModels, path])] };
    await refresh();
  }, [host, refresh, updateSettings]);

  const removeModel = useCallback(
    async (target: ModelFile) => {
      if (!host) return;
      if (engineModel.state !== 'none' && 'path' in engineModel && engineModel.path === target.path) {
        await host.stopEngine();
        setEngineModel({ state: 'none' });
      }
      if (target.inLibrary) await host.removeModel(target.path);
      else {
        const extraModels = settingsRef.current.extraModels.filter((p) => p !== target.path);
        updateSettings({ extraModels });
        settingsRef.current = { ...settingsRef.current, extraModels };
      }
      if (settingsRef.current.lastModel === target.path) updateSettings({ lastModel: null });
      await refresh();
    },
    [host, engineModel, refresh, updateSettings],
  );

  const chooseEngineFolder = useCallback(async () => {
    if (!host) return;
    const dir = await host.pickEngineFolder();
    if (!dir) return;
    updateSettings({ engineDir: dir });
    settingsRef.current = { ...settingsRef.current, engineDir: dir };
    await refresh();
  }, [host, refresh, updateSettings]);

  const startJob = useCallback<AiState['startJob']>(
    async ({ useStyleGuide, ...input }) => {
      try {
        // Load the last used model if none is loaded, so a job can be started in one step.
        if (!providerRef.current && host && settingsRef.current.lastModel) {
          notify('info', 'Loading the AI model. Editing starts when it is ready.');
          await loadModel(settingsRef.current.lastModel);
        }
        const current = providerRef.current;
        const job = await edits.createJob({ ...input, styleGuide: useStyleGuide ? settingsRef.current.styleGuide : '', model: current?.label ?? '' });
        await refreshJobs();
        // Give the screen a moment to pick up a freshly loaded model before work starts.
        window.setTimeout(() => runner.kick(), 50);
        return job;
      } catch (e) {
        reportError('ai', e, 'The editing job could not be started.');
        return null;
      }
    },
    [edits, host, loadModel, notify, refreshJobs, reportError, runner],
  );

  const startAnalysis = useCallback<AiState['startAnalysis']>(
    async (bookId, deep, automatic = false) => {
      try {
        if (deep && !providerRef.current && host && settingsRef.current.lastModel) {
          notify('info', 'Loading the AI model. The analysis starts when it is ready.');
          await loadModel(settingsRef.current.lastModel);
        }
        const analysis = await analyses.start(bookId, { deep, model: deep ? (providerRef.current?.label ?? '') : '', automatic: automatic && !deep });
        await Promise.all([refreshJobs(), refreshBooks()]);
        setSuggestionsVersion((v) => v + 1);
        if (deep) window.setTimeout(() => runner.kick(), 50);
        return analysis;
      } catch (e) {
        reportError('analysis', e, 'The analysis could not be started.');
        return null;
      }
    },
    [analyses, host, loadModel, notify, refreshBooks, refreshJobs, reportError, runner],
  );

  // When a model becomes ready, continue any queued work.
  useEffect(() => {
    if (provider) runner.kick();
  }, [provider, runner]);

  const value: AiState = {
    hasEngine: !!host, settings, updateSettings, hardware, engines, models, scanning, refresh, model, provider, loadModel, unloadModel,
    measureSpeed, downloads, startDownload, addModelFile, removeModel, chooseEngineFolder, edits, runner, jobs, runnerState, refreshJobs,
    startJob, analyses, startAnalysis, activeAnalysis, canRunAi: model.state === 'ready' || (!!host && !!settings.lastModel),
    suggestionsVersion, touchSuggestions: () => setSuggestionsVersion((v) => v + 1),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
