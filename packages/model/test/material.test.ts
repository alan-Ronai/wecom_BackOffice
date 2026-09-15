import { describe, it, expect } from 'vitest';
import type { ParagraphDiff } from '@wecom/shared';
import {
  isCosmetic,
  isNoiseChange,
  isFieldRenameOnly,
  isReorderOnly,
  materialDiffs,
  materialSentences,
  materialTokens,
  renamedFields,
  RuleBasedModel,
  type ProposalContext,
} from '../src/index.js';

/**
 * The negative half of the eval set is only meaningful if the thing being tested can actually
 * tell noise from a change. These pin the line: a number, a latin token or a quoted string that
 * moved is always a change; everything else has to survive normalisation to be one.
 */
const known = new Set(['sim block lbl']);

describe('isCosmetic', () => {
  it('ignores whitespace and punctuation', () => {
    expect(isCosmetic('בצע ריענון SIM.', 'בצע   ריענון SIM')).toBe(true);
    expect(isCosmetic('המתן דקה, ובדוק שוב.', 'המתן דקה ובדוק שוב.')).toBe(true);
  });

  it('treats a spelling fix as cosmetic but a replaced word as content', () => {
    expect(isCosmetic('בצע ריענוו לכרטיס.', 'בצע ריענון לכרטיס.')).toBe(true);
    expect(isCosmetic('בצע ריענון לכרטיס.', 'בצע ריענון למכשיר.')).toBe(false);
  });

  it('never calls a changed number, latin token or quoted name cosmetic', () => {
    expect(isCosmetic('מעל 5 מגה תקין.', 'מעל 6 מגה תקין.')).toBe(false);
    expect(isCosmetic('הרץ Speedtest.', 'הרץ Fast.')).toBe(false);
    expect(isCosmetic('עדכן את "sim block lbl".', 'עדכן את "sim status".')).toBe(false);
    expect(materialTokens('מעל 5 מגה, הרץ Speedtest')).toEqual(['5', 'speedtest']);
  });

  it('counts an added or removed word as content however small', () => {
    expect(isCosmetic('המתן ובדוק.', 'המתן, ובדוק שוב.')).toBe(false);
  });
});

describe('materialSentences', () => {
  it('returns the sentence whose value changed, not just wholly new ones', () => {
    expect(
      materialSentences('תוצאת Speedtest מעל 5 מגה נחשבת תקינה.', 'תוצאת Speedtest מעל 6 מגה נחשבת תקינה.'),
    ).toEqual(['תוצאת Speedtest מעל 6 מגה נחשבת תקינה.']);
  });

  it('returns nothing at all for a cosmetic change', () => {
    expect(materialSentences('בצע ריענוו לכרטיס.', 'בצע ריענון לכרטיס.')).toEqual([]);
  });
});

describe('CRM field renames', () => {
  it('names the pair when a known field is quoted out and an unknown one in', () => {
    expect(
      renamedFields(
        'עדכן את השדה "sim block lbl" לערך "לא חסום".',
        'עדכן את השדה "sim status" לערך "לא חסום".',
        known,
      ),
    ).toEqual([{ from: 'sim block lbl', to: 'sim status' }]);
  });

  it('is rename-only when nothing else in the paragraph moved, and not when an instruction was added', () => {
    expect(isFieldRenameOnly('עדכן את השדה "sim block lbl".', 'עדכן את השדה "sim status".', known)).toBe(
      true,
    );
    expect(
      isFieldRenameOnly(
        'עדכן את השדה "sim block lbl".',
        'עדכן את השדה "sim status". לאחר מכן המתן 90 שניות.',
        known,
      ),
    ).toBe(false);
  });
});

const diff = (ref: string, before: string, after: string): ParagraphDiff =>
  ({ ref, kind: 'changed', before, after, similarity: 0.5 }) as ParagraphDiff;

