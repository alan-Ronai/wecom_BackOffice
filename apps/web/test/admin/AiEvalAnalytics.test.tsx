import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { EvalTab } from '../../src/components/admin/ai/EvalTab.js';
import { SuggestionAnalyticsTab } from '../../src/components/admin/ai/SuggestionAnalyticsTab.js';
import { aiAdminState } from '../msw/ai-admin.js';

describe('EvalTab', () => {
  it('lists a run with its scores and queues a new one', async () => {
    renderWithProviders(<EvalTab />, { route: '/admin/ai?tab=eval' });
    const table = await screen.findByRole('table', { name: 'ריצות הערכה' });
    const row = await waitFor(() => within(table).getByText('dictalm2.0-instruct:7b-q4_K_M').closest('tr')!);
    const cells = [...row.querySelectorAll('td')].map((c) => c.textContent);
    expect(cells).toContain('v3.2.1');
    expect(cells).toContain('40');
    expect(cells).toContain('78%');
    expect(cells).toContain('85%');
    expect(cells).toContain('61%');

    fireEvent.click(screen.getByRole('button', { name: 'הרץ הערכה' }));
    await waitFor(() => expect(aiAdminState.evalQueued).toBe(1));
    expect(await screen.findByText('ההערכה נוספה לתור')).toBeInTheDocument();
  });

  it('wave Y: shows precision and the language count as columns of their own', async () => {
    aiAdminState.evalRuns = [
      aiAdminState.evalRuns[0]!,
      {
        ...aiAdminState.evalRuns[0]!,
        id: 'e0000000-0000-4000-8000-0000000000e2',
        model: 'old-run',
        precision: null,
        languageFailures: null,
      },
    ];
    renderWithProviders(<EvalTab />, { route: '/admin/ai?tab=eval' });
    const table = await screen.findByRole('table', { name: 'ריצות הערכה' });
    await within(table).findByText('old-run');
    expect(within(table).getByRole('columnheader', { name: 'דיוק' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'כשלי שפה' })).toBeInTheDocument();
    const cellsOf = (model: string) =>
      [...within(table).getByText(model).closest('tr')!.querySelectorAll('td')].map((c) => c.textContent);
    const cells = cellsOf('dictalm2.0-instruct:7b-q4_K_M');
    expect(cells).toContain('0.962');
    expect(cells).toContain('3');
    // A run recorded before the column existed has no precision — a dash, never "0.000".
    const old = cellsOf('old-run');
    expect(old.filter((c) => c === '—')).toHaveLength(2);
    expect(old).not.toContain('0.000');
  });

  it('shows a run still in flight as running', async () => {
    aiAdminState.evalRuns = [{ ...aiAdminState.evalRuns[0], finishedAt: null, notes: 'לא רלוונטי' }];
    renderWithProviders(<EvalTab />, { route: '/admin/ai?tab=eval' });
    expect(await screen.findByText('רץ…')).toBeInTheDocument();
  });
});

describe('SuggestionAnalyticsTab', () => {
  it('shows the headline rates and the breakdown, and can regroup it', async () => {
    renderWithProviders(<SuggestionAnalyticsTab />, { route: '/admin/ai?tab=analytics' });
    const rate = await screen.findByText('56%');
    expect(rate.closest('.stat')).toHaveTextContent('אושרו');
    expect(screen.getAllByText('22%')).toHaveLength(2); // נערכו + נדחו
    expect(screen.getByText('95')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'פילוח הצעות' });
    expect(within(table).getByText('update-step')).toBeInTheDocument();
    expect(within(table).getByText('70')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('פילוח'), { target: { value: 'byModel' } });
    expect(within(table).getByText('dictalm2.0-instruct:7b-q4_K_M')).toBeInTheDocument();
    expect(within(table).queryByText('update-step')).toBeNull();
  });

  it('writes the date window to the URL and asks the server for it', async () => {
    renderWithProviders(<SuggestionAnalyticsTab />, { route: '/admin/ai?tab=analytics' });
    const from = await screen.findByLabelText('מתאריך');
    fireEvent.change(from, { target: { value: '2026-09-01' } });
    // Round-tripped through the URL, so the window can be linked to…
    expect(await screen.findByDisplayValue('2026-09-01')).toBeInTheDocument();
    // …and it is the window the query actually asked for: the *local* start of that day, which in
    // a UTC+n zone is not the same date string.
    await waitFor(() => expect(aiAdminState.lastAnalyticsQuery?.from).toBeTruthy());
    const sent = new Date(aiAdminState.lastAnalyticsQuery!.from);
    expect([sent.getFullYear(), sent.getMonth() + 1, sent.getDate(), sent.getHours()]).toEqual([
      2026, 9, 1, 0,
    ]);
  });
});
