import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AiError, chatBody, ChatStreamReader, type AiProvider, type ChatOptions, type ChatRequest, type ChatResult } from '../core/ai/provider';
import type { AiHost, BackupInfo, Db, DownloadProgress, FileStore, Platform, PlatformInfo, SqlParam, SqlStatement } from './types';

function clean(params: SqlParam[] | undefined): (string | number | boolean | null)[] {
  return (params ?? []).map((p) => (p === undefined ? null : p));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Turns an error from the desktop shell into a normal Error with its message. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : ((e as Error)?.message ?? String(e)));
  }
}

const db: Db = {
  execute: (sql, params) => call('db_execute', { sql, params: clean(params) }),
  select: <T>(sql: string, params?: SqlParam[]) => call<T[]>('db_select', { sql, params: clean(params) }),
  batch: (statements: SqlStatement[]) =>
    call('db_batch', { statements: statements.map((s) => ({ sql: s.sql, params: clean(s.params) })) }),
};

const files: FileStore = {
  write: (path, bytes) => call('file_write', { path, base64: toBase64(bytes) }),
  read: async (path) => fromBase64(await call<string>('file_read', { path })),
  exists: (path) => call('file_exists', { path }),
  remove: (path) => call('file_remove', { path }),
};

let requestCounter = 0;

/** Sends chat requests to the local engine through the Rust shell, which streams the reply back. */
class EngineProvider implements AiProvider {
  readonly kind = 'local' as const;
  constructor(readonly label: string) {}

  async chat(request: ChatRequest, options: ChatOptions = {}): Promise<ChatResult> {
    const requestId = `r${Date.now()}-${++requestCounter}`;
    const reader = new ChatStreamReader(options.onToken);
    let streamProblem: unknown = null;
    const channel = new Channel<string>();
    channel.onmessage = (data) => {
      try {
        reader.push(data);
      } catch (e) {
        streamProblem = e;
      }
    };
    const onAbort = () => void invoke('ai_cancel', { requestId }).catch(() => undefined);
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    options.signal?.addEventListener('abort', onAbort);
    const started = Date.now();
    try {
      await invoke('ai_chat', { requestId, body: JSON.stringify(chatBody(request, undefined, true)), onData: channel });
    } catch (e) {
      const message = typeof e === 'string' ? e : ((e as Error)?.message ?? String(e));
      if (message === 'cancelled' || options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (message === 'engine-not-running') throw new AiError('The AI engine is not running. Load a model in Settings.', true, true);
      const refused = /^engine-refused:(\d+):([\s\S]*)$/.exec(message);
      if (refused) {
        const tooLong = /context|too long|exceed/i.test(refused[2]);
        throw new AiError(
          tooLong ? 'This passage is too long for the model at the current context size.' : `The AI engine refused the request. ${refused[2].slice(0, 200)}`,
          Number(refused[1]) >= 500,
        );
      }
      throw new AiError(message);
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
    // The last pieces of the reply can arrive just after the call itself returns.
    for (let i = 0; i < 40 && !reader.done && !streamProblem; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    if (streamProblem) throw streamProblem;
    reader.push('\n');
    const result = reader.result();
    if (!result.tokensPerSecond && result.completionTokens) {
      result.tokensPerSecond = result.completionTokens / Math.max((Date.now() - started) / 1000, 0.001);
    }
    return result;
  }
}

const ai: AiHost = {
  hardware: (engineDir) => call('hardware_info', { customDir: engineDir || null }),
  findEngines: (engineDir) => call('engine_find', { customDir: engineDir || null }),
  listModels: (extraPaths) => call('models_list', { extraPaths }),
  downloadModel(url, fileName, onProgress) {
    const id = `d${Date.now()}-${++requestCounter}`;
    const channel = new Channel<DownloadProgress>();
    channel.onmessage = onProgress;
    return {
      promise: call<string>('model_download', { id, url, fileName, onProgress: channel }),
      cancel: () => void invoke('model_download_cancel', { id }).catch(() => undefined),
    };
  },
  removeModel: (path) => call('model_remove', { path }),
  pickModelFile: () => call('pick_file', { title: 'Choose a model file (.gguf)', extensions: ['gguf'] }),
  pickEngineFolder: () => call('pick_folder', { title: 'Choose the folder that contains llama-server' }),
  startEngine: (options) => call('engine_start', { options }),
  stopEngine: () => call('engine_stop'),
  engineStatus: () => call('engine_status'),
  provider: (label) => new EngineProvider(label),
};

/** The real desktop app: storage is handled by the Rust shell. */
export async function createTauriPlatform(): Promise<Platform> {
  const raw = await call<{ dataDir: string; version: string; os: string; arch: string; selftest: boolean; selftestModel: string | null }>('app_info');
  const info: PlatformInfo = { kind: 'desktop', dataDir: raw.dataDir, version: raw.version, os: `${raw.os} (${raw.arch})`, selftest: raw.selftest, selftestModel: raw.selftestModel };

  // When the user closes the window, the shell asks first so nothing typed is lost.
  const closeHandlers = new Set<() => Promise<void>>();
  await listen('mf://close-requested', async () => {
    const work = Promise.allSettled([...closeHandlers].map((handler) => handler()));
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 3000))]);
    await call('close_now');
  });
  await call('ui_ready');

  return {
    ai,
    saveFile: (defaultName, extension, bytes) => call<string | null>('save_file', { defaultName, extension, base64: toBase64(bytes) }),
    onBeforeClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    info,
    db,
    files,
    backupNow: () => call<BackupInfo>('backup_now'),
    backupIfDue: () => call<BackupInfo | null>('backup_if_due'),
    listBackups: () => call<BackupInfo[]>('list_backups'),
    finishSelftest: (report, passed) => call('selftest_finish', { report, passed }),
  };
}
