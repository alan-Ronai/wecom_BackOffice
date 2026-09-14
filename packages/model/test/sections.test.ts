import { describe, it, expect } from 'vitest';
import { htmlToParagraphs, type Paragraph } from '@wecom/shared';
import { RuleBasedModel, groupSections, type ProposalContext } from '../src/index.js';

/**
 * The fan-out defect: a first import of a source with no matching document produced one
 * `new-card` per paragraph — a card for the `<h2>`, a card for the `<p>`, a card per `<li>` —
 * and the single (connector, external_id) sync link could only point at one of them.
 */

/** Every paragraph of a first import is "added"; that is what `paragraphDiff(null, …)` returns. */
const ctxFor = (
  paragraphs: Paragraph[],
  o: { title: string; singleDocument?: boolean },
): ProposalContext => ({
  source: { id: 'src', title: o.title, singleDocument: o.singleDocument },
  paragraphs,
  diffs: paragraphs.map((p) => ({
    ref: p.ref,
    kind: 'added' as const,
    before: null,
    after: p.runs.map((r) => r.t).join(''),
    similarity: 0,
  })),
  linkedSteps: [],
  fields: [],
  blocks: [],
});

/** The body `scripts/wp-stub.mjs` serves and the edit `apps/web/e2e/real/wordpress-source.spec.ts` makes. */
const WP_HTML =
  '<h2>מבוא</h2><p>סף מהירות: 5 מגה.</p><ul><li>בדיקת APN</li><li>ניתוק מ-Wi-Fi</li></ul>';
const WP_HTML_EDITED =
  '<h2>מבוא</h2><p>סף מהירות: 6 מגה.</p><ul><li>בדיקת APN</li><li>ניתוק מ-Wi-Fi</li></ul>';
const WP_TITLE = 'נוהל WordPress לבדיקה';

describe('groupSections', () => {
  it('groups the WordPress post into one section: heading, paragraph, one item per <li>', () => {
    const sections = groupSections(htmlToParagraphs(WP_HTML), WP_TITLE);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ title: 'מבוא', ref: 'h2-1', level: 2 });
    expect(sections[0].items).toEqual([
      { ref: 'h2-1.p-1', text: 'סף מהירות: 5 מגה.', list: false },
      { ref: 'h2-1.ul-2', text: 'בדיקת APN', list: true },
      { ref: 'h2-1.ul-2', text: 'ניתוק מ-Wi-Fi', list: true },
    ]);
  });

  it('keeps one section across the 6-מגה edit and only the paragraph text changes', () => {
    const before = groupSections(htmlToParagraphs(WP_HTML), WP_TITLE);
    const after = groupSections(htmlToParagraphs(WP_HTML_EDITED), WP_TITLE);
    expect(after).toHaveLength(1);
    expect(after[0].items.map((i) => i.ref)).toEqual(before[0].items.map((i) => i.ref));
    expect(after[0].items[0].text).toBe('סף מהירות: 6 מגה.');
  });

  it('splits a docx-like paragraph list on its two h2 headings and nests an h3 inside', () => {
    const paragraphs: Paragraph[] = [
      { ref: '1', heading: 'רקע', level: 2, runs: [{ t: 'רקע' }] },
      { ref: '2', runs: [{ t: 'הנוהל חל על כל הנציגים.' }] },
      { ref: '3', heading: 'תת-סעיף', level: 3, runs: [{ t: 'תת-סעיף' }] },
      { ref: '4', runs: [{ t: 'פרטים נוספים על הרקע.' }] },
      { ref: '5', heading: 'טיפול בתקלה', level: 2, runs: [{ t: 'טיפול בתקלה' }] },
      { ref: '6', runs: [{ t: 'פתח CRM ובדוק את שדה הגלישה.' }] },
    ];
    const sections = groupSections(paragraphs, 'נהלי תמיכה');
    expect(sections.map((s) => [s.title, s.ref, s.items.length])).toEqual([
      ['רקע', '1', 3],
      ['טיפול בתקלה', '5', 1],
    ]);
    // The deeper heading stays inside its parent section as a step of its own.
    expect(sections[0].items.map((i) => i.text)).toEqual([
      'הנוהל חל על כל הנציגים.',
      'תת-סעיף',
      'פרטים נוספים על הרקע.',
    ]);
  });

  it('a source with no headings is one section named after the source', () => {
    const paragraphs: Paragraph[] = [
      { ref: 'p-1', runs: [{ t: 'שורה ראשונה ללא כותרת.' }] },
      { ref: 'p-2', runs: [{ t: 'שורה שנייה ללא כותרת.' }] },
    ];
    const sections = groupSections(paragraphs, 'מסמך ללא כותרות');
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ title: 'מסמך ללא כותרות', ref: 'p-1' });
    expect(sections[0].items).toHaveLength(2);
  });

  it('leaves a table paragraph whole — only an all-bullet paragraph is a list', () => {
    const sections = groupSections(
      htmlToParagraphs('<h2>טבלה</h2><table><tr><td>א</td><td>ב</td></tr><tr><td>ג</td><td>ד</td></tr></table>'),
      'מקור',
    );
    expect(sections[0].items).toHaveLength(1);
    expect(sections[0].items[0].list).toBe(false);
  });
});

