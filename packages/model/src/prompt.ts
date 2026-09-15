import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SuggestionPayloadSchema, SuggestionSchema, SuggestionTypeSchema } from '@wecom/shared';
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
const promptPath = fileURLToPath(new URL(`../prompts/${PROMPT_VERSION}.md`, import.meta.url));
export const SYSTEM_PROMPT = readFileSync(promptPath, 'utf8');

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
function systemMessage(ctx: ProposalContext): string {
  return [
    ctx.brief?.trim(),
    ARCHITECTURE_PROMPT.trim(),
    ctx.style?.trim() ? 'סגנון הבית:\n' + ctx.style.trim() : '',
    SYSTEM_PROMPT.trim(),
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

export function buildMessages(ctx: ProposalContext): { role: 'system' | 'user'; content: string }[] {
  const diffs = ctx.diffs
    .filter((d) => d.kind !== 'same')
    .map(
      (d) =>
        `- §${stripAnchor(d.ref)} ${d.kind}: לפני: ${JSON.stringify(d.before ?? '')} אחרי: ${JSON.stringify(d.after ?? '')}`,
    )
    .join('\n');
  const steps = ctx.linkedSteps
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
  const sys = systemMessage(ctx);
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
    'שלבים ממופים (linkedSteps):',
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
  const withExamples = examplesText
    ? ['', 'דוגמאות מאושרות (שמור על אותה רמת פירוט):', examplesText]
    : [];
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
  .refine((s) => s.payload.type === s.type, { message: 'payload.type must equal type' });
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
