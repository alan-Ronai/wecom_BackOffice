/**
 * review/wave6-ai-quality, experiment (a) — a flat, enum-typed response schema.
 *
 * Why the shipped `RESPONSE_FORMAT` cannot work on a 3B/8B:
 *
 * 1. `payload: { type: 'object' }` carries **no properties**, so llama.cpp's grammar lets the
 *    model write any object at all. Every observed failure of `03`, `04`, `06` and `07` is the
 *    model inventing a payload shape (`{"type":"deprecate-step"}` with no `reason`;
 *    `actions: [{action, duration}]` instead of `[{id, text}]`; `phases: [{stepKey, actions}]`).
 *    The discriminated union in `SuggestionPayloadSchema` is never expressed to the model.
 * 2. `targetDocumentId` / `targetStepKey` / `targetBlockId` are left out of `required`, which in
 *    a JSON-schema grammar means *skippable*. A small model always takes the shorter path, so it
 *    emitted a correct `update-step` and never named the step — five of eight cases.
 * 3. Nothing bounds the ids. The model is told "do not invent ids" in Hebrew prose and then given
 *    a `{"type":"string"}` slot; the only example in `propose-v3.md` shows `targetDocumentId:"D"`,
 *    which is not even a uuid.
 *
 * The fix is to stop asking prose to do a grammar's job. This builds the schema **per context**:
 * every id slot is an `enum` of the ids that actually appear in `linkedSteps`/`blocks` (plus `""`
 * for "none"), every slot is `required`, and the payload is flattened into one set of scalar /
 * string-array fields that the same six types share. `toPayload` re-inflates the discriminated
 * union in code, where a `for` loop is cheaper and more reliable than a grammar.
 */
import type { SuggestionPayload } from '@wecom/shared';
import { SuggestionTypeSchema } from '@wecom/shared';
import type { ProposalContext, ProposedSuggestion } from './contract.js';
import { confidenceFor } from './calibration.js';

/** "" is the enum's "no target": a JSON-schema enum cannot hold `null` in every Ollama build. */
const NONE = '';

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

export interface FlatCandidates {
  documentIds: string[];
  stepKeys: string[];
  blockIds: string[];
  fieldNames: string[];
}

export const candidatesOf = (ctx: ProposalContext): FlatCandidates => ({
  documentIds: uniq(ctx.linkedSteps.map((s) => s.documentId)),
  stepKeys: uniq(ctx.linkedSteps.map((s) => s.stepKey)),
  blockIds: uniq([...ctx.blocks.map((b) => b.id), ...ctx.linkedSteps.map((s) => s.blockId ?? '')]),
  fieldNames: uniq(ctx.fields.map((f) => f.name)),
});

/**
 * The Ollama `format` for one context. Flat, fully `required`, every identifier an `enum`.
 *
 * `actions` carries the type's action list whatever the type is (`addActions` for an
 * `update-step`, the full replacement list for an `update-block`, the step list for a
 * `new-card`): one name the model has to learn instead of six.
 */
export function flatResponseFormat(ctx: ProposalContext): Record<string, unknown> {
  const c = candidatesOf(ctx);
  const idEnum = (values: string[]) => ({ type: 'string', enum: [...values, NONE] });
  return {
    type: 'object',
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'anchor',
            'type',
            'title',
            'targetDocumentId',
            'targetStepKey',
            'targetBlockId',
            'actions',
            'rationale',
          ],
          properties: {
            anchor: { type: 'string' },
            type: { type: 'string', enum: SuggestionTypeSchema.options },
            title: { type: 'string' },
            targetDocumentId: idEnum(c.documentIds),
            targetStepKey: idEnum(c.stepKeys),
            targetBlockId: idEnum(c.blockIds),
            /** update-step: the new instructions. update-block/new-card/new-step: the full list. */
            actions: { type: 'array', items: { type: 'string' } },
            /** deprecate-step only. */
            reason: { type: 'string' },
            /** field-alert only. */
            fieldName: { type: 'string', enum: [...c.fieldNames, NONE] },
            issue: { type: 'string', enum: ['unknown', 'renamed', 'retired', NONE] },
            /** new-step only: the step it goes after. */
            afterStepKey: idEnum(c.stepKeys),
            rationale: { type: 'string' },
          },
        },
      },
    },
  };
}

