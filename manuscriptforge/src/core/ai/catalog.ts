/** A model the app suggests for download. Sizes and addresses were checked when this list was written. */
export interface CatalogModel {
  id: string;
  name: string;
  /** Parameter count as people say it, for example "32B". */
  size: string;
  quantization: string;
  sizeBytes: number;
  role: 'everyday' | 'fast' | 'overnight';
  /** One line on what it is good at. */
  summary: string;
  languages: string;
  licence: string;
  fileName: string;
  url: string;
}

const HF = 'https://huggingface.co';

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'gemma-3-27b', name: 'Gemma 3 27B', size: '27B', quantization: 'Q4_K_M', sizeBytes: 16_546_404_992, role: 'everyday',
    summary: 'Strong, careful editing with room to spare on a 24 GB card. A good first choice.',
    languages: 'Over 100 languages', licence: 'Gemma Terms of Use',
    fileName: 'google_gemma-3-27b-it-Q4_K_M.gguf', url: `${HF}/bartowski/google_gemma-3-27b-it-GGUF/resolve/main/google_gemma-3-27b-it-Q4_K_M.gguf`,
  },
  {
    id: 'qwen2.5-32b', name: 'Qwen2.5 32B Instruct', size: '32B', quantization: 'Q4_K_M', sizeBytes: 19_851_336_576, role: 'everyday',
    summary: 'The largest model that fits a 24 GB card whole. Follows instructions closely.',
    languages: 'English, Chinese and about 30 more', licence: 'Apache 2.0',
    fileName: 'Qwen2.5-32B-Instruct-Q4_K_M.gguf', url: `${HF}/bartowski/Qwen2.5-32B-Instruct-GGUF/resolve/main/Qwen2.5-32B-Instruct-Q4_K_M.gguf`,
  },
  {
    id: 'mistral-small-24b', name: 'Mistral Small 3.2 24B', size: '24B', quantization: 'Q4_K_M', sizeBytes: 14_333_915_264, role: 'everyday',
    summary: 'Fast for its size and especially good with European languages.',
    languages: 'English, French, German, Spanish, Italian and more', licence: 'Apache 2.0',
    fileName: 'mistralai_Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf',
    url: `${HF}/bartowski/mistralai_Mistral-Small-3.2-24B-Instruct-2506-GGUF/resolve/main/mistralai_Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf`,
  },
  {
    id: 'qwen2.5-14b', name: 'Qwen2.5 14B Instruct', size: '14B', quantization: 'Q4_K_M', sizeBytes: 8_988_110_976, role: 'fast',
    summary: 'A good balance of speed and quality for proofreading long books.',
    languages: 'English, Chinese and about 30 more', licence: 'Apache 2.0',
    fileName: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf', url: `${HF}/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf`,
  },
  {
    id: 'gemma-3-12b', name: 'Gemma 3 12B', size: '12B', quantization: 'Q4_K_M', sizeBytes: 7_300_575_264, role: 'fast',
    summary: 'Quick proofreading passes in many languages.',
    languages: 'Over 100 languages', licence: 'Gemma Terms of Use',
    fileName: 'google_gemma-3-12b-it-Q4_K_M.gguf', url: `${HF}/bartowski/google_gemma-3-12b-it-GGUF/resolve/main/google_gemma-3-12b-it-Q4_K_M.gguf`,
  },
  {
    id: 'qwen2.5-7b', name: 'Qwen2.5 7B Instruct', size: '7B', quantization: 'Q4_K_M', sizeBytes: 4_683_074_240, role: 'fast',
    summary: 'Very fast. Fine for catching typos, less reliable for rewording.',
    languages: 'English, Chinese and about 30 more', licence: 'Apache 2.0',
    fileName: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', url: `${HF}/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf`,
  },
  {
    id: 'gemma-3-4b', name: 'Gemma 3 4B', size: '4B', quantization: 'Q4_K_M', sizeBytes: 2_489_758_112, role: 'fast',
    summary: 'For computers without a strong graphics card. Typos only.',
    languages: 'Over 100 languages', licence: 'Gemma Terms of Use',
    fileName: 'google_gemma-3-4b-it-Q4_K_M.gguf', url: `${HF}/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf`,
  },
  {
    id: 'llama-3.3-70b', name: 'Llama 3.3 70B Instruct', size: '70B', quantization: 'Q4_K_M', sizeBytes: 42_520_398_816, role: 'overnight',
    summary: 'Highest quality here, but it does not fit a 24 GB card, so it runs partly on the processor and is slow. For overnight jobs.',
    languages: 'English and 7 more', licence: 'Llama 3.3 Community License',
    fileName: 'Llama-3.3-70B-Instruct-Q4_K_M.gguf', url: `${HF}/bartowski/Llama-3.3-70B-Instruct-GGUF/resolve/main/Llama-3.3-70B-Instruct-Q4_K_M.gguf`,
  },
];

