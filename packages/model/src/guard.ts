/**
 * review/wave6-ai-quality, experiment (e) — deterministic guards over whatever the model said.
 *
 * (a) and (b) took hit-target to 1.000, but two of the six types stayed wrong under every prompt
 * and under two-stage classification as well: `04` (a step backed by a shared block) and `05` (a
 * renamed CRM field) come back as `update-step`. Experiment (c) proved that is not task crowding
 * — a call whose *only* job is the classification still gets those two wrong.
 *
 * Both are decidable from the context without reading the Hebrew:
 *
 * - The linked step either carries a `blockId` or it does not. If it does, the spec says the
 *   change belongs in the block (§1.7, `architecture-v1.md`). That is not a judgement.
 * - The source either quotes a CRM field name that is in the known list and replaces it with one
 *   that is not, or it does not. `rules.ts` never detects this at all — the X1 report lists it as
 *   one of the rule engine's three real limits.
 *
 * So the model is left to do what it is actually good at — writing the Hebrew instruction and the
 * rationale — and the two structural decisions are taken in code, which is free, deterministic
 * and cannot code-switch into Chinese halfway through (observed: see the review's raw outputs).
 */
import type { ProposalContext, ProposedSuggestion } from './contract.js';
import { confidenceFor } from './calibration.js';
import { materialDiffs } from './material.js';

const stripRef = (r: string) => r.replace(/^§/, '');

/**
 * An `update-step` aimed at a step that is embedded from a shared block is an `update-block`.
 *
 * The model's `actions` for an `update-step` are the *new* instructions only, while an
 * `update-block` replaces the block's whole list — so the block's existing actions lead and the
 * model's new ones are appended, unless the model already returned a list at least as long as
 * the block's, in which case it answered with the full list and that is used as-is.
 */
export function coerceBlockUpdates(ctx: ProposalContext, items: ProposedSuggestion[]): ProposedSuggestion[] {
  return items.map((s) => {
    if (s.type !== 'update-step' || s.payload.type !== 'update-step') return s;
    const step = ctx.linkedSteps.find(
      (l) => l.documentId === s.targetDocumentId && l.stepKey === s.targetStepKey,
    );
    const blockId = step?.blockId ?? (s.targetBlockId || undefined);
    if (!blockId) return s;
    const block = ctx.blocks.find((b) => b.id === blockId);
    if (!block) return s;
    const proposed = s.payload.addActions;
    const texts = proposed.length >= block.actions.length ? proposed : [...block.actions, ...proposed];
    return {
      ...s,
      type: 'update-block',
      targetBlockId: blockId,
      payload: {
        type: 'update-block',
        actions: texts.map((t, i) => ({ id: 'b' + (i + 1), text: t })),
      },
      confidence: confidenceFor('update-block', s.confidence),
      rationale: s.rationale.includes(block.title)
        ? s.rationale
        : `הפסקה ממופה לבלוק המשותף "${block.title}"; ` + s.rationale,
    } satisfies ProposedSuggestion;
  });
}

/** Every `"…"` / «…» / '…' run in a paragraph — how both the docx and the WordPress sources quote a field. */
const QUOTED = /["«'׳"]([^"«»'׳"]{2,60})["»'׳"]/g;
const quoted = (text: string): string[] => [...text.matchAll(QUOTED)].map((m) => m[1].trim());
/**
 * A CRM field name, as against a quoted *value*. Every field in the platform is a latin
 * identifier (`sim block lbl`, `billing hold`); a quoted `"לא חסום"` or `"כן"` is what the agent
 * is asked to type into it. Requiring latin is what stops every quoted value being reported as
 * an unknown field.
 */
const FIELDISH = /^[A-Za-z][A-Za-z0-9 _.-]{2,}$/;

/**
 * A CRM field the source renamed: a known field name is quoted in `before`, and `after` quotes a
 * name in its place that is not in the known list. Emitted **in addition to** whatever the model
 * proposed for that paragraph — the instruction still has to change *and* somebody has to decide
 * whether the CRM field was really renamed, and those are two different decisions for two
 * different people.
 */
