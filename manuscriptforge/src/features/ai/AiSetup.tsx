import { Cpu, Download, FolderOpen, Gauge, Play, Plus, Power, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { modelName, useAi } from '../../app/ai';
import { useApp } from '../../app/context';
import { FIT_LABELS, formatGb, rateFit, recommendModels, type Fit } from '../../core/ai/catalog';
import { diffText } from '../../core/edit/diff';
import { editChunk } from '../../core/edit/pipeline';
import type { ParagraphEdit } from '../../core/edit/types';
import { Button, Field, Pill, Spinner } from '../../ui/components';
import { describeError } from '../../ui/format';
import { DiffParagraph } from '../review/DiffParagraph';

const SAMPLE = 'The lighthouse keeper had forgoten his lamp, and teh stairs was very dark. He climed slowly , counting each step as he went.';

const FIT_TONE: Record<Fit, 'success' | 'warning' | 'neutral' | 'danger'> = { gpu: 'success', split: 'warning', cpu: 'warning', 'too-big': 'danger' };

function SampleEdit() {
  const { provider } = useAi();
  const [state, setState] = useState<{ running: boolean; edit?: ParagraphEdit | null; error?: string }>({ running: false });
  const run = async () => {
    if (!provider) return;
    setState({ running: true });
    try {
      const result = await editChunk(
        provider,
        { items: [{ n: 1, blockIndex: 0, markup: SAMPLE }], contextBefore: '', words: 22 },
        { level: 'proofread', strength: 'medium', language: 'en', bookType: 'fiction' },
      );
      setState({ running: false, edit: result.edits[0] ?? null });
    } catch (e) {
      setState({ running: false, error: describeError(e) });
    }
  };
  return (
    <div className="setup-block">
      <h3>Try it</h3>
      <p className="muted">Proofreads one sentence with deliberate mistakes, so you can see that the model works.</p>
      <Button icon={<Sparkles size={15} />} disabled={!provider || state.running} onClick={() => void run()} data-testid="sample-edit">
        {state.running ? 'Working…' : 'Run a sample edit'}
      </Button>
      {state.error && <p className="notice notice-warning">{state.error}</p>}
      {state.edit === null && <p className="notice notice-warning">The model returned the sentence unchanged. A larger model will do better.</p>}
      {state.edit && (
        <div className="sample-result manuscript" data-testid="sample-result">
          <DiffParagraph original={state.edit.original} revised={state.edit.revised} hunks={diffText(state.edit.original, state.edit.revised)} />
        </div>
      )}
    </div>
  );
}

/** Everything needed to get the local AI working: hardware, engine, models, and a test. */
export function AiSetup() {
  const { platform } = useApp();
  const ai = useAi();
  const { hardware, engines, models, model, settings, downloads } = ai;
  const [url, setUrl] = useState(settings.serverUrl);

  const gpu = hardware?.gpus.slice().sort((a, b) => b.vramBytes - a.vramBytes)[0];
  const fitHardware = useMemo(
    () => (hardware ? { ramBytes: hardware.ramBytes, vramBytes: hardware.unifiedMemory ? hardware.ramBytes : (gpu?.vramBytes ?? 0), unifiedMemory: hardware.unifiedMemory } : null),
    [hardware, gpu],
  );
  const catalog = useMemo(() => (fitHardware ? recommendModels(fitHardware, settings.context) : []), [fitHardware, settings.context]);
  const loadedPath = model.state === 'ready' || model.state === 'loading' ? model.path : null;

  const status = (
    <div className={`ai-status ai-${model.state}`} data-testid="ai-status" data-state={model.state}>
      {model.state === 'none' && <span>No AI model is loaded.</span>}
      {model.state === 'loading' && <Spinner label={`Loading ${model.name}. Large models can take a minute.`} />}
      {model.state === 'ready' && (
        <>
          <span>
            <strong>{model.name}</strong> is ready{model.speed ? `, running at about ${Math.round(model.speed)} tokens per second.` : '. Measuring speed…'}
          </span>
          <span className="grow" />
          <Button size="sm" icon={<Gauge size={14} />} onClick={async () => {
            const speed = await ai.measureSpeed();
            if (speed !== null) ai.updateSettings({ speeds: { ...settings.speeds, [model.path]: speed } });
            await ai.refresh();
          }}>
            Measure speed
          </Button>
          <Button size="sm" icon={<Power size={14} />} onClick={() => void ai.unloadModel()}>{ai.hasEngine ? 'Unload' : 'Disconnect'}</Button>
        </>
      )}
      {model.state === 'error' && (
        <>
          <span>
            <strong>{model.name ?? 'The model'} could not be loaded.</strong> {model.message}
          </span>
          <span className="grow" />
          {model.path && !settings.cpuOnly && (
            <Button size="sm" icon={<Cpu size={14} />} onClick={() => void ai.loadModel(model.path!, { cpuOnly: true })}>Try without the graphics card</Button>
          )}
        </>
      )}
    </div>
  );

  if (!ai.hasEngine) {
    return (
      <div className="ai-setup">
        {status}
        <div className="setup-block">
          <h3>Connect to a server</h3>
          <p className="muted">
            This is the browser preview of ManuscriptForge, which has no built-in AI engine. For testing, it can use an OpenAI-compatible server on this
            computer, such as llama.cpp's llama-server. The installed desktop app runs its own engine and needs none of this.
          </p>
          <div className="row-start">
            <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8080" aria-label="Server address" />
            <Button variant="primary" disabled={!url.trim()} onClick={() => ai.updateSettings({ serverUrl: url.trim().replace(/\/+$/, '') })}>Connect</Button>
          </div>
        </div>
        <SampleEdit />
      </div>
    );
  }

  return (
    <div className="ai-setup">
      {status}

      <div className="setup-block">
        <h3>This computer</h3>
        {!hardware ? (
          <Spinner label="Checking hardware…" />
        ) : (
          <dl className="facts">
            <div><dt>Memory</dt><dd>{formatGb(hardware.ramBytes)}</dd></div>
            <div><dt>Processor</dt><dd>{hardware.cpuName} ({hardware.cpuCores} cores)</dd></div>
            <div>
              <dt>Graphics</dt>
              <dd>
                {hardware.gpus.length === 0
                  ? 'No graphics card that the engine can use was found. Models will run on the processor.'
                  : hardware.gpus.map((g) => `${g.name} (${formatGb(g.vramBytes)}${hardware.unifiedMemory ? ', shared with the system' : ''})`).join('; ')}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="setup-block">
        <h3>AI engine</h3>
        {engines.length ? (
          <p>
            llama.cpp {engines[0].version ? `version ${engines[0].version}` : ''} <Pill tone="success">{engines[0].variant}</Pill>
            <br />
            <code>{engines[0].path}</code>
          </p>
        ) : (
          <p className="notice notice-warning">
            The AI engine (llama.cpp) was not found. Installers include it. If you run ManuscriptForge from source, run "npm run engine:fetch" in the
            project folder, or download llama.cpp yourself and choose its folder below.
          </p>
        )}
        <div className="row-start">
          <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => void ai.chooseEngineFolder()}>Use llama.cpp from another folder…</Button>
          {settings.engineDir && <Button size="sm" onClick={() => { ai.updateSettings({ engineDir: '' }); window.setTimeout(() => void ai.refresh(), 50); }}>Use the built-in engine</Button>}
        </div>
      </div>

      <div className="setup-block">
        <h3>Installed models</h3>
        {models.length === 0 ? (
          <p className="muted">No models yet. Download one below, or add a .gguf file you already have.</p>
        ) : (
          <ul className="model-list">
            {models.map((m) => {
              const fit = fitHardware && !m.problem ? rateFit(m.sizeBytes, fitHardware, settings.context) : null;
              return (
                <li key={m.path} data-testid="installed-model">
                  <div className="model-main">
                    <strong>{modelName(m, m.path)}</strong>
                    <span className="muted">
                      {[m.meta?.sizeLabel, m.meta?.quantization, formatGb(m.sizeBytes), m.meta?.contextLength ? `up to ${Math.round(m.meta.contextLength / 1024)}k context` : null].filter(Boolean).join(' · ')}
                      {!m.inLibrary && ' · kept in its own folder'}
                    </span>
                    {m.problem ? <span className="flag">{m.problem}</span> : fit && <Pill tone={FIT_TONE[fit]}>{FIT_LABELS[fit]}</Pill>}
                    {settings.speeds[m.path] && <span className="muted">Measured: {Math.round(settings.speeds[m.path])} tokens per second</span>}
                  </div>
                  {loadedPath === m.path ? (
                    <Pill tone="accent">{model.state === 'loading' ? 'Loading' : 'Loaded'}</Pill>
                  ) : (
                    <Button size="sm" variant="primary" icon={<Play size={14} />} disabled={!!m.problem || model.state === 'loading' || !engines.length} onClick={() => void ai.loadModel(m.path)}>Load</Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} title={m.inLibrary ? 'Delete this model file' : 'Remove from this list (the file is kept)'} onClick={() => void ai.removeModel(m)}>
                    {m.inLibrary ? 'Delete' : 'Remove'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="row-start">
          <Button size="sm" icon={<Plus size={14} />} onClick={() => void ai.addModelFile()}>Add a model file…</Button>
          <Button size="sm" disabled={ai.scanning} onClick={() => void ai.refresh()}>Check again</Button>
        </div>
        <div className="form-grid load-options">
          <Field label="Context size" hint="How much text the model can hold at once. Larger needs more memory.">
            <select value={settings.context} onChange={(e) => ai.updateSettings({ context: Number(e.target.value) })}>
              {[4096, 8192, 16384, 32768].map((n) => (
                <option key={n} value={n}>{n / 1024}k tokens{n === 8192 ? ' (recommended)' : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="Graphics card use" hint="Automatic lets the engine fit as much of the model on the card as it can.">
            <select
              value={settings.cpuOnly ? 'cpu' : settings.gpuLayers === null ? 'auto' : 'manual'}
              onChange={(e) => ai.updateSettings(e.target.value === 'cpu' ? { cpuOnly: true } : e.target.value === 'auto' ? { cpuOnly: false, gpuLayers: null } : { cpuOnly: false, gpuLayers: settings.gpuLayers ?? 20 })}
            >
              <option value="auto">Automatic</option>
              <option value="manual">A set number of layers</option>
              <option value="cpu">Do not use the graphics card</option>
            </select>
          </Field>
          {!settings.cpuOnly && settings.gpuLayers !== null && (
            <Field label="Layers on the graphics card">
              <input type="number" min={0} max={200} value={settings.gpuLayers} onChange={(e) => ai.updateSettings({ gpuLayers: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
          )}
        </div>
        <p className="fine-print">Changes to these options apply the next time a model is loaded.</p>
      </div>

      <div className="setup-block">
        <h3>Download a model</h3>
        <p className="muted">
          Models are large files, downloaded once from huggingface.co and then used offline. Downloading is the only thing on this screen that uses the
          internet. Check a model's licence before using it commercially.
        </p>
        <ul className="model-list">
          {catalog.map(({ model: entry, fit, recommended }) => {
            const installed = models.some((m) => m.fileName === entry.fileName);
            const download = downloads[entry.id];
            return (
              <li key={entry.id} data-testid="catalog-model">
                <div className="model-main">
                  <strong>
                    {entry.name} {recommended && <Pill tone="accent">Recommended for this computer</Pill>}
                  </strong>
                  <span>{entry.summary}</span>
                  <span className="muted">
                    {entry.size} · {entry.quantization} · {formatGb(entry.sizeBytes)} · {entry.languages} · Licence: {entry.licence}
                  </span>
                  <Pill tone={FIT_TONE[fit]}>{FIT_LABELS[fit]}</Pill>
                  {download && !download.error && (
                    <div className="download-progress">
                      <div className="progress" role="progressbar" aria-valuenow={Math.round((download.received / Math.max(download.total, 1)) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Downloading ${entry.name}`}>
                        <div style={{ width: `${(download.received / Math.max(download.total, 1)) * 100}%` }} />
                      </div>
                      <span className="muted">{formatGb(download.received)} of {formatGb(download.total)}</span>
                    </div>
                  )}
                  {download?.error && <span className="flag">{download.error}</span>}
                </div>
                {installed ? (
                  <Pill tone="success">Installed</Pill>
                ) : download && !download.error ? (
                  <Button size="sm" onClick={() => download.cancel()}>Stop</Button>
                ) : (
                  <Button size="sm" icon={<Download size={14} />} disabled={fit === 'too-big'} onClick={() => ai.startDownload(entry)}>
                    {download?.error ? 'Try again' : 'Download'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="fine-print">Library folder: <code>{platform.info.dataDir}</code>. Any .gguf file placed in its "models" folder is listed above.</p>
      </div>

      <SampleEdit />
    </div>
  );
}
