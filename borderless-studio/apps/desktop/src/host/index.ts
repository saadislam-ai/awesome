import type { Host } from '@borderless/core';
import { createBridgeHost } from './bridgeHost';
import { createTauriHost } from './tauriHost';

/** True inside the installed app (Tauri injects this object into the web view). */
export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function createHost(): Host {
  if (isTauri()) return createTauriHost();
  const params = new URLSearchParams(window.location.search);
  return createBridgeHost(params.get('bridge') ?? 'http://127.0.0.1:8787');
}
