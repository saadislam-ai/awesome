import { isTauri } from '@tauri-apps/api/core';
import type { Platform } from './types';

export type { Platform, PlatformInfo, BackupInfo } from './types';

/** Picks the storage backend: the desktop shell when installed, a browser stand-in otherwise. */
export async function createPlatform(): Promise<Platform> {
  if (isTauri()) {
    const { createTauriPlatform } = await import('./tauri');
    return createTauriPlatform();
  }
  const { createBrowserPlatform } = await import('./browser');
  return createBrowserPlatform();
}
