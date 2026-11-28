import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { MemoryFiles } from './memory';
import { createSqlJsDb } from './sqljs';
import type { Platform } from './types';

const IDB_NAME = 'manuscriptforge-preview';
const IDB_STORE = 'kv';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key: string): Promise<Uint8Array | undefined> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const request = idb.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
    request.onsuccess = () => resolve(request.result as Uint8Array | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key: string, value: Uint8Array): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Runs the app in an ordinary browser, for development and automated UI
 * tests. The library lives in the browser's own storage, and original files
 * are kept in memory only. The installed desktop app never uses this.
 */
export async function createBrowserPlatform(): Promise<Platform> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let saved: Uint8Array | undefined;
  try {
    saved = await idbGet('library');
  } catch {
    saved = undefined;
  }
  const database = saved ? new SQL.Database(saved) : new SQL.Database();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void idbSet('library', database.export()).catch(() => undefined), 400);
  };
  return {
    info: { kind: 'browser', dataDir: 'Browser storage (preview mode)', version: '0.1.0', os: 'browser', selftest: false },
    db: createSqlJsDb(database, persist),
    files: new MemoryFiles(),
    backupNow: async () => null,
    backupIfDue: async () => null,
    listBackups: async () => [],
    finishSelftest: async () => undefined,
    onBeforeClose: (handler) => {
      const listener = () => void handler();
      window.addEventListener('beforeunload', listener);
      return () => window.removeEventListener('beforeunload', listener);
    },
  };
}
