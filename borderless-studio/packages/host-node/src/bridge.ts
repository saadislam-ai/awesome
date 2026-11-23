#!/usr/bin/env node
/**
 * Development bridge. Lets the React interface run in an ordinary browser
 * (for development and for the automated interface tests) by forwarding its
 * Host calls to the Node host over HTTP on this computer only.
 *
 *   npm run bridge            (listens on http://127.0.0.1:8787)
 *
 * The installed app never uses this: there the same calls go straight to the
 * native layer. The bridge only listens on 127.0.0.1.
 */
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SecretName, ToolId } from '@borderless/core';
import { NodeHost } from './nodeHost';

const PORT = Number(process.env.BRIDGE_PORT ?? 8787);
const host = new NodeHost({ userDataDir: process.env.BORDERLESS_USERDATA });
const fwd = (p: string) => p.replace(/\\/g, '/');

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.otf': 'font/otf', '.ttf': 'font/ttf', '.json': 'application/json',
  '.xhtml': 'application/xhtml+xml', '.html': 'text/html', '.css': 'text/css', '.txt': 'text/plain', '.md': 'text/plain',
};

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

type Json = Record<string, unknown>;

async function rpc(method: string, a: Json): Promise<unknown> {
  const s = (k: string) => String(a[k] ?? '');
  switch (method) {
    case 'paths': return host.paths();
    case 'readText': return host.readText(s('path'));
    case 'writeText': return host.writeText(s('path'), s('text'));
    case 'exists': return host.exists(s('path'));
    case 'stat': return host.stat(s('path'));
    case 'list': return host.list(s('path'));
    case 'mkdirp': return host.mkdirp(s('path'));
    case 'remove': return host.remove(s('path'));
    case 'rename': return host.rename(s('from'), s('to'));
    case 'copy': return host.copy(s('from'), s('to'));
    case 'runTool': return host.runTool(s('tool') as ToolId, (a.args as string[]) ?? [], (a.opts as object) ?? {});
    case 'toolInfo': return host.toolInfo(s('tool') as ToolId);
    case 'launchTool': return host.launchTool(s('tool') as ToolId, (a.args as string[]) ?? []);
    case 'dbExec': return host.db.exec(s('sql'), (a.params as unknown[]) ?? []);
    case 'dbQuery': return host.db.query(s('sql'), (a.params as unknown[]) ?? []);
    case 'http': return host.http(a.req as never);
    case 'secretGet': return host.secrets.get(s('name') as SecretName);
    case 'secretSet': return host.secrets.set(s('name') as SecretName, s('value'));
    case 'secretRemove': return host.secrets.remove(s('name') as SecretName);
    case 'os': return { os: host.os };
    default: throw new Error(`Unknown bridge method: ${method}`);
  }
}

const server = http.createServer(async (req, res) => {
  // The interface is served by Vite on another port of this computer.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-path');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'POST' && url.pathname.startsWith('/rpc/')) {
      const body = await readBody(req);
      const args = body.length ? (JSON.parse(body.toString('utf8')) as Json) : {};
      const result = await rpc(url.pathname.slice(5), args);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result: result ?? null }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/file') {
      const p = url.searchParams.get('path') ?? '';
      const data = await fs.promises.readFile(p);
      res.writeHead(200, { 'content-type': MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/file') {
      const p = decodeURIComponent(String(req.headers['x-path'] ?? ''));
      const data = await readBody(req);
      await host.writeBinary(fwd(p), new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"result":null}');
      return;
    }
    res.writeHead(404).end('Not found');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Borderless Studio development bridge on http://127.0.0.1:${PORT}`);
});
