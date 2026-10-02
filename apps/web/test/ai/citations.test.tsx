import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithStepLinks } from '../../src/components/ai/citations.js';

describe('step citations', () => {
  it('turns "שלב 3א" and "שלב 12" into links and leaves the rest of the text alone', () => {
    render(
      <MemoryRouter>{renderWithStepLinks('ראה שלב 3א ואחר כך שלב 12. שלבים רבים.', 'doc-1')}</MemoryRouter>,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/doc/doc-1/3א', '/doc/doc-1/12']);
    expect(screen.getByText(/שלבים רבים/)).toBeInTheDocument();
  });

  it('links by step key when the number → key index is known', () => {
    render(
      <MemoryRouter>
        {renderWithStepLinks('בצע שלב 3א', 'doc-1', { '3א': 'diag-sim', '4': 'swap' })}
      </MemoryRouter>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/doc/doc-1/diag-sim');
  });

  it('returns the text unchanged when nothing is cited', () => {
    render(<MemoryRouter>{renderWithStepLinks('אין כאן ציטוט', 'doc-1')}</MemoryRouter>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('אין כאן ציטוט')).toBeInTheDocument();
  });

  /**
   * The prose between citations keeps the pane's bidi treatment — `<Fmt>` isolates a Latin run in
   * a `<bdi dir="ltr">` so an RTL sentence does not scramble it — and it is escaped, so a model
   * cannot put markup on the screen by typing it.
   */
  it('renders the prose around a citation through the bidi-safe Fmt treatment', () => {
    const { container } = render(
      <MemoryRouter>{renderWithStepLinks('הרץ Speedtest ואז שלב 2', 'doc-1')}</MemoryRouter>,
    );
    expect(container.querySelector('bdi.lat')).toHaveTextContent('Speedtest');
    expect(screen.getByRole('link', { name: 'שלב 2' })).toBeInTheDocument();
  });

  it('escapes markup a model typed rather than rendering it', () => {
    const { container } = render(
      <MemoryRouter>{renderWithStepLinks('<img src=x onerror=alert(1)> שלב 3', 'doc-1')}</MemoryRouter>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).toContain('&lt;');
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(screen.getByRole('link', { name: 'שלב 3' })).toBeInTheDocument();
  });
});
