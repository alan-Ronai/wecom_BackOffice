import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING } from '../msw/fixtures.js';
import { hrefForNode } from '../../src/components/graph/ImpactPanel.js';

const svg = () => screen.findByTestId('graph-svg');

describe('<GraphPage>', () => {
  it('renders one node per kind with an accessible name, and typed edges', async () => {
    renderWithProviders(<App />, { route: '/graph' });
    const g = await svg();

    expect(within(g).getAllByRole('button', { name: /^מסמך: / }).length).toBe(6);
    expect(within(g).getByLabelText('בלוק: ריענון SIM')).toBeInTheDocument();
    expect(within(g).getByLabelText('שדה CRM: שירות נדידה')).toBeInTheDocument();
    expect(within(g).getByLabelText(/^מקור: /)).toBeInTheDocument();
    expect(within(g).getByLabelText(/^תסריט: /)).toBeInTheDocument();

    // Edges carry their LinkType, which is what the legend and the filters key off.
    expect(g.querySelectorAll('[data-type="shares_block"]').length).toBeGreaterThan(0);
    expect(g.querySelectorAll('[data-type="same_field"]').length).toBeGreaterThan(0);
  });

  it('counts the nodes by kind in the topbar', async () => {
    renderWithProviders(<App />, { route: '/graph' });
    await svg();
    expect(screen.getByText('מסמכים 6')).toBeInTheDocument();
    expect(screen.getByText('בלוקים 2')).toBeInTheDocument();
    expect(screen.getByText('שדות CRM 2')).toBeInTheDocument();
  });

  it('filters by link type and puts the filter in the URL', async () => {
    renderWithProviders(<App />, { route: '/graph' });
    const g = await svg();
    expect(g.querySelectorAll('[data-type="same_field"]').length).toBeGreaterThan(0);

    // Turning one type off leaves the rest on.
    await userEvent.click(screen.getByRole('button', { name: 'אותו שדה CRM' }));
    await waitFor(() =>
      expect(screen.getByTestId('graph-svg').querySelectorAll('[data-type="same_field"]')).toHaveLength(0),
    );
    expect(
      screen.getByTestId('graph-svg').querySelectorAll('[data-type="shares_block"]').length,
    ).toBeGreaterThan(0);
  });

  it('selecting a node shows "מה נשבר אם אמחק" from the impact route', async () => {
    renderWithProviders(<App />, { route: '/graph' });
    const g = await svg();

    await userEvent.click(within(g).getByLabelText(/^מסמך: איטיות גלישה/));
    expect(await screen.findByText('מה נשבר אם אמחק')).toBeInTheDocument();
    // Three documents point at it; two of those are `link` edges, which are what actually break.
    expect(await screen.findByLabelText('3 מסמכים מושפעים')).toBeInTheDocument();
    expect(screen.getByLabelText('2 קישורים יישברו')).toBeInTheDocument();
    // The inbound list names the documents *and* the step the reference sits on.
    const panel = screen.getByLabelText('פרטי צומת');
    expect(within(panel).getByText('דיבאג נטישה')).toBeInTheDocument();
    expect(within(panel).getByText('שלב s2 · קישור')).toBeInTheDocument();
  });

  it('separates "something points at this" from "a link will break"', async () => {
    renderWithProviders(<App />, { route: '/graph' });
    const g = await svg();
    await userEvent.click(within(g).getByLabelText('בלוק: ריענון SIM'));
    // Two documents embed the block, so they are affected — but `shares_block` is a derived
    // edge, not a link someone clicks, so nothing *breaks*.
    expect(await screen.findByLabelText('2 מסמכים מושפעים')).toBeInTheDocument();
    expect(screen.getByLabelText('0 קישורים יישברו')).toBeInTheDocument();
  });

  it('focuses a node into the querystring and narrows the graph with depth', async () => {
    renderWithProviders(<App />, { route: '/graph' });
    const g = await svg();
    const before = g.querySelectorAll('.gnode').length;

    await userEvent.click(within(g).getByLabelText(/^מסמך: איטיות גלישה/));
    await userEvent.click(await screen.findByRole('button', { name: 'מקד כאן' }));
    await waitFor(() => expect(screen.getByTestId('graph-svg').querySelector('.gnode.focus')).not.toBeNull());

    // Depth 1 is the node's immediate neighbourhood, which is strictly smaller than the whole graph.
    await userEvent.selectOptions(screen.getByLabelText('עומק המיקוד'), '1');
    await waitFor(() =>
      expect(screen.getByTestId('graph-svg').querySelectorAll('.gnode').length).toBeLessThan(before),
    );

    await userEvent.click(screen.getByRole('button', { name: 'נקה מיקוד' }));
    await waitFor(() => expect(screen.getByText('מסמכים 6')).toBeInTheDocument());
  });

  it('marks document nodes with data-doc so the shared hover Peek works on them', async () => {
    renderWithProviders(<App />, { route: '/graph' });
    const g = await svg();
    expect(g.querySelector(`[data-doc="${D_BROWSING}"]`)).not.toBeNull();
    // Non-document nodes deliberately carry no data-doc: there is no card to preview.
    expect(within(g).getByLabelText('בלוק: ריענון SIM')).not.toHaveAttribute('data-doc');
  });

  it('opens the selected document from the panel', async () => {
    renderWithProviders(<App />, { route: '/graph' });
    const g = await svg();
    await userEvent.click(within(g).getByLabelText(/^מסמך: איטיות גלישה/));
    await userEvent.click(await screen.findByRole('button', { name: 'פתח' }));
    expect(await screen.findByText(/15 שלבים/)).toBeInTheDocument();
  });
});

describe('hrefForNode', () => {
  it('maps every addressable node kind onto its route', () => {
    expect(hrefForNode('doc:abc')).toBe('/doc/abc');
    expect(hrefForNode('block:abc')).toBe('/blocks/abc');
    expect(hrefForNode('field:שירות נדידה')).toBe(
      '/fields/%D7%A9%D7%99%D7%A8%D7%95%D7%AA%20%D7%A0%D7%93%D7%99%D7%93%D7%94',
    );
    expect(hrefForNode('source:abc')).toBe('/sources/abc');
    // A script has no page of its own yet, and an unprefixed id is not a node id.
    expect(hrefForNode('script:abc')).toBeNull();
    expect(hrefForNode('abc')).toBeNull();
  });
});
