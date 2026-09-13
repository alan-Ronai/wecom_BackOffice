import { describe, it, expect } from 'vitest';
import { RuleBasedModel, type ProposalContext } from '../src/index.js';

const D = '11111111-1111-4111-8111-111111111111';
const ctx: ProposalContext = {
  source: { id: 'src', title: 'נהלי תמיכה טכנית' },
  paragraphs: [],
  diffs: [
    { ref: '4.8', kind: 'changed', before: 'בקש מהלקוח להריץ Speedtest. מעל 5 מגה – תקין.', after: 'בקש מהלקוח להריץ Speedtest. מעל 6 מגה – תקין. יש לוודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה.', similarity: 0.8 },
    { ref: '4.14', kind: 'added', before: null, after: 'בעיות גלישה ברכב. אם הלקוח מדווח על איטיות רק ברכב – בדוק Wi-Fi של הרכב. הנחה לכבות Wi-Fi ברכב.', similarity: 0 },
    { ref: '4.11', kind: 'changed', before: 'ריענון SIM. sim block lbl ← שמור.', after: 'ריענון SIM. sim block lbl ← שמור. ולחכות 90 שניות.', similarity: 0.9 },
  ],
  linkedSteps: [
    { documentId: D, documentTitle: 'איטיות גלישה', stepKey: 's8', stepNum: '8', stepTitle: 'בדיקת מהירות גלישה', anchor: '4.8', actions: ['בקש מהלקוח להריץ Speedtest'] },
    { documentId: D, documentTitle: 'איטיות גלישה', stepKey: 's11', stepNum: '11', stepTitle: 'ריענון SIM', anchor: '4.11', actions: [], blockId: 'blk-1' },
  ],
  fields: [{ name: 'sim block lbl', status: 'ok' }],
  blocks: [{ id: 'blk-1', title: 'ריענון SIM', actions: ['CRM ← sim block lbl ← שמור', 'בקש מהלקוח לאתחל מכשיר'] }],
};

describe('RuleBasedModel', () => {
  it('maps changed paragraph with a linked step to update-step, added paragraph to new-card, block-linked to update-block', async () => {
    const out = await new RuleBasedModel().proposeChanges(ctx);
    expect(out.map((s) => [s.anchor, s.type])).toEqual([['§4.8', 'update-step'], ['§4.14', 'new-card'], ['§4.11', 'update-block']]);
    const upd = out[0]; if (upd.payload.type !== 'update-step') throw new Error();
    expect(upd.payload.addActions).toEqual(['יש לוודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה.']);
    expect(upd.targetStepKey).toBe('s8');
    expect(upd.confidence).toBeGreaterThan(0.5);
  });
  it('is always available', async () => { expect(await new RuleBasedModel().available()).toBe(true); });
});
