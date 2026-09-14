/**
 * A-3 (acceptance review §3, §7 item 13) — the Hebrew counters, and the two screens the review
 * named by name: the topic page reading `1 פריטים` and the library header reading `1 נושאים`.
 */
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import {
  counted,
  documents,
  items,
  notes,
  results,
  suggestions,
  topics,
  users,
  versions,
} from '../../src/lib/count.js';

describe('Hebrew counters', () => {
  it('never says "1 <plural>"', () => {
    expect(items(1)).toBe('פריט אחד');
    expect(topics(1)).toBe('נושא אחד');
    expect(documents(1)).toBe('מסמך אחד');
    expect(versions(1)).toBe('גרסה אחת');
    expect(results(1)).toBe('תוצאה אחת');
    expect(suggestions(1)).toBe('הצעה אחת');
    expect(notes(1)).toBe('הערה אחת');
    expect(users(1)).toBe('משתמש אחד');
  });

  it('uses the dual, with the right gender', () => {
    // Masculine nouns take שני, feminine ones שתי — getting this wrong is as visible to a Hebrew
    // reader as "two items" vs "twoo items" is to an English one.
    expect(items(2)).toBe('שני פריטים');
    expect(documents(2)).toBe('שני מסמכים');
    expect(users(2)).toBe('שני משתמשים');
    expect(versions(2)).toBe('שתי גרסאות');
    expect(results(2)).toBe('שתי תוצאות');
    expect(notes(2)).toBe('שתי הערות');
  });

  it('uses digits from three up, and for zero', () => {
    expect(items(3)).toBe('3 פריטים');
    expect(topics(50)).toBe('50 נושאים');
    expect(items(0)).toBe('0 פריטים');
  });

  it('agrees the verb with the count, so the fix does not swap one error for another', () => {
    // `פריט אחד יועברו` would be worse Hebrew than `1 פריטים` — the verb inflects with the
    // subject, so a counting sentence has two things to get right.
    expect(counted(1, items, 'יועבר', 'יועברו')).toBe('פריט אחד יועבר');
    expect(counted(2, items, 'יועבר', 'יועברו')).toBe('שני פריטים יועברו');
    expect(counted(5, items, 'יועבר', 'יועברו')).toBe('5 פריטים יועברו');
    expect(counted(0, items, 'יועבר', 'יועברו')).toBe('0 פריטים יועברו');
  });
});

describe('the screens the review named', () => {
  it('the library header counts topics in Hebrew rather than "N נושאים" unconditionally', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const head = (await screen.findAllByRole('heading', { level: 1 }))[0];
    const text = head.textContent ?? '';
    // Whatever the fixture's count is, the header must never read "1 נושאים".
    expect(text).not.toMatch(/\b1 נושאים/);
    expect(text).toMatch(/נושא אחד|שני נושאים|\d+ נושאים/);
  });

  it('the pinned view — one fixture card — reads "נושא אחד"', async () => {
    renderWithProviders(<App />, { route: '/pinned' });
    const head = await screen.findByRole('heading', { level: 1, name: /מוצמדים/ });
    expect(within(head).getByText(/נושא אחד|שני נושאים|\d+ נושאים/)).toBeInTheDocument();
    expect(head.textContent).not.toMatch(/\b1 נושאים/);
  });
});
