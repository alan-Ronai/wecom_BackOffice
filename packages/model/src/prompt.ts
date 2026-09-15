import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { IdSchema, SuggestionPayloadSchema, SuggestionSchema, SuggestionTypeSchema } from '@wecom/shared';
import type { ProposalContext, ProposedSuggestion } from './contract.js';
import { groupSections, isNewSourcePath } from './sections.js';
import { toFlatExample } from './flat.js';

/** Bump together with a new `prompts/<version>.md` file; stored on every run for reproducibility.
 * v2 (pipeline-fanout): a brand-new source is proposed as one card per SECTION, and a single
 * remote item as one card with a phase per section, instead of one card per paragraph.
 * v3 (wave 6, X1): the model is briefed. The system message is assembled from the admin's
 * company brief, the knowledge architecture, the admin's house style and these task rules, and
 * the user message carries the change's impact set and accepted examples of the same types.
 * The JSON envelope is unchanged, so nothing downstream of `parseProposals` moved.
 * v4 (wave 6 fix wave, C-C1…C-C3): v3 restructured for a 3B — the task first, an ordered
 * decision list (stop at the first rule that matches) instead of six independent bullets, one
 * compact example **per type in the flat answer shape** (`flat.ts`), and an explicit "copy the
 * id exactly" rule. The architecture brief is dropped from the system message: it is background
 * a 3B cannot act on and it was 40% of the tokens. Measured on the committed case set, v4 with
 * the flat schema takes hit-target from 0.000 to 1.000 on both tiers. */
export const PROMPT_VERSION = 'propose-v4';
/**
 * The wave-6-as-merged prompt, kept reachable for an A/B and for `OllamaOptions.legacyEnvelope`.
 * Nothing selects it by default; `test/prompt.test.ts` pins that the path still parses.
 */
export const LEGACY_PROMPT_VERSION = 'propose-v3';
const readPrompt = (v: string) => readFileSync(fileURLToPath(new URL(`../prompts/${v}.md`, import.meta.url)), 'utf8');
export const SYSTEM_PROMPT = readPrompt(PROMPT_VERSION);

export interface PromptOptions {
  /** `propose-v4` (default) or `propose-v3` (legacy). */
  version?: string;
  /** Prepend `architecture-v1`. Default true for v3, false for v4. */
  architecture?: boolean;
}
const promptCache = new Map<string, string>();
const promptFor = (v: string): string => {
  const hit = promptCache.get(v);
  if (hit !== undefined) return hit;
  const text = v === PROMPT_VERSION ? SYSTEM_PROMPT : readPrompt(v);
  promptCache.set(v, text);
  return text;
};

/**
 * The knowledge architecture the platform is built on (spec §1.7): worlds, topics, the seven
 * item types, the two layers and the shared-block rule. It is *data*, not a rule set — injected
 * verbatim so a model that has never seen wecom proposes an `update-block` for a shared block
 * instead of an `update-step` per document.
 */
const archPath = fileURLToPath(new URL('../prompts/architecture-v1.md', import.meta.url));
export const ARCHITECTURE_PROMPT = readFileSync(archPath, 'utf8');
export const renderArchitecture = (): string => ARCHITECTURE_PROMPT;

/** `ai.limits.maxContextChars`'s default, for a caller that does not read the settings. */
export const DEFAULT_MAX_CONTEXT_CHARS = 24_000;
/** Impact never takes more than this much of the budget, however large the radius is. */
const MAX_IMPACT_CHARS = 4000;

/* ── C-I4: budget in tokens, and size `num_ctx` from the budget ──────────── */

/**
 * The budget was in characters and the window is in tokens, which is how a 24,000-char context
 * silently overran an 8,192-token `num_ctx` and got truncated by Ollama with no error.
 *
 * Measured over every committed case's rendered prompt (Hebrew prose + JSON ids + latin field
 * names): **2.6 characters per token**. Configurable, because a source set that is mostly latin
 * runs nearer 4 and one that is mostly Hebrew nearer 2.2, and getting it wrong in the safe
 * direction only costs a dropped example.
 */
export const DEFAULT_CHARS_PER_TOKEN = 2.6;
export const charsPerToken = (): number => {
  const v = Number(process.env.MODEL_CHARS_PER_TOKEN);
  return Number.isFinite(v) && v > 0.5 ? v : DEFAULT_CHARS_PER_TOKEN;
};
/** ceil, so an estimate is never optimistic about how much of the window is left. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / charsPerToken());

/**
 * Prompt tokens a context may occupy. `maxContextTokens` wins; otherwise the char limit is
 * converted, so an admin who lowered `ai.limits.maxContextChars` still gets what they asked for.
 */
