import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { learningState } from '../msw/learning-manage.js';

describe('/gaps', () => {
  it('ranks open gaps with evidence and actions; a reader without gaps.manage cannot dismiss', async () => {
    server.use(withMe({ roles: ['editor'], permissions: ['docs.read', 'gaps.read'] }));
    renderWithProviders(<App />, { route: '/gaps' });
    const items = await screen.findAllByRole('article');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole('heading', { name: /"esim"/ })).toBeInTheDocument();
    // The evidence the heuristic fired on is on the card, not behind a click.
    expect(within(items[0]!).getByText(/lastTerms/)).toBeInTheDocument();
    expect(within(items[0]!).getByRole('link', { name: 'צור פריט' })).toHaveAttribute(
      'href',
      expect.stringContaining('/edit/new?title=esim'),
    );
    expect(screen.queryByRole('button', { name: 'דחה' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'הרץ זיהוי עכשיו' })).toBeNull();
  });

  it('dismisses with a reason, resolves to a document, and runs detection', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'gaps.read', 'gaps.manage'] }));
    renderWithProviders(<App />, { route: '/gaps' });
    const first = (await screen.findAllByRole('article'))[0]!;
    await userEvent.click(within(first).getByRole('button', { name: 'דחה' }));
    await userEvent.type(await screen.findByLabelText('סיבה'), 'כפילות של מונח קיים');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(learningState.gaps[0]!.status).toBe('dismissed'));
    await waitFor(async () => expect(await screen.findAllByRole('article')).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'הרץ זיהוי עכשיו' }));
    await waitFor(() => expect(learningState.detectRuns).toBe(1));
    expect(await screen.findByText('פער אחד זוהה · שני פערים עודכנו')).toBeInTheDocument();
  });

  it('resolves a gap against the document that closes it', async () => {
    server.use(withMe({ roles: ['lead'], permissions: ['docs.read', 'gaps.read', 'gaps.manage'] }));
    renderWithProviders(<App />, { route: '/gaps' });
    const first = (await screen.findAllByRole('article'))[0]!;
    await userEvent.click(within(first).getByRole('button', { name: 'סמן כטופל' }));
    await userEvent.type(await screen.findByLabelText('הפריט שסוגר את הפער'), 'גלישה');
    await userEvent.click(await screen.findByRole('option', { name: /איטיות גלישה/ }));
    await waitFor(() => expect(learningState.gaps[0]!.status).toBe('resolved'));
    expect(learningState.gaps[0]!.resolvedDocumentId).toBeTruthy();
  });
});
