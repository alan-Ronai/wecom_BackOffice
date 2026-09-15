/**
 * Wave 6 (X2) — turning a model's rewrite into anchored hunks, and anchored hunks back into
 * HTML. Both halves are pure; the write path that uses them lives in `routes.ts` and goes
 * through `saveSourceDocument` like any other source save (spec §1.3).
 *
 * The anchor is a `htmlToParagraphs` ref — heading path plus index — never a DOM id, because
 * `sanitizeHtml` strips `id` attributes and there would be nothing in the stored document to
 * look one up by. Every op carries `before`, the anchor paragraph's text at proposal time, so
 * the overlay can render a real diff and `applyOps` can refuse a hunk whose text moved under it.
 */
import {
  applyParagraphEdits,
  normalizeText,
  paragraphRefs,
  paragraphText,
  sanitizeHtml,
  type Paragraph,
  type ParagraphEdit,
  type ProposedEditOp,
} from '@wecom/shared';
import { httpError } from '../../lib/http.js';

export interface ProposedParagraph {
  ref: string;
  text: string;
}

const same = (a: string, b: string): boolean => normalizeText(a) === normalizeText(b);

/**
 * Pair the model's paragraphs against the current ones by ref.
 *
 * A ref present in both with different text is a `replace`. A ref the model invented (it was
 * asked to keep `§ref` prefixes, so anything else is new text) is an `insert` after the last
 * real ref it echoed. A ref that has *gone* is a `delete` — but only when `scope` named it:
 * outside an explicit scope, a model that simply did not echo a paragraph has not asked for it
 * to be deleted, and reading it that way would let one lazy answer empty a document.
 */
export function diffToOps(
  current: readonly Paragraph[],
  proposed: readonly ProposedParagraph[],
  scope?: readonly string[],
): ProposedEditOp[] {
  const currentText = new Map(current.map((p) => [p.ref, paragraphText(p)]));
  const proposedByRef = new Map<string, string>();
  for (const p of proposed) if (currentText.has(p.ref)) proposedByRef.set(p.ref, p.text);
  const inScope = (ref: string) => !scope || scope.includes(ref);

  const ops: Omit<ProposedEditOp, 'id'>[] = [];
  for (const p of current) {
    if (!inScope(p.ref)) continue;
    const before = currentText.get(p.ref)!;
    const after = proposedByRef.get(p.ref);
    if (after === undefined) {
      if (scope) ops.push({ anchor: p.ref, kind: 'delete', before, after: '' });
      continue;
    }
    if (!same(before, after)) ops.push({ anchor: p.ref, kind: 'replace', before, after });
  }

  let anchor: string | null = null;
  for (const p of proposed) {
    if (currentText.has(p.ref)) {
      anchor = p.ref;
      continue;
    }
    if (!p.text.trim()) continue;
    const at = anchor ?? current[current.length - 1]?.ref;
    if (!at) continue; // nothing to anchor to; an empty source is not edited by chat
    ops.push({ anchor: at, kind: 'insert', before: currentText.get(at) ?? '', after: p.text });
  }
  return ops.map((op, i) => ({ id: `op-${i + 1}`, ...op }));
}

/**
 * Apply the ops to the live HTML. Throws `AI_EDIT_ANCHOR` when a hunk's `before` no longer
 * matches the anchor paragraph: the source moved between the proposal and the click, and
 * applying the hunk anyway would silently overwrite somebody's edit.
 */
export function applyOps(html: string, ops: readonly ProposedEditOp[]): string {
  const byRef = new Map(paragraphRefs(html).map((p) => [p.ref, p.text]));
  const edits: ParagraphEdit[] = [];
  for (const op of ops) {
    const current = byRef.get(op.anchor);
    if (current === undefined || !same(current, op.before))
      throw httpError(409, 'AI_EDIT_ANCHOR', `העריכה המוצעת אינה מתאימה עוד לטקסט במסמך (${op.anchor})`);
    edits.push({ ref: op.anchor, kind: op.kind, text: op.after });
  }
  return sanitizeHtml(applyParagraphEdits(html, edits));
}

/**
 * Which ops a decision applies. `'all'` on either side means the whole set, and a reject wins
 * over an accept for the same id — "I said no" is the safer reading of a contradictory body.
 */
export function acceptedOps(
  ops: readonly ProposedEditOp[],
  body: { accept: string[] | 'all'; reject: string[] | 'all' },
): ProposedEditOp[] {
  if (body.reject === 'all') return [];
  const rejected = new Set(body.reject);
  const accepted = body.accept === 'all' ? ops.map((o) => o.id) : body.accept;
  const wanted = new Set(accepted);
  return ops.filter((o) => wanted.has(o.id) && !rejected.has(o.id));
}

export const decisionStatus = (
  ops: readonly ProposedEditOp[],
  applied: readonly ProposedEditOp[],
): 'accepted' | 'rejected' | 'partially_accepted' =>
  applied.length === 0 ? 'rejected' : applied.length === ops.length ? 'accepted' : 'partially_accepted';
