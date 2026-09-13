import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Fmt } from '../../src/components/Fmt.js';
import { ago, fmtDate, inDays } from '../../src/lib/format.js';

describe('<Fmt>', () => {
  it('renders CRM chips and bdi isolation', () => {
    const { container } = render(
      <Fmt
        text='פתח CRM ↗ שדה "גלישה בארץ" ← APN'
        fields={[{ name: 'גלישה בארץ', status: 'ok' }]}
        docs={[]}
      />,
    );
    expect(container.querySelector('.crm[data-crm="גלישה בארץ"]')).not.toBeNull();
    expect(container.querySelector('bdi.lat')?.textContent).toBe('CRM');
    expect([...container.querySelectorAll('bdi.lat')].map((n) => n.textContent)).toContain('APN');
  });
  it('never renders raw html from text', () => {
    render(<Fmt text="<img src=x onerror=alert(1)>" fields={[]} docs={[]} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });
  it('links documents by [[doc:id]] and by code', () => {
    const { container } = render(
      <Fmt
        text="המשך לפי [[doc:d1|איטיות גלישה]] או T-01"
        fields={[]}
        docs={[{ id: 'd1', title: 'איטיות גלישה', code: 'T-01' }]}
      />,
    );
    const links = [...container.querySelectorAll('a.doc-link')];
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('data-doc')).toBe('d1');
  });
});

describe('dates', () => {
  it('formats Hebrew dates', () => {
    expect(fmtDate('2025-06-12')).toBe('12 יוני 2025');
    expect(fmtDate('2025-06-12', { month: true })).toBe('יוני 2025');
  });
  it('relative time', () => {
    expect(ago(new Date(Date.now() - 3 * 864e5).toISOString())).toBe('לפני 3 ימים');
    expect(ago(new Date().toISOString())).toBe('עכשיו');
  });
  it('countdown', () => {
    expect(inDays(new Date(Date.now() - 1000).toISOString())).toBe('היום');
    expect(inDays(new Date(Date.now() + 3.5 * 864e5).toISOString())).toBe('בעוד 4 ימים');
  });
});