export const DEFAULT_MAX_CONTEXT_TOKENS = Math.floor(DEFAULT_MAX_CONTEXT_CHARS / DEFAULT_CHARS_PER_TOKEN);
export function promptTokenBudget(ctx: ProposalContext): number {
  if (ctx.maxContextTokens && ctx.maxContextTokens > 0) return ctx.maxContextTokens;
  if (ctx.maxContextChars && ctx.maxContextChars > 0) return Math.floor(ctx.maxContextChars / charsPerToken());
  return DEFAULT_MAX_CONTEXT_TOKENS;
}

/** Room left for the answer itself; the six-section `new-card` answer is the longest observed. */
const OUTPUT_TOKEN_RESERVE = 2048;
const CTX_STEP = 2048;
const MIN_NUM_CTX = 8192;
const MAX_NUM_CTX = 32_768;

/**
 * `num_ctx` for a context: the prompt budget plus room for the answer, rounded up to a 2,048
 * boundary and clamped. Below the floor nothing is gained (llama.cpp allocates the KV cache
 * per request and 8k is free on this hardware); above the ceiling a CPU-only box swaps.
 */
export function numCtxFor(ctx: ProposalContext): number {
  const want = promptTokenBudget(ctx) + OUTPUT_TOKEN_RESERVE;
  const rounded = Math.ceil(want / CTX_STEP) * CTX_STEP;
  return Math.min(MAX_NUM_CTX, Math.max(MIN_NUM_CTX, rounded));
}

/**
 * system = [brief] [architecture] [style] [task rules]. The brief comes first because it is the
 * one part that says *who the company is*; the task rules come last because a model weights the
 * end of a system message most and those are the rules it is graded on.
 */
function systemMessage(ctx: ProposalContext, opts: PromptOptions = {}): string {
  const version = opts.version ?? PROMPT_VERSION;
  const withArch = opts.architecture ?? version === LEGACY_PROMPT_VERSION;
  return [
    ctx.brief?.trim(),
    withArch ? ARCHITECTURE_PROMPT.trim() : '',
    ctx.style?.trim() ? 'סגנון הבית:\n' + ctx.style.trim() : '',
    promptFor(version).trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * A local mirror of `ImpactService.formatImpact` (`apps/api/src/modules/sources/impact.ts`):
 * this package cannot import the api, and the eval harness has to show the model exactly the
 * text production shows it. Keep the two in step — the shape is asserted on both sides.
 */
function formatImpactForPrompt(impact: NonNullable<ProposalContext['impact']>): string {
  const lines: string[] = [];
  for (const b of impact.blocks)
    lines.push(`- בלוק משותף "${b.title}" (blockId=${b.id}) בשימוש ב-${b.usedBy} מסמכים`);
  for (const f of impact.fields) lines.push(`- שדה CRM "${f.name}" בשימוש ב-${f.usedBy} מסמכים`);
  for (const d of impact.documents) lines.push(`- מסמך "${d.title}" (documentId=${d.id}) — ${d.why}`);
  for (const t of impact.topics) lines.push(`- נושא "${t.name}"`);
  for (const r of impact.related)
    lines.push(`- מסמך קרוב "${r.title}" (documentId=${r.id}, דמיון ${r.similarity.toFixed(2)})`);
  let out = '';
  for (const l of lines) {
    if (out.length + l.length + 1 > MAX_IMPACT_CHARS) {
      out += '\n- …';
      break;
    }
    out += (out ? '\n' : '') + l;
  }
  return out;
}

/**
 * **Legacy.** The nested envelope shipped with wave 6, superseded by `flat.ts`'s per-context
 * enum-typed schema and reachable only behind `OllamaOptions.legacyEnvelope`.
 *
 * It is kept rather than deleted because it is the control arm: `--legacy-envelope` on the eval
 * CLI reproduces the 0.000/0.000/0.000 baseline on demand, which is how the next prompt change
 * is shown to be an improvement over something. Its defects are C-C1 (`payload: {type:'object'}`
 * with no properties), C-C2 (the three target fields absent from `required` and mandatory in the
 * parse) and C-C4 (`parseProposals` is all-or-nothing). Do not select it for production.
 */
export const RESPONSE_FORMAT = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['anchor', 'type', 'title', 'payload', 'confidence', 'rationale'],
        properties: {
          anchor: { type: 'string' },
          type: { type: 'string', enum: SuggestionTypeSchema.options },
          title: { type: 'string' },
          targetDocumentId: { type: ['string', 'null'] },
          targetStepKey: { type: ['string', 'null'] },
          targetBlockId: { type: ['string', 'null'] },
          payload: { type: 'object' },
          confidence: { type: 'number' },
          rationale: { type: 'string' },
        },
      },
    },
  },
  required: ['suggestions'],
} as const;

