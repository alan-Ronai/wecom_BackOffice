import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { ConversationsTab } from '../../src/components/admin/ai/ConversationsTab.js';
import { aiAdminState, CONV_1, sampleConversation } from '../msw/ai-admin.js';

const { downloadSpy, confirmSpy } = vi.hoisted(() => ({
  downloadSpy: vi.fn(),
  confirmSpy: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('../../src/lib/format.js', async (orig) => ({
  ...((await orig()) as object),
  download: downloadSpy,
}));
vi.mock('../../src/components/ui/Modal.js', async (orig) => ({
  ...((await orig()) as object),
  useModal: () => ({
    confirm: confirmSpy,
    open: () => () => {},
    close: () => {},
    prompt: async () => null,
    count: 0,
  }),
}));

describe('ConversationsTab', () => {
  it('lists a conversation and opens its transcript', async () => {
    renderWithProviders(<ConversationsTab />, { route: '/admin/ai?tab=conversations' });
    const table = await screen.findByRole('table', { name: 'שיחות' });
    const row = await waitFor(() => within(table).getByText('נועה').closest('tr')!);
    expect(row).toHaveTextContent('טיפול באיטיות גלישה');
    expect(row).toHaveTextContent('סביבת עבודה');
    expect(row).toHaveTextContent('שתי הודעות');

    fireEvent.click(within(row).getByRole('button', { name: /ספטמבר/ }));
    const transcript = await screen.findByRole('region', { name: 'תמליל' });
    await waitFor(() =>
      expect(within(transcript).getByLabelText('משתמש')).toHaveTextContent('קצר את סעיף 3'),
    );
    const assistant = within(transcript).getByLabelText('המערכת');
    expect(assistant).toHaveTextContent('propose_source_edit');
    expect(within(assistant).getByLabelText('משוב חיובי')).toBeInTheDocument();
    expect(assistant).toHaveTextContent('14 שנ׳');
  });

  /*
   * X6 fix wave (B-I3): there is no feedback filter. It filtered nothing — `serverQuery` stripped
   * it, no browser-side filter ran, and the covering test only ever saw the *empty* state that a
   * changed query key produced while the refetch was in flight.
   */
  it('offers no feedback filter, because the route has no such field', async () => {
    renderWithProviders(<ConversationsTab />, { route: '/admin/ai?tab=conversations' });
    await screen.findByText('נועה');
    expect(screen.queryByLabelText('משוב')).toBeNull();
  });

  it('says it is loading, not that nothing matched, while a filter change is in flight', async () => {
    renderWithProviders(<ConversationsTab />, { route: '/admin/ai?tab=conversations' });
    await screen.findByText('נועה');
    fireEvent.change(screen.getByLabelText('משתמש'), { target: { value: 'מישהו אחר' } });
    // The user box is debounced, then the new query key has no data yet: "טוען…", never
    // "אין שיחות תואמות." before the answer is in.
    expect(await screen.findByText('טוען…')).toBeInTheDocument();
    expect(screen.queryByText('אין שיחות תואמות.')).toBeNull();
    expect(await screen.findByText('אין שיחות תואמות.')).toBeInTheDocument();
  });

  it('debounces the user box into one request', async () => {
    aiAdminState.listCalls = 0;
    renderWithProviders(<ConversationsTab />, { route: '/admin/ai?tab=conversations' });
    await screen.findByText('נועה');
    const box = screen.getByLabelText('משתמש');
    for (const v of ['נ', 'נו', 'נוע', 'נועה']) fireEvent.change(box, { target: { value: v } });
    await waitFor(() => expect(screen.getByText('נועה')).toBeInTheDocument());
    // One initial list plus one for the settled value — not one per keystroke.
    await waitFor(() => expect(aiAdminState.listCalls).toBe(2));
  });

  it('wave Y (B-M12): searches message bodies through a debounced box, and the export follows it', async () => {
    aiAdminState.listCalls = 0;
    renderWithProviders(<ConversationsTab />, { route: '/admin/ai?tab=conversations' });
    await screen.findByText('נועה');
    const box = screen.getByLabelText('חיפוש בתוכן השיחות');
    for (const v of ['ל', 'למז', 'למזג']) fireEvent.change(box, { target: { value: v } });
    await waitFor(() => expect(aiAdminState.lastListQuery?.q).toBe('למזג'));
    // One initial list plus one for the settled value.
    expect(aiAdminState.listCalls).toBe(2);
    expect(await screen.findByText('נועה')).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'אין כזה ביטוי' } });
    expect(await screen.findByText('אין שיחות תואמות.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ייצוא JSONL' }));
    await waitFor(() => expect(aiAdminState.lastExportQuery).not.toBeNull());
    expect(aiAdminState.lastExportQuery).toMatchObject({ q: 'אין כזה ביטוי' });
    expect(aiAdminState.lastExportQuery).not.toHaveProperty('page');
  });

  it('wave Y (B-M12): pages through the list, and a filter change goes back to page 1', async () => {
    aiAdminState.conversations = Array.from({ length: 60 }, (_, i) =>
      sampleConversation({
        id: `e0000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`,
        userName: `משתמש ${i + 1}`,
      }),
    );
    renderWithProviders(<ConversationsTab />, { route: '/admin/ai?tab=conversations' });
    const pager = await screen.findByRole('navigation', { name: 'דפדוף בשיחות' });
    expect(pager).toHaveTextContent('עמוד 1 מתוך 2 · 60 שיחות');
    expect(within(pager).getByRole('button', { name: 'הקודם' })).toBeDisabled();
    expect(screen.getByText('משתמש 50')).toBeInTheDocument();
    expect(screen.queryByText('משתמש 51')).toBeNull();

    fireEvent.click(within(pager).getByRole('button', { name: 'הבא' }));
    expect(await screen.findByText('משתמש 51')).toBeInTheDocument();
    expect(aiAdminState.lastListQuery?.page).toBe('2');
    const p2 = screen.getByRole('navigation', { name: 'דפדוף בשיחות' });
    expect(p2).toHaveTextContent('עמוד 2 מתוך 2');
    await waitFor(() => expect(within(p2).getByRole('button', { name: 'הבא' })).toBeDisabled());

    fireEvent.change(screen.getByLabelText('מתאריך'), { target: { value: '2026-09-01' } });
    await waitFor(() => expect(aiAdminState.lastListQuery?.from).toBeTruthy());
    expect(aiAdminState.lastListQuery).not.toHaveProperty('page');
    expect(await screen.findByText('משתמש 1')).toBeInTheDocument();
  });

  it('exports the filtered transcripts as JSONL', async () => {
    downloadSpy.mockClear();
    renderWithProviders(<ConversationsTab />, { route: '/admin/ai?tab=conversations' });
    fireEvent.click(await screen.findByRole('button', { name: 'ייצוא JSONL' }));
    await waitFor(() => expect(aiAdminState.exportCalls).toBe(1));
    expect(downloadSpy.mock.calls[0][0]).toMatch(/^ai-conversations-\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(downloadSpy.mock.calls[0][2]).toBe('application/x-ndjson');
  });

  it('deletes a conversation after confirmation', async () => {
    renderWithProviders(<ConversationsTab />, { route: '/admin/ai?tab=conversations' });
    fireEvent.click(await screen.findByRole('button', { name: 'מחק' }));
    await waitFor(() => expect(aiAdminState.deleted).toContain(CONV_1));
    expect(confirmSpy).toHaveBeenCalled();
    expect(await screen.findByText('אין שיחות תואמות.')).toBeInTheDocument();
  });
});