/** One mapped step on §2.1, so a change there is a real `update-step` and noise is not. */
const ctx = (diffs: ParagraphDiff[]): ProposalContext => ({
  source: { id: 's', title: 'נהלי SIM' },
  paragraphs: [{ ref: '2.1', runs: [{ t: 'x' }] }],
  diffs,
  linkedSteps: [
    {
      documentId: '11111111-1111-4111-8111-111111111111',
      documentTitle: 'אין קליטה',
      stepKey: 's3',
      stepNum: '3',
      stepTitle: 'ריענון SIM',
      anchor: '2.1',
      actions: ['בצע ריענון SIM'],
    },
  ],
  fields: [],
  blocks: [],
});

describe('revision-level noise', () => {
  it('recognises a pure reorder', () => {
    expect(isReorderOnly([diff('1', 'ראשון.', 'שני.'), diff('2', 'שני.', 'ראשון.')])).toBe(true);
    expect(isReorderOnly([diff('1', 'ראשון.', 'שני.'), diff('2', 'שני.', 'שלישי.')])).toBe(false);
  });

  it('drops cosmetic changes and heading renames from what a model is shown', () => {
    const out = materialDiffs([
      diff('h2-1', 'זיהוי הלקוח', 'זיהוי לקוח'),
      diff('2.1', 'בצע ריענוו.', 'בצע ריענון.'),
      diff('2.2', 'המתן דקה.', 'המתן 90 שניות.'),
      { ref: '2.3', kind: 'same', before: 'x', after: 'x', similarity: 1 } as ParagraphDiff,
    ]);
    expect(out.map((d) => d.ref)).toEqual(['2.2']);
  });

  /**
   * The heading exemption used to fire before the cosmetic test, so *any* change to a heading was
   * noise — including a changed threshold. A heading is a table of contents and a rewording of
   * one is nothing to decide; a heading carrying a number that moved is a fact that moved.
   */
  it('keeps a heading whose number changed, and still drops one that was only reworded', () => {
    expect(isNoiseChange(diff('h2-4', 'סף 5 מגה', 'סף 6 מגה'))).toBe(false);
    expect(materialDiffs([diff('h2-4', 'סף 5 מגה', 'סף 6 מגה')]).map((d) => d.ref)).toEqual(['h2-4']);
    expect(isNoiseChange(diff('h2-4', 'בדיקות מהירות', 'בדיקות מהירות גלישה'))).toBe(true);
    // A latin token or a quoted name in a heading counts for the same reason a number does.
    expect(isNoiseChange(diff('h2-5', 'בדיקת Speedtest', 'בדיקת Fast'))).toBe(false);
  });

  it('the rule engine sees the same heading change the model does', async () => {
    const withHeading = ctx([diff('h2-4', 'סף 5 מגה', 'סף 6 מגה')]);
    withHeading.linkedSteps[0].anchor = 'h2-4';
    const out = await new RuleBasedModel().proposeChanges(withHeading);
    expect(out).toHaveLength(1);
    expect(out[0].payload.type === 'update-step' && out[0].payload.addActions.join(' ')).toContain('6');
  });
});

describe('the rule engine proposes nothing on noise', () => {
  it('emits nothing for a typo, whitespace, punctuation or a reorder', async () => {
    const m = new RuleBasedModel();
    expect(await m.proposeChanges(ctx([diff('2.1', 'בצע ריענוו SIM.', 'בצע ריענון SIM.')]))).toEqual([]);
    expect(await m.proposeChanges(ctx([diff('2.1', 'בצע  ריענון SIM.', 'בצע ריענון SIM.')]))).toEqual([]);
    expect(await m.proposeChanges(ctx([diff('2.1', 'בצע ריענון SIM', 'בצע ריענון SIM.')]))).toEqual([]);
    expect(
      await m.proposeChanges(
        ctx([
          diff('2.1', 'ראשון ארוך יותר.', 'שני ארוך יותר.'),
          diff('2.2', 'שני ארוך יותר.', 'ראשון ארוך יותר.'),
        ]),
      ),
    ).toEqual([]);
  });

  it('still emits for a changed number', async () => {
    const out = await new RuleBasedModel().proposeChanges(
      ctx([diff('2.1', 'בצע ריענון SIM והמתן דקה אחת.', 'בצע ריענון SIM והמתן 90 שניות.')]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('update-step');
  });
});
