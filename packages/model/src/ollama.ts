import type {
  ChatMessage,
  ChatResult,
  ChatToolSpec,
  GeneratedQuestion,
  ModelClient,
  ProposalContext,
  ProposedSuggestion,
  QuestionContext,
  ToolCall,
} from './contract.js';
import { buildMessages, numCtxFor, parseProposals, RESPONSE_FORMAT } from './prompt.js';
import { flatResponseFormat, parseFlatProposals, repairHint } from './flat.js';
import { applyGuards } from './guard.js';
import { buildQuestionMessages, parseQuestions, QUESTIONS_RESPONSE_FORMAT } from './questions.js';
import { enforceSectionCards, isNewSourcePath } from './sections.js';

export interface OllamaOptions {
  url: string;
  model: string;
  embedModel?: string;
  timeoutMs?: number;
  fallback?: ModelClient;
  fetchImpl?: typeof fetch;
  /**
   * Wave 6 (X2). Whether the tag supports native tool calling — probed once per tag by the api
   * (`probeToolSupport`). `false`/undefined puts `chat` into envelope mode: the tools are
   * described in a system message and the model is asked to answer with a JSON envelope.
   */
  supportsTools?: boolean;
  /**
   * **Legacy, off.** Go back to wave 6's nested `RESPONSE_FORMAT` envelope and its all-or-nothing
   * `parseProposals`, for an A/B against the measured default. It scores 0.000/0.000/0.000 with
   * 8/8 schema failures on both tiers (C-C1, C-C2, C-C4) — it exists as the control arm, not as
   * an option anyone should select. The default path is `flat.ts`'s per-context, enum-typed,
   * fully-required schema, re-inflated into the discriminated union in code.
   */
  legacyEnvelope?: boolean;
  /** `propose-v4` (the default, `PROMPT_VERSION`) unless a caller pins an older file. */
  promptVersion?: string;
  /**
   * **On by default.** The two context-determined types are decided in code (`guard.ts`) rather
   * than hoped for from the model's reading of rules 1 and 3 — measured: hit-type 0.750 → 1.000
   * on both tiers. Set false only to measure the model's unaided classification.
   */
  guards?: boolean;
  /**
   * Sampling. The defaults are the measured ones: `temperature: 0` (free, and it makes a run
   * reproducible) and **no** `num_predict` — a 600-token cap truncated the six-section answer
   * and cost 0.125 hit-target, so nothing is capped below the longest legitimate answer.
   * `numCtx` defaults to `numCtxFor(ctx)`, sized from the *token* budget (C-I4).
   */
  temperature?: number;
  numPredict?: number;
  numCtx?: number;
}

const randomId = () => 'call_' + crypto.randomUUID().slice(0, 8);

/** NDJSON over a `ReadableStream`: one JSON object per line, blank lines ignored. */
async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield line;
      nl = buf.indexOf('\n');
    }
  }
  const rest = buf.trim();
  if (rest) yield rest;
}

interface OllamaWireMessage {
  role: string;
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_call_id?: string;
}

const toOllamaMessage = (m: ChatMessage): OllamaWireMessage => {
  const out: OllamaWireMessage = { role: m.role, content: m.content };
  if (m.toolCalls?.length)
    out.tool_calls = m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } }));
  if (m.toolCallId) out.tool_call_id = m.toolCallId;
  return out;
};

/**
 * The envelope contract for tags without native tool calling. Hebrew, like every other
 * instruction the local models get, and deliberately blunt: the whole reply is the JSON or
 * there is no JSON at all, because a half-parsed envelope is a tool call nobody authorised.
 */
export const toolEnvelopeInstructions = (tools: ChatToolSpec[]): string =>
  [
    'כשאתה צריך כלי, החזר אך ורק JSON: {"tool_calls":[{"name":…,"args":{…}}]}. אחרת ענה בטקסט רגיל.',
    'הכלים הזמינים:',
    ...tools.map((t) => {
      const props = (t.parameters as { properties?: Record<string, unknown> }).properties ?? {};
      return `- ${t.name}(${Object.keys(props).join(', ')}) — ${t.description}`;
    }),
  ].join('\n');

