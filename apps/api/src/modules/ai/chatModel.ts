/**
 * Wave 6 (X2) — the chat slot's model client and the holder that makes it swappable.
 *
 * The chat model is a *second* client, separate from `app.model`: a tier may point the two
 * slots at different tags (spec §6), and the generation slot has a deterministic fallback
 * (`RuleBasedModel`) while chat has none — there is no rule-based conversation, so an
 * unreachable model is a 503, not a worse answer.
 *
 * The holder is a module-level singleton *and* a decorator. Fastify decorators do not travel
 * upwards out of the `/api/v1` scope this module is registered in, so a test holding the root
 * app could not reach `app.aiChat`; the singleton is the seam tests and X6 actually use
 * (`aiChatHolder.swap(fakeChat(...))`), and the decorator is the ergonomic spelling inside the
 * module. Both are the same object.
 */
import { OllamaModel, type ChatResult, type ModelClient } from '@wecom/model';
import type { FastifyBaseLogger } from 'fastify';
import { resolveModelSlots, type ModelSlotsConfig } from '../../lib/modelSlots.js';
import { httpError } from '../../lib/http.js';
import { ScriptedChatModel } from './scripted.js';

export type ChatInput = Parameters<NonNullable<ModelClient['chat']>>[0];

/** `available()` false and `chat()` a 503: what every caller sees when no chat model is configured. */
export const unavailableChatModel = (name = 'disabled'): ModelClient => ({
  name,
  available: async () => false,
  proposeChanges: async () => [],
});

export class ChatModelHolder {
  constructor(public impl: ModelClient) {}
  swap(impl: ModelClient): void {
    this.impl = impl;
  }
  get name(): string {
    return this.impl.name;
  }
  available(): Promise<boolean> {
    return this.impl.available();
  }
  chat(input: ChatInput): Promise<ChatResult> {
    if (!this.impl.chat) throw httpError(503, 'AI_UNAVAILABLE', 'מודל הצ׳אט אינו זמין');
    return this.impl.chat(input);
  }
}

/**
 * The process-wide holder. Created unavailable so importing this module never reaches the
 * network; `initChatModel` fills it in during registration.
 */
export const aiChatHolder = new ChatModelHolder(unavailableChatModel('uninitialised'));

/** Probed once per tag: `/api/show` reports `capabilities`, and `tools` is what decides the mode. */
const toolSupport = new Map<string, boolean>();

export async function probeToolSupport(
  url: string,
  tag: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const hit = toolSupport.get(tag);
  if (hit !== undefined) return hit;
  try {
    const r = await fetchImpl(url.replace(/\/$/, '') + '/api/show', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: tag }),
    });
    const j = (await r.json()) as { capabilities?: string[] };
    const ok = !!j.capabilities?.includes('tools');
    toolSupport.set(tag, ok);
    return ok;
  } catch {
    // Not cached: an Ollama that was down at boot may be up by the first message.
    return false;
  }
}

export interface ChatModelConfig extends ModelSlotsConfig {
  MODEL_URL: string;
  MODEL_DISABLED: boolean;
  NODE_ENV: string;
}

const CHAT_TIMEOUT_MS = 180_000;

/**
 * `AI_TEST_SCRIPT=1` outside production selects the deterministic `ScriptedChatModel`. The e2e
 * stack runs with `MODEL_DISABLED=true` and no Ollama on the box, so without it every chat
 * assertion there would be a 503 — and pointing e2e at a real 7B on CPU would make the suite
 * both slow and non-deterministic. Read from the environment rather than from `Config` on
 * purpose: it is a test seam, not an operational setting, and it has no place in
 * `deploy/.env.example`.
 */
export const scriptedChatRequested = (nodeEnv: string): boolean =>
  process.env.AI_TEST_SCRIPT === '1' && nodeEnv !== 'production';

export async function makeChatModel(config: ChatModelConfig, log: FastifyBaseLogger): Promise<ModelClient> {
  if (scriptedChatRequested(config.NODE_ENV)) {
    log.warn('AI_TEST_SCRIPT=1 — the chat slot is the scripted stand-in, not a model');
    return new ScriptedChatModel();
  }
  const slots = resolveModelSlots(config);
  if (config.MODEL_DISABLED) return unavailableChatModel('disabled');
  const supportsTools = await probeToolSupport(config.MODEL_URL, slots.chatModel);
  log.info({ chatModel: slots.chatModel, supportsTools }, 'chat model ready');
  return new OllamaModel({
    url: config.MODEL_URL,
    model: slots.chatModel,
    timeoutMs: CHAT_TIMEOUT_MS,
    supportsTools,
  });
}

export async function initChatModel(
  config: ChatModelConfig,
  log: FastifyBaseLogger,
): Promise<ChatModelHolder> {
  aiChatHolder.swap(await makeChatModel(config, log));
  return aiChatHolder;
}
