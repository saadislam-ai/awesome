export type SqlParam = string | number | boolean | null | undefined;

export interface SqlStatement {
  sql: string;
  params?: SqlParam[];
}

/** The database as seen by the app. Implemented by the desktop shell and by an in-browser engine for tests. */
export interface Db {
  execute(sql: string, params?: SqlParam[]): Promise<{ rowsAffected: number }>;
  select<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** Runs all statements in one transaction: all of them apply or none do. */
  batch(statements: SqlStatement[]): Promise<void>;
}

/** Files inside the data folder, addressed by relative path. */
export interface FileStore {
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  /** Removes a file or a whole folder. */
  remove(path: string): Promise<void>;
}

export interface BackupInfo {
  name: string;
  sizeBytes: number;
  modifiedMs: number;
}

export interface PlatformInfo {
  kind: 'desktop' | 'browser';
  dataDir: string;
  version: string;
  os: string;
  /** True when launched in automated self-check mode. */
  selftest: boolean;
}

export interface Platform {
  info: PlatformInfo;
  db: Db;
  files: FileStore;
  backupNow(): Promise<BackupInfo | null>;
  backupIfDue(): Promise<BackupInfo | null>;
  listBackups(): Promise<BackupInfo[]>;
  finishSelftest(report: string, passed: boolean): Promise<void>;
}