const stripAnchor = (ref: string) => ref.replace(/^§/, '');

export function buildMessages(
  ctx: ProposalContext,
  opts: PromptOptions = {},
): { role: 'system' | 'user'; content: string }[] {
  const v4 = (opts.version ?? PROMPT_VERSION) !== LEGACY_PROMPT_VERSION;
  const diffs = ctx.diffs
    .filter((d) => d.kind !== 'same')
    .map(
      (d) =>
        `- §${stripAnchor(d.ref)} ${d.kind}: לפני: ${JSON.stringify(d.before ?? '')} אחרי: ${JSON.stringify(d.after ?? '')}`,
    )
    .join('\n');
  /**
   * v4 numbers the candidates and puts the two copyable ids first on the line, because that is
   * what the model is asked to copy; v3's line buries `stepKey=` behind the document title.
   */
  const steps = v4
    ? ctx.linkedSteps
        .map(
          (s, i) =>
            `${i + 1}. §${stripAnchor(s.anchor)} → targetDocumentId="${s.documentId}" targetStepKey="${s.stepKey}"` +
            (s.blockId ? ` targetBlockId="${s.blockId}"` : '') +
            ` — שלב ${s.stepNum} "${s.stepTitle}" במסמך "${s.documentTitle}", פעולות: ${JSON.stringify(s.actions)}`,
        )
        .join('\n')
    : ctx.linkedSteps
        .map(
          (s) =>
            `- anchor §${stripAnchor(s.anchor)}: documentId=${s.documentId} ("${s.documentTitle}") stepKey=${s.stepKey} מספר ${s.stepNum} "${s.stepTitle}"${s.blockId ? ` blockId=${s.blockId}` : ''} פעולות: ${JSON.stringify(s.actions)}`,
        )
        .join('\n');
  const blocks = ctx.blocks
    .map((b) => `- blockId=${b.id} "${b.title}" פעולות: ${JSON.stringify(b.actions)}`)
    .join('\n');
  const fields = ctx.fields.map((f) => `${f.name} (${f.status})`).join(', ');
  /**
   * On the new-source path the model is shown the *sections* it is expected to answer with,
   * rather than being left to infer them from a list of "added" paragraphs — which is what
   * produced a card per paragraph.
   */
  const sections = isNewSourcePath(ctx)
    ? groupSections(ctx.paragraphs, ctx.source.title)
        .map(
          (s, i) =>
            `- סעיף ${i + 1} §${s.ref} "${s.title}": ` +
            s.items.map((it) => `§${it.ref} ${JSON.stringify(it.text)}`).join(' | '),
        )
        .join('\n')
    : '';
  /**
   * Wave 6 (X1). The optional blocks are appended under a budget rather than unconditionally:
   * on a CPU-only 7B, a user message with a large impact set and three examples is a timeout,
   * and a timeout is worse than a less-informed suggestion. Order of sacrifice: examples first
   * (nice to have), then impact (valuable), never the diffs and the linked steps — without
   * those there is nothing to propose at all.
   */
  const impactText = ctx.impact ? formatImpactForPrompt(ctx.impact) : '';
  /**
   * C-I3: an accepted example is rendered in the shape the model is being asked to answer in.
   * On v4 that is the flat shape (`toFlatExample`); the legacy path still shows the envelope,
   * because there the envelope is what it is being graded on.
   */
  const examplesText = (ctx.examples ?? [])
    .slice(0, 3)
    .map(
      (e, i) =>
        `דוגמה ${i + 1} — שינוי: ${e.diff}\nהצעה מאושרת: ` +
        JSON.stringify(v4 ? toFlatExample(e.suggestion) : e.suggestion),
    )
    .join('\n\n');
  const budget = promptTokenBudget(ctx);
  const sys = systemMessage(ctx, opts);
  const head = [
    `מסמך מקור: ${ctx.source.title}`,
    ...(ctx.source.singleDocument ? ['(פריט מרוחק יחיד — כרטיס אחד בלבד, phase לכל סעיף)'] : []),
  ];
  const tail = [
    ...(sections ? ['', 'סעיפי המקור (מקור חדש ללא שלבים ממופים):', sections] : []),
    '',
    'שינויים:',
    diffs || '- אין',
    '',
    v4
      ? ctx.linkedSteps.length
        ? 'שלבים ממופים — העתק את המזהים מהשורה המתאימה בדיוק כפי שהם:'
        : 'שלבים ממופים: אין אף שלב ממופה במקור הזה — כל הצעה היא new-card עם מזהים ריקים.'
      : 'שלבים ממופים (linkedSteps):',
    steps || '- אין',
    '',
    'בלוקים משותפים:',
    blocks || '- אין',
    '',
    `שדות CRM מוכרים: ${fields || 'אין'}`,
    '',
    'החזר JSON בלבד.',
  ];
  const withImpact = impactText ? ['', 'השפעה (impact) — מה עוד השינוי נוגע בו:', impactText] : [];
  const withExamples = examplesText ? ['', 'דוגמאות מאושרות (שמור על אותה רמת פירוט):', examplesText] : [];
  /**
   * C-I4: the sacrifice ladder is measured in *tokens* now — examples first, then impact, never
   * the diffs and the linked steps. Both messages count: the system message is 3,661 characters
   * of it before the user message starts.
   */
  const size = (optional: string[]) => estimateTokens(sys) + estimateTokens([...head, ...optional, ...tail].join('\n'));
  let optional = [...withImpact, ...withExamples];
  if (size(optional) > budget) optional = [...withImpact];
  if (size(optional) > budget) optional = [];
  const user = [...head, ...optional, ...tail].join('\n');
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/**
 * X6: the three target fields are **absent-means-null**.
 *
 * `RESPONSE_FORMAT` above deliberately leaves them out of `required` — a suggestion that targets
 * a document has no step key, one that targets a block has no document — but `SuggestionSchema`
 * spells them `.nullable()`, which in zod still demands the key be present. So the model was told
 * the field was optional and then rejected for omitting it. Every case of the tier-0 evaluation
 * run failed on exactly that (`suggestions.0.targetBlockId: Required`) and scored 0, from a model
 * whose answers were otherwise the right shape: a 3B does not emit `"targetBlockId": null`.
 *
 * Only the *model-facing* parse is relaxed. `SuggestionSchema` — the API contract, where a stored
 * row really does carry all three columns — is untouched.
 */
const ProposedSchema = SuggestionSchema.innerType()
  .omit({
    id: true,
    sourceRevisionId: true,
    status: true,
    createdAt: true,
    decidedBy: true,
    decidedAt: true,
    appliedVersionId: true,
    editedPayload: true,
  })
  .extend({
    targetDocumentId: IdSchema.nullish().transform((v) => v ?? null),
    targetStepKey: z
      .string()
      .nullish()
      .transform((v) => v ?? null),
    targetBlockId: IdSchema.nullish().transform((v) => v ?? null),
  })
  .refine((s) => s.payload.type === s.type, { message: 'payload.type must equal type' })
  /**
   * Absent-means-null is only safe if a type that *needs* a target is still refused without one.
   * The apply path resolves the target and 404s when it cannot (`needDoc` / `needStep`), so a
   * suggestion with no step key is not a worse suggestion — it is one that cannot be accepted at
   * all, and it used to be caught here only by accident, because the parse demanded all three
   * keys on every type. `RESPONSE_FORMAT` cannot express a per-type requirement; this can.
   */
  .superRefine((s, ctx) => {
    const need = (field: 'targetDocumentId' | 'targetStepKey' | 'targetBlockId') => {
      if (!s[field])
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${s.type} requires ${field}` });
    };
    if (s.type === 'update-step' || s.type === 'deprecate-step') {
      need('targetDocumentId');
      need('targetStepKey');
    }
    if (s.type === 'update-block') need('targetBlockId');
    if (s.type === 'new-step') need('targetDocumentId');
    // `new-card` creates the document and `field-alert` touches a field, so neither has a target.
  });
const EnvelopeSchema = z.object({ suggestions: z.array(ProposedSchema) });

export function parseProposals(
  text: string,
): { ok: true; items: ProposedSuggestion[] } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, ''),
    );
  } catch (e) {
    return { ok: false, error: 'invalid json: ' + (e as Error).message };
  }
  const r = EnvelopeSchema.safeParse(json);
  if (!r.success)
    return { ok: false, error: r.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ') };
  /**
   * C-M1: `EnvelopeSchema` has already validated every payload through the same union, so this
   * was dead — and it was `.parse` outside the `try`, so the one way it could ever have fired
   * was by throwing out of a function whose whole contract is to return a result object.
   * `safeParse`, reported as an error, keeps the belt without the exception.
   */
  for (const [i, s] of r.data.suggestions.entries()) {
    const p = SuggestionPayloadSchema.safeParse(s.payload);
    if (!p.success) return { ok: false, error: `suggestions.${i}.payload: ${p.error.issues[0]?.message ?? 'invalid'}` };
  }
  return { ok: true, items: r.data.suggestions as ProposedSuggestion[] };
}
