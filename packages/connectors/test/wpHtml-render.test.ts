import { describe, it, expect } from 'vitest';
import { renderWpHtml, htmlToParagraphs } from '../src/index.js';
import { paragraphText, type Document, type Block } from '@wecom/shared';
import { docFixture } from './helpers/docFixture.js';

const BLOCK = '33333333-3333-4333-8333-333333333333';
const block: Block = {
  id: BLOCK,
  slug: 'sim-refresh',
  title: 'ריענון SIM',
  kind: 'step',
  actions: [
    { id: 'b1', text: 'CRM ← sim block lbl ← שמור' },
    { id: 'b2', text: 'בקש מהלקוח לאתחל מכשיר' },
  ],
  outcomes: [],
  currentVersion: 2,
  updatedAt: '2025-06-12T00:00:00.000Z',
};
const doc = docFixture as unknown as Document;

describe('renderWpHtml', () => {
  it('is deterministic and structured', () => {
    const html = renderWpHtml({ document: doc, html: '', blocks: [block] });
    expect(html).toBe(renderWpHtml({ document: doc, html: '', blocks: [block] }));
    expect(html).toContain('<h2>שלב 1 – מסנן</h2>');
    expect(html).toContain('<h3 data-kb-step="s1">1. בדיקת חסימה</h3>');
    expect(html).toContain('<li>פתח CRM ↗ שדה <b>"גלישה בארץ"</b></li>');
    expect(html).toContain('<table class="kb-branch">');
    expect(html).toContain('<blockquote class="kb-script">"מה מוצג?"</blockquote>');
    expect(html).toContain(`<div data-kb-block="${BLOCK}">`);
    expect(html).toContain('<li>בקש מהלקוח לאתחל מכשיר</li>');
    expect(html).not.toContain('class="crm');
  });
  it('round-trips through htmlToParagraphs', () => {
    const ps = htmlToParagraphs(renderWpHtml({ document: doc, html: '', blocks: [block] }));
    const text = ps.map(paragraphText).join('\n');
    expect(text).toContain('• פתח CRM ↗ שדה "גלישה בארץ"');
    expect(text).toContain('ניצל 100% | הצע חבילה');
    expect(ps.find((p) => p.heading === '3. ריענון SIM')).toBeDefined();
  });
});
