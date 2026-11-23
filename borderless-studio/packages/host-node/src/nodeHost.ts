/**
 * Node implementation of the Host interface. Used by the command line tool,
 * the automated tests, and the development bridge that lets the UI run in an
 * ordinary browser.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DirEntry, FileStat, Host, HostDb, HostPaths, HttpRequest, HttpResponse, RunOptions, ToolId, ToolInfo, ToolResult,
} from '@borderless/core';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Root of the repository checkout (packages/host-node/src is three levels down). */
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

const fwd = (p: string) => p.replace(/\\/g, '/');
const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

export interface NodeHostOptions {
  /** Folder with fonts, typst library, dictionaries (default: <repo>/resources). */
  resourcesDir?: string;
  /** Folder with downloaded tools (default: <repo>/tools). */
  toolsDir?: string;
  /** Folder for settings and the index (default: a temp folder, so tests never touch real user data). */
  userDataDir?: string;
  /** Explicit tool locations, same as the "Tools" settings in the app. */
  toolPaths?: Partial<Record<ToolId, string>>;
}

function onPath(name: string): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, name + e);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<ToolResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        windowsHide: true,
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e) });
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      err.push(Buffer.from(`\nStopped after ${Math.round((opts.timeoutMs ?? 120_000) / 1000)} seconds (time limit).`));
      finish(-2);
    }, opts.timeoutMs ?? 120_000);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => {
      err.push(Buffer.from(String(e)));
      finish(-1);
    });
    child.on('close', (code) => finish(code ?? -1));
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

export class NodeHost implements Host {
  readonly kind = 'node' as const;
  readonly os: Host['os'] = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
  readonly resourcesDir: string;
  readonly toolsDir: string;
  readonly userDataDir: string;
  private toolPaths: Partial<Record<ToolId, string>>;
  private toolCache = new Map<ToolId, ToolInfo>();
  private database: import('node:sqlite').DatabaseSync | null = null;

  constructor(opts: NodeHostOptions = {}) {
    this.resourcesDir = fwd(opts.resourcesDir ?? process.env.BORDERLESS_RESOURCES ?? path.join(REPO_ROOT, 'resources'));
    this.toolsDir = fwd(opts.toolsDir ?? process.env.BORDERLESS_TOOLS ?? path.join(REPO_ROOT, 'tools'));
    this.userDataDir = fwd(opts.userDataDir ?? process.env.BORDERLESS_USERDATA ?? path.join(os.tmpdir(), 'borderless-studio-userdata'));
    this.toolPaths = opts.toolPaths ?? {};
  }

  async paths(): Promise<HostPaths> {
    return {
      resources: this.resourcesDir,
      userData: this.userDataDir,
      documents: fwd(path.join(os.homedir(), 'Documents')),
      temp: fwd(os.tmpdir()),
      home: fwd(os.homedir()),
    };
  }

  /* -------------------------------------------------------------- files */

  async readText(p: string): Promise<string> {
    return fsp.readFile(p, 'utf8');
  }

  async readBinary(p: string): Promise<Uint8Array> {
    const b = await fsp.readFile(p);
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }

