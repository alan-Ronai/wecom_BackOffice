/**
 * X6 — every wave 6 component mounted into the shell, the admin console, the article, the editor
 * and the sources page.
 *
 * One describe per mount task. The lanes each proved their component in isolation; these are the
 * only tests that assert the *seam* — that the component is reachable from the screen spec §5 puts
 * it on, behind the permission the spec asks for.
 */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { fx, D_BROWSING, SRC_TECH } from '../msw/fixtures.js';
import { DOCK_TITLE } from '../../src/components/ai/EditorChatDock.js';
import { ASK_TITLE } from '../../src/components/ai/ArticleAskPane.js';

const B = '/api/v1';
const side = async () => within(await screen.findByRole('complementary', { name: 'ניווט ראשי' }));

/** The fixture user is a full admin; every gate below needs a narrower one. */
const withPermissions = (...permissions: string[]) =>
  server.use(http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, permissions })));

describe('X6 shell + admin console mounts', () => {
  it('lists בינה מלאכותית under admin for ai.manage', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const s = await side();
    expect(await s.findByText('בינה מלאכותית')).toBeInTheDocument();
  });

  it('hides it without ai.manage', async () => {
    withPermissions('docs.read', 'users.manage');
    renderWithProviders(<App />, { route: '/library' });
    const s = await side();
    await s.findByText('משתמשים');
    expect(s.queryByText('בינה מלאכותית')).toBeNull();
  });

  it('opens /admin/ai from the admin console tabs', async () => {
    renderWithProviders(<App />, { route: '/admin/ai' });
    expect(await screen.findByRole('heading', { name: 'בינה מלאכותית', level: 1 })).toBeInTheDocument();
    const tab = screen.getAllByRole('link', { name: 'בינה מלאכותית' }).find((a) => a.closest('.admin-nav'));
    expect(tab).toHaveClass('active');
  });
});

describe('X6 article mounts', () => {
  it('offers the ask pane to an agent and no workspace link', async () => {
    withPermissions('docs.read', 'ai.ask');
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    expect(await screen.findByRole('button', { name: ASK_TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /סביבת עבודה/ })).toBeNull();
  });

  it('offers the workspace link to an editor with ai.chat and hides the pane without ai.ask', async () => {
    withPermissions('docs.read', 'docs.edit', 'ai.chat');
    renderWithProviders(<App />, { route: `/doc/${D_BROWSING}` });
    expect(await screen.findByRole('button', { name: /סביבת עבודה/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ASK_TITLE })).toBeNull();
  });
});

describe('X6 editor mounts', () => {
  it('shows the chat dock and the workspace link for ai.chat', async () => {
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
    expect(await screen.findByRole('complementary', { name: DOCK_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /סביבת עבודה/ })).toHaveAttribute(
      'href',
      `/workspace/${D_BROWSING}`,
    );
  });

  it('hides the dock without ai.chat', async () => {
    withPermissions('docs.read', 'docs.edit');
    renderWithProviders(<App />, { route: `/edit/${D_BROWSING}` });
    await screen.findByLabelText('שם פריט הידע');
    expect(screen.queryByRole('complementary', { name: DOCK_TITLE })).toBeNull();
    expect(screen.queryByRole('link', { name: /סביבת עבודה/ })).toBeNull();
  });
});

describe('X6 sources-page mounts', () => {
  it('renders the workspace suggestions panel — affects chips and the structured editor', async () => {
    renderWithProviders(<App />, { route: `/sources/${SRC_TECH}` });
    const panel = await screen.findByRole('complementary', { name: 'הצעות לכרטיסים' });
    const detailed = await within(panel).findAllByRole('button', { name: 'עריכה מפורטת' });
    await userEvent.click(detailed[0]!);
    expect(await screen.findByRole('dialog', { name: /עריכת ההצעה/ })).toBeInTheDocument();
  });
});
