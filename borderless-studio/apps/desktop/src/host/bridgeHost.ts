/**
 * Host implementation for running the interface in an ordinary browser during
 * development and in the automated interface tests. Calls are forwarded to
 * the development bridge (packages/host-node/src/bridge.ts) on this computer.
 * The installed app never uses this file's code path.
 */
import type { DirEntry, FileStat, Host, HostPaths, HttpRequest, HttpResponse, RunOptions, ToolId, ToolInfo, ToolResult } from '@borderless/core';

export function createBridgeHost(base = 'http://127.0.0.1:8787'): Host {
  async function rpc<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${base}/rpc/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
    const json = (await res.json()) as { ok: boolean; result?: T; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'The development bridge reported an error.');
    return json.result as T;
  }
  const ask = (title: string | undefined, fallback: string) => {
    const v = window.prompt(title ?? 'Path', fallback);
    return v ? v.replace(/\\/g, '/') : null;
  };
  return {
    kind: 'bridge',
    os: /Mac/i.test(navigator.userAgent) ? 'macos' : /Win/i.test(navigator.userAgent) ? 'windows' : 'linux',
    paths: () => rpc<HostPaths>('paths'),
    readText: (path) => rpc<string>('readText', { path }),
    writeText: (path, text) => rpc<void>('writeText', { path, text }),
    readBinary: async (path) => {
      const res = await fetch(`${base}/file?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`Could not read "${path}".`);
      return new Uint8Array(await res.arrayBuffer());
    },
    writeBinary: async (path, data) => {
      const res = await fetch(`${base}/file`, { method: 'POST', headers: { 'x-path': encodeURIComponent(path) }, body: new Blob([data as unknown as BlobPart]) });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? `Could not save "${path}".`);
    },
    exists: (path) => rpc<boolean>('exists', { path }),
    stat: (path) => rpc<FileStat | null>('stat', { path }),
    list: (path) => rpc<DirEntry[]>('list', { path }),
    mkdirp: (path) => rpc<void>('mkdirp', { path }),
    remove: (path) => rpc<void>('remove', { path }),
    rename: (from, to) => rpc<void>('rename', { from, to }),
    copy: (from, to) => rpc<void>('copy', { from, to }),
    runTool: (tool: ToolId, args: string[], opts?: RunOptions) => rpc<ToolResult>('runTool', { tool, args, opts }),
    toolInfo: (tool: ToolId) => rpc<ToolInfo>('toolInfo', { tool }),
    launchTool: (tool: ToolId, args: string[]) => rpc<boolean>('launchTool', { tool, args }),
    db: {
      exec: (sql, params) => rpc<void>('dbExec', { sql, params }),
      query: <T,>(sql: string, params?: unknown[]) => rpc<T[]>('dbQuery', { sql, params }),
    },
    http: (req: HttpRequest) => rpc<HttpResponse>('http', { req }),
    ui: {
      pickFolder: async (title, defaultPath) => ask(title, defaultPath ?? ''),
      pickFile: async (title, _filters, defaultPath) => ask(title, defaultPath ?? ''),
      pickFiles: async (title, _filters, defaultPath) => {
        const v = ask(title, defaultPath ?? '');
        return v ? [v] : [];
      },
      saveFile: async (title, defaultPath) => ask(title, defaultPath ?? ''),
      openPath: async (path) => console.info('open', path),
      revealPath: async (path) => console.info('reveal', path),
      openExternal: async (url) => {
        window.open(url, '_blank', 'noopener');
      },
      fileUrl: (path) => `${base}/file?path=${encodeURIComponent(path)}&t=${Date.now()}`,
    },
  };
}