  /** Write to a temporary file in the same folder, flush, then rename over the target. */
  private async atomicWrite(p: string, data: string | Uint8Array): Promise<void> {
    const dir = path.dirname(p);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(p)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    const handle = await fsp.open(tmp, 'w');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fsp.rename(tmp, p);
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      throw e;
    }
  }

  async writeText(p: string, text: string): Promise<void> {
    await this.atomicWrite(p, text);
  }

  async writeBinary(p: string, data: Uint8Array): Promise<void> {
    await this.atomicWrite(p, data);
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fsp.access(p);
      return true;
    } catch {
      return false;
    }
  }

  async stat(p: string): Promise<FileStat | null> {
    try {
      const s = await fsp.stat(p);
      return { isFile: s.isFile(), isDir: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return null;
    }
  }

  async list(p: string): Promise<DirEntry[]> {
    const names = await fsp.readdir(p);
    const out: DirEntry[] = [];
    for (const name of names) {
      // Leftover temporary files from an interrupted save are never shown.
      if (name.startsWith('.') && name.endsWith('.tmp')) continue;
      const s = await this.stat(path.join(p, name));
      if (s) out.push({ name, ...s });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async mkdirp(p: string): Promise<void> {
    await fsp.mkdir(p, { recursive: true });
  }

  async remove(p: string): Promise<void> {
    await fsp.rm(p, { recursive: true, force: true });
  }

  async rename(from: string, to: string): Promise<void> {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
  }

  async copy(from: string, to: string): Promise<void> {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.cp(from, to, { recursive: true, force: true });
  }

  /* -------------------------------------------------------------- tools */

  private javaPath(): string | null {
    const bundled = path.join(this.toolsDir, 'jre', 'bin', exe('java'));
    if (fs.existsSync(bundled)) return bundled;
    if (this.toolPaths.java && fs.existsSync(this.toolPaths.java)) return this.toolPaths.java;
    if (process.env.JAVA_HOME) {
      const p = path.join(process.env.JAVA_HOME, 'bin', exe('java'));
      if (fs.existsSync(p)) return p;
    }
    return onPath('java');
  }

  private locate(tool: ToolId): { path: string | null; source: ToolInfo['source']; hint?: string } {
    const configured = this.toolPaths[tool];
    if (configured && fs.existsSync(configured)) return { path: configured, source: 'configured' };
    switch (tool) {
      case 'typst': {
        const env = process.env.BORDERLESS_TYPST;
        if (env && fs.existsSync(env)) return { path: env, source: 'configured' };
        const bundled = path.join(this.toolsDir, 'typst', exe('typst'));
        if (fs.existsSync(bundled)) return { path: bundled, source: 'bundled' };
        const p = onPath('typst');
        return p ? { path: p, source: 'path' } : { path: null, source: 'missing', hint: 'Run "npm run fetch-tools" to download Typst.' };
      }
      case 'epubcheck': {
        const env = process.env.BORDERLESS_EPUBCHECK_JAR;
        const jar = env && fs.existsSync(env) ? env : path.join(this.toolsDir, 'epubcheck', 'epubcheck.jar');
        if (!fs.existsSync(jar)) return { path: null, source: 'missing', hint: 'Run "npm run fetch-tools" to download EPUBCheck.' };
        if (!this.javaPath()) return { path: null, source: 'missing', hint: 'EPUBCheck needs Java. Install a Java runtime (for example Eclipse Temurin 17 or newer).' };
        return { path: jar, source: 'bundled' };
      }
      case 'java': {
        const p = this.javaPath();
        return p ? { path: p, source: p.startsWith(this.toolsDir) ? 'bundled' : 'path' } : { path: null, source: 'missing', hint: 'Install a Java runtime (for example Eclipse Temurin 17 or newer).' };
      }
      case 'kindle-previewer': {
        const candidates =
          process.platform === 'darwin'
            ? ['/Applications/Kindle Previewer 4.app/Contents/MacOS/Kindle Previewer 4', '/Applications/Kindle Previewer 3.app/Contents/MacOS/Kindle Previewer 3']
            : process.platform === 'win32'
              ? [path.join(process.env.LOCALAPPDATA ?? '', 'Amazon', 'Kindle Previewer 4', 'Kindle Previewer 4.exe'), path.join(process.env.LOCALAPPDATA ?? '', 'Amazon', 'Kindle Previewer 3', 'Kindle Previewer 3.exe')]
              : [];
        const found = candidates.find((c) => fs.existsSync(c));
        return found ? { path: found, source: 'path' } : { path: null, source: 'missing', hint: 'Kindle Previewer is a free download from Amazon.' };
      }
      default: {
        const p = onPath(tool);
        return p ? { path: p, source: 'path' } : { path: null, source: 'missing' };
      }
    }
  }

  async toolInfo(tool: ToolId): Promise<ToolInfo> {
    const cached = this.toolCache.get(tool);
    if (cached) return cached;
    const loc = this.locate(tool);
    const info: ToolInfo = { id: tool, found: Boolean(loc.path), path: loc.path ? fwd(loc.path) : undefined, source: loc.source, hint: loc.hint };
    if (loc.path) {
      if (tool === 'typst' || tool === 'pandoc' || tool === 'git') {
        const r = await run(loc.path, ['--version'], { timeoutMs: 15_000 });
        info.version = r.stdout.split('\n')[0].trim();
      } else if (tool === 'java') {
        const r = await run(loc.path, ['-version'], { timeoutMs: 15_000 });
        info.version = (r.stderr || r.stdout).split('\n').find((l) => /version/i.test(l))?.trim();
      } else if (tool === 'epubcheck') {
        const r = await run(this.javaPath()!, ['-jar', loc.path, '--version'], { timeoutMs: 30_000 });
        info.version = (r.stdout + r.stderr).split('\n').find((l) => /EPUBCheck/i.test(l))?.trim();
      }
    }
    this.toolCache.set(tool, info);
    return info;
  }

  async runTool(tool: ToolId, args: string[], opts: RunOptions = {}): Promise<ToolResult> {
    const loc = this.locate(tool);
    if (!loc.path) return { code: -1, stdout: '', stderr: loc.hint ?? `${tool} was not found.` };
    if (tool === 'epubcheck') {
      return run(this.javaPath()!, ['-Djava.awt.headless=true', '-jar', loc.path, ...args], opts);
    }
    return run(loc.path, args, opts);
  }

  async launchTool(tool: ToolId, args: string[]): Promise<boolean> {
    if (tool !== 'kindle-previewer') throw new Error(`"${tool}" cannot be started this way.`);
    const loc = this.locate(tool);
    if (!loc.path) return false;
    const { spawn } = await import('node:child_process');
    spawn(loc.path, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  }

  /* -------------------------------------------------------------- index */

  get db(): HostDb {
    const open = async () => {
      if (!this.database) {
        const { DatabaseSync } = await import('node:sqlite');
        await fsp.mkdir(this.userDataDir, { recursive: true });
        this.database = new DatabaseSync(path.join(this.userDataDir, 'index.sqlite'));
      }
      return this.database;
    };
    return {
      exec: async (sql: string, params: unknown[] = []) => {
        const db = await open();
        if (params.length === 0) db.exec(sql);
        else db.prepare(sql).run(...(params as never[]));
      },
      query: async <T>(sql: string, params: unknown[] = []) => {
        const db = await open();
        return db.prepare(sql).all(...(params as never[])) as T[];
      },
    };
  }

  /**
   * Secrets for the command line tool and for development: a private file in
   * the user data folder (readable by the owner only). The desktop app uses
   * the system keychain instead.
   */
  get secrets(): NonNullable<Host['secrets']> {
    const file = path.join(this.userDataDir, 'secrets.json');
    const read = async (): Promise<Record<string, string>> => {
      try {
        return JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, string>;
      } catch {
        return {};
      }
    };
    const write = async (map: Record<string, string>): Promise<void> => {
      await fsp.mkdir(this.userDataDir, { recursive: true });
      await fsp.writeFile(file, JSON.stringify(map, null, 2), { mode: 0o600 });
    };
    return {
      get: async (name) => (await read())[name] ?? null,
      set: async (name, value) => {
        await write({ ...(await read()), [name]: value });
        return 'file';
      },
      remove: async (name) => {
        const map = await read();
        delete map[name];
        await write(map);
      },
    };
  }

  async http(req: HttpRequest): Promise<HttpResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 60_000);
    try {
      const res = await fetch(req.url, { method: req.method ?? 'GET', headers: req.headers, body: req.body, signal: ctrl.signal });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      return { status: res.status, headers, body: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  }
}
