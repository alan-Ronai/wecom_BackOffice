import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PERMISSIONS, type Phase } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { C_WP, D_UNLINKED, LINK_CONFLICT, LINK_IMPORT, REMOTE_UNLINKED, stage5State } from '../msw/stage5.js';

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

describe('sync · parity report (design 4d)', () => {
  it('groups links by connector and counts how many are in step', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/sync/parity' });
    expect(await screen.findByText(/1 מתוך 2 זהים · 1 קונפליקטים/)).toBeInTheDocument();
    const [table] = await screen.findAllByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + two links
  });

  it('shows each side its own fingerprint, and flags the side that moved', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/sync/parity' });
    const [table] = await screen.findAllByRole('table');
    const row = within(table).getByText('איטיות גלישה').closest('tr') as HTMLElement;
    // Seven characters, as the design shows: a full sha256 in a table cell is noise.
    expect(within(row).getByText('7d02be9')).toBeInTheDocument(); // remote now
    expect(within(row).getByText('a91c4f2')).toBeInTheDocument(); // the library
    // Both sides moved off the baseline, and each says so beside its own hash.
    expect(within(row).getAllByText('השתנה')).toHaveLength(2);

    // The row that never moved carries no badge at all.
    const inStep = within(table).getByText('ריענון SIM').closest('tr') as HTMLElement;
    expect(within(inStep).queryByText('השתנה')).not.toBeInTheDocument();
  });

  it('says the remote was unreadable instead of printing a column of dashes', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/sync/parity' });
    expect(await screen.findByText(/לא ניתן היה לקרוא את הצד המרוחק/)).toBeInTheDocument();
  });

  it('lists what has no link on either side, and links a pair', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/sync/parity' });
    expect(await screen.findByText('מסמך ללא קישור')).toBeInTheDocument();
    expect(screen.getByText('עמוד שאין לו מסמך')).toBeInTheDocument();

    // A pairing needs both ends: "קשר" is inert until a document is selected, because completing
    // it without one would mean inventing an externalId.
    const linkBtn = screen.getByRole('button', { name: 'קשר' });
    expect(linkBtn).toBeDisabled();

    await userEvent.click(screen.getByLabelText('בחר מסמך ללא קישור'));
    expect(linkBtn).toBeEnabled();
    await userEvent.click(linkBtn);

    await waitFor(() =>
      expect(stage5State.created).toContainEqual({
        connectorId: C_WP,
        documentId: D_UNLINKED,
        externalId: REMOTE_UNLINKED,
      }),
    );
    expect(await screen.findByText(/הקישור נוצר/)).toBeInTheDocument();
  });

  it('surfaces a 409 in the server’s own words, not a generic failure', async () => {
    asAdmin();
    server.use(
      http.post('/api/v1/sync/links', () =>
        HttpResponse.json(
          { code: 'ALREADY_LINKED', message: 'הפריט המרוחק כבר מקושר למסמך אחר' },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(<App />, { route: '/sync/parity' });
    await userEvent.click(await screen.findByLabelText('בחר מסמך ללא קישור'));
    await userEvent.click(screen.getByRole('button', { name: 'קשר' }));
    expect(await screen.findByText('הפריט המרוחק כבר מקושר למסמך אחר')).toBeInTheDocument();
  });

  it('shows the lists read-only to a reviewer who cannot create links', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'suggestions.apply'] }));
    renderWithProviders(<App />, { route: '/sync/parity' });
    expect(await screen.findByText('מסמך ללא קישור')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'קשר' })).not.toBeInTheDocument();
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
