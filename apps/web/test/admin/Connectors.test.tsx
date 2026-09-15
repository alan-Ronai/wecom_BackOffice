import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { C_WP, stage5State } from '../msw/stage5.js';
import { describeCron } from '../../src/components/admin/ConnectorsPage.js';

const asAdmin = () => server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));

const row = async (name: string) =>
  (await within(await screen.findByRole('table')).findByText(name)).closest('tr') as HTMLElement;

describe('describeCron', () => {
  it('says what the schedule means, not what it is spelled like', () => {
    expect(describeCron(null)).toBe('ללא תזמון');
    expect(describeCron('*/30 * * * *')).toBe('כל 30 דק׳');
    expect(describeCron('0 */2 * * *')).toBe('כל 2 שעות');
    expect(describeCron('0 6 * * *')).toBe('כל יום ב-06:00');
    // An expression outside the presets is shown verbatim rather than mislabelled.
    expect(describeCron('15 3 * * 1')).toBe('15 3 * * 1');
  });
});

describe('admin · connector registry', () => {
  it('shows health, endpoint, schedule and only the capabilities the type declares', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/connectors' });

    const wp = await row('WordPress');
    expect(within(wp).getByText('תקין')).toBeInTheDocument();
    expect(within(wp).getByText('https://help.wecom.co.il')).toBeInTheDocument();
    expect(within(wp).getByText('כל 30 דק׳')).toBeInTheDocument();
    // WordPress declares read/write/webhooks but not identity.
    expect(within(wp).getByTitle('קריאה · כתיבה · webhook')).toBeInTheDocument();

    const folder = await row('תיקיית Word');
    expect(within(folder).getByText('טרם רץ')).toBeInTheDocument();
    expect(within(folder).getByText('ללא תזמון')).toBeInTheDocument();
    // A disabled connector cannot be told to run.
    expect(within(folder).getByRole('button', { name: 'הרץ עכשיו' })).toBeDisabled();
  });

  it('runs a connector and reports what the run actually did', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/connectors' });
    const wp = await row('WordPress');
    await userEvent.click(within(wp).getByRole('button', { name: 'הרץ עכשיו' }));
    await waitFor(() => expect(stage5State.runs).toContain(C_WP));
    expect(await screen.findByText('נקלטו 2 · נדחפו 1 · 0 קונפליקטים')).toBeInTheDocument();
  });

  it('surfaces a run that came back with errors as a warning, not a success', async () => {
    asAdmin();
    server.use(
      http.post('/api/v1/connectors/:id/run', () =>
        HttpResponse.json({ imported: 0, pushed: 0, conflicts: 0, errors: ['401 מהאתר'] }),
      ),
    );
    renderWithProviders(<App />, { route: '/admin/connectors' });
    const wp = await row('WordPress');
    await userEvent.click(within(wp).getByRole('button', { name: 'הרץ עכשיו' }));
    expect(await screen.findByText(/הריצה הסתיימה עם 1 שגיאות · 401 מהאתר/)).toBeInTheDocument();
  });

  it('toggles enabled with a PATCH that carries no config', async () => {
    asAdmin();
    let body: unknown;
    server.use(
      http.patch('/api/v1/connectors/:id', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...stage5State.connectors[0], enabled: false });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/connectors' });
    await userEvent.click(await screen.findByLabelText('פעיל: WordPress'));
    // An empty `config` on a PATCH would hand the server a blank configuration.
    await waitFor(() => expect(body).toEqual({ enabled: false }));
  });

  it('names what a delete takes with it before doing it', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/connectors' });
    await userEvent.click(await screen.findByLabelText('מחק WordPress'));
    expect(await screen.findByText(/38 קישורי סנכרון יימחקו/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'מחק' }));
    await waitFor(() => expect(stage5State.deleted).toContain(C_WP));
  });

  it('is read-only without connectors.manage', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'audit.read'] }));
    renderWithProviders(<App />, { route: '/admin/connectors' });
    // Not even reachable: the nav entry is gated on the same permission.
    expect(await screen.findByText('אין הרשאה לנהל מחברים')).toBeInTheDocument();
  });
});

