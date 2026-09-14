import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../render.js';
import { AssignmentPage } from '../../src/components/learning/AssignmentPage.js';
import { A_BRIEF, learningState } from '../msw/learning-handlers.js';
import { fx } from '../msw/fixtures.js';

const mount = (id = A_BRIEF) =>
  renderWithProviders(
    <Routes>
      <Route path="/learning" element={<div data-testid="my-learning" />} />
      <Route path="/learning/:assignmentId" element={<AssignmentPage />} />
    </Routes>,
    { route: `/learning/${id}` },
  );

describe('<BriefingReader>', () => {
  it('renders the intro, the entries with the article step renderer, and acknowledges', async () => {
    mount();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'תדריך: איטיות גלישה' }),
    ).toBeInTheDocument();
    expect(screen.getByText('מה חדש בטיפול באיטיות גלישה')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: fx.docBrowsing.title })).toBeInTheDocument();
    expect(screen.getByText('שימו לב לסף החדש')).toBeInTheDocument();
    // The first step of the fixture document is rendered by the shared renderer.
    expect(screen.getByText(fx.docBrowsing.phases[0].steps[0].title)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'קראתי והבנתי' }));
    await waitFor(() => expect(learningState.acknowledged).toEqual([A_BRIEF]));
    expect(await screen.findByText('התדריך סומן כנקרא')).toBeInTheDocument();
    expect(await screen.findByTestId('my-learning')).toBeInTheDocument();
  });
  it('shows the changed-since-assigned banner on an entry', async () => {
    const { sampleBriefingPlayer } = await import('../msw/learning-handlers.js');
    const { http, HttpResponse } = await import('msw');
    const { server } = await import('../msw/server.js');
    const p = sampleBriefingPlayer();
    p.entries[0].changedSinceAssigned = true;
    server.use(http.get(`/api/v1/learning/my/${A_BRIEF}`, () => HttpResponse.json(p)));
    mount();
    expect(await screen.findByText('התוכן עודכן – יש לקרוא שוב')).toBeInTheDocument();
  });
  it('shows a not-found state for an unknown assignment', async () => {
    mount('a0000000-0000-4000-8000-0000000000ff');
    expect(await screen.findByText('המטלה לא נמצאה')).toBeInTheDocument();
  });
});
