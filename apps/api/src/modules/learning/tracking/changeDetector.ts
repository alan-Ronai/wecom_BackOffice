import { detectFieldRefs, type Block, type Document, type Step } from '@wecom/shared';
import { allSteps, diffDocuments } from '../../documents/diff.js';

export interface ChangeDetection {
  significant: boolean;
  reasons: string[];
}

const outcomeSig = (s: Step) => JSON.stringify(s.outcomes.map((o) => [o.kind, o.text, o.goto ?? null]));
const branchSig = (s: Step) =>
  s.branch
    ? JSON.stringify([s.branch.q, s.branch.options.map((o) => [o.kind, o.label, o.text, o.goto ?? null])])
    : '';
const fieldSig = (doc: Document, fieldNames: string[], blocks: Map<string, Block>) =>
  new Set(detectFieldRefs(doc, fieldNames, blocks).map((r) => r.stepKey + '|' + r.fieldName));

/**
 * Spec §1.5: a publish is "significant" when it changes what an agent must *do* — an outcome,
 * a branch, a CRM field, a removed step — or when more than 40% of the steps changed at all.
 * Text-only edits to actions/titles below that threshold are not significant.
 */
export function detectSignificantChange(
  before: Document,
  after: Document,
  blocks: Map<string, Block>,
  fieldNames: string[],
): ChangeDetection {
  const reasons: string[] = [];
  const B = new Map(allSteps(before).map((s) => [s.key, s]));
  const A = new Map(allSteps(after).map((s) => [s.key, s]));

  for (const [key, s] of B) if (!A.has(key)) reasons.push(`שלב הוסר: ${s.num}`);
  for (const [key, n] of A) {
    const o = B.get(key);
    if (!o) continue;
    if (outcomeSig(o) !== outcomeSig(n)) reasons.push(`תוצאה השתנתה בשלב ${n.num}`);
    if (branchSig(o) !== branchSig(n)) reasons.push(`הסתעפות השתנתה בשלב ${n.num}`);
  }

  const fb = fieldSig(before, fieldNames, blocks);
  const fa = fieldSig(after, fieldNames, blocks);
  const changedFields = new Set<string>();
  for (const x of fb) if (!fa.has(x)) changedFields.add(x.split('|')[1]);
  for (const x of fa) if (!fb.has(x)) changedFields.add(x.split('|')[1]);
  for (const f of changedFields) reasons.push(`שדה CRM השתנה: ${f}`);

  const rows = diffDocuments(before, after, blocks);
  const total = Math.max(B.size, A.size, 1);
  const touched = rows.filter((r) => r.kind !== 'same').length;
  if (touched / total > 0.4) reasons.push('יותר מ-40% מהשלבים השתנו');

  return { significant: reasons.length > 0, reasons };
}
