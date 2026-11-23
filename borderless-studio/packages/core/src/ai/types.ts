/** Shared by the two assistant back ends. */
export interface AssistantReply {
  text: string;
  /** The model that answered, as the service names it. */
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type AssistantProblem = 'unavailable' | 'no-key' | 'auth' | 'model' | 'busy' | 'request' | 'network' | 'service' | 'refused' | 'too-long' | 'empty';

/** A problem with a plain sentence the author can act on. */
export class AssistantError extends Error {
  constructor(
    readonly problem: AssistantProblem,
    message: string,
  ) {
    super(message);
    this.name = 'AssistantError';
  }
}
