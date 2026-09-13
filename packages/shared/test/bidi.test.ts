import { describe, it, expect } from 'vitest';
import { fmt, crmIn, stripFmt } from '../src/format/index.js';

const fields = [{ name: 'גלישה בארץ', status: 'ok' as const }, { name: 'sim block lbl', status: 'ok' as const }, { name: 'שירות נדידה', status: 'renamed' as const, renamedTo: 'שירותי נדידה' }];
const docs = [{ id: '11111111-1111-4111-8111-111111111111', title: 'אין גלישה בחו"ל', code: 'R-02' }];

describe('fmt', () => {
  it('isolates latin runs', () => {
    expect(fmt('ודא שה-APN מוגדר ל-WE', { fields })).toBe('ודא שה-<bdi class="lat" dir="ltr">APN</bdi> מוגדר ל-<bdi class="lat" dir="ltr">WE</bdi>');
  });
  it('renders CRM chips with status', () => {
    const html = fmt('פתח CRM ↗ שדה "שירות נדידה"', { fields });
    expect(html).toContain('class="crm rtl renamed"');
    expect(html).toContain('data-crm="שירות נדידה"');
  });
  it('renders bold, links and codes', () => {
    const html = fmt('המשך לפי [[doc:11111111-1111-4111-8111-111111111111|אין גלישה]] או **R-02**', { fields, docs });
    expect(html).toContain('<a class="doc-link" data-doc="11111111-1111-4111-8111-111111111111">אין גלישה</a>');
    expect(html).toContain('<b><a class="doc-link"');
  });
  it('escapes html', () => {
    expect(fmt('<script>', { fields })).toBe('&lt;<bdi class="lat" dir="ltr">script</bdi>&gt;');
  });
  it('skips chips when noCrm', () => {
    expect(fmt('גלישה בארץ', { fields, noCrm: true })).toBe('גלישה בארץ');
  });
});
describe('crmIn / stripFmt', () => {
  it('finds longest names first', () => {
    expect(crmIn('שוב עריכה ← sim block lbl ← שמור', fields.map((f) => f.name))).toEqual(['sim block lbl']);
  });
  it('strips markup', () => {
    expect(stripFmt('**x** [[doc:abc|y]]')).toBe('x y');
  });
});
