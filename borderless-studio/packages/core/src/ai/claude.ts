/**
 * The Claude side of the optional assistant, through Anthropic's official
 * SDK. Nothing here runs unless the author has switched the assistant on,
 * chosen Claude, entered their own API key and pressed a button.
 *
 * The SDK's requests do not leave through the web view. They are handed to
 * the app's host (the same single door every other outside contact uses),
 * which only talks to https addresses.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Host } from '../host';
import { AssistantError, type AssistantReply } from './types';

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Recommended: careful with prose' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster and about half the price' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest and cheapest; fine for proofreading' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', note: 'Most capable and most expensive' },
] as const;
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export const claudeModel = (id: string): string => (CLAUDE_MODELS.some((m) => m.id === id) ? id : DEFAULT_CLAUDE_MODEL);

/**
 * Models for which the API can pass a declined request on to another model
 * inside the same call. Without this a rare false alarm of the safety
 * filters would simply fail the request.
 */
const WITH_FALLBACK = new Set<string>(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2']);

/** A fetch function that sends the SDK's requests through the host. */
function hostFetch(host: Host, timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const request = host.http!({ url, method: (init?.method ?? 'GET').toUpperCase() as 'GET' | 'POST', headers, body: typeof init?.body === 'string' ? init.body : undefined, timeoutMs });
    // The host cannot cancel a request that is under way, but the SDK's own timeout must still end the wait.
    const signal = init?.signal;
    const res = await (signal
      ? Promise.race([
          request,
          new Promise<never>((_resolve, reject) => {
            const stop = () => reject(new DOMException('The request was cancelled.', 'AbortError'));
            if (signal.aborted) stop();
            else signal.addEventListener('abort', stop, { once: true });
          }),
        ])
      : request);
    const empty = res.status === 204 || res.status === 304;
    return new Response(empty ? null : res.body, { status: res.status, headers: res.headers });
  };
}

export interface ClaudeRequest {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** How long to wait for the answer. Long passages on the larger models can take a minute or two. */
  timeoutMs?: number;
}

export async function askClaude(host: Host, req: ClaudeRequest): Promise<AssistantReply> {
  if (!host.http) throw new AssistantError('unavailable', 'This copy of the app cannot make network requests.');
  if (!req.apiKey.trim()) throw new AssistantError('no-key', 'No API key is saved for Claude. Add your key in Settings, under Assistant.');
  const timeout = req.timeoutMs ?? 180_000;
  const model = claudeModel(req.model);
  const client = new Anthropic({
    apiKey: req.apiKey.trim(),
    fetch: hostFetch(host, timeout),
    timeout,
    maxRetries: 2,
    // The key is the author's own, typed on their own computer and kept in the system keychain;
    // there is no web page here that a stranger's script could read it from.
    dangerouslyAllowBrowser: true,
  });
  const params = {
    model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' as const },
    output_config: { effort: 'medium' as const },
    system: req.system,
    messages: [{ role: 'user' as const, content: req.user }],
  };
  try {
    const response = WITH_FALLBACK.has(model)
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
    if (response.stop_reason === 'refusal') {
      const why = response.stop_details && 'explanation' in response.stop_details && response.stop_details.explanation ? ` ${response.stop_details.explanation}` : '';
      throw new AssistantError('refused', `The assistant declined this request.${why} Your text was not changed.`);
    }
    if (response.stop_reason === 'max_tokens' || response.stop_reason === 'model_context_window_exceeded') {
      throw new AssistantError('too-long', 'The passage is too long to handle in one go. Select a shorter passage and ask again.');
    }
    let text = '';
    for (const block of response.content) if (block.type === 'text') text += block.text;
    return { text, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  } catch (error) {
    if (error instanceof AssistantError) throw error;
    // Most specific first: each of these needs a different next step from the author.
    if (error instanceof Anthropic.AuthenticationError) throw new AssistantError('auth', 'The API key was not accepted. Check the key in Settings, under Assistant.');
    if (error instanceof Anthropic.PermissionDeniedError) throw new AssistantError('auth', 'This API key is not allowed to use the chosen model. Choose another model in Settings, or check the key in the Anthropic Console.');
    if (error instanceof Anthropic.NotFoundError) throw new AssistantError('model', `The model "${model}" was not found for this API key. Choose another model in Settings.`);
    if (error instanceof Anthropic.RateLimitError) throw new AssistantError('busy', 'Too many requests in a short time, or the spending limit of the API account is reached. Wait a little and try again.');
    if (error instanceof Anthropic.BadRequestError) throw new AssistantError('request', `The request was not accepted: ${error.message}`);
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new AssistantError('network', 'No answer came in time. Try again, or select a shorter passage.');
    if (error instanceof Anthropic.APIConnectionError) throw new AssistantError('network', 'Anthropic could not be reached. Check the internet connection and try again.');
    if (error instanceof Anthropic.APIError) throw new AssistantError('service', `Anthropic's service reported a problem (status ${error.status ?? 'unknown'}). Try again in a moment.`);
    throw error;
  }
}