describe('RuleBasedModel on a source with no matching document', () => {
  it('a WordPress post becomes ONE card titled after the post, a phase per heading', async () => {
    const out = await new RuleBasedModel().proposeChanges(
      ctxFor(htmlToParagraphs(WP_HTML_EDITED), { title: WP_TITLE, singleDocument: true }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'new-card', anchor: '§h2-1', title: WP_TITLE });
    const p = out[0].payload;
    if (p.type !== 'new-card') throw new Error('expected a new-card payload');
    expect(p.title).toBe(WP_TITLE);
    expect(p.phases).toHaveLength(1);
    expect(p.phases[0].label).toBe('מבוא');
    // One step per paragraph and per list item, each carrying the paragraph ref it came from.
    expect(p.phases[0].steps.map((s) => [s.key, s.title, s.sourceRef])).toEqual([
      ['s1', 'סף מהירות: 6 מגה', '§h2-1.p-1'],
      ['s2', 'בדיקת APN', '§h2-1.ul-2'],
      ['s3', 'ניתוק מ-Wi-Fi', '§h2-1.ul-2'],
    ]);
    expect(p.phases[0].steps.at(-1)!.outcomes[0].kind).toBe('ok');
    expect(p.phases[0].steps[0].outcomes[0]).toMatchObject({ kind: 'next', goto: 's2' });
  });

  it('two h2 sections of a single remote item become two phases of one card, keys unique', async () => {
    const paragraphs = htmlToParagraphs(
      '<h2>מבוא</h2><p>פסקה ראשונה.</p><h2>טיפול</h2><p>פסקה שנייה.</p><p>פסקה שלישית.</p>',
    );
    const out = await new RuleBasedModel().proposeChanges(
      ctxFor(paragraphs, { title: 'פוסט', singleDocument: true }),
    );
    expect(out).toHaveLength(1);
    const p = out[0].payload;
    if (p.type !== 'new-card') throw new Error('expected a new-card payload');
    expect(p.phases.map((ph) => [ph.id, ph.label, ph.steps.length])).toEqual([
      ['p1', 'מבוא', 1],
      ['p2', 'טיפול', 2],
    ]);
    const keys = p.phases.flatMap((ph) => ph.steps.map((s) => s.key));
    expect(keys).toEqual(['s1', 's2', 's3']);
    expect(new Set(keys).size).toBe(3);
  });

  it('an upload (not one remote item) becomes one card per section, not one per paragraph', async () => {
    const paragraphs: Paragraph[] = [
      { ref: '1', heading: 'רקע', level: 2, runs: [{ t: 'רקע' }] },
      { ref: '2', runs: [{ t: 'הנוהל חל על כל הנציגים.' }] },
      { ref: '3', runs: [{ t: 'תוקף: 2026.' }] },
      { ref: '4', heading: 'טיפול בתקלה', level: 2, runs: [{ t: 'טיפול בתקלה' }] },
      { ref: '5', runs: [{ t: 'פתח CRM ובדוק את שדה הגלישה.' }] },
    ];
    const out = await new RuleBasedModel().proposeChanges(ctxFor(paragraphs, { title: 'נהלי תמיכה' }));
    expect(out.map((s) => [s.anchor, s.type, s.title])).toEqual([
      ['§1', 'new-card', 'רקע'],
      ['§4', 'new-card', 'טיפול בתקלה'],
    ]);
    const first = out[0].payload;
    if (first.type !== 'new-card') throw new Error('expected a new-card payload');
    expect(first.phases).toHaveLength(1);
    expect(first.phases[0].label).toBe('שלבי הטיפול');
    expect(first.phases[0].steps.map((s) => s.sourceRef)).toEqual(['§2', '§3']);
  });

  it('a headless source is one card named after the source', async () => {
    const out = await new RuleBasedModel().proposeChanges(
      ctxFor([{ ref: 'p-1', runs: [{ t: 'טקסט חופשי ללא כותרת כלשהי.' }] }], { title: 'מסמך חופשי' }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('מסמך חופשי');
  });

  it('leaves the update path alone once the source feeds a step', async () => {
    const ctx = ctxFor(htmlToParagraphs(WP_HTML_EDITED), { title: WP_TITLE, singleDocument: true });
    ctx.linkedSteps = [
      {
        documentId: '11111111-1111-4111-8111-111111111111',
        documentTitle: WP_TITLE,
        stepKey: 's1',
        stepNum: '1',
        stepTitle: 'סף מהירות',
        anchor: 'h2-1.p-1',
        actions: ['סף מהירות: 5 מגה.'],
      },
    ];
    ctx.diffs = [
      {
        ref: 'h2-1.p-1',
        kind: 'changed',
        before: 'סף מהירות: 5 מגה.',
        after: 'סף מהירות: 6 מגה.',
        similarity: 0.9,
      },
    ];
    const out = await new RuleBasedModel().proposeChanges(ctx);
    expect(out.map((s) => s.type)).toEqual(['update-step']);
  });
});
