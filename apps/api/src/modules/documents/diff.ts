import { escapeHtml, stripFmt, wordDiff, type Block, type Document, type Step } from '@wecom/shared';

export interface DiffSide {
  key: string;
  num: string;
  titleHtml: string;
  lines: string[];
}
export interface DiffRow {
  kind: 'same' | 'changed' | 'added' | 'removed';
  oldStep: DiffSide | null;
  newStep: DiffSide | null;
  blame?: { version: number; author: string };
}

/** The plain-text lines a step renders as, with the shared block's body substituted when embedded. */
export const stepLines = (s: Step, blocks: Map<string, Block>): string[] => {
  const b = s.blockId ? blocks.get(s.blockId) : undefined;
  const lines: string[] = [];
  if (s.blockId) lines.push('⧉ בלוק משותף: ' + (b?.title ?? s.blockId));
  for (const a of b?.actions ?? s.actions) lines.push('› ' + stripFmt(a.text));
  const script = s.script ?? b?.script;
  if (script) lines.push('“ ' + stripFmt(script));
  if (s.branch) {
    lines.push('? ' + s.branch.q);
    for (const o of s.branch.options) lines.push('• ' + o.label + ': ' + stripFmt(o.text));
  }
  for (const o of s.outcomes) lines.push(stripFmt(o.text));
  return lines;
};

export const stepSignature = (s: Step, blocks: Map<string, Block>): string =>
  stripFmt(s.title) + '\n' + stepLines(s, blocks).join('\n');

export const allSteps = (doc: Document): Step[] => doc.phases.flatMap((p) => p.steps);

/**
 * Align two document versions by step key and classify every row.
 * Removed steps are emitted before added ones at the same position so the two columns line up.
 */
export function diffDocuments(oldDoc: Document, newDoc: Document, blocks: Map<string, Block>): DiffRow[] {
  const O = allSteps(oldDoc);
  const N = allSteps(newDoc);
  const oldIdx = new Map(O.map((s, i) => [s.key, i]));
  const newKeys = new Set(N.map((s) => s.key));
  const rows: DiffRow[] = [];
  let cursor = 0;

  const side = (s: Step, lines: string[], titleHtml: string): DiffSide => ({
    key: s.key,
    num: s.num,
    titleHtml,
    lines,
  });
  const pair = (o: Step, n: Step): DiffRow => {
    const same = stepSignature(o, blocks) === stepSignature(n, blocks);
    const ol = stepLines(o, blocks);
    const nl = stepLines(n, blocks);
    const la: string[] = [];
    const lb: string[] = [];
    for (let i = 0; i < Math.max(ol.length, nl.length); i++) {
      const d = wordDiff(ol[i] ?? '', nl[i] ?? '');
      if (ol[i] != null) la.push(d.a);
      if (nl[i] != null) lb.push(d.b);
    }
    const t = wordDiff(stripFmt(o.title), stripFmt(n.title));
    return {
      kind: same ? 'same' : 'changed',
      oldStep: side(o, la, same ? escapeHtml(stripFmt(o.title)) : t.a),
      newStep: side(n, lb, same ? escapeHtml(stripFmt(n.title)) : t.b),
    };
  };
  const removedRow = (o: Step): DiffRow => ({
    kind: 'removed',
    oldStep: side(o, stepLines(o, blocks).map(escapeHtml), escapeHtml(stripFmt(o.title))),
    newStep: null,
  });
  const addedRow = (n: Step): DiffRow => ({
    kind: 'added',
    oldStep: null,
    newStep: side(n, stepLines(n, blocks).map(escapeHtml), escapeHtml(stripFmt(n.title))),
  });

  const pendingAdded: Step[] = [];
  const flushRemoved = (until: number) => {
    while (cursor < until) {
      const o = O[cursor++];
      if (!newKeys.has(o.key)) rows.push(removedRow(o));
    }
  };
  const flushAdded = () => {
    while (pendingAdded.length) rows.push(addedRow(pendingAdded.shift()!));
  };

  for (const n of N) {
    const oi = oldIdx.get(n.key);
    if (oi === undefined) {
      pendingAdded.push(n);
      continue;
    }
    flushRemoved(oi);
    flushAdded();
    cursor = oi + 1;
    rows.push(pair(O[oi], n));
  }
  flushRemoved(O.length);
  flushAdded();
  return rows;
}

export const diffStats = (rows: DiffRow[]) => ({
  changed: rows.filter((r) => r.kind === 'changed').length,
  added: rows.filter((r) => r.kind === 'added').length,
  removed: rows.filter((r) => r.kind === 'removed').length,
});

/** For every changed/added row, the first version in `history` that introduced the difference. */
export function annotateBlame(
  rows: DiffRow[],
  history: { version: number; author: string; doc: Document }[],
  blocks: Map<string, Block>,
): DiffRow[] {
  if (history.length < 2) return rows;
  const sigs = history.map((h) => {
    const m = new Map<string, string>();
    for (const s of allSteps(h.doc)) m.set(s.key, stepSignature(s, blocks));
    return m;
  });
  for (const row of rows) {
    if (row.kind !== 'changed' && row.kind !== 'added') continue;
    const key = row.newStep?.key;
    if (!key) continue;
    for (let i = 1; i < history.length; i++) {
      if (sigs[i].get(key) !== sigs[i - 1].get(key)) {
        row.blame = { version: history[i].version, author: history[i].author };
        break;
      }
    }
  }
  return rows;
}
