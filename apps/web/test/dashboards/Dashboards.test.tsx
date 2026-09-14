import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { BarList, Donut } from '../../src/components/dashboards/charts.js';

describe('<DashboardsPage>', () => {
  it('renders all five tiles from GET /dashboards', async () => {
    renderWithProviders(<App />, { route: '/dashboards' });

    expect(await screen.findByText('כיסוי')).toBeInTheDocument();
    expect(screen.getByText('רעננות')).toBeInTheDocument();
    expect(screen.getByText('שימוש')).toBeInTheDocument();
    expect(screen.getByText('צינור הצעות')).toBeInTheDocument();
    expect(screen.getByText('התאמת סנכרון')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'פתח רשימה' })).toHaveLength(5);
  });

  it('states each series in words, not only in colour', async () => {
    renderWithProviders(<App />, { route: '/dashboards' });
    await screen.findByText('כיסוי');

    // Coverage: 23 of 52 cards have a document.
    expect(screen.getByLabelText(/כיסוי כרטיסים: עם מסמך 23/)).toBeInTheDocument();
    expect(screen.getByLabelText(/כיסוי לפי קטגוריה: תמיכה טכנית 13/)).toBeInTheDocument();
    expect(screen.getByLabelText(/מצב ההצעות: ממתינות 2, אושרו 9/)).toBeInTheDocument();
    expect(screen.getByLabelText(/מצב הקישורים: זהים 33/)).toBeInTheDocument();
  });

  it('shows the usage numbers and the freshness warnings', async () => {
    renderWithProviders(<App />, { route: '/dashboards' });
    await screen.findByText('שימוש');

    expect(screen.getByText('1222')).toBeInTheDocument();
    expect(screen.getByText('צפיות · 7 ימים')).toBeInTheDocument();
    expect(screen.getByText('486')).toBeInTheDocument();
    expect(screen.getByText('301')).toBeInTheDocument();

    // Categories whose median age is over 180 days are called out by name.
    expect(screen.getByText(/חיובים · עודכן לאחרונה מעולם לא/)).toBeInTheDocument();
    expect(screen.getByText('מעל 180 יום')).toBeInTheDocument();
  });

  it('drills from a bar into the list it summarises', async () => {
    renderWithProviders(<App />, { route: '/dashboards' });
    await screen.findByText('שימוש');

    const usage = screen.getByLabelText(/המסמכים המובילים/);
    await userEvent.click(within(usage).getByText('איטיות גלישה / חוסר גלישה'));
    expect(await screen.findByText(/15 שלבים/)).toBeInTheDocument();
  });

  it('drills from a tile header into the library', async () => {
    renderWithProviders(<App />, { route: '/dashboards' });
    await screen.findByText('כיסוי');
    await userEvent.click(screen.getAllByRole('button', { name: 'פתח רשימה' })[0]);
    expect(await screen.findByTestId('library-grid')).toBeInTheDocument();
  });

  it('refetches on demand', async () => {
    renderWithProviders(<App />, { route: '/dashboards' });
    await screen.findByText('כיסוי');
    await userEvent.click(screen.getByRole('button', { name: '⟳ רענן' }));
    await waitFor(() => expect(screen.getByText('כיסוי')).toBeInTheDocument());
  });
});

describe('charts', () => {
  it('a donut with no data does not divide by zero', () => {
    render(
      <Donut
        caption="ריק"
        center="0"
        slices={[
          { label: 'א', value: 0, color: 'var(--ok)' },
          { label: 'ב', value: 0, color: 'var(--warn)' },
        ]}
      />,
    );
    expect(screen.getAllByText('0%')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'ריק: א 0, ב 0' })).toBeInTheDocument();
  });

  it('a bar never overflows its track, even past its denominator', () => {
    const { container } = render(<BarList caption="גלישה" bars={[{ label: 'א', value: 200, of: 100 }]} />);
    expect(container.querySelector('.bar-track i')).toHaveStyle({ width: '100%' });
  });

  it('renders an empty series as a message rather than an empty box', () => {
    render(<BarList caption="ריק" bars={[]} />);
    expect(screen.getByText('אין נתונים')).toBeInTheDocument();
  });

  it('only makes a row a button when it actually drills somewhere', () => {
    render(
      <BarList
        caption="מעורב"
        bars={[
          { label: 'לחיץ', value: 1, onClick: () => {} },
          { label: 'סטטי', value: 1 },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: /לחיץ/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /סטטי/ })).toBeNull();
  });
});
