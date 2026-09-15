import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';
import { D_BROWSING } from '../msw/fixtures.js';

const asEditor = () =>
  server.use(
    withMe({
      roles: ['editor'],
      permissions: ['docs.read', 'learning.read', 'learning.manage', 'gaps.read'],
    }),
  );
const asLead = () => server.use(withMe({ roles: ['lead'], permissions: [...PERMISSIONS] }));

describe('/learning/manage', () => {
  it('lists items with kind, status, completion and filters by kind', async () => {
    asEditor();
    renderWithProviders(<App />, { route: '/learning/manage' });
    const list = await screen.findByTestId('learning-items');
    expect(await within(list).findAllByRole('article')).toHaveLength(2);
    expect(within(list).getByText(/75%/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('סוג'), 'quiz');
    expect(await within(await screen.findByTestId('learning-items')).findAllByRole('article')).toHaveLength(
      1,
    );
  });

  it('creates a quiz and lands in its editor', async () => {
    asEditor();
    renderWithProviders(<App />, { route: '/learning/manage' });
    await screen.findByTestId('learning-items');
    await userEvent.click(screen.getByRole('button', { name: '✚ שאלון' }));
    await userEvent.type(await screen.findByLabelText('כותרת'), 'שאלון חדש');
    // `modal.prompt`'s confirm button is labelled 'אישור' app-wide.
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    expect(await screen.findByRole('heading', { level: 1, name: /שאלון חדש/ })).toBeInTheDocument();
    expect(learningState.items.some((i) => i.title === 'שאלון חדש' && i.kind === 'quiz')).toBe(true);
  });

  it('filters to the items referencing a document when ?documentId= is set (the article badge links here)', async () => {
    asEditor();
    renderWithProviders(<App />, { route: `/learning/manage?documentId=${D_BROWSING}` });
    const list = await screen.findByTestId('learning-items');
    // Only the quiz anchors questions to that document.
    expect(await within(list).findAllByRole('article')).toHaveLength(1);
    expect(screen.getByText(/מסונן לפי פריט ידע/)).toBeInTheDocument();
    // The document-scoped list ignores all four facets, so they say so instead of writing to the
    // URL and changing nothing.
    expect(screen.getByLabelText('סוג')).toBeDisabled();
    expect(screen.getByLabelText('סטטוס')).toBeDisabled();
    expect(screen.getByLabelText('עולם תוכן')).toBeDisabled();
    expect(screen.getByLabelText('חיפוש')).toBeDisabled();
    expect(screen.getByText('הסינון אינו זמין בתצוגה של פריט ידע יחיד')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'בטל סינון לפי פריט ידע' }));
    expect(await within(await screen.findByTestId('learning-items')).findAllByRole('article')).toHaveLength(
      2,
    );
  });

  it('shows the dashboard panel to a lead and hides the page from a reader', async () => {
    asLead();
    const lead = renderWithProviders(<App />, { route: '/learning/manage' });
    expect(await screen.findByText('ממתינים לרענון')).toBeInTheDocument();
    lead.unmount();
    server.use(withMe({ roles: ['agent'], permissions: ['docs.read', 'learning.read'] }));
    renderWithProviders(<App />, { route: '/learning/manage' });
    expect(await screen.findByText('אין הרשאה לניהול למידה')).toBeInTheDocument();
  });
});
