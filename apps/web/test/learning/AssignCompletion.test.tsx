import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';
import { http, HttpResponse } from 'msw';
import { fx, LI_BRIEF, U2 } from '../msw/fixtures.js';

const asEditor = () =>
  server.use(
    withMe({
      roles: ['editor'],
      permissions: ['docs.read', 'learning.read', 'learning.manage', 'notes.write'],
    }),
  );

/** jsdom's `Blob` has no `.text()`; `FileReader` is how you read one there. */
const blobText = (b: Blob): Promise<string> =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(b);
  });

describe('assign and completion', () => {
  it('creates an audience of roles × worlds with due days', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await userEvent.click(await screen.findByRole('button', { name: 'הקצה' }));
    const dlg = await screen.findByRole('dialog', { name: 'הקצאת פריט למידה' });
    // `fx.roles` carries `lead` and `admin`; the world is the fixture's Hebrew name.
    await userEvent.click(await within(dlg).findByRole('checkbox', { name: 'lead' }));
    await userEvent.click(within(dlg).getByRole('checkbox', { name: 'חו"ל ונדידה' }));
    await userEvent.clear(within(dlg).getByLabelText('ימים להשלמה'));
    await userEvent.type(within(dlg).getByLabelText('ימים להשלמה'), '10');
    await userEvent.click(within(dlg).getByRole('button', { name: 'הקצה לקהל' }));
    await waitFor(() => expect(learningState.audiences).toHaveLength(1));
    expect(learningState.audiences[0]).toMatchObject({
      itemId: LI_BRIEF,
      roleNames: ['lead'],
      worldSlugs: ['intl'],
      dueDays: 10,
    });
    expect(await screen.findByText('הוקצה ל-12 משתמשים')).toBeInTheDocument();
  });

  it('assigns individuals picked from the people search', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await userEvent.click(await screen.findByRole('button', { name: 'הקצה' }));
    const dlg = await screen.findByRole('dialog', { name: 'הקצאת פריט למידה' });
    await userEvent.type(within(dlg).getByLabelText('חיפוש משתמש'), 'דנה');
    await userEvent.click(await within(dlg).findByRole('button', { name: /דנה/ }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'הקצה למשתמשים' }));
    // `דנה ר.` is U2 in the mentionable fixture.
    await waitFor(() =>
      expect(learningState.assigned).toEqual([{ itemId: LI_BRIEF, userIds: [U2], dueDays: 14 }]),
    );
  });

  it('shows completion rows and exports CSV', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await userEvent.click(await screen.findByRole('tab', { name: 'השלמה' }));
    const table = await screen.findByRole('table', { name: 'השלמות' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('באיחור')).toBeInTheDocument();
    const blobs: Blob[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => {
      blobs.push(b);
      return 'blob:x';
    };
    await userEvent.click(screen.getByRole('button', { name: 'ייצוא CSV' }));
    expect(blobs[0]!.type).toContain('text/csv');
    const csv = await blobText(blobs[0]!);
    // The dates read as the table shows them, not as raw ISO.
    expect(csv).toContain('1 ספטמבר 2026');
    expect(csv).not.toContain('2026-09-01T08:00:00.000Z');
    URL.createObjectURL = orig;
  });

  it('neutralises a display name that Excel would run as a formula', async () => {
    asEditor();
    server.use(
      http.get('/api/v1/learning/items/:id/completion', () =>
        HttpResponse.json({
          ...fx.completion,
          rows: [{ ...fx.completion.rows[0]!, displayName: '=1+1+cmd|calc' }],
        }),
      ),
    );
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await userEvent.click(await screen.findByRole('tab', { name: 'השלמה' }));
    await screen.findByRole('table', { name: 'השלמות' });
    const blobs: Blob[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => {
      blobs.push(b);
      return 'blob:x';
    };
    await userEvent.click(screen.getByRole('button', { name: 'ייצוא CSV' }));
    expect(await blobText(blobs[0]!)).toContain(`"'=1+1+cmd|calc"`);
    URL.createObjectURL = orig;
  });
});
