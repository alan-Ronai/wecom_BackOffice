import { similarity } from '@wecom/shared';
import type { ModelClient, ProposalContext, ProposedSuggestion } from './contract.js';

const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 2);
const anchorOf = (ref: string) => (ref.startsWith('§') ? ref : '§' + ref);
const stripRef = (ref: string) => ref.replace(/^§/, '');

/** A near-similarity threshold below which an "after" sentence with no exact "before"
 * match is still treated as a lightly-edited existing sentence (e.g. a changed number)
 * rather than genuinely new content. */
const NEW_SENTENCE_MAX_SIMILARITY = 0.5;

/** Sentences in `after` with no exact match in `before` and no near-duplicate either
 * (so a sentence that only swapped a word/number, like a changed threshold, is not
 * reported as newly added content). */
const addedSentences = (before: string, after: string): string[] => {
  const beforeSentences = sentences(before);
  const beforeSet = new Set(beforeSentences);
  return sentences(after).filter((s) => {
    if (beforeSet.has(s)) return false;
    return beforeSentences.every((b) => similarity(s, b) < NEW_SENTENCE_MAX_SIMILARITY);
  });
};

/** Deterministic fallback: no language model, only alignment + heuristics. */
export class RuleBasedModel implements ModelClient {
  name = 'rules';
  async available() { return true; }
  async proposeChanges(ctx: ProposalContext): Promise<ProposedSuggestion[]> {
    const out: ProposedSuggestion[] = [];
    for (const d of ctx.diffs) {
      if (d.kind === 'same') continue;
      const linked = ctx.linkedSteps.filter((s) => stripRef(s.anchor) === stripRef(d.ref));
      const anchor = anchorOf(d.ref);
      if (d.kind === 'removed' && linked.length) {
        for (const s of linked) out.push({ anchor, type: 'deprecate-step', title: 'הוצאה משימוש: ' + s.stepTitle, targetDocumentId: s.documentId, targetStepKey: s.stepKey, targetBlockId: null, payload: { type: 'deprecate-step', reason: 'הפסקה ' + d.ref + ' נמחקה במסמך המקור' }, confidence: 0.7, rationale: 'הפסקה נמחקה במקור.' });
        continue;
      }
      if (d.kind === 'added' || !linked.length) {
        const after = d.after ?? ''; const ss = sentences(after); const title = (ss[0] ?? after).replace(/[.:]$/, '').slice(0, 80);
        const steps = (ss.length > 1 ? ss.slice(1) : ss).slice(0, 8).map((s, i, arr) => ({ key: 's' + (i + 1), num: String(i + 1), title: s.length > 48 ? s.slice(0, 45) + '…' : s, actions: [{ id: 'a1', text: s }], outcomes: i === arr.length - 1 ? [{ kind: 'ok' as const, text: '✓ הסתדר – סיום' }] : [{ kind: 'next' as const, text: '→ המשך לשלב ' + (i + 2), goto: 's' + (i + 2) }], blockRefs: [], deps: [], sourceRef: anchor }));
        out.push({ anchor, type: 'new-card', title, targetDocumentId: null, targetStepKey: null, targetBlockId: null,
          payload: { type: 'new-card', title, description: after.slice(0, 120), category: /חו"ל|נדידה/.test(after) ? 'intl' : /חיוב|חשבונית/.test(after) ? 'billing' : /שימור|נטישה/.test(after) ? 'ops' : 'tech', wave: 2, priority: 'm', phases: [{ id: 'p1', label: 'שלבי הטיפול', steps }] },
          confidence: Math.min(0.85, 0.5 + steps.length * 0.05), rationale: 'פסקה חדשה ' + d.ref + ' ללא שלב מקושר.' });
        continue;
      }
      // changed + linked
      const added = addedSentences(d.before ?? '', d.after ?? '');
      for (const s of linked) {
        if (s.blockId) {
          const b = ctx.blocks.find((x) => x.id === s.blockId);
          if (!b) continue;
          const actions = b.actions.map((t, i) => ({ id: 'b' + (i + 1), text: t }));
          if (added.length) actions[actions.length - 1] = { ...actions[actions.length - 1], text: actions[actions.length - 1].text + ' ' + added.join(' ') };
          out.push({ anchor, type: 'update-block', title: b.title + ': ' + (added[0] ?? 'עדכון'), targetDocumentId: s.documentId, targetStepKey: s.stepKey, targetBlockId: s.blockId, payload: { type: 'update-block', actions }, confidence: 0.75, rationale: 'הפסקה ממופה לבלוק משותף "' + b.title + '".' });
        } else {
          out.push({ anchor, type: 'update-step', title: s.stepTitle + ': ' + (added[0] ?? 'שינוי ניסוח'), targetDocumentId: s.documentId, targetStepKey: s.stepKey, targetBlockId: null, payload: { type: 'update-step', addActions: added, patch: {} }, confidence: added.length ? 0.8 : 0.55, rationale: 'הפסקה ' + d.ref + ' שונתה; משפיע על שלב ' + s.stepNum + ' ב"' + s.documentTitle + '".' });
        }
      }
    }
    return out;
  }
}
