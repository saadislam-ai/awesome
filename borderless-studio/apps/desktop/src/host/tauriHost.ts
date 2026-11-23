/**
 * Host implementation for the installed app: every call goes to a native
 * command in src-tauri/src/lib.rs.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { DirEntry, FileFilter, FileStat, Host, HostPaths, HttpRequest, HttpResponse, RunOptions, ToolId, ToolInfo, ToolResult } from '@borderless/core';

function detectOs(): Host['os'] {
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return 'macos';
  if (/Win/i.test(ua)) return 'windows';
  return 'linux';
}

export function createTauriHost(): Host {
  return {
    kind: 'tauri',
    os: detectOs(),
    paths: () => invoke<HostPaths>('host_paths'),
    readText: (path) => invoke<string>('fs_read_text', { path }),
    writeText: (path, text) => invoke<void>('fs_write_text', { path, text }),
    readBinary: async (path) => new Uint8Array(await invoke<ArrayBuffer>('fs_read_binary', { path })),
    writeBinary: (path, data) => invoke<void>('fs_write_binary', data, { headers: { 'x-path': encodeURIComponent(path) } }),
    exists: (path) => invoke<boolean>('fs_exists', { path }),
    stat: (path) => invoke<FileStat | null>('fs_stat', { path }),
    list: (path) => invoke<DirEntry[]>('fs_list', { path }),
    mkdirp: (path) => invoke<void>('fs_mkdirp', { path }),
    remove: (path) => invoke<void>('fs_remove', { path }),
    rename: (from, to) => invoke<void>('fs_rename', { from, to }),
    copy: (from, to) => invoke<void>('fs_copy', { from, to }),
    runTool: (tool: ToolId, args: string[], opts?: RunOptions) => invoke<ToolResult>('run_tool', { tool, args, opts: opts ?? null }),
    toolInfo: (tool: ToolId) => invoke<ToolInfo>('tool_info', { tool }),
    launchTool: (tool: ToolId, args: string[]) => invoke<boolean>('launch_tool', { tool, args }),
    db: {
      exec: (sql, params) => invoke<void>('db_exec', { sql, params: params ?? [] }),
      query: <T,>(sql: string, params?: unknown[]) => invoke<T[]>('db_query', { sql, params: params ?? [] }),
    },
    http: (req: HttpRequest) => invoke<HttpResponse>('http_request', { req }),
    ui: {
      pickFolder: async (title, defaultPath) => {
        const r = await open({ directory: true, multiple: false, title, defaultPath });
        return typeof r === 'string' ? r.replace(/\\/g, '/') : null;
      },
      pickFile: async (title, filters?: FileFilter[], defaultPath?) => {
        const r = await open({ multiple: false, title, filters, defaultPath });
        return typeof r === 'string' ? r.replace(/\\/g, '/') : null;
      },
      pickFiles: async (title, filters?: FileFilter[], defaultPath?) => {
        const r = await open({ multiple: true, title, filters, defaultPath });
        return Array.isArray(r) ? r.map((p) => p.replace(/\\/g, '/')) : [];
      },
      saveFile: async (title, defaultPath, filters) => {
        const r = await save({ title, defaultPath, filters });
        return r ? r.replace(/\\/g, '/') : null;
      },
      openPath: (path) => invoke<void>('os_open', { target: path, reveal: false }),
      revealPath: (path) => invoke<void>('os_open', { target: path, reveal: true }),
      openExternal: (url) => invoke<void>('os_open', { target: url, reveal: false }),
      fileUrl: (path) => convertFileSrc(path),
    },
  };
}

/** Tell the native layer about tool locations set by hand in Settings. */
export function pushToolPaths(paths: Record<string, string>): Promise<void> {
  return invoke<void>('set_tool_paths', { paths });
}
