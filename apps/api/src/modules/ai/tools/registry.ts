/**
 * Wave 6 (X2) — the tool runtime.
 *
 * Three rules hold here and nowhere else, which is why every tool goes through `runTool`:
 *
 * 1. **The caller's tier decides the tool set**, not the model. `toolsFor(permissions)` (minus
 *    the conversation kind's cap) is computed server-side; the model is never told about a tool
 *    the caller may not run, and a call for one is refused with `ok: false` even so — a model
 *    that hallucinates a tool name must not be able to reach past the permission check.
 * 2. **Arguments are re-validated with zod.** A model's "valid JSON" is not an authorisation,
 *    and a bad argument is a Hebrew summary the model can read and retry, never an exception
 *    that kills the stream.
 * 3. **No tool writes.** `propose_source_edit` and `refine_suggestion` *return* proposals; the
 *    only write path in this lane is `POST /ai/proposed-edits/:id/decide` (spec §1.3).
 */
import { z } from 'zod';
import type { ChatToolSpec, ModelClient } from '@wecom/model';
import {
  AI_TOOLS,
  type AiSettings,
  type AiToolName,
  type Conversation,
  type Document,
  type ProposedEditOp,
  type SuggestionPayload,
} from '@wecom/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Queryable } from '../../../lib/sql.js';
import type { ReqUser } from '../../../lib/user.js';

export interface ToolCtx {
  db: Queryable;
  user: ReqUser;
  conversation: Conversation;
  /** The conversation's document, already visibility-checked, when it has one. */
  document: Document | null;
  /** The chat model, for the tools that run a second, tool-less call of their own. */
  model: Pick<ModelClient, 'chat'> | null;
  settings: AiSettings;
  log: FastifyBaseLogger;
}

export interface ToolOk {
  ok: true;
  /** The Hebrew line the pane shows under "מה המערכת עשתה". */
  summary: string;
  data: unknown;
  /** `propose_source_edit` only: hunks the orchestrator persists and streams. */
  proposedEdits?: ProposedEditOp[];
  /** `refine_suggestion` only: a payload the user still has to accept. */
  refined?: { suggestionId: string; editedPayload: SuggestionPayload };
}
export interface ToolFail {
  ok: false;
  summary: string;
}
export type ToolOutcome = ToolOk | ToolFail;

export interface ToolDef<A> {
  name: AiToolName;
  description: string;
  args: z.ZodType<A>;
  run(ctx: ToolCtx, args: A): Promise<ToolOutcome>;
}

/** The one spelling of "this document is not yours to see", for every document-addressed tool. */
export const NOT_FOUND: ToolFail = { ok: false, summary: 'לא נמצא' };

/* ── zod → JSON Schema ───────────────────────────────────────────────────────
 * A local, deliberately small converter rather than `zod-to-json-schema`: that package is a
 * transitive dependency of `fastify-type-provider-zod`, not a declared one of this app, and the
 * argument schemas below are flat objects of strings, numbers, enums and arrays. Ollama takes
 * the result verbatim; the authoritative validation is the zod parse in `runTool`, so an
 * imprecise schema costs a retry, never a wrong authorisation.
 */
type Json = Record<string, unknown>;

interface ZodDefShape {
  typeName: string;
  innerType?: z.ZodTypeAny;
  type?: z.ZodTypeAny;
  values?: string[];
  checks?: { kind: string; value?: number }[];
}

function jsonSchemaOf(schema: z.ZodTypeAny): Json {
  const def = schema._def as unknown as ZodDefShape;
  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodNullable:
    case z.ZodFirstPartyTypeKind.ZodDefault:
      return jsonSchemaOf(def.innerType!);
    case z.ZodFirstPartyTypeKind.ZodString: {
      const checks = def.checks ?? [];
      const out: Json = { type: 'string' };
      for (const c of checks) {
        if (c.kind === 'uuid') out.format = 'uuid';
        if (c.kind === 'min') out.minLength = c.value;
        if (c.kind === 'max') out.maxLength = c.value;
      }
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const checks = def.checks ?? [];
      const out: Json = { type: checks.some((c) => c.kind === 'int') ? 'integer' : 'number' };
      for (const c of checks) {
        if (c.kind === 'min') out.minimum = c.value;
        if (c.kind === 'max') out.maximum = c.value;
      }
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: 'boolean' };
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return { type: 'string', enum: [...(def.values ?? [])] };
    case z.ZodFirstPartyTypeKind.ZodArray:
      return { type: 'array', items: jsonSchemaOf(def.type!) };
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (schema as unknown as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Json = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = jsonSchemaOf(value);
        if (!value.isOptional()) required.push(key);
      }
      return { type: 'object', properties, ...(required.length ? { required } : {}) };
    }
    default:
      return {};
  }
}

/* ── registry ────────────────────────────────────────────────────────────── */

const DEFS = new Map<AiToolName, ToolDef<unknown>>();

/** Called once per tool module at import time; `read.ts` and `propose.ts` own the definitions. */
export function defineTool<A>(def: ToolDef<A>): ToolDef<A> {
  DEFS.set(def.name, def as unknown as ToolDef<unknown>);
  return def;
}

export const toolDef = (name: AiToolName): ToolDef<unknown> | undefined => DEFS.get(name);

/** The specs the model sees, in catalogue order — never more than the caller may run. */
export const specsFor = (names: readonly AiToolName[]): ChatToolSpec[] =>
  AI_TOOLS.filter((t) => names.includes(t.name)).flatMap((t) => {
    const def = DEFS.get(t.name);
    return def
      ? [{ name: def.name, description: def.description, parameters: jsonSchemaOf(def.args) }]
      : [];
  });

export async function runTool(
  ctx: ToolCtx,
  allowed: ReadonlySet<AiToolName>,
  call: { id: string; name: string; args: Record<string, unknown> },
): Promise<ToolOutcome> {
  const def = DEFS.get(call.name as AiToolName);
  if (!def) return { ok: false, summary: `כלי לא מוכר: ${call.name}` };
  if (!allowed.has(def.name)) return { ok: false, summary: 'אין הרשאה להפעיל כלי זה' };
  const parsed = def.args.safeParse(call.args ?? {});
  if (!parsed.success)
    return {
      ok: false,
      summary:
        'ארגומנטים לא תקינים: ' +
        parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '),
    };
  try {
    return await def.run(ctx, parsed.data);
  } catch (e) {
    const err = e as { statusCode?: number; message?: string };
    ctx.log.warn({ tool: def.name, err: err.message }, 'tool failed');
    return {
      ok: false,
      summary: err.statusCode === 404 || err.statusCode === 403 ? 'לא נמצא' : 'הכלי נכשל',
    };
  }
}

export { jsonSchemaOf };
