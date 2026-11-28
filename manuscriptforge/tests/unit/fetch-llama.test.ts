import { describe, expect, it } from 'vitest';
// @ts-expect-error The build script is plain JavaScript without type declarations.
import { pickAssets } from '../../scripts/fetch-llama.mjs';

/** File names as llama.cpp publishes them with each release. */
const RELEASE = [
  'cudart-llama-bin-win-cuda-12.4-x64.zip', 'llama-b6123-bin-macos-arm64.zip', 'llama-b6123-bin-macos-x64.zip', 'llama-b6123-bin-ubuntu-arm64.zip',
  'llama-b6123-bin-ubuntu-vulkan-x64.zip', 'llama-b6123-bin-ubuntu-x64.zip', 'llama-b6123-bin-win-cpu-arm64.zip', 'llama-b6123-bin-win-cpu-x64.zip',
  'llama-b6123-bin-win-cuda-12.4-x64.zip', 'llama-b6123-bin-win-hip-radeon-x64.zip', 'llama-b6123-bin-win-sycl-x64.zip', 'llama-b6123-bin-win-vulkan-x64.zip',
  'llama-b6123-xcframework.zip',
].map((name) => ({ name, browser_download_url: `https://example.invalid/${name}` }));

describe('choosing the engine build for a platform', () => {
  it('takes the Vulkan build (never the NVIDIA-only one) plus a processor fallback on Windows', () => {
    const { picked, missing } = pickAssets('win32', 'x64', RELEASE);
    expect(picked.map((p: { variant: string; name: string }) => [p.variant, p.name])).toEqual([
      ['vulkan', 'llama-b6123-bin-win-vulkan-x64.zip'],
      ['cpu', 'llama-b6123-bin-win-cpu-x64.zip'],
    ]);
    expect(missing).toEqual([]);
  });

  it('takes the right build for each Mac processor, and for Linux', () => {
    expect(pickAssets('darwin', 'arm64', RELEASE).picked.map((p: { name: string }) => p.name)).toEqual(['llama-b6123-bin-macos-arm64.zip']);
    expect(pickAssets('darwin', 'x64', RELEASE).picked.map((p: { name: string }) => p.name)).toEqual(['llama-b6123-bin-macos-x64.zip']);
    expect(pickAssets('linux', 'x64', RELEASE).picked.map((p: { variant: string }) => p.variant)).toEqual(['vulkan', 'cpu']);
  });

  it('copes with archives renamed to .tar.gz and reports builds that are absent', () => {
    const renamed = RELEASE.map((a) => ({ ...a, name: a.name.replace('macos-arm64.zip', 'macos-arm64.tar.gz') }));
    expect(pickAssets('darwin', 'arm64', renamed).picked[0].name).toBe('llama-b6123-bin-macos-arm64.tar.gz');
    expect(pickAssets('win32', 'x64', RELEASE.filter((a) => !a.name.includes('vulkan'))).missing).toEqual(['vulkan']);
    expect(pickAssets('linux', 'arm64', RELEASE)).toMatchObject({ missing: ['vulkan'] });
  });
});
