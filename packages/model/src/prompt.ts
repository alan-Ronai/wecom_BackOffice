import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { IdSchema, SuggestionPayloadSchema, SuggestionSchema, SuggestionTypeSchema } from '@wecom/shared';
import type { ProposalContext, ProposedSuggestion } from './contract.js';
import { groupSections, isNewSourcePath } from './sections.js';

/** Bump together with a new `prompts/<version>.md` file; stored on every run for reproducibility.
 * v2 (pipeline-fanout): a brand-new source is proposed as one card per SECTION, and a single
 * remote item as one card with a phase per section, instead of one card per paragraph.
 * v3 (wave 6, X1): the model is briefed. The system message is assembled from the admin's
 * company brief, the knowledge architecture, the admin's house style and these task rules, and
 * the user message carries the change's impact set and accepted examples of the same types.
 * The JSON envelope is unchanged, so nothing downstream of `parseProposals` moved. */
export const PROMPT_VERSION = 'propose-v3';
const readPrompt = (v: string) => readFileSync(fileURLToPath(new URL(`../prompts/${v}.md`, import.meta.url)), 'utf8');
export const SYSTEM_PROMPT = readPrompt(PROMPT_VERSION);

/**
 * review/wave6-ai-quality, experiment (b). `propose-v4` is v3 restructured for a 3B: the task
 * first, an ordered decision list (stop at the first rule that matches) instead of six
 * independent bullets, one compact example **per type in the flat answer shape**, and an
 * explicit "copy the key exactly" rule. The architecture brief is dropped from the system
 * message on this path — it is background a 3B cannot act on, and it was 40% of the tokens.
 */
export interface PromptOptions {
  /** `propose-v3` (shipped) or `propose-v4` (experiment b). */
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

/**
 * system = [brief] [architecture] [style] [task rules]. The brief comes first because it is the
 * one part that says *who the company is*; the task rules come last because a model weights the
 * end of a system message most and those are the rules it is graded on.
 */
function systemMessage(ctx: ProposalContext, opts: PromptOptions = {}): string {
  const version = opts.version ?? PROMPT_VERSION;
  const withArch = opts.architecture ?? version === PROMPT_VERSION;
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

/** JSON schema handed to Ollama's `format` so the model is constrained to our envelope. */
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
  const v4 = (opts.version ?? PROMPT_VERSION) !== PROMPT_VERSION;
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
  const examplesText = (ctx.examples ?? [])
    .slice(0, 3)
    .map((e, i) => `דוגמה ${i + 1} — שינוי: ${e.diff}\nהצעה מאושרת: ${JSON.stringify(e.suggestion)}`)
    .join('\n\n');
  const budget = ctx.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
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
  const size = (optional: string[]) => sys.length + [...head, ...optional, ...tail].join('\n').length;
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
  for (const s of r.data.suggestions) SuggestionPayloadSchema.parse(s.payload);
  return { ok: true, items: r.data.suggestions as ProposedSuggestion[] };
}