interface FlatSuggestion {
  anchor?: unknown;
  type?: unknown;
  title?: unknown;
  targetDocumentId?: unknown;
  targetStepKey?: unknown;
  targetBlockId?: unknown;
  actions?: unknown;
  reason?: unknown;
  fieldName?: unknown;
  issue?: unknown;
  afterStepKey?: unknown;
  rationale?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const orNull = (v: unknown): string | null => str(v) || null;

const categoryOf = (text: string) =>
  /חו"ל|נדידה/.test(text)
    ? 'intl'
    : /חיוב|חשבונית/.test(text)
      ? 'billing'
      : /שימור|נטישה/.test(text)
        ? 'ops'
        : 'tech';

const MAX_TITLE = 48;
const shortTitle = (t: string) =>
  t.replace(/\s+/g, ' ').replace(/[.:]$/, '').trim().slice(0, MAX_TITLE - 1) +
  (t.length >= MAX_TITLE ? '…' : '');

/**
 * Re-inflates the discriminated union from the flat answer. This is the half of the contract the
 * grammar is bad at and a function is good at: defaults, ids, outcome chaining and the step
 * scaffolding a `new-card` needs are all derivable, so the model never has to emit them.
 */
function toPayload(f: FlatSuggestion, type: string): SuggestionPayload | null {
  const actions = strs(f.actions);
  switch (type) {
    case 'update-step':
      return { type: 'update-step', addActions: actions, patch: {} };
    case 'deprecate-step': {
      const reason = str(f.reason) || str(f.title);
      return reason ? { type: 'deprecate-step', reason } : null;
    }
    case 'update-block':
      return actions.length
        ? { type: 'update-block', actions: actions.map((t, i) => ({ id: 'b' + (i + 1), text: t })) }
        : null;
    case 'field-alert': {
      const fieldName = str(f.fieldName);
      const issue = str(f.issue);
      return fieldName && (issue === 'unknown' || issue === 'renamed' || issue === 'retired')
        ? { type: 'field-alert', fieldName, issue }
        : null;
    }
    case 'new-step':
      return actions.length
        ? {
            type: 'new-step',
            afterStepKey: orNull(f.afterStepKey),
            title: shortTitle(str(f.title) || actions[0]),
            actions,
            outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }],
          }
        : null;
    case 'new-card': {
      if (!actions.length) return null;
      const title = str(f.title) || shortTitle(actions[0]);
      return {
        type: 'new-card',
        title,
        description: actions.join(' ').slice(0, 120),
        category: categoryOf(actions.join(' ')),
        wave: 2,
        priority: 'm',
        phases: [
          {
            id: 'p1',
            label: 'שלבי הטיפול',
            steps: actions.map((a, i) => ({
              key: 's' + (i + 1),
              num: String(i + 1),
              title: shortTitle(a),
              actions: [{ id: 'a1', text: a }],
              outcomes:
                i === actions.length - 1
                  ? [{ kind: 'ok' as const, text: '✓ הסתדר – סיום' }]
                  : [{ kind: 'next' as const, text: '→ המשך לשלב ' + (i + 2), goto: 's' + (i + 2) }],
              blockRefs: [],
              deps: [],
            })),
          },
        ],
      };
    }
    default:
      return null;
  }
}

/**
 * The per-type target rule of `prompt.ts`'s `superRefine`, applied here too — an `update-step`
 * with no step key cannot be accepted by the apply path, so it is not a suggestion.
 */
const targetsOk = (s: ProposedSuggestion): boolean => {
  if (s.type === 'update-step' || s.type === 'deprecate-step')
    return !!s.targetDocumentId && !!s.targetStepKey;
  if (s.type === 'update-block') return !!s.targetBlockId;
  if (s.type === 'new-step') return !!s.targetDocumentId;
  return true;
};

/**
 * Parses a flat answer into `ProposedSuggestion[]`. Unlike `parseProposals` this is
 * **per-suggestion tolerant**: one malformed entry in a five-suggestion answer drops that entry
 * instead of failing the whole revision back to the rule engine. `errors` reports what was
 * dropped so the harness can still count it.
 */
export function parseFlatProposals(
  ctx: ProposalContext,
  text: string,
): { ok: true; items: ProposedSuggestion[]; errors: string[] } | { ok: false; error: string } {
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
  const raw = (json as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(raw)) return { ok: false, error: 'suggestions: expected an array' };
  const c = candidatesOf(ctx);
  const items: ProposedSuggestion[] = [];
  const errors: string[] = [];
  for (const [i, entry] of raw.entries()) {
    const f = entry as FlatSuggestion;
    const type = str(f.type);
    if (!SuggestionTypeSchema.options.includes(type as never)) {
      errors.push(`${i}: unknown type ${JSON.stringify(type)}`);
      continue;
    }
    const payload = toPayload(f, type);
    if (!payload) {
      errors.push(`${i}: ${type} payload could not be built`);
      continue;
    }
    // An id outside the candidate list is a hallucination whatever the grammar allowed.
    const pick = (v: unknown, allowed: string[]) => {
      const s = str(v);
      return s && allowed.includes(s) ? s : null;
    };
    const s: ProposedSuggestion = {
      anchor: str(f.anchor) || '§?',
      type: type as ProposedSuggestion['type'],
      title: str(f.title) || payload.type,
      targetDocumentId: pick(f.targetDocumentId, c.documentIds),
      targetStepKey: pick(f.targetStepKey, c.stepKeys),
      targetBlockId: pick(f.targetBlockId, c.blockIds),
      payload,
      confidence: confidenceFor(type as ProposedSuggestion['type']),
      rationale: str(f.rationale),
    };
    /**
     * A `update-block` the model aimed at a step is still aimed at that step: the block is the
     * thing being edited, the step is where the editor sees it. `rules.ts` fills all three for
     * exactly this reason, and the eval's `04` expectation asserts on the document and the step.
     */
    if (s.type === 'update-block' && s.targetBlockId && (!s.targetDocumentId || !s.targetStepKey)) {
      const via = ctx.linkedSteps.find((l) => l.blockId === s.targetBlockId);
      if (via) {
        s.targetDocumentId ??= via.documentId;
        s.targetStepKey ??= via.stepKey;
      }
    }
    if (!targetsOk(s)) {
      errors.push(`${i}: ${type} is missing a required target`);
      continue;
    }
    items.push(s);
  }
  if (!items.length && errors.length) return { ok: false, error: errors.join('; ') };
  return { ok: true, items, errors };
}
