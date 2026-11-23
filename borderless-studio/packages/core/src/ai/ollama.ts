/**
 * The local side of the optional assistant: Ollama, a free program that runs
 * language models on this computer. Nothing leaves the machine; the request
 * goes to the Ollama program at a localhost address.
 */
import type { Host } from '../host';
import { AssistantError, type AssistantReply } from './types';

const base = (url: string): string => url.trim().replace(/\/+$/, '') || 'http://localhost:11434';
const NOT_RUNNING = 'Ollama did not answer. Start the Ollama program on this computer (it is a free download from ollama.com), then try again.';

/** The models that are installed in Ollama on this computer. */
export async function listOllamaModels(host: Host, url: string): Promise<string[]> {
  if (!host.http) throw new AssistantError('unavailable', 'This copy of the app cannot make network requests.');
  let res;
  try {
    res = await host.http({ url: `${base(url)}/api/tags`, method: 'GET', timeoutMs: 8000 });
  } catch {
    throw new AssistantError('network', NOT_RUNNING);
  }
  if (res.status !== 200) throw new AssistantError('service', `Ollama answered with status ${res.status}.`);
  try {
    const data = JSON.parse(res.body) as { models?: { name?: string }[] };
    return (data.models ?? []).map((m) => m.name ?? '').filter(Boolean).sort();
  } catch {
    throw new AssistantError('service', 'The address answered, but not like Ollama. Check the address in Settings.');
  }
}

export interface OllamaRequest {
  url: string;
  model: string;
  system: string;
  user: string;
  timeoutMs?: number;
}

export async function askOllama(host: Host, req: OllamaRequest): Promise<AssistantReply> {
  if (!host.http) throw new AssistantError('unavailable', 'This copy of the app cannot make network requests.');
  if (!req.model.trim()) throw new AssistantError('model', 'No Ollama model is chosen. Pick one in Settings, under Assistant.');
  const body = JSON.stringify({
    model: req.model.trim(),
    stream: false,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    // Editing wants the likeliest wording, not a surprising one.
    options: { temperature: 0.2 },
  });
  let res;
  try {
    // Local models can be slow on a laptop, so the wait is generous.
    res = await host.http({ url: `${base(req.url)}/api/chat`, method: 'POST', headers: { 'content-type': 'application/json' }, body, timeoutMs: req.timeoutMs ?? 600_000 });
  } catch {
    throw new AssistantError('network', NOT_RUNNING);
  }
  let data: { message?: { content?: string }; model?: string; error?: string; prompt_eval_count?: number; eval_count?: number };
  try {
    data = JSON.parse(res.body);
  } catch {
    throw new AssistantError('service', `Ollama gave an answer that could not be read (status ${res.status}).`);
  }
  if (res.status === 404 || /not found/i.test(data.error ?? '')) {
    throw new AssistantError('model', `Ollama does not have the model "${req.model}". Install it with "ollama pull ${req.model}" in a terminal, or pick an installed model in Settings.`);
  }
  if (res.status !== 200 || data.error) throw new AssistantError('service', `Ollama reported a problem: ${data.error ?? `status ${res.status}`}`);
  return { text: data.message?.content ?? '', model: data.model ?? req.model, inputTokens: data.prompt_eval_count, outputTokens: data.eval_count };
}
