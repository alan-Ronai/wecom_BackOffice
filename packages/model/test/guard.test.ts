import { describe, it, expect } from 'vitest';
import {
  applyGuards,
  coerceBlockUpdates,
  detectFieldAlerts,
  dropUnanchored,
  enforceSectionCards,
} from '../src/index.js';
import type { ProposalContext, ProposedSuggestion } from '../src/index.js';

/**
 * The deterministic half of the generation path. Everything here is decidable from the context
 * without reading Hebrew, which is why it belongs in code: it is free, it is reproducible, and
 * it cannot code-switch into Chinese halfway through a rationale.
 */
const D = '11111111-1111-4111-8111-111111111111';
const B = '44444444-4444-4444-8444-444444444444';

const ctx: ProposalContext = {
  source: { id: 's', title: 'נהלי SIM' },
  paragraphs: [],
  diffs: [
    { ref: '2.3', kind: 'changed', before: 'המתן דקה אחת.', after: 'המתן 90 שניות.', similarity: 0.6 },
    {
      ref: '2.7',
      kind: 'changed',
      before: 'עדכן את השדה "sim block lbl".',
      after: 'עדכן את השדה "sim status".',
      similarity: 0.9,
    },
    { ref: '2.9', kind: 'changed', before: 'בצע ריענוו.', after: 'בצע ריענון.', similarity: 0.99 },
  ],
  linkedSteps: [
    {
      documentId: D,
      documentTitle: 'אין קליטה',
      stepKey: 's3',
      stepNum: '3',
      stepTitle: 'ריענון SIM',
      anchor: '2.3',
      actions: ['בצע ריענון SIM', 'המתן דקה'],
      blockId: B,
    },
    {
      documentId: D,
      documentTitle: 'אין קליטה',
      stepKey: 's7',
      stepNum: '7',
      stepTitle: 'עדכון סטטוס SIM',
      anchor: '2.7',
      actions: ['CRM ← sim block lbl'],
    },
  ],
  fields: [{ name: 'sim block lbl', status: 'ok' }],
  blocks: [{ id: B, title: 'ריענון SIM', actions: ['בצע ריענון SIM', 'המתן דקה'] }],
};

const s = (over: Partial<ProposedSuggestion> = {}): ProposedSuggestion =>
  ({
    anchor: '§2.3',
    type: 'update-step',
    title: 'המתנה 90 שניות',
    targetDocumentId: D,
    targetStepKey: 's3',
    targetBlockId: null,
    payload: { type: 'update-step', addActions: ['המתן 90 שניות'], patch: {} },
    confidence: 0.9,
    rationale: 'הזמן שונה',
    ...over,
  }) as ProposedSuggestion;

describe('coerceBlockUpdates', () => {
  it('moves an edit of a block-backed step into the block, keeping the block’s own actions', () => {
    const [out] = coerceBlockUpdates(ctx, [s()]);
    expect(out.type).toBe('update-block');
    expect(out.targetBlockId).toBe(B);
    expect(out.payload.type === 'update-block' && out.payload.actions.map((a) => a.text)).toEqual([
      'בצע ריענון SIM',
      'המתן דקה',
      'המתן 90 שניות',
    ]);
    expect(out.rationale).toContain('בלוק המשותף');
  });
});

describe('detectFieldAlerts', () => {
  it('raises a rename when a known field is quoted out and an unknown one in', () => {
    const out = detectFieldAlerts(ctx, []);
    expect(out).toHaveLength(1);
    expect(out[0].payload).toEqual({ type: 'field-alert', fieldName: 'sim block lbl', issue: 'renamed' });
    // The target comes from the linked step on the same anchor, which is what case 05 asserts.
    expect([out[0].targetDocumentId, out[0].targetStepKey]).toEqual([D, 's7']);
  });

  it('raises `unknown` when the source names a field nobody has heard of', () => {
    const withNew: ProposalContext = {
      ...ctx,
      diffs: [
        {
          ref: '3.4',
          kind: 'changed',
          before: 'עדכן את "sim block lbl".',
          after: 'עדכן את "sim block lbl" ואת "invoice freeze flag".',
          similarity: 0.7,
        },
      ],
    };
    const out = detectFieldAlerts(withNew, []);
    expect(out[0].payload).toEqual({
      type: 'field-alert',
      fieldName: 'invoice freeze flag',
      issue: 'unknown',
    });
  });

  it('never mistakes a quoted Hebrew value for a field name', () => {
    const values: ProposalContext = {
      ...ctx,
      diffs: [
        {
          ref: '3.5',
          kind: 'changed',
          before: 'עדכן את "sim block lbl" לערך "חסום".',
          after: 'עדכן את "sim block lbl" לערך "לא חסום".',
          similarity: 0.9,
        },
      ],
    };
    expect(detectFieldAlerts(values, [])).toEqual([]);
  });

  it('does not raise the same field twice when the model already did', () => {
    const already = s({
      anchor: '§2.7',
      type: 'field-alert',
      payload: { type: 'field-alert', fieldName: 'sim block lbl', issue: 'renamed' },
    });
    expect(detectFieldAlerts(ctx, [already])).toHaveLength(1);
  });
});