describe('admin · connector wizard', () => {
  it('renders the form from the type configSchema, not from hand-written fields', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/connectors/new' });
    await userEvent.click(await screen.findByLabelText('WordPress'));
    await userEvent.click(screen.getByRole('button', { name: 'המשך' }));

    // string, url, secret, array and map each render as the control their schema implies —
    // every field the type declares, which is the whole of W-1: the settings step used to render
    // the connector's name and nothing else, for either type.
    expect(screen.getByLabelText('כתובת האתר')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('סיסמת אפליקציה')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('שם משתמש')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('סוד ה-webhook')).toHaveAttribute('type', 'password');
    // Schema defaults arrive pre-filled — the array as a comma list, the map as `key = value`.
    expect(screen.getByLabelText('סוגי תוכן')).toHaveValue('posts');
    expect(screen.getByLabelText('מיפוי קטגוריות')).toHaveValue('');
  });

  it('blocks the next step until every required field is filled', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/connectors/new' });
    await userEvent.click(await screen.findByLabelText('WordPress'));
    await userEvent.click(screen.getByRole('button', { name: 'המשך' }));

    // One message per empty required field, beside the field — not one summary line naming
    // fields the operator cannot see, which is what this screen used to (never) show.
    expect(screen.getAllByText(/שדה חובה/)).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'המשך לבדיקה' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('כתובת האתר'), 'https://help.wecom.co.il');
    await userEvent.type(screen.getByLabelText('שם משתמש'), 'kb-bot');
    await userEvent.type(screen.getByLabelText('סיסמת אפליקציה'), 'app-pass');
    // The connector's own `min(8)`, applied here rather than discovered as a 400.
    await userEvent.type(screen.getByLabelText('סוד ה-webhook'), 'short');
    expect(screen.getByText('סוד ה-webhook: לפחות 8 תווים')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'המשך לבדיקה' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('סוד ה-webhook'), 'er-secret');
    expect(screen.getByRole('button', { name: 'המשך לבדיקה' })).toBeEnabled();

    // And `z.string().url()`, likewise.
    await userEvent.clear(screen.getByLabelText('כתובת האתר'));
    await userEvent.type(screen.getByLabelText('כתובת האתר'), 'help.wecom.co.il');
    expect(screen.getByText(/^כתובת האתר: כתובת לא תקינה/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'המשך לבדיקה' })).toBeDisabled();
  });

  it('dry-tests an unsaved connector against the typed config', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: '/admin/connectors/new' });
    await userEvent.click(await screen.findByLabelText('WordPress'));
    await userEvent.click(screen.getByRole('button', { name: 'המשך' }));
    await userEvent.type(screen.getByLabelText('כתובת האתר'), 'http://insecure.example');
    await userEvent.type(screen.getByLabelText('שם משתמש'), 'kb-bot');
    await userEvent.type(screen.getByLabelText('סיסמת אפליקציה'), 'app-pass');
    await userEvent.type(screen.getByLabelText('סוד ה-webhook'), 'webhook-secret');
    await userEvent.click(screen.getByRole('button', { name: 'המשך לבדיקה' }));

    expect(screen.getByText('טרם נבדק')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'בדוק חיבור' }));
    expect(await screen.findByText(/כתובת האתר חייבת להיות https/)).toBeInTheDocument();
  });

  /**
   * W-1, the whole walk: `/admin/connectors → ✚ מחבר`, WordPress, every field of the type filled
   * in, tested, scheduled, created — and the POST carrying all six keys.
   *
   * The regression this exists for is exactly the one the operator walkthrough hit: step 2
   * rendered one input (*שם המחבר*), "בדוק חיבור" answered "הגדרות המחבר אינן תקינות" and
   * "צור מחבר" was a 400 with nowhere to type what was missing. Every automated cover of
   * connector creation before this one posted `POST /connectors` from the spec, which is what
   * let the form rot untouched — so this one types into the form and asserts on what it sends.
   */
  it('walks the WordPress wizard from the connectors page to a created connector', async () => {
    asAdmin();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/connectors', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...stage5State.connectors[0], id: C_WP }, { status: 201 });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/connectors' });

    await userEvent.click(await screen.findByRole('button', { name: '✚ מחבר' }));
    await userEvent.click(await screen.findByLabelText('WordPress'));
    await userEvent.click(screen.getByRole('button', { name: 'המשך' }));

    // Step 2 — the name, and one control per declared field.
    await userEvent.clear(screen.getByLabelText('שם המחבר'));
    await userEvent.type(screen.getByLabelText('שם המחבר'), 'אתר התמיכה');
    await userEvent.type(screen.getByLabelText('כתובת האתר'), 'https://help.wecom.co.il');
    await userEvent.type(screen.getByLabelText('שם משתמש'), 'kb-bot');
    await userEvent.type(screen.getByLabelText('סיסמת אפליקציה'), 'app-pass');
    await userEvent.clear(screen.getByLabelText('סוגי תוכן'));
    await userEvent.type(screen.getByLabelText('סוגי תוכן'), 'posts, pages');
    await userEvent.type(screen.getByLabelText('מיפוי קטגוריות'), 'sim-cards = sim');
    await userEvent.type(screen.getByLabelText('סוד ה-webhook'), 'webhook-secret');
    expect(screen.queryByText(/שדה חובה/)).not.toBeInTheDocument();

    // Step 3 — the dry run against the typed config, before anything is saved.
    await userEvent.click(screen.getByRole('button', { name: 'המשך לבדיקה' }));
    await userEvent.click(screen.getByRole('button', { name: 'בדוק חיבור' }));
    expect(await screen.findByText(/מחובר · WordPress/)).toBeInTheDocument();

    // Step 4 — schedule and create.
    await userEvent.click(screen.getByRole('button', { name: 'המשך לתזמון' }));
    await userEvent.selectOptions(screen.getByLabelText('תדירות'), '0 */1 * * *');
    await userEvent.click(screen.getByRole('button', { name: 'צור מחבר' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ type: 'wordpress', name: 'אתר התמיכה', schedule: '0 */1 * * *' });
    // The array is a list, the map is an object, the secrets are what was typed — the shapes
    // `WpConfigSchema` accepts, built by the form rather than by the test.
    expect(body!.config).toEqual({
      baseUrl: 'https://help.wecom.co.il',
      username: 'kb-bot',
      applicationPassword: 'app-pass',
      postTypes: ['posts', 'pages'],
      categoryMap: { 'sim-cards': 'sim' },
      webhookSecret: 'webhook-secret',
    });
    expect(await screen.findByText('המחבר נוצר')).toBeInTheDocument();
  });

  it('creates a connector with the chosen cron preset', async () => {
    asAdmin();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/connectors', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...stage5State.connectors[0], id: C_WP }, { status: 201 });
      }),
    );
    renderWithProviders(<App />, { route: '/admin/connectors/new' });
    await userEvent.click(await screen.findByLabelText('WordPress'));
    await userEvent.click(screen.getByRole('button', { name: 'המשך' }));
    await userEvent.type(screen.getByLabelText('כתובת האתר'), 'https://help.wecom.co.il');
    await userEvent.type(screen.getByLabelText('שם משתמש'), 'kb-bot');
    await userEvent.type(screen.getByLabelText('סיסמת אפליקציה'), 'app-pass');
    await userEvent.type(screen.getByLabelText('סוד ה-webhook'), 'webhook-secret');
    await userEvent.click(screen.getByRole('button', { name: 'המשך לבדיקה' }));
    await userEvent.click(screen.getByRole('button', { name: 'המשך לתזמון' }));
    await userEvent.selectOptions(screen.getByLabelText('תדירות'), '*/15 * * * *');
    await userEvent.click(screen.getByRole('button', { name: 'צור מחבר' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ type: 'wordpress', schedule: '*/15 * * * *' });
    expect((body!.config as Record<string, unknown>).applicationPassword).toBe('app-pass');
  });

  it('never sends a masked secret back, and offers the webhook details once an id exists', async () => {
    asAdmin();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.patch('/api/v1/connectors/:id', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(stage5State.connectors[0]);
      }),
    );
    renderWithProviders(<App />, { route: `/admin/connectors/${C_WP}` });
    // The saved secrets come back masked, so the field says "מוגדר" rather than showing bullets.
    await waitFor(() => expect(screen.getAllByText('מוגדר').length).toBe(2));

    await userEvent.click(screen.getByRole('button', { name: '4. תזמון' }));
    expect(screen.getByText(`http://kb.test/api/v1/connectors/${C_WP}/webhook`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }));

    await waitFor(() => expect(body).toBeDefined());
    // Nothing in the config was touched, so there is no `config` key at all. `{}` would be the
    // spelling that clears one, and restating the unchanged values would mean re-sending the
    // masked placeholders standing in for secrets this browser never received.
    expect(body).not.toHaveProperty('config');
  });

  it('sends only the config key the operator actually changed', async () => {
    asAdmin();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.patch('/api/v1/connectors/:id', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(stage5State.connectors[0]);
      }),
    );
    renderWithProviders(<App />, { route: `/admin/connectors/${C_WP}` });

    // The form is seeded from the connector's own `config` — the field that was absent from the
    // detail route's published shape, which loaded this form blank and PATCHed the blank back.
    const username = await screen.findByLabelText('שם משתמש');
    expect(username).toHaveValue('kb-bot');
    await userEvent.clear(username);
    await userEvent.type(username, 'kb-bot-2');

    await userEvent.click(screen.getByRole('button', { name: '4. תזמון' }));
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body!.config).toEqual({ username: 'kb-bot-2' });
  });

  it('does not offer a type change on a saved connector', async () => {
    asAdmin();
    renderWithProviders(<App />, { route: `/admin/connectors/${C_WP}` });
    expect(await screen.findByRole('button', { name: '1. סוג' })).toBeDisabled();
  });
});