export function detectFieldAlerts(ctx: ProposalContext, items: ProposedSuggestion[]): ProposedSuggestion[] {
  const known = new Set(ctx.fields.map((f) => f.name.toLowerCase()));
  if (!known.size) return items;
  const out: ProposedSuggestion[] = [];
  const raised = new Set(
    items
      .filter((s) => s.payload.type === 'field-alert')
      .map((s) => (s.payload as { fieldName: string }).fieldName.toLowerCase()),
  );
  const add = (
    d: { ref: string },
    fieldName: string,
    issue: 'renamed' | 'unknown',
    title: string,
    why: string,
  ) => {
    if (raised.has(fieldName.toLowerCase())) return;
    raised.add(fieldName.toLowerCase());
    const step = ctx.linkedSteps.find((l) => stripRef(l.anchor) === stripRef(d.ref));
    out.push({
      anchor: '§' + stripRef(d.ref),
      type: 'field-alert',
      title,
      targetDocumentId: step?.documentId ?? null,
      targetStepKey: step?.stepKey ?? null,
      targetBlockId: null,
      payload: { type: 'field-alert', fieldName, issue },
      confidence: confidenceFor('field-alert'),
      rationale: why,
    });
  };
  for (const d of ctx.diffs) {
    if (d.kind !== 'changed' || !d.before || !d.after) continue;
    const beforeQ = quoted(d.before);
    const afterQ = quoted(d.after);
    const oldField = beforeQ.find((q) => known.has(q.toLowerCase()) && !afterQ.includes(q));
    const newField = afterQ.find(
      (q) => !known.has(q.toLowerCase()) && !beforeQ.includes(q) && FIELDISH.test(q),
    );
    if (oldField && newField) {
      const usedBy = ctx.impact?.fields.find((f) => f.name === oldField)?.usedBy;
      add(
        d,
        oldField,
        'renamed',
        `שדה CRM שונה: ${oldField} → ${newField}`,
        `המקור מפנה ל"${newField}" במקום ל"${oldField}", שאינו ברשימת שדות ה-CRM המוכרים` +
          (usedBy ? ` ומשמש ב-${usedBy} מסמכים` : '') +
          '.',
      );
      continue;
    }
    /**
     * `issue: 'unknown'` — the source names a CRM field nobody has heard of, without replacing
     * one that exists. The rename branch above cannot see it (no known name left the paragraph),
     * and it is the more common case in practice: a new field is added to a procedure before
     * anyone tells the knowledge platform it exists.
     */
    if (newField)
      add(
        d,
        newField,
        'unknown',
        `שדה CRM לא מוכר: ${newField}`,
        `הפסקה מפנה לשדה "${newField}" שאינו מופיע ברשימת שדות ה-CRM המוכרים; יש לאשר שהשדה קיים לפני שהשלב מפנה אליו.`,
      );
  }
  return [...items, ...out];
}

/**
 * A suggestion about a paragraph that did not materially change.
 *
 * `buildMessages` shows the model only `materialDiffs`, so an answer anchored anywhere else is
 * about something the model was not shown — it re-read the source text in the linked-steps block
 * and proposed on that. Measured over the six negative cases: `aya-expanse:8b` proposed on all
 * six and `qwen2.5:3b` on one, in every run, however plainly the prompt asks for `[]`. Telling
 * the model again is not a fix; the pipeline already knows which paragraphs changed.
 *
 * Kept deliberately narrow — the anchor has to match nothing at all in the material set. A
 * suggestion on a real change with a mistyped anchor is still a real suggestion and survives via
 * the `§`-insensitive compare.
 */
export function dropUnanchored(ctx: ProposalContext, items: ProposedSuggestion[]): ProposedSuggestion[] {
  const material = new Set(materialDiffs(ctx.diffs).map((d) => stripRef(d.ref)));
  if (!material.size) return [];
  return items.filter((s) => material.has(stripRef(s.anchor)));
}

/**
 * Every guard, in the order the pipeline needs them: drop what was invented, move a step edit
 * into its shared block, then look for field renames. (The missing-id back-fill happens earlier,
 * inside `parseFlatProposals`, because the parse would otherwise have discarded the suggestion
 * before a guard could see it.)
 *
 * Run with `items: []` this is still useful: `detectFieldAlerts` needs no model at all, so a
 * revision whose model answer was unusable keeps the suggestions the context alone can prove.
 */
export const applyGuards = (ctx: ProposalContext, items: ProposedSuggestion[]): ProposedSuggestion[] =>
  detectFieldAlerts(ctx, coerceBlockUpdates(ctx, dropUnanchored(ctx, items)));
