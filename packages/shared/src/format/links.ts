import type { Block, Document, DocumentLink, Step } from '../schemas/index.js';
import { crmIn } from './bidi.js';
import type { DocRef } from './bidi.js';

const CODE_RE = /\b([RMOE]-\d{2}|T-\d{2})\b/g;
const LINK_RE = /\[\[doc:([\w-]+)/g;

export function stepText(step: Step, block?: Block | null): string {
  const actions = block?.actions ?? step.actions;
  const script = step.script ?? block?.script ?? '';
  const parts = [step.title, step.description ?? '', ...actions.map((a) => a.text), script];
  if (step.branch) parts.push(step.branch.q, ...step.branch.options.map((o) => o.label + ' ' + o.text));
  parts.push(...step.outcomes.map((o) => o.text));
  const ex = step.extras;
  if (ex) {
    (ex.stages ?? []).forEach((st) => parts.push(st.label, st.script ?? '', ...(st.actions ?? [])));
    (ex.signals ?? []).forEach((g) => parts.push(...g.items));
    if (ex.objection) parts.push(ex.objection.q, ex.objection.a);
    parts.push(...(ex.principles ?? []), ...(ex.pillars ?? []).map((p) => p.label + ' ' + p.text));
  }
  return parts.filter(Boolean).join(' · ');
}

const allSteps = (doc: Document): Step[] => doc.phases.flatMap((p) => p.steps);

export function detectFieldRefs(doc: Document, fieldNames: string[], blocks: Map<string, Block>) {
  const out: { stepKey: string; fieldName: string }[] = [];
  for (const s of allSteps(doc))
    for (const f of crmIn(stepText(s, s.blockId ? blocks.get(s.blockId) : null), fieldNames))
      out.push({ stepKey: s.key, fieldName: f });
  return out;
}

export function detectLinks(doc: Document, docs: DocRef[], blocks: Map<string, Block>): DocumentLink[] {
  const out: DocumentLink[] = [];
  const base = {
    fromDocumentId: doc.id,
    toBlockId: null,
    toFieldName: null,
    toSourceId: null,
    origin: 'detected' as const,
  };
  for (const s of allSteps(doc)) {
    const t = stepText(s, s.blockId ? blocks.get(s.blockId) : null);
    const seen = new Set<string>();
    for (const m of t.matchAll(LINK_RE))
      if (m[1] !== doc.id && docs.some((d) => d.id === m[1])) seen.add(m[1]);
    for (const m of t.matchAll(CODE_RE)) {
      const d = docs.find((x) => x.code === m[1]);
      if (d && d.id !== doc.id) seen.add(d.id);
    }
    for (const id of seen) out.push({ ...base, fromStepKey: s.key, toDocumentId: id, type: 'link' });
    if (s.blockId)
      out.push({
        ...base,
        fromStepKey: s.key,
        toDocumentId: null,
        toBlockId: s.blockId,
        type: 'shares_block',
      });
  }
  for (const r of doc.related)
    if (r.documentId !== doc.id)
      out.push({
        ...base,
        fromStepKey: null,
        toDocumentId: r.documentId,
        type: 'related',
        origin: 'explicit',
      });
  return out;
}
