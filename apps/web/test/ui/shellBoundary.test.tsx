/**
 * M1 — the outer boundary must not be a one-way door.
 *
 * `Shell` renders the sidebar, the tab strip, the notification bell, the palette, the peek drawer
 * and the tour *beside* the route outlet, all under one boundary that was mounted without a
 * `resetKey`. So a throw anywhere in that chrome replaced the entire application with the crash
 * panel and left it there: `נסה שוב` re-rendered the same overlay in the same state that had just
 * thrown, and navigating — the one thing an agent mid-call would try — changed nothing.
 *
 * Two fixes, two tests: the outer boundary now keys on the path like the route one, and each
 * overlay has a boundary of its own that closes it instead of taking the app down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from '../../src/components/ui/ErrorBoundary.js';

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('the shell boundary', () => {
  it('clears on navigation, so a crashed overlay does not outlive the page it crashed on', async () => {
    /** Stands in for the chrome: it throws only while the agent is on the page that broke it. */
    function Chrome() {
      const loc = useLocation();
      if (loc.pathname === '/doc/a') throw new Error('פאנל שבור');
      return <nav aria-label="ניווט ראשי">ספרייה</nav>;
    }
    function Jump() {
      const go = useNavigate();
      return <button onClick={() => go('/library')}>לספרייה</button>;
    }
    render(
      <MemoryRouter initialEntries={['/doc/a']}>
        <Jump />
        {/* No `resetKey` — exactly how `routes.tsx` mounts it. */}
        <ErrorBoundary where="shell">
          <Chrome />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('משהו השתבש')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'לספרייה' }));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'ניווט ראשי' })).toBeInTheDocument());
    expect(screen.queryByText('משהו השתבש')).not.toBeInTheDocument();
  });
});

describe('an overlay boundary', () => {
  function Boom(): never {
    throw new Error('חלונית שבורה');
  }

  it('closes the overlay and leaves the app usable, instead of painting over it', async () => {
    // The arrangement `Shell` builds: chrome and outlet first, overlays after, each in its own
    // boundary with no panel of its own.
    render(
      <MemoryRouter initialEntries={['/library']}>
        <ErrorBoundary where="shell">
          <div>
            <nav aria-label="ניווט ראשי">ספרייה</nav>
            <Routes>
              <Route path="/library" element={<div>תוכן העמוד</div>} />
            </Routes>
            <ErrorBoundary where="palette" fallback={null}>
              <Boom />
            </ErrorBoundary>
          </div>
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'ניווט ראשי' })).toBeInTheDocument();
    expect(screen.getByText('תוכן העמוד')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still reports the throw — silent to the agent is not silent to the console', () => {
    render(
      <MemoryRouter initialEntries={['/library']}>
        <ErrorBoundary where="palette" fallback={null}>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    const logged = vi.mocked(console.error).mock.calls;
    expect(logged.some((a) => String(a[0]).includes('ErrorBoundary:palette'))).toBe(true);
  });
});

describe('Shell', () => {
  it('wraps each overlay, not just the outlet', async () => {
    // A structural check on the real component: whatever the palette does, the shell survives it.
    vi.doMock('../../src/components/palette/Palette.js', () => ({
      Palette: () => {
        throw new Error('פלטה שבורה');
      },
    }));
    const { Shell } = await import('../../src/components/shell/Shell.js');
    const { renderWithProviders } = await import('../render.js');
    renderWithProviders(
      <ErrorBoundary where="shell">
        <Routes>
          <Route element={<Shell />}>
            <Route path="/library" element={<div>תוכן העמוד</div>} />
          </Route>
        </Routes>
      </ErrorBoundary>,
      { route: '/library' },
    );
    expect(await screen.findByText('תוכן העמוד')).toBeInTheDocument();
    expect(screen.queryByText('משהו השתבש')).not.toBeInTheDocument();
    vi.doUnmock('../../src/components/palette/Palette.js');
  });
});
