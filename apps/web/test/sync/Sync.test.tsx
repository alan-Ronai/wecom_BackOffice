import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PERMISSIONS, type Phase } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { LINK_CONFLICT, LINK_IMPORT, stage5State } from '../msw/stage5.js';

const asAdmin = () => server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));

const row = async (title: string) =>
  (await within(await screen.findByRole('table')).findByText(title)).closest('tr') as HTMLElement;

describe('sync · queue', () => {
  it('tabs carry the whole-queue counts, not the filtered page', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/sync' });
    expect(await screen.findByRole('tab', { name: 'קונפליקט 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'זהים 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ממתין לייבוא 1' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'קונפליקט 1' }));
    await row('איטיות גלישה');
    // The counts describe the queue; selecting a tab must not renumber them.
    expect(screen.getByRole('tab', { name: 'זהים 1' })).toBeInTheDocument();
  });

  it('opens on the state named in the URL, so a connector can link straight to its conflicts', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/sync?state=conflict' });
    await row('איטיות גלישה');
    expect(within(await screen.findByRole('table')).queryByText('ריענון SIM')).not.toBeInTheDocument();
  });

  it('offers only the direction a row can actually move', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/sync' });

    expect(within(await row('חו"ל ונדידה')).getByRole('button', { name: 'ייבא עכשיו' })).toBeEnabled();
    expect(within(await row('Hotspot לא עובד')).getByRole('button', { name: 'דחוף עכשיו' })).toBeEnabled();
    // A conflict cannot be synced in either direction until somebody resolves it.
    const conflict = await row('איטיות גלישה');
    expect(within(conflict).queryByRole('button', { name: /עכשיו/ })).not.toBeInTheDocument();
    expect(within(conflict).getByRole('button', { name: 'פתור קונפליקט' })).toBeInTheDocument();
    // An in-step row has nothing to do.
    expect(within(await row('ריענון SIM')).getByText('אין פעולה')).toBeInTheDocument();
  });

  it('imports one row and reports the direction it moved', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/sync' });
    await userEvent.click(within(await row('חו"ל ונדידה')).getByRole('button', { name: 'ייבא עכשיו' }));
    await waitFor(() => expect(stage5State.synced).toContainEqual({ id: LINK_IMPORT, direction: 'import' }));
    expect(await screen.findByText('נקלט מהמקור')).toBeInTheDocument();
  });

  it('surfaces a sync that returned errors as a failure', async () => {
    asAdmin();
    server.use(
      http.post('/api/v1/sync/links/:id/sync', () =>
        HttpResponse.json({ imported: 0, pushed: 0, conflicts: 0, errors: ['403 מהאתר'] }),
      ),
    );
    renderWithProviders(<App />, { route: '/sync' });
    await userEvent.click(within(await row('חו"ל ונדידה')).getByRole('button', { name: 'ייבא עכשיו' }));
    expect(await screen.findByText(/הסנכרון נכשל · 403 מהאתר/)).toBeInTheDocument();
  });

  it('refuses the queue without sources.manage', async () => {
    server.use(withMe({ roles: ['agent'], permissions: ['docs.read'] }));
    renderWithProviders(<App />, { route: '/sync' });
    expect(await screen.findByText('אין הרשאה לתור הסנכרון')).toBeInTheDocument();
  });
});

describe('sync · parity report', () => {
  it('groups links by connector and counts how many are in step', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/sync/parity' });
    expect(await screen.findByText(/1 מתוך 4 זהים · 1 קונפליקטים/)).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(5); // header + four links
  });
});

