import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { ModelsTab } from '../../src/components/admin/ai/ModelsTab.js';
import { aiAdminState, sampleSettings } from '../msw/ai-admin.js';

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

const MODELS = sampleSettings().models;

describe('ModelsTab', () => {
  /*
   * X6 fix wave: the model block is resolved from the environment and `PUT /admin/ai/settings`
   * refuses one (400 `MODELS_ENV_ONLY`), so the tab shows it and does not offer to edit it.
   */
  it('shows the resolved tier and slots read-only, with no way to edit them', async () => {
    renderWithProviders(<ModelsTab />, { route: '/admin/ai?tab=models' });
    expect(await screen.findByRole('heading', { name: 'דרגת מודלים' })).toBeInTheDocument();
    expect(screen.getByText(`דרגה ${MODELS.tier}`)).toBeInTheDocument();
    expect(screen.getByLabelText('תג המודל · מודל הצעות')).toHaveTextContent(MODELS.suggestModel);
    expect(screen.getByLabelText("תג המודל · מודל צ'אט")).toHaveTextContent(MODELS.chatModel);
    expect(screen.getByLabelText('תג המודל · מודל הטמעה')).toHaveTextContent(MODELS.embedModel);
    expect(screen.getByText(new RegExp(`${MODELS.embedDimension} ממדים`))).toBeInTheDocument();
    // No tier select, no slot inputs, no dimension field — only the two limits are editable.
    expect(screen.queryByLabelText('דרגה')).toBeNull();
    expect(screen.queryByLabelText('מספר ממדים')).toBeNull();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
  });

  it('tests the embed slot and reports the width it returned', async () => {
    renderWithProviders(<ModelsTab />, { route: '/admin/ai?tab=models' });
    await screen.findByRole('heading', { name: 'דרגת מודלים' });
    fireEvent.click(screen.getAllByRole('button', { name: 'בדוק' })[2]!);
    expect(await screen.findByText(/1024 ממדים/)).toBeInTheDocument();
    expect(screen.getByText(/✔ זמין/)).toBeInTheDocument();
    expect(aiAdminState.lastTest).toBe('embed');
  });

  it('saves the limits and sends no models block', async () => {
    renderWithProviders(<ModelsTab />, { route: '/admin/ai?tab=models' });
    await screen.findByRole('heading', { name: 'דרגת מודלים' });
    fireEvent.change(screen.getByLabelText("הודעות צ'אט למשתמש לשעה"), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() =>
      expect(
        (aiAdminState.lastPut as { limits: { chatPerUserPerHour: number } }).limits.chatPerUserPerHour,
      ).toBe(90),
    );
    expect(aiAdminState.lastPut).not.toHaveProperty('models');
  });

  it('queues a reindex once the confirmation is accepted', async () => {
    renderWithProviders(<ModelsTab />, { route: '/admin/ai?tab=models' });
    await screen.findByRole('heading', { name: 'דרגת מודלים' });
    fireEvent.click(screen.getByRole('button', { name: 'אינדוקס מחדש' }));
    await waitFor(() => expect(aiAdminState.reindexQueued).toBe(1));
    expect(confirmSpy).toHaveBeenCalled();
  });
});
