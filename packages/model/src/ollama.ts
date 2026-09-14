import type {
  GeneratedQuestion,
  ModelClient,
  ProposalContext,
  ProposedSuggestion,
  QuestionContext,
} from './contract.js';
import { buildMessages, parseProposals, RESPONSE_FORMAT } from './prompt.js';
import { buildQuestionMessages, parseQuestions, QUESTIONS_RESPONSE_FORMAT } from './questions.js';

export interface OllamaOptions {
  url: string;
  model: string;
  embedModel?: string;
  timeoutMs?: number;
  fallback?: ModelClient;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 2;

/**
 * Local Ollama client. JSON mode + schema validation; one retry with the parse error
 * fed back to the model, then the deterministic `fallback` (RuleBasedModel) if configured.
 */
export class OllamaModel implements ModelClient {
  name: string;
  lastRun: { used: 'ollama' | 'fallback'; attempts: number; ms: number; error?: string } | null = null;
  private readonly f: typeof fetch;

  constructor(private readonly o: OllamaOptions) {
    this.name = 'ollama:' + o.model;
    this.f = o.fetchImpl ?? fetch;
  }

  private async req(path: string, body?: unknown): Promise<Response> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      return await this.f(this.o.url.replace(/\/$/, '') + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  }

  async available(): Promise<boolean> {
    try {
      const r = await this.req('/api/tags');
      return r.ok;
    } catch {
      return false;
    }
  }

  async proposeChanges(ctx: ProposalContext): Promise<ProposedSuggestion[]> {
    const started = Date.now();
    const messages = buildMessages(ctx);
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await this.req('/api/chat', {
          model: this.o.model,
          stream: false,
          format: RESPONSE_FORMAT,
          options: { temperature: 0.1, num_ctx: 8192 },
          messages:
            attempt === 1
              ? messages
              : [
                  ...messages,
                  {
                    role: 'user',
                    content: 'התשובה הקודמת לא הייתה JSON תקין (' + lastError + '). החזר JSON תקין בלבד.',
                  },
                ],
        });
        if (!r.ok) {
          lastError = 'http ' + r.status;
          continue;
        }
        const data = (await r.json()) as { message?: { content?: string } };
        const parsed = parseProposals(data.message?.content ?? '');
        if (parsed.ok) {
          this.lastRun = { used: 'ollama', attempts: attempt, ms: Date.now() - started };
          return parsed.items;
        }
        lastError = parsed.error;
      } catch (e) {
        lastError = (e as Error).message;
      }
    }
    if (!this.o.fallback) throw new Error('model failed: ' + lastError);
    const items = await this.o.fallback.proposeChanges(ctx);
    this.lastRun = { used: 'fallback', attempts: MAX_ATTEMPTS, ms: Date.now() - started, error: lastError };
    return items;
  }

  /**
   * Wave 5 (V1). Same shape as `proposeChanges` minus the fallback: there is no deterministic
   * question generator in this package, so a failure throws and the api falls back to its own
   * rules and reports `source: 'rules'`.
   */
  async generateQuestions(ctx: QuestionContext): Promise<GeneratedQuestion[]> {
    const started = Date.now();
    const messages = buildQuestionMessages(ctx);
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await this.req('/api/chat', {
          model: this.o.model,
          stream: false,
          format: QUESTIONS_RESPONSE_FORMAT,
          options: { temperature: 0.2, num_ctx: 8192 },
          messages:
            attempt === 1
              ? messages
              : [
                  ...messages,
                  {
                    role: 'user',
                    content: 'התשובה הקודמת לא הייתה JSON תקין (' + lastError + '). החזר JSON תקין בלבד.',
                  },
                ],
        });
        if (!r.ok) {
          lastError = 'http ' + r.status;
          continue;
        }
        const data = (await r.json()) as { message?: { content?: string } };
        const parsed = parseQuestions(data.message?.content ?? '');
        if (parsed.ok) {
          this.lastRun = { used: 'ollama', attempts: attempt, ms: Date.now() - started };
          return parsed.items;
        }
        lastError = parsed.error;
      } catch (e) {
        lastError = (e as Error).message;
      }
    }
    throw new Error('model failed: ' + lastError);
  }

  async embed(text: string): Promise<number[]> {
    const r = await this.req('/api/embeddings', {
      model: this.o.embedModel ?? 'nomic-embed-text',
      prompt: text,
    });
    if (!r.ok) throw new Error('embeddings http ' + r.status);
    return ((await r.json()) as { embedding: number[] }).embedding;
  }
}
