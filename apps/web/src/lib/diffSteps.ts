import type { Block, Document, Step } from '@wecom/shared';
import { stripFmt } from '@wecom/shared';
import { allSteps } from './steps.js';

export type DiffKind = 'same' | 'changed' | 'added' | 'removed';
export interface DiffRow {
  old: Step | null;
  new: Step | null;
  kind: DiffKind;
}

const blockOf = (s: Step, blocks: Block[] | undefined) =>
  s.blockId ? blocks?.find((b) => b.id === s.blockId) : undefined;

/** The lines a step contributes to the side-by-side diff (legacy stepLines). */
export function stepLines(s: Step, blocks?: Block[]): string[] {
  const b = blockOf(s, blocks);
  const lines: string[] = [];
  if (s.blockId) lines.push('⧉ בלוק משותף: ' + (b?.title ?? s.blockId));
  (b?.actions ?? s.actions).forEach((a) => lines.push('› ' + stripFmt(a.text)));
  const script = s.script ?? b?.script;
  if (script) lines.push('“ ' + stripFmt(script));
  if (s.branch) {
    lines.push('? ' + s.branch.q);
    s.branch.options.forEach((o) => lines.push('• ' + o.label + ': ' + stripFmt(o.text)));
  }
  (s.outcomes.length ? s.outcomes : (b?.outcomes ?? [])).forEach((o) => lines.push(stripFmt(o.text)));
  (s.extras?.stages ?? []).forEach((st) => {
    lines.push('▸ ' + st.label);
    (st.actions ?? []).forEach((a) => lines.push('› ' + stripFmt(a)));
    if (st.script) lines.push('“ ' + stripFmt(st.script));
  });
  return lines;
}

export const stepSig = (s: Step, blocks?: Block[]): string =>
  stripFmt(s.title) + '\n' + stepLines(s, blocks).join('\n');

/** Aligns two documents by step key and classifies each row (legacy KB.diffSteps). */
export function diffSteps(
  oldDoc: Document | { phases: Document['phases'] } | null | undefined,
  newDoc: Document | { phases: Document['phases'] } | null | undefined,
  blocks?: Block[],
): DiffRow[] {
  const O = allSteps(oldDoc as Document | undefined);
  const N = allSteps(newDoc as Document | undefined);
  const oldIdx = new Map(O.map((s, i) => [s.key, i]));
  const rows: DiffRow[] = [];
  let cursor = 0;
  N.forEach((n) => {
    const oi = oldIdx.get(n.key) ?? -1;
    if (oi >= 0) {
      while (cursor < oi) {
        const o = O[cursor++];
        if (!N.some((x) => x.key === o.key)) rows.push({ old: o, new: null, kind: 'removed' });
      }
      cursor = oi + 1;
      rows.push({
        old: O[oi],
        new: n,
        kind: stepSig(O[oi], blocks) === stepSig(n, blocks) ? 'same' : 'changed',
      });
    } else rows.push({ old: null, new: n, kind: 'added' });
  });
  while (cursor < O.length) {
    const o = O[cursor++];
    if (!N.some((x) => x.key === o.key)) rows.push({ old: o, new: null, kind: 'removed' });
  }
  return rows;
}

export interface Blame {
  v: number;
  author: string;
  kind: 'added' | 'changed';
}

/** Which version last touched each step, from an ordered list of snapshots. */
export function blameMap(
  versions: { version: number; author: string; doc: Document }[],
  blocks?: Block[],
): Record<string, Blame> {
  const map: Record<string, Blame> = {};
  let prev: Document | null = null;
  [...versions]
    .sort((a, b) => a.version - b.version)
    .forEach(({ version, author, doc }) => {
      allSteps(doc).forEach((s) => {
        const ps = prev ? allSteps(prev).find((x) => x.key === s.key) : undefined;
        if (!ps) map[s.key] = { v: version, author, kind: 'added' };
        else if (stepSig(ps, blocks) !== stepSig(s, blocks))
          map[s.key] = { v: version, author, kind: 'changed' };
      });
      prev = doc;
    });
  return map;
}

export const diffStats = (rows: DiffRow[]) => ({
  added: rows.filter((r) => r.kind === 'added').length,
  changed: rows.filter((r) => r.kind === 'changed').length,
  removed: rows.filter((r) => r.kind === 'removed').length,
});
