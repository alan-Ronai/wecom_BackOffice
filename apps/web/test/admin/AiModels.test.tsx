import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { MODEL_TIER_PRESETS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { ModelsTab } from '../../src/components/admin/ai/ModelsTab.js';
import { aiAdminState } from '../msw/ai-admin.js';

// `confirm` is a dialog the user drives; the reindex test is about what the button does once they
// have said yes, so the provider's promise is resolved here instead of clicked through.
const { confirmSpy } = vi.hoisted(() => ({ confirmSpy: vi.fn(() => Promise.resolve(true)) }));
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

describe('ModelsTab', () => {
  it('fills the three slots from the tier preset', async () => {
    renderWithProviders(<ModelsTab />, { route: '/admin/ai?tab=models' });
    const tier = await screen.findByLabelText('דרגה');
    expect(tier).toHaveValue('1');
    fireEvent.change(tier, { target: { value: '2' } });
    const p = MODEL_TIER_PRESETS[2];
    expect(screen.getByLabelText('תג המודל · מודל הצעות')).toHaveValue(p.suggestModel);
    expect(screen.getByLabelText("תג המודל · מודל צ'אט")).toHaveValue(p.chatModel);
    expect(screen.getByLabelText('תג המודל · מודל הטמעה')).toHaveValue(p.embedModel);
    expect(screen.getByLabelText('מספר ממדים')).toHaveValue(p.embedDimension);
  });

  it('tests the embed slot and reports the width it returned', async () => {
    renderWithProviders(<ModelsTab />, { route: '/admin/ai?tab=models' });
    await screen.findByLabelText('דרגה');
    fireEvent.click(screen.getAllByRole('button', { name: 'בדוק' })[2]);
    expect(await screen.findByText(/1024 ממדים/)).toBeInTheDocument();
    expect(screen.getByText(/✔ זמין/)).toBeInTheDocument();
    expect(aiAdminState.lastTest).toBe('embed');
  });

  it('saves the slots and warns that a new width needs a reindex', async () => {
    renderWithProviders(<ModelsTab />, { route: '/admin/ai?tab=models' });
    const tier = await screen.findByLabelText('דרגה');
    fireEvent.change(tier, { target: { value: '0' } }); // 768 dims — a real change
    expect(screen.getByText('שינוי ממדים דורש אינדוקס מחדש')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect((aiAdminState.lastPut as { models: { tier: number } }).models.tier).toBe(0));
    expect((aiAdminState.lastPut as { models: { embedDimension: number } }).models.embedDimension).toBe(768);
  });

  it('queues a reindex once the confirmation is accepted', async () => {
    renderWithProviders(<ModelsTab />, { route: '/admin/ai?tab=models' });
    await screen.findByLabelText('דרגה');
    fireEvent.click(screen.getByRole('button', { name: 'אינדוקס מחדש' }));
    await waitFor(() => expect(aiAdminState.reindexQueued).toBe(1));
    expect(confirmSpy).toHaveBeenCalled();
  });
});
