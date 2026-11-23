/**
 * The Host interface is the only door between the engine and the outside
 * world. The engine never touches the disk, never starts a process and never
 * opens a network connection by itself. Three hosts implement this interface:
 *
 *   - the Tauri host (Rust commands) inside the desktop app,
 *   - the Node host used by the command line tool and the automated tests,
 *   - the bridge host that lets the UI run in a normal browser during
 *     development and end to end tests (it forwards calls to the Node host).
 *
 * Keeping the surface this small is what lets one code base run identically
 * on macOS, Windows and in the test suite.
 */

/** External programs the app may run. The host decides where they live. */
export type ToolId = 'typst' | 'epubcheck' | 'java' | 'pandoc' | 'git' | 'kindle-previewer';

/** The secrets the app may keep. A fixed list, checked again by the host. */
export type SecretName = 'claude-api-key';

export interface FileStat {
  isFile: boolean;
  isDir: boolean;
  size: number;
  /** Last modification time, milliseconds since the Unix epoch. */
  mtimeMs: number;
}

export interface DirEntry extends FileStat {
  name: string;
}

export interface RunOptions {
  cwd?: string;
  /** Text piped to the program's standard input. */
  stdin?: string;
  /** Kill the program if it runs longer than this. Default 120 seconds. */
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ToolResult {
  /** Process exit code. -1 means the program could not be started. */
  code: number;
  stdout: string;
  stderr: string;
}

export interface ToolInfo {
  id: ToolId;
  found: boolean;
  path?: string;
  version?: string;
  /** Where the host found it. "bundled" means shipped inside the installer. */
  source: 'bundled' | 'configured' | 'path' | 'missing';
  /** Plain English install hint shown in Settings when the tool is missing. */
  hint?: string;
}

export interface HostPaths {
  /** Read only folder with bundled fonts, specs, templates and dictionaries. */
  resources: string;
  /** Per user folder for app settings and the SQLite index. */
  userData: string;
  /** The user's Documents folder (default home of the library). */
  documents: string;
  temp: string;
  home: string;
}

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Capabilities that only exist when a person is sitting in front of a window. */
export interface HostUi {
  pickFolder(title?: string, defaultPath?: string): Promise<string | null>;
  pickFile(title?: string, filters?: FileFilter[], defaultPath?: string): Promise<string | null>;
  pickFiles(title?: string, filters?: FileFilter[], defaultPath?: string): Promise<string[]>;
  saveFile(title?: string, defaultPath?: string, filters?: FileFilter[]): Promise<string | null>;
  /** Open a file or folder with the operating system's default program. */
  openPath(path: string): Promise<void>;
  /** Show a file in Finder or Explorer. */
  revealPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** A URL the web view can load a local file from (pictures, previews). */
  fileUrl(path: string): string;
}

/** Minimal SQL access for the rebuildable library index. */
export interface HostDb {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Host {
  readonly kind: 'tauri' | 'node' | 'bridge';
  readonly os: 'macos' | 'windows' | 'linux';

  paths(): Promise<HostPaths>;

  readText(path: string): Promise<string>;
  /**
   * Crash safe write: the text goes to a temporary file in the same folder,
   * is flushed to disk, and is then renamed over the target. A power cut can
   * therefore never leave a half written manuscript file behind.
   */
  writeText(path: string, text: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  /** Crash safe binary write, same strategy as writeText. */
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat | null>;
  list(path: string): Promise<DirEntry[]>;
  mkdirp(path: string): Promise<void>;
  /** Remove a file or a folder with everything in it. */
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Copy a file, or a folder recursively. */
  copy(from: string, to: string): Promise<void>;

  runTool(tool: ToolId, args: string[], opts?: RunOptions): Promise<ToolResult>;
  toolInfo(tool: ToolId): Promise<ToolInfo>;
  /**
   * Start a program that has a window of its own (Kindle Previewer) and
   * return at once, without waiting for it to close. Resolves to false when
   * the program is not installed.
   */
  launchTool?(tool: ToolId, args: string[]): Promise<boolean>;

  /** Present in the app and the Node host; the index is always rebuildable. */
  db?: HostDb;
  /**
   * A small store for secrets (the API key of the optional assistant). In
   * the app this is the operating system's keychain; set() resolves to where
   * the secret went, "keychain" or "file" (a private file, where there is no
   * keychain).
   */
  secrets?: {
    get(name: SecretName): Promise<string | null>;
    set(name: SecretName, value: string): Promise<'keychain' | 'file'>;
    remove(name: SecretName): Promise<void>;
  };
  /** Only used by opt in online features (AI assistant, rate updates). */
  http?(req: HttpRequest): Promise<HttpResponse>;
  ui?: HostUi;
}

/** Read and parse a JSON file, with a readable error that names the file. */
export async function readJson<T>(host: Host, path: string): Promise<T> {
  const text = await host.readText(path);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`The file ${path} is not valid JSON: ${(e as Error).message}`);
  }
}

/** Write JSON with stable two space formatting so git diffs stay small. */
export async function writeJson(host: Host, path: string, value: unknown): Promise<void> {
  await host.writeText(path, JSON.stringify(value, null, 2) + '\n');
}