/** `{"tool_calls":[…]}`, possibly inside a ```json fence. Anything else returns null. */
export function parseToolEnvelope(text: string): { name: string; args: Record<string, unknown> }[] | null {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  if (!body.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const calls = (parsed as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(calls) || !calls.length) return null;
  const out: { name: string; args: Record<string, unknown> }[] = [];
  for (const c of calls) {
    const name = (c as { name?: unknown }).name;
    const args = (c as { args?: unknown }).args ?? {};
    if (typeof name !== 'string' || !name) return null;
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
    out.push({ name, args: args as Record<string, unknown> });
  }
  return out;
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
    const legacy = this.o.legacyEnvelope === true;
    const guards = this.o.guards !== false;
    const messages = buildMessages(ctx, { version: this.o.promptVersion });
    let lastError = '';
    /** C-I7: the answer that failed, replayed as the assistant turn of the one retry. */
    let lastAnswer = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await this.req('/api/chat', {
          model: this.o.model,
          stream: false,
          format: legacy ? RESPONSE_FORMAT : flatResponseFormat(ctx),
          options: {
            /** Measured: temperature 0 costs nothing and makes a run reproducible. */
            temperature: this.o.temperature ?? 0,
            /** C-I4: sized from the token budget rather than pinned at 8192. */
            num_ctx: this.o.numCtx ?? numCtxFor(ctx),
            /** No `num_predict` by default: a cap below the longest answer truncates case 06. */
            ...(this.o.numPredict ? { num_predict: this.o.numPredict } : {}),
          },
          messages:
            attempt === 1
              ? messages
              : [
                  ...messages,
                  ...(lastAnswer ? [{ role: 'assistant', content: lastAnswer }] : []),
                  { role: 'user', content: repairHint(lastError) },
                ],
        });
        if (!r.ok) {
          lastError = 'http ' + r.status;
          continue;
        }
        const data = (await r.json()) as { message?: { content?: string } };
        const content = data.message?.content ?? '';
        lastAnswer = content;
        const parsed = legacy ? parseProposals(content) : parseFlatProposals(ctx, content);
        if (parsed.ok) {
          this.lastRun = { used: 'ollama', attempts: attempt, ms: Date.now() - started };
          // The prompt asks for one card per section, but the section rule is an invariant of
          // the pipeline, not a request: hold it whatever the model returned.
          const items = enforceSectionCards(ctx, parsed.items);
          // The guards run *after* the invariant, so a coerced `update-block` cannot be undone
          // by the section rule and a `field-alert` is never dropped as "not a section card".
          return guards ? applyGuards(ctx, items) : items;
        }
        lastError = parsed.error;
        /**
         * C-C5. On the new-source path the cards are the *rule engine's* anyway
         * (`enforceSectionCards` discards the model's `new-card`s), so a model answer that will
         * not parse costs nothing there — yet every observed failure of case `06` was the whole
         * revision going to the fallback because the model wrote `update-step` for a source
         * that has no steps yet. Hold the invariant instead of retrying for cards we discard.
         */
        if (isNewSourcePath(ctx)) {
          this.lastRun = { used: 'ollama', attempts: attempt, ms: Date.now() - started, error: lastError };
          return enforceSectionCards(ctx, []);
        }
        /**
         * Same argument, last attempt: the guards need no model. `detectFieldAlerts` reads the
         * diffs and the known field list, so a revision whose answer would not parse still keeps
         * the suggestions the context alone proves — rather than losing them to a fallback that
         * happens not to look for them. Measured: `aya-expanse:8b` failed the parse on case `05`
         * and the field rename was there to be found the whole time.
         */
        if (attempt === MAX_ATTEMPTS && guards) {
          const rescued = applyGuards(ctx, []);
          if (rescued.length) {
            this.lastRun = { used: 'ollama', attempts: attempt, ms: Date.now() - started, error: lastError };
            return rescued;
          }
        }
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

  /**
   * Wave 6 (X2). Streams `/api/chat` so the SSE route can emit tokens as they arrive, and
   * returns the tool calls the model asked for — natively when the tag supports it, otherwise
   * from a JSON envelope parsed out of the content.
   *
   * In envelope mode nothing is streamed until the first non-whitespace character is known: a
   * model that decided to call a tool otherwise streams raw JSON into the user's chat pane.
   * The moment that character turns out not to be `{` or a fence, the buffer is flushed and
   * streaming continues normally.
   */
  async chat(input: {
    model?: string;
    messages: ChatMessage[];
    tools?: ChatToolSpec[];
    onToken?: (t: string) => void;
    signal?: AbortSignal;
  }): Promise<ChatResult> {
    const native = this.o.supportsTools ?? false;
    const envelopeMode = !native && !!input.tools?.length;
    const messages: ChatMessage[] = envelopeMode
      ? [
          ...input.messages.slice(0, 1),
          { role: 'system', content: toolEnvelopeInstructions(input.tools!) },
          ...input.messages.slice(1),
        ]
      : input.messages;
    const res = await this.f(this.o.url.replace(/\/$/, '') + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        model: input.model ?? this.o.model,
        stream: true,
        options: { temperature: 0.2, num_ctx: 8192 },
        messages: messages.map(toOllamaMessage),
        ...(native && input.tools?.length
          ? {
              tools: input.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
      }),
    });
    if (!res.ok || !res.body) throw new Error('chat http ' + res.status);
    let content = '';
    const toolCalls: ToolCall[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    /** Envelope mode only: true until we know the reply is prose rather than an envelope. */
    let holding = envelopeMode;
    const emit = (piece: string) => {
      if (!holding) return input.onToken?.(piece);
      const seen = content.trimStart();
      if (!seen) return; // still only whitespace — nothing decided yet
      if (seen.startsWith('{') || seen.startsWith('```')) return; // envelope: stream nothing
      holding = false;
      input.onToken?.(content); // flush everything held back, including this piece
    };
    for await (const line of ndjsonLines(res.body)) {
      let chunk: {
        message?: {
          content?: string;
          tool_calls?: { function: { name: string; arguments?: Record<string, unknown> } }[];
        };
        done?: boolean;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      try {
        chunk = JSON.parse(line);
      } catch {
        continue; // a truncated line is a dropped token, never a failed answer
      }
      const piece = chunk.message?.content ?? '';
      if (piece) {
        content += piece;
        emit(piece);
      }
      for (const tc of chunk.message?.tool_calls ?? [])
        toolCalls.push({ id: randomId(), name: tc.function.name, args: tc.function.arguments ?? {} });
      if (chunk.done) {
        tokensIn = chunk.prompt_eval_count ?? 0;
        tokensOut = chunk.eval_count ?? 0;
      }
    }
    if (envelopeMode) {
      const env = parseToolEnvelope(content);
      if (env) {
        toolCalls.push(...env.map((c) => ({ id: randomId(), name: c.name, args: c.args })));
        content = '';
      } else if (holding && content.trim()) {
        // Held back on a `{` that never parsed: the user still gets the text.
        input.onToken?.(content);
      }
    }
    return { content, toolCalls, tokensIn, tokensOut };
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
  async showModel(tag: string): Promise<{
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
