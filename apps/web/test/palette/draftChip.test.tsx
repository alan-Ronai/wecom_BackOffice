/**
 * M5 — a draft in the palette must look like a draft.
 *
 * Below the search threshold the palette answers out of the card cache, and `toHit` dropped the
 * one field that distinguishes those cards from one another: `status`. So "מסמכים שכבר נטענו"
 * offered an unpublished procedure and a published one as the same kind of row — same chips, same
 * label — to an agent who is on a call and has no way to check.
 *
 * The status the card already carries now travels with the row, and the row renders the same
 * `StatusChip` the library card and the article header use.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { localGroups, LOCAL_GROUP_LABELS } from '../../src/components/palette/localHits.js';
import { hitLabel } from '../../src/components/palette/hitLabel.js';
import { cards } from '../msw/fixtures.js';

/** A draft in the fixture corpus, and the first word of its title, for the two-character query. */
const draftCard = cards.find((c) => c.status === 'draft');

describe('localGroups', () => {
  it('carries the card status onto the hit', () => {
    const [group] = localGroups({
      cards: [{ ...cards[0]!, title: 'טיוטת בדיקה', status: 'draft' }],
      lastSeen: {},
      needle: 'טיוטת',
    });
    expect(group?.hits[0]?.status).toBe('draft');
  });

  it('says so in the announced label, where a chip will be drawn', () => {
    const hit = localGroups({
      cards: [{ ...cards[0]!, title: 'טיוטת בדיקה', status: 'draft' }],
      lastSeen: {},
      needle: 'טיוטת',
    })[0]!.hits[0]!;
    expect(hitLabel(hit).aria).toContain('טיוטה');
    // `published` is the normal state and draws no chip, so it is not announced either.
    expect(hitLabel({ ...hit, status: 'published' }).aria).not.toContain('פורסם');
  });
});

describe('the palette, below the search threshold', () => {
  it('marks a cached draft as a draft', async () => {
    expect(draftCard, 'the fixture corpus needs a draft for this to mean anything').toBeTruthy();
    renderWithProviders(<App />, { route: '/drafts' });
    // `/drafts` puts the draft cards in the query cache the palette reads; two characters of the
    // title keep the query under MIN_SEARCH_CHARS, which is the state under test.
    await screen.findAllByText(draftCard!.title);
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByPlaceholderText(/חפש מסמך/);
    await userEvent.type(input, draftCard!.title.slice(0, 2));

    const row = await waitFor(() => {
      const el = [...document.querySelectorAll('.res .ri[aria-label]')].find((n) =>
        n.getAttribute('aria-label')?.includes(draftCard!.title),
      );
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(within(row).getByText('טיוטה')).toHaveAttribute('data-status', 'draft');
    // And it is one of the local sections, not a search result: nothing was sent for two letters.
    const sections = Object.values(LOCAL_GROUP_LABELS).flatMap((l) => screen.queryAllByText(l));
    expect(sections.length).toBeGreaterThan(0);
  });
});
