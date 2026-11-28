import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { BackupInfo, Db, FileStore, Platform, PlatformInfo, SqlParam, SqlStatement } from './types';

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

/** The real desktop app: storage is handled by the Rust shell. */
export async function createTauriPlatform(): Promise<Platform> {
  const raw = await call<{ dataDir: string; version: string; os: string; arch: string; selftest: boolean }>('app_info');
  const info: PlatformInfo = { kind: 'desktop', dataDir: raw.dataDir, version: raw.version, os: `${raw.os} (${raw.arch})`, selftest: raw.selftest };

  // When the user closes the window, the shell asks first so nothing typed is lost.
  const closeHandlers = new Set<() => Promise<void>>();
  await listen('mf://close-requested', async () => {
    const work = Promise.allSettled([...closeHandlers].map((handler) => handler()));
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 3000))]);
    await call('close_now');
  });
  await call('ui_ready');

  return {
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
