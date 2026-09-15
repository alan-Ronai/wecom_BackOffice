import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { ConversationsTab } from '../../src/components/admin/ai/ConversationsTab.js';
import { aiAdminState, CONV_1 } from '../msw/ai-admin.js';

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

  it('filters by feedback', async () => {
    renderWithProviders(<ConversationsTab />, { route: '/admin/ai?tab=conversations' });
    await screen.findByText('נועה');
    fireEvent.change(screen.getByLabelText('משוב'), { target: { value: 'down' } });
    expect(await screen.findByText('אין שיחות תואמות.')).toBeInTheDocument();
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
