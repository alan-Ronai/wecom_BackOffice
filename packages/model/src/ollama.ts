import type {
  GeneratedQuestion,
  ModelClient,
  ProposalContext,
  ProposedSuggestion,
  QuestionContext,
} from './contract.js';
import { buildMessages, parseProposals, RESPONSE_FORMAT } from './prompt.js';
import { buildQuestionMessages, parseQuestions, QUESTIONS_RESPONSE_FORMAT } from './questions.js';
import { enforceSectionCards } from './sections.js';

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
          // The prompt asks for one card per section, but the section rule is an invariant of
          // the pipeline, not a request: hold it whatever the model returned.
          return enforceSectionCards(ctx, parsed.items);
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

  /**
   * Wave 6 (X1). `/api/embed` accepts an array and returns one vector per input, so a reindex
   * of 5,000 documents is 5,000/`batch` round trips instead of 5,000. Empty input → [] without a
   * call. A model that ignores the batch form (older Ollama) answers with one vector for the
   * first input only; we detect the short answer and fall back to one `embed` per text.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const r = await this.req('/api/embed', {
      model: this.o.embedModel ?? 'nomic-embed-text',
      input: texts,
    });
    if (!r.ok) throw new Error('embed http ' + r.status);
    const data = (await r.json()) as { embeddings?: number[][] };
    if (Array.isArray(data.embeddings) && data.embeddings.length === texts.length) return data.embeddings;
    const out: number[][] = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }

  /** `/api/show` for one tag: family, parameter size, quantization and (for embedders) the vector width. */
  async showModel(
    tag: string,
  ): Promise<{
    family?: string;
    parameterSize?: string;
    quantization?: string;
    embeddingLength?: number;
  } | null> {
    try {
      const r = await this.req('/api/show', { model: tag });
      if (!r.ok) return null;
      const d = (await r.json()) as {
        details?: { family?: string; parameter_size?: string; quantization_level?: string };
        model_info?: Record<string, unknown>;
      };
      const info = d.model_info ?? {};
      const lenKey = Object.keys(info).find((k) => k.endsWith('.embedding_length'));
      return {
        family: d.details?.family,
        parameterSize: d.details?.parameter_size,
        quantization: d.details?.quantization_level,
        embeddingLength: lenKey ? Number(info[lenKey]) : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * The tags Ollama has locally, for `POST /admin/ai/models/test`'s presence check.
   * Never throws: an unreachable daemon is an empty listing, which the route reports as
   * `reachable: false` rather than a 500.
   */
  async listTags(): Promise<{ name: string; size: number }[]> {
    try {
      const r = await this.req('/api/tags');
      if (!r.ok) return [];
      const d = (await r.json()) as { models?: { name?: string; size?: number }[] };
      return (d.models ?? [])
        .filter((m) => !!m.name)
        .map((m) => ({ name: m.name as string, size: Number(m.size ?? 0) }));
    } catch {
      return [];
    }
  }

  /**
   * One short generation on an arbitrary tag, for the admin slot test: the point is the
   * measured throughput, not the text. Throws so the caller can report the error verbatim.
   */
  async generateProbe(tag: string, prompt: string, numPredict = 20): Promise<{ tokens: number; ms: number }> {
    const started = Date.now();
    const r = await this.req('/api/chat', {
      model: tag,
      stream: false,
      options: { temperature: 0, num_predict: numPredict },
      messages: [{ role: 'user', content: prompt }],
    });
    if (!r.ok) throw new Error('chat http ' + r.status);
    const d = (await r.json()) as { eval_count?: number };
    return { tokens: Number(d.eval_count ?? 0), ms: Date.now() - started };
  }
}