export interface FitHardware {
  ramBytes: number;
  /** Memory of the best graphics card, or 0 when there is none. */
  vramBytes: number;
  /** True when graphics and system memory are one pool (Apple Silicon). */
  unifiedMemory: boolean;
}

export type Fit = 'gpu' | 'split' | 'cpu' | 'too-big';

export const FIT_LABELS: Record<Fit, string> = {
  gpu: 'Fits on your graphics card',
  split: 'Runs partly on the processor (slower)',
  cpu: 'Runs on the processor only (slow)',
  'too-big': 'Too large for this computer',
};

const GB = 1024 ** 3;

/** Memory a model needs beyond its file: working memory for the context, and overhead. */
export function memoryNeeded(sizeBytes: number, contextTokens: number): number {
  const perThousand = sizeBytes > 12 * GB ? 0.22 * GB : sizeBytes > 6 * GB ? 0.14 * GB : 0.08 * GB;
  return sizeBytes * 1.03 + (contextTokens / 1000) * perThousand + 0.6 * GB;
}

/** Says how a model of this size would run on this computer. */
export function rateFit(sizeBytes: number, hardware: FitHardware, contextTokens = 8192): Fit {
  const need = memoryNeeded(sizeBytes, contextTokens);
  if (hardware.unifiedMemory) return need <= hardware.ramBytes * 0.72 ? 'gpu' : 'too-big';
  // Leave some graphics memory for the screen and other programs.
  if (hardware.vramBytes > 0 && need <= hardware.vramBytes * 0.94) return 'gpu';
  const systemBudget = Math.max(hardware.ramBytes - 6 * GB, hardware.ramBytes * 0.5);
  if (hardware.vramBytes >= 4 * GB && need <= hardware.vramBytes * 0.9 + systemBudget) return 'split';
  if (need <= systemBudget) return hardware.vramBytes >= 4 * GB ? 'split' : 'cpu';
  return 'too-big';
}

/** The catalog ordered for this computer: models that fit the graphics card first, best first. */
export function recommendModels(hardware: FitHardware, contextTokens = 8192): { model: CatalogModel; fit: Fit; recommended: boolean }[] {
  const order: Record<Fit, number> = { gpu: 0, split: 1, cpu: 2, 'too-big': 3 };
  const rated = MODEL_CATALOG.map((model) => ({ model, fit: rateFit(model.sizeBytes, hardware, contextTokens) }));
  const sorted = [...rated].sort((a, b) => order[a.fit] - order[b.fit] || b.model.sizeBytes - a.model.sizeBytes);
  // Recommend the first everyday model that fits whole; failing that, the best that runs at all.
  // Without a graphics card that can hold the model, speed matters most: suggest a small one.
  const small = (r: { model: CatalogModel; fit: Fit }) => r.fit !== 'too-big' && r.model.sizeBytes <= 5 * GB;
  const pick =
    sorted.find((r) => r.fit === 'gpu' && r.model.role === 'everyday') ??
    sorted.find((r) => r.fit === 'gpu') ??
    sorted.find(small) ??
    sorted.find((r) => r.fit !== 'too-big');
  return sorted.map((r) => ({ ...r, recommended: r === pick }));
}

export function formatGb(bytes: number): string {
  return `${(bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 1)} GB`;
}
