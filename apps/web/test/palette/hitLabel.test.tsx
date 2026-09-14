/**
 * A-2 (acceptance review §3, §7 item 8) — a search result is labelled with the knowledge item,
 * not the ingest filename.
 *
 * The review's exact complaint: every palette hit read `topics.json · תמיכה טכנית · שלב 1 – מסנן`.
 * `topics.json` is the static file the seed was imported from — "the single most visible 'this is
 * a tool built for its builders' moment in the agent path".
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { hitLabel } from '../../src/components/palette/hitLabel.js';
import type { SearchHit } from '../../src/api/types.js';

const stepHit: SearchHit = {
  type: 'step',
  id: 'doc-1#s11',
  documentId: 'doc-1',
  stepKey: 's11',
  num: '11',
  title: 'ריענון SIM',
  snippet: 'בתוך איטיות גלישה',
  meta: 'topics.json · תמיכה טכנית · שלב 1 – מסנן',
  score: 80,
  docType: 'M',
  world: 'tech',
  docTitle: 'איטיות גלישה / חוסר גלישה',
};

describe('hitLabel', () => {
  it('drops the ingest filename', () => {
    const label = hitLabel(stepHit);
    expect(label.rest.join(' ')).not.toMatch(/topics\.json/);
    expect(label.aria).not.toMatch(/\.json/);
  });

  it('names the knowledge item and keeps the matched section as the row title', () => {
    const label = hitLabel(stepHit);
    // The step title stays the headline; the document is what the meta row adds.
    expect(label.item).toBe('איטיות גלישה / חוסר גלישה');
    expect(label.rest).toContain('שלב 1 – מסנן');
  });

  it('carries the item type and world for the chips', () => {
    const label = hitLabel(stepHit);
    expect(label.docType).toBe('M');
    expect(label.world).toBe('tech');
    // The world is rendered as a chip, so repeating its label as text would be noise.
    expect(label.rest).not.toContain('תמיכה טכנית');
  });

  it('does not repeat a document hit’s own title as the item', () => {
    const docHit: SearchHit = {
      ...stepHit,
      type: 'document',
      title: 'איטיות גלישה / חוסר גלישה',
      meta: 'topics.json · תמיכה טכנית · v7',
    };
    expect(hitLabel(docHit).item).toBeNull();
    expect(hitLabel(docHit).rest).toContain('v7');
  });

  it('falls back to meta for a hit with no knowledge item behind it', () => {
    // A CRM field, a shared block or a tag carries none of the three new fields, and the world
    // label in `meta` is then the most useful thing the row has.
    const fieldHit: SearchHit = {
      type: 'field',
      id: 'גלישה בארץ',
      title: 'גלישה בארץ',
      snippet: '',
      meta: 'crm-fields.json · ok',
      score: 10,
    };
    const label = hitLabel(fieldHit);
    expect(label.docType).toBeUndefined();
    expect(label.world).toBeNull();
    expect(label.rest).toEqual(['ok']);
  });

  it('announces the type, the item and the world in one label', () => {
    expect(hitLabel(stepHit).aria).toBe(
      'שלב · ריענון SIM · M · אבחון · תמיכה טכנית · איטיות גלישה / חוסר גלישה · שלב 1 – מסנן',
    );
  });
});

describe('<Palette> result rows', () => {
  const open = async () => {
    await screen.findAllByText('ספריית ידע');
    await userEvent.keyboard('{Control>}k{/Control}');
    return screen.findByPlaceholderText(/חפש מסמך/);
  };

  it('renders the library card’s chips on a hit, and no ingest filename anywhere', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const input = await open();
    await userEvent.type(input, 'ריענון sim');
    const res = document.querySelector('.palette .res') as HTMLElement;
    const row = await waitFor(() => {
      const el = within(res)
        .getByText(/ריענון SIM/)
        .closest('.ri') as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    // The same two chips `DocCard` renders, reused rather than re-implemented.
    expect(within(row).getByText('טכני')).toBeInTheDocument();
    expect(row.querySelector('.type-badge')?.getAttribute('data-doctype')).toBe('M');
    // The knowledge item the step belongs to.
    expect(within(row).getByText('איטיות גלישה / חוסר גלישה')).toBeInTheDocument();
    expect(res.textContent).not.toMatch(/topics\.json/);
  });

  it('gives the keyboard the same label through aria-label', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const input = await open();
    await userEvent.type(input, 'ריענון sim');
    const row = await screen.findByRole('button', { name: /^שלב · ריענון SIM · M · אבחון · תמיכה טכנית/ });
    expect(row).toHaveClass('ri');
  });
});
