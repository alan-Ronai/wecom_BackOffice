import { describe, it, expect } from 'vitest';
import { blameMap, diffStats, diffSteps, stepLines, stepSig } from '../../src/lib/diffSteps.js';
import { fx } from '../msw/fixtures.js';

describe('diffSteps', () => {
  it('aligns by key and classifies rows', () => {
    const old = structuredClone(fx.docBrowsing);
    old.phases[0].steps[0].actions[0].text = 'פתח CRM';
    old.phases[0].steps.splice(2, 1); // remove s3 in old → added in new
    const rows = diffSteps(old, fx.docBrowsing, fx.blocks);
    expect(rows.find((r) => r.new?.key === 's1')?.kind).toBe('changed');
    expect(rows.find((r) => r.new?.key === 's3')?.kind).toBe('added');
    expect(rows.find((r) => r.new?.key === 's2')?.kind).toBe('same');
  });

  it('reports removed steps', () => {
    const next = structuredClone(fx.docBrowsing);
    next.phases[0].steps.splice(1, 1);
    const rows = diffSteps(fx.docBrowsing, next, fx.blocks);
    expect(rows.find((r) => r.old?.key === 's2')?.kind).toBe('removed');
    expect(diffStats(rows)).toMatchObject({ removed: 1, added: 0 });
  });

  it('expands an embedded block into the compared lines', () => {
    const s11 = fx.docBrowsing.phases[3].steps.find((s) => s.key === 's11')!;
    const lines = stepLines(s11, fx.blocks);
    expect(lines[0]).toContain('⧉ בלוק משותף: ריענון SIM');
    expect(lines.some((l) => l.includes('sim block lbl'))).toBe(true);
    expect(stepSig(s11, fx.blocks)).not.toBe(stepSig(s11, []));
  });

  it('blames each step on the version that last touched it', () => {
    const v5 = structuredClone(fx.docBrowsing);
    v5.phases[0].steps[0].actions[0].text = 'ישן';
    const v6 = structuredClone(fx.docBrowsing);
    const map = blameMap(
      [
        { version: 5, author: 'ענבר ל.', doc: v5 },
        { version: 6, author: 'אלון ר.', doc: v6 },
      ],
      fx.blocks,
    );
    expect(map.s1).toEqual({ v: 6, author: 'אלון ר.', kind: 'changed' });
    expect(map.s2).toEqual({ v: 5, author: 'ענבר ל.', kind: 'added' });
  });
});
