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
  /** A model file to try the AI engine with during a self-check, when one was given. */
  selftestModel?: string | null;
}

export interface Gpu {
  name: string;
  vramBytes: number;
  freeBytes: number | null;
  device: string | null;
}

export interface Hardware {
  ramBytes: number;
  cpuName: string;
  cpuCores: number;
  cpuThreads: number;
  gpus: Gpu[];
  unifiedMemory: boolean;
  os: string;
  arch: string;
  gpuSource: 'engine' | 'system' | 'none';
}

export interface EngineBinary {
  variant: string;
  path: string;
  version: string | null;
}

export interface GgufMeta {
  name: string | null;
  architecture: string | null;
  sizeLabel: string | null;
  quantization: string | null;
  contextLength: number | null;
  blockCount: number | null;
  languages: string[];
}

export interface ModelFile {
  path: string;
  fileName: string;
  sizeBytes: number;
  inLibrary: boolean;
  meta: GgufMeta | null;
  problem: string | null;
}

export interface EngineStatus {
  running: boolean;
  model: string | null;
  binary: string | null;
  context: number;
  cpuOnly: boolean;
  logTail: string[];
}

export interface EngineStartOptions {
  binary: string;
  model: string;
  context: number;
  gpuLayers?: number | null;
  threads?: number | null;
  cpuOnly?: boolean;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

/** The local AI engine and its model files. Only the desktop app has one. */
export interface AiHost {
  hardware(engineDir?: string): Promise<Hardware>;
  findEngines(engineDir?: string): Promise<EngineBinary[]>;
  listModels(extraPaths: string[]): Promise<ModelFile[]>;
  /** Starts a download. `promise` resolves with the path of the finished file. */
  downloadModel(url: string, fileName: string, onProgress: (p: DownloadProgress) => void): { promise: Promise<string>; cancel(): void };
  removeModel(path: string): Promise<void>;
  pickModelFile(): Promise<string | null>;
  pickEngineFolder(): Promise<string | null>;
  startEngine(options: EngineStartOptions): Promise<EngineStatus>;
  stopEngine(): Promise<void>;
  engineStatus(): Promise<EngineStatus>;
  /** A provider that sends requests to the loaded model. */
  provider(label: string): import('../core/ai/provider').AiProvider;
}

export interface Platform {
  /** The local AI engine, or null where there is none (the browser preview). */
  ai: AiHost | null;
  /** Lets the user choose where to save a file and writes it. Returns where it went, or null if cancelled. */
  saveFile(defaultName: string, extension: string, bytes: Uint8Array): Promise<string | null>;
  info: PlatformInfo;
  db: Db;
  files: FileStore;
  backupNow(): Promise<BackupInfo | null>;
  backupIfDue(): Promise<BackupInfo | null>;
  listBackups(): Promise<BackupInfo[]>;
  finishSelftest(report: string, passed: boolean): Promise<void>;
  /**
   * Registers work to finish before the app window closes, such as saving
   * unsaved typing. Returns a function that removes the registration.
   */
  onBeforeClose(handler: () => Promise<void>): () => void;
}