describe('dropUnanchored', () => {
  it('drops a suggestion about a paragraph that did not materially change', () => {
    // §2.9 is a spelling fix, so the model was never shown it and cannot have meant it.
    expect(dropUnanchored(ctx, [s({ anchor: '§2.9' })])).toEqual([]);
    expect(dropUnanchored(ctx, [s()])).toHaveLength(1);
  });

  it('drops everything when nothing in the revision materially changed', () => {
    const noise: ProposalContext = { ...ctx, diffs: [ctx.diffs[2]] };
    expect(dropUnanchored(noise, [s({ anchor: '§2.9' })])).toEqual([]);
  });

  /**
   * The regression this exists for: a second revision of an unmapped source adds one paragraph
   * under a heading that did not change. `enforceSectionCards` anchors its cards on the
   * *headings*, which are `kind: 'same'` and therefore not material — so the guard was deleting
   * the very cards the invariant had just inserted, the revision came back empty, and an empty
   * revision is auto-accepted. The source would have been marked synced with none of its
   * sections ever reaching an editor.
   */
  it('keeps the section cards of a new source whose headings did not change', () => {
    const fresh: ProposalContext = {
      source: { id: 's2', title: 'נוהל החלפת מכשיר' },
      paragraphs: [
        { ref: 'h2-1', heading: 'זיהוי הלקוח', level: 2, runs: [{ t: 'זיהוי הלקוח' }] },
        { ref: 'h2-1.p-1', runs: [{ t: 'ודא את זהות הלקוח מול תעודה מזהה.' }] },
        { ref: 'h2-1.p-2', runs: [{ t: 'רשום את מספר התעודה בכרטיס הפנייה.' }] },
      ],
      diffs: [
        { ref: 'h2-1', kind: 'same', before: 'זיהוי הלקוח', after: 'זיהוי הלקוח', similarity: 1 },
        {
          ref: 'h2-1.p-1',
          kind: 'same',
          before: 'ודא את זהות הלקוח מול תעודה מזהה.',
          after: 'ודא את זהות הלקוח מול תעודה מזהה.',
          similarity: 1,
        },
        {
          ref: 'h2-1.p-2',
          kind: 'added',
          before: null,
          after: 'רשום את מספר התעודה בכרטיס הפנייה.',
          similarity: 0,
        },
      ],
      linkedSteps: [],
      fields: [],
      blocks: [],
    };
    const cards = enforceSectionCards(fresh, []);
    expect(cards.map((x) => [x.type, x.anchor])).toEqual([['new-card', '§h2-1']]);
    // The card's anchor is the unchanged heading, so without the exemption this returned [].
    expect(dropUnanchored(fresh, cards)).toEqual(cards);
    expect(applyGuards(fresh, cards)).toEqual(cards);
  });

  it('keeps a new-card even off the new-source path — a card has no existing target to be wrong about', () => {
    const card = s({ anchor: '§2.9', type: 'new-card' });
    expect(dropUnanchored(ctx, [card])).toHaveLength(1);
  });
});

describe('applyGuards', () => {
  it('runs with no model answer at all — the detectors need none', () => {
    const out = applyGuards(ctx, []);
    expect(out.map((x) => x.type)).toEqual(['field-alert']);
  });

  it('drops the invented, coerces the block, and adds the field alert in one pass', () => {
    const out = applyGuards(ctx, [s(), s({ anchor: '§2.9' })]);
    expect(out.map((x) => x.type)).toEqual(['update-block', 'field-alert']);
  });
});
