import { describe, it, expect } from 'vitest';
import type { ParagraphDiff } from '@wecom/shared';
import { likelyType, type LikelyTypeContext } from '../../src/modules/sources/proposal.js';

/**
 * C-I3. `likelyType` is the `types` filter handed to `fewShotExamples`, so a type it cannot
 * return is a type that can never have an accepted example retrieved for it — however many the
 * review queue has accumulated. It used to return three of six, and the three it left out
 * (`update-block`, `new-step`, `field-alert`) were exactly the three both tiers got wrong.
 *
 * The order below is `propose-v4`'s ordered decision list, stop at the first match, so the
 * examples a revision is shown are the ones for the rules it is about to be asked to apply.
 */
const D = '11111111-1111-4111-8111-111111111111';
const B = '44444444-4444-4444-8444-444444444444';

const diff = (over: Partial<ParagraphDiff> = {}): ParagraphDiff =>
  ({ ref: '2.3', kind: 'changed', before: 'לפני', after: 'אחרי', similarity: 0.8, ...over }) as ParagraphDiff;

const ctx = (over: Partial<LikelyTypeContext> = {}): LikelyTypeContext => ({
  steps: new Map([['2.3', { blockId: null }]]),
  anyMapped: true,
  knownFields: new Set(['sim block lbl']),
  ...over,
});

describe('likelyType reaches all six suggestion types', () => {
  it('1 — a mapped step backed by a shared block is an update-block', () => {
    expect(likelyType(diff(), ctx({ steps: new Map([['2.3', { blockId: B }]]) }))).toBe('update-block');
  });

  it('2 — a removed paragraph with a mapped step is a deprecate-step', () => {
    expect(likelyType(diff({ kind: 'removed', after: null }), ctx())).toBe('deprecate-step');
  });

  it('3 — a known CRM field quoted out and an unknown one quoted in is a field-alert', () => {
    const renamed = diff({
      before: 'עדכן את השדה "sim block lbl" לערך "לא חסום".',
      after: 'עדכן את השדה "sim status" לערך "לא חסום".',
    });
    expect(likelyType(renamed, ctx())).toBe('field-alert');
    // …but only when the *old* name is one the platform knows; otherwise it is a plain edit.
    expect(likelyType(renamed, ctx({ knownFields: new Set() }))).toBe('update-step');
  });

  it('4 — an ordinary change to a mapped step is an update-step', () => {
    expect(likelyType(diff(), ctx())).toBe('update-step');
  });

  it('5 — an added paragraph with no step of its own, in a source that has others, is a new-step', () => {
    expect(likelyType(diff({ ref: '2.9', kind: 'added', before: null }), ctx())).toBe('new-step');
  });

  it('6 — a source with nothing mapped at all is a new-card', () => {
    expect(likelyType(diff({ ref: '2.9', kind: 'added', before: null }), ctx({ steps: new Map(), anyMapped: false }))).toBe(
      'new-card',
    );
  });

  it('the block rule wins over the removal rule, as the prompt orders them', () => {
    expect(
      likelyType(diff({ kind: 'removed', after: null }), ctx({ steps: new Map([['2.3', { blockId: B }]]) })),
    ).toBe('update-block');
  });

  it('strips a leading § from the diff ref before looking the step up', () => {
    expect(likelyType(diff({ ref: '§2.3' }), ctx())).toBe('update-step');
    expect(D).toHaveLength(36);
  });
});
