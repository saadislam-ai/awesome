export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /**
   * When given, the reply must be JSON of this shape. The local engine
   * enforces it while generating, so even small models return valid data.
   */
  jsonSchema?: Record<string, unknown>;
}

export interface ChatResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Generation speed reported by the engine, when it reports one. */
  tokensPerSecond?: number;
  /** "length" means the reply was cut off by the token limit. */
  finishReason?: string;
}

export interface ChatOptions {
  onToken?(text: string): void;
  signal?: AbortSignal;
}

/**
 * One way of reaching a language model. Every AI feature talks to this
 * interface only, so it works the same with the local engine, a cloud
 * service, or a scripted stand-in used by tests.
 */
export interface AiProvider {
  readonly kind: 'local' | 'cloud' | 'custom';
  /** A short name for the model in use, shown to the user and stored with each job. */
  readonly label: string;
  chat(request: ChatRequest, options?: ChatOptions): Promise<ChatResult>;
}

/** An AI problem with a message that is safe to show to the user as is. */
export class AiError extends Error {
  constructor(
    message: string,
    /** True when trying again at once might work. */
    readonly retryable = false,
    /** True when the engine itself is not answering, as opposed to giving a poor answer. */
    readonly engineDown = false,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException ? error.name === 'AbortError' : (error as { name?: string })?.name === 'AbortError';
}

/** Reads one server-sent-events stream of OpenAI-style chat chunks. */
export class ChatStreamReader {
  private buffer = '';
  text = '';
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSecond?: number;
  finishReason?: string;
  done = false;

  constructor(private readonly onToken?: (text: string) => void) {}

  /** Feeds raw text from the stream. Complete events are processed, the rest is kept. */
  push(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this.line(line);
    }
  }

  private line(line: string): void {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') {
      this.done = true;
      return;
    }
    let event: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event.error) {
      throw new AiError(`The AI engine reported a problem: ${event.error.message ?? JSON.stringify(event.error)}`);
    }
    const choice = event.choices?.[0];
    const piece = choice?.delta?.content;
    if (typeof piece === 'string' && piece) {
      this.text += piece;
      this.onToken?.(piece);
    }
    if (choice?.finish_reason) this.finishReason = choice.finish_reason;
    if (event.usage) {
      this.promptTokens = event.usage.prompt_tokens ?? this.promptTokens;
      this.completionTokens = event.usage.completion_tokens ?? this.completionTokens;
    }
    if (event.timings?.predicted_per_second) this.tokensPerSecond = event.timings.predicted_per_second;
  }

  result(): ChatResult {
    return {
      text: this.text,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      tokensPerSecond: this.tokensPerSecond,
      finishReason: this.finishReason,
    };
  }
}

/** The request body for an OpenAI-compatible chat endpoint. */
export function chatBody(request: ChatRequest, model?: string, local = false): Record<string, unknown> {
  return {
    ...(model ? { model } : {}),
    messages: request.messages,
    temperature: request.temperature ?? 0.2,
    max_tokens: request.maxTokens ?? 1024,
    stream: true,
    stream_options: { include_usage: true },
    ...(request.jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: request.jsonSchema } } } : {}),
    // Editing needs the answer itself, not a model's visible reasoning.
    ...(local ? { cache_prompt: true, chat_template_kwargs: { enable_thinking: false } } : {}),
  };
}

export interface HttpProviderConfig {
  /** Base URL of an OpenAI-compatible server, for example http://127.0.0.1:8080 */
  baseUrl: string;
  apiKey?: string;
  model?: string;
  label?: string;
  kind?: AiProvider['kind'];
}

/**
 * Talks straight to an OpenAI-compatible HTTP server. The desktop app does
 * not use this for the local engine (requests go through the Rust shell);
 * it is used by the browser preview and by automated tests.
 */
export class HttpProvider implements AiProvider {
  readonly kind: AiProvider['kind'];
  readonly label: string;

  constructor(private readonly config: HttpProviderConfig) {
    this.kind = config.kind ?? 'custom';
    this.label = config.label ?? config.model ?? 'Custom server';
  }

  async chat(request: ChatRequest, options: ChatOptions = {}): Promise<ChatResult> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}) },
        body: JSON.stringify(chatBody(request, this.config.model, this.kind !== 'cloud')),
        signal: options.signal,
      });
    } catch (e) {
      if (isAbort(e)) throw e;
      throw new AiError('The AI engine could not be reached. Check that a model is loaded.', true, true);
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new AiError(`The AI engine refused the request (${response.status}). ${detail.slice(0, 300)}`, response.status >= 500, response.status >= 500);
    }
    const reader = new ChatStreamReader(options.onToken);
    const decoder = new TextDecoder();
    const stream = response.body.getReader();
    for (;;) {
      const { value, done } = await stream.read();
      if (done) break;
      reader.push(decoder.decode(value, { stream: true }));
    }
    reader.push('\n');
    return reader.result();
  }
}
