import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../render.js';
import { MyLearningPage } from '../../src/components/learning/MyLearningPage.js';

const mount = () =>
  renderWithProviders(
    <Routes>
      <Route path="/learning" element={<MyLearningPage />} />
      <Route path="/learning/:assignmentId" element={<div data-testid="assignment-page" />} />
    </Routes>,
    { route: '/learning' },
  );

describe('<MyLearningPage>', () => {
  it('lists open, overdue and completed assignments with kind, due date and status', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'הלמידה שלי' })).toBeInTheDocument();
    // The heading paints before the query settles, so wait for the first section.
    const open = await screen.findByRole('region', { name: 'פתוחות' });
    expect(within(open).getAllByRole('article')).toHaveLength(2);
    expect(within(open).getByText('תדריך: איטיות גלישה')).toBeInTheDocument();
    expect(within(open).getByText('תדריך')).toBeInTheDocument();
    expect(within(open).getByText('שאלון')).toBeInTheDocument();
    const overdue = screen.getByRole('region', { name: 'באיחור' });
    expect(within(overdue).getByText('רענון ידע')).toBeInTheDocument();
    expect(within(overdue).getByText(/שינוי מהותי במסמך/)).toBeInTheDocument();
    const done = screen.getByRole('region', { name: 'הושלמו' });
    expect(within(done).getByText('ציון 90')).toBeInTheDocument();
  });
  it('opens an assignment', async () => {
    mount();
    await userEvent.click(await screen.findByRole('link', { name: /תדריך: איטיות גלישה/ }));
    expect(await screen.findByTestId('assignment-page')).toBeInTheDocument();
  });
  it('shows an empty state when nothing is assigned', async () => {
    const { learningState } = await import('../msw/learning-handlers.js');
    learningState.my = { open: [], overdue: [], completed: [], invalidated: [] };
    mount();
    expect(await screen.findByText('אין לך מטלות למידה כרגע')).toBeInTheDocument();
  });
});
