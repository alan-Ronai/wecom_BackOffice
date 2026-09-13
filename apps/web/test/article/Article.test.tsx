import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { D_BROWSING } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';

const route = (step?: string) => `/doc/${D_BROWSING}${step ? '/' + step : ''}`;
const curStep = () => document.querySelector('.step.cur')?.getAttribute('data-step');

describe('<ArticlePage> call mode', () => {
  it('walks steps with the keyboard: ArrowDown, branch option 2, then outcome 1', async () => {
    renderWithProviders(<App />, { route: route() });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    await waitFor(() => expect(curStep()).toBe('s1'));

    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(curStep()).toBe('s2'));

    await userEvent.keyboard('2'); // branch option 2 → goto s3
    await waitFor(() => expect(curStep()).toBe('s3'));

    await userEvent.keyboard('1'); // "✓ הסתדר" has no goto → next step in order
    await waitFor(() => expect(curStep()).toBe('s4'));

    const jump = screen.getByTestId('jumpstrip');
    expect(within(jump).getByText('1')).toHaveClass('skip');
    expect(within(jump).getByText('2')).toHaveClass('done');
    expect(screen.getByTestId('summary').textContent).toContain('ש2 ✓ חבילה פעילה');
  });

  it('records a view once and resets progress', async () => {
    renderWithProviders(<App />, { route: route() });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    await waitFor(() => expect(state.views).toContain(D_BROWSING));
    await userEvent.keyboard('{ArrowDown}2');
    await waitFor(() => expect(screen.getByTestId('summary').textContent).toContain('ש2'));
    await userEvent.click(screen.getByTitle('אפס מעקב'));
    await waitFor(() => expect(curStep()).toBe('s1'));
  });

  it('shows step connections and the shared block chip for s11', async () => {
    renderWithProviders(<App />, { route: route('s11') });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    await waitFor(() => expect(curStep()).toBe('s11'));
    await waitFor(() => expect(screen.getByText('קשרים של השלב')).toBeInTheDocument());
    // both s10 and s11 embed a shared block
    expect(screen.getAllByText(/⧉ בלוק משותף/).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByText('sim block lbl')[0]).toHaveClass('crm'));
  });

  it('adds a note with N and shows it in the notes tab', async () => {
    renderWithProviders(<App />, { route: route() });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    await userEvent.keyboard('n');
    const box = await screen.findByLabelText('מה כדאי שנציגים אחרים ידעו בשלב הזה?');
    await userEvent.type(box, 'לבדוק גם VPN');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await userEvent.click(await screen.findByText(/הערות/));
    // `<Fmt>` isolates the Latin run, so the note text is split across nodes.
    expect(await screen.findByText(/לבדוק גם/)).toBeInTheDocument();
  });

  it('jumps with G then number', async () => {
    renderWithProviders(<App />, { route: route() });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    await userEvent.keyboard('g7{Enter}');
    await waitFor(() => expect(curStep()).toBe('s7'));
  });

  it('renders the card map and related documents in the panel', async () => {
    renderWithProviders(<App />, { route: route() });
    expect(await screen.findByText('מפת הכרטיס')).toBeInTheDocument();
    expect(await screen.findByText('אין גלישה בחו"ל')).toBeInTheDocument();
  });
});
