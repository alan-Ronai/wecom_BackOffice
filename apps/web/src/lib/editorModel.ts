import type { Block, CrmField, Document, Phase, Step } from '@wecom/shared';
import { crmIn, stepText } from '@wecom/shared';
import { allSteps } from './steps.js';

export type CheckLevel = 'ok' | 'warn' | 'bad';
export type Check = [CheckLevel, string];
export type BasicType = 'step' | 'branch' | 'outcomes' | 'script' | 'description';

let seq = 0;
export const uid = (p: string): string =>
  `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const newStep = (num: number | string): Step => ({
  key: uid('s'),
  num: String(num),
  title: '',
  blockRefs: [],
  deps: [],
  actions: [{ id: uid('a'), text: '' }],
  outcomes: [],
});

const clone = (doc: Document): Document => structuredClone(doc);
const phaseOf = (doc: Document, key: string): Phase | undefined =>
  doc.phases.find((p) => p.steps.some((s) => s.key === key));

/** Sequential display numbers; steps numbered with a Hebrew letter (1א) keep theirs. */
export function renumber(doc: Document): Document {
  const next = clone(doc);
  let n = 1;
  next.phases.forEach((p) =>
    p.steps.forEach((s) => {
      if (!/[א-ת]/.test(s.num)) s.num = String(n++);
    }),
  );
  return next;
}

/** Adds a basic building block, after `targetKey` when given (legacy addBasic). */
export function addBasic(
  doc: Document,
  type: BasicType,
  targetKey: string | null,
  selectedKey: string | null,
): Document {
  const next = clone(doc);
  const anchor = targetKey ?? selectedKey;
  if (type === 'step') {
    const p = (anchor ? phaseOf(next, anchor) : undefined) ?? next.phases[next.phases.length - 1];
    if (!p) {
      next.phases.push({ id: uid('p'), label: 'שלבי הטיפול', steps: [newStep(1)] });
      return renumber(next);
    }
    const i = anchor ? p.steps.findIndex((s) => s.key === anchor) + 1 : p.steps.length;
    p.steps.splice(i, 0, newStep(allSteps(next).length + 1));
    return renumber(next);
  }
  const s = anchor ? allSteps(next).find((x) => x.key === anchor) : undefined;
  const target = s
    ? next.phases.flatMap((p) => p.steps).find((x) => x.key === s.key)
    : next.phases.at(-1)?.steps.at(-1);
  if (!target) return addBasic(next, 'step', null, null);
  if (type === 'branch')
    target.branch = target.branch ?? {
      q: 'מה מוצג?',
      options: [
        { kind: 'if', label: '', text: '' },
        { kind: 'then', label: '', text: '' },
      ],
    };
  if (type === 'outcomes')
    target.outcomes = target.outcomes.length
      ? target.outcomes
      : [
          { kind: 'ok', text: '✓ הסתדר – סיום' },
          { kind: 'next', text: '→ לא הסתדר – המשך' },
        ];
  if (type === 'script') target.script = target.script ?? '"…"';
  if (type === 'description') target.description = target.description ?? '';
  return next;
}

/** Embeds a shared block: into an empty target step, otherwise as a new step (legacy addShared). */
export function addShared(doc: Document, block: Block, targetKey: string | null): Document {
  const next = clone(doc);
  const target = targetKey ? next.phases.flatMap((p) => p.steps).find((s) => s.key === targetKey) : undefined;
  if (target && !target.blockId) {
    target.blockId = block.id;
    target.actions = [];
    target.title = target.title || block.title;
    return next;
  }
  const p = next.phases[next.phases.length - 1];
  if (!p) return next;
  p.steps.push({
    key: uid('s'),
    num: String(allSteps(next).length + 1),
    title: block.title,
    blockId: block.id,
    blockRefs: [],
    deps: [],
    actions: [],
    outcomes: structuredClone(block.outcomes),
  });
  return renumber(next);
}

export function addAction(doc: Document, key: string | null, text: string): Document {
  const next = clone(doc);
  const target = key
    ? next.phases.flatMap((p) => p.steps).find((s) => s.key === key)
    : next.phases.at(-1)?.steps.at(-1);
  if (!target || target.blockId) return doc;
  target.actions = [...target.actions, { id: uid('a'), text }];
  return next;
}

export function moveStep(doc: Document, key: string, dir: number): Document {
  const next = clone(doc);
  const p = phaseOf(next, key);
  if (!p) return doc;
  const i = p.steps.findIndex((s) => s.key === key);
  const j = i + dir;
  if (j < 0 || j >= p.steps.length) return doc;
  const [s] = p.steps.splice(i, 1);
  p.steps.splice(j, 0, s);
  return next;
}

export function deleteStep(doc: Document, key: string): Document {
  const next = clone(doc);
  const p = phaseOf(next, key);
  if (!p) return doc;
  p.steps = p.steps.filter((s) => s.key !== key);
  return renumber(next);
}

/** Handles a `text/kb` drag payload: `move:<key>`, `basic:<type>`, `shared:<id>`, `preset:<text>`. */
export function dropAt(
  doc: Document,
  data: string,
  targetKey: string | null,
  blocks: Block[] = [],
): Document {
  const i = data.indexOf(':');
  if (i < 0) return doc;
  const kind = data.slice(0, i);
  const val = data.slice(i + 1);
  if (kind === 'move') {
    if (val === targetKey) return doc;
    const next = clone(doc);
    const from = phaseOf(next, val);
    if (!from) return doc;
    const [s] = from.steps.splice(
      from.steps.findIndex((x) => x.key === val),
      1,
    );
    const to = targetKey ? phaseOf(next, targetKey) : next.phases[next.phases.length - 1];
    if (!to) return doc;
    const ti = targetKey ? to.steps.findIndex((x) => x.key === targetKey) : to.steps.length;
    to.steps.splice(ti < 0 ? to.steps.length : ti, 0, s);
    return renumber(next);
  }
  if (kind === 'basic') return addBasic(doc, val as BasicType, targetKey, targetKey);
  if (kind === 'shared') {
    const b = blocks.find((x) => x.id === val);
    return b ? addShared(doc, b, targetKey) : doc;
  }
  if (kind === 'preset') return addAction(doc, targetKey, val);
  return doc;
}

/** Port of the legacy pre-publish checklist. */
export function checkList(
  doc: Document,
  fields: CrmField[],
  blocks: Block[],
  related: { documentId: string }[] = [],
): Check[] {
  const out: Check[] = [];
  const names = fields.map((f) => f.name);
  const steps = allSteps(doc).map((s) => ({
    ...s,
    block: s.blockId ? blocks.find((b) => b.id === s.blockId) : undefined,
  }));
  const unknown: string[] = [];
  steps.forEach((s) =>
    s.actions.forEach((a) => {
      const m = /(?:CRM|שדה)\s*[↗←]?\s*"([^"]+)"/.exec(a.text);
      if (m && !names.includes(m[1])) unknown.push(m[1]);
    }),
  );
  const used = [...new Set(steps.flatMap((s) => crmIn(stepText(s, s.block), names)))];
  const renamed = used.filter((n) => fields.find((f) => f.name === n)?.status === 'renamed');
  out.push(
    unknown.length
      ? ['bad', `! שדה לא מוכר ב-crm-fields.json: ${unknown.join(', ')}`]
      : renamed.length
        ? ['warn', `! שדה ששונה שמו: ${renamed.join(', ')} — עדכן לשם החדש`]
        : ['ok', '✓ כל שדות CRM קיימים ב-crm-fields.json'],
  );

  const noOut = steps.filter((s) => !s.outcomes.length && !s.branch);
  out.push(
    noOut.length
      ? [
          'warn',
          `! ${noOut.length} שלבים ללא תוצאה (${noOut
            .slice(0, 3)
            .map((s) => s.num)
            .join(', ')})`,
        ]
      : ['ok', '✓ אין שלבים ללא תוצאה'],
  );

  const empty = steps.filter(
    (s) => !s.actions.some((a) => a.text.trim()) && !s.branch && !s.script && !s.blockId,
  );
  out.push(
    empty.length
      ? ['warn', `! שלב ${empty.map((s) => s.num).join(', ')} ריק — יסומן "מסמך חלקי"`]
      : ['ok', '✓ לכל שלב יש תוכן'],
  );

  out.push(
    related.length
      ? ['ok', `✓ ${related.length} מסמכים קשורים זוהו אוטומטית`]
      : ['warn', '! אין מסמכים קשורים — נזהה אוטומטית לפי בלוקים ושדות'],
  );

  if (!doc.title.trim()) out.unshift(['bad', '! חסרה כותרת']);
  if (!steps.length) out.unshift(['bad', '! אין שלבים במסמך']);
  return out;
}