describe('sync · three-way merge', () => {
  it('shows base, remote and ours, and flags only the paragraph both sides edited', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: `/sync/conflicts/${LINK_CONFLICT}` });
    expect(await screen.findByText(/1 פסקאות בהתנגשות/)).toBeInTheDocument();
    // §7 is identical on both sides; §8 is the contested one; §10 exists only remotely.
    expect(screen.getAllByText('שני הצדדים השתנו')).toHaveLength(1);
    expect(screen.getByText('נוסף במקור')).toBeInTheDocument();
    expect(screen.getByText(/אם לא נפתר, פתח תקלה לרשת/)).toBeInTheDocument();
  });

  it('takes ours wholesale', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: `/sync/conflicts/${LINK_CONFLICT}` });
    await userEvent.click(await screen.findByRole('button', { name: 'שמור את שלנו' }));
    await waitFor(() =>
      expect(stage5State.resolved).toContainEqual({ id: LINK_CONFLICT, resolution: 'ours' }),
    );
    expect(await screen.findByText('הקונפליקט נפתר')).toBeInTheDocument();
  });

  it('builds a merged structure from the paragraphs picked on each side', async () => {
    asAdmin();
    let body: { resolution: string; merged?: { phases: Phase[] }; label?: string } | undefined;
    server.use(
      http.post('/api/v1/sync/links/:id/resolve', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ ...stage5State.links[0], state: 'synced' });
      }),
    );
    renderWithProviders(<App />, { route: `/sync/conflicts/${LINK_CONFLICT}` });

    // Take the contested §8 from WordPress, and import the remote-only §10.
    await userEvent.click(await screen.findByLabelText('קח מ-WordPress · §8'));
    await userEvent.click(screen.getByLabelText('קח מ-WordPress · §10'));
    await userEvent.click(screen.getByRole('button', { name: 'שמור מיזוג' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body!.resolution).toBe('merged');
    const steps = body!.merged!.phases.flatMap((p) => p.steps);
    // §8 now carries their text…
    expect(steps.find((s) => s.sourceRef === '§8')?.description).toMatch(/כשהוא מנותק מ-Wi-Fi/);
    // …§10 arrived as a new step, and §7 (untouched on both sides) is unchanged.
    expect(steps.find((s) => s.sourceRef === '§10')?.description).toMatch(/פתח תקלה לרשת/);
    expect(steps.find((s) => s.sourceRef === '§7')?.description).toMatch(/חיסכון בסוללה/);
    expect(body!.label).toContain('WordPress');
  });

  it('leaves a remote-only paragraph out unless it is picked', async () => {
    asAdmin();
    let body: { merged?: { phases: Phase[] } } | undefined;
    server.use(
      http.post('/api/v1/sync/links/:id/resolve', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ ...stage5State.links[0], state: 'synced' });
      }),
    );
    renderWithProviders(<App />, { route: `/sync/conflicts/${LINK_CONFLICT}` });
    await userEvent.click(await screen.findByRole('button', { name: 'שמור מיזוג' }));

    await waitFor(() => expect(body).toBeDefined());
    const steps = body!.merged!.phases.flatMap((p) => p.steps);
    expect(steps.some((s) => s.sourceRef === '§10')).toBe(false);
    // A contested paragraph defaults to ours, never to a silent overwrite.
    expect(steps.find((s) => s.sourceRef === '§8')?.description).toMatch(/ל-6 מגה/);
  });

  it('sends text the operator typed over the merge, not just the side they picked (4e)', async () => {
    asAdmin();
    let body: { merged?: { phases: Phase[] } } | undefined;
    server.use(
      http.post('/api/v1/sync/links/:id/resolve', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ ...stage5State.links[0], state: 'synced' });
      }),
    );
    renderWithProviders(<App />, { route: `/sync/conflicts/${LINK_CONFLICT}` });

    // §8 is the contested paragraph: a WordPress editor and a KB author both changed it, so
    // neither column is the answer. That is the case the three-way screen could not resolve.
    const result = await screen.findByLabelText('תוצאה · §8');
    await userEvent.clear(result);
    await userEvent.type(result, 'נסח מוסכם לשני הצדדים');
    expect(screen.getByLabelText('בטל עריכה · §8')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'שמור מיזוג' }));
    await waitFor(() => expect(body).toBeDefined());
    const steps = body!.merged!.phases.flatMap((p) => p.steps);
    expect(steps.find((s) => s.sourceRef === '§8')?.description).toBe('נסח מוסכם לשני הצדדים');
  });

  it('picking a side after editing discards the edit, so the pick means what it says', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: `/sync/conflicts/${LINK_CONFLICT}` });

    const result = await screen.findByLabelText('תוצאה · §8');
    await userEvent.clear(result);
    await userEvent.type(result, 'טיוטה');
    await userEvent.click(screen.getByLabelText('קח מ-WordPress · §8'));

    expect(screen.queryByLabelText('בטל עריכה · §8')).not.toBeInTheDocument();
    expect((screen.getByLabelText('תוצאה · §8') as HTMLTextAreaElement).value).toMatch(/כשהוא מנותק מ-Wi-Fi/);
  });

  it('refuses to resolve without suggestions.apply', async () => {
    server.use(withMe({ roles: ['editor'], permissions: ['docs.read', 'sources.manage'] }));
    renderWithProviders(<App />, { route: `/sync/conflicts/${LINK_CONFLICT}` });
    expect(await screen.findByText('אין הרשאה לפתור קונפליקטים')).toBeInTheDocument();
  });
});
