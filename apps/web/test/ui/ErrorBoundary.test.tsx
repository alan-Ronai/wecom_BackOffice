/**
 * A-8 — the render-crash net (acceptance review §3, §6.2, §7 item 4).
 *
 * The thing being asserted is not "a panel appears". It is that a throw *below* the route keeps
 * everything *above* it alive: the sidebar, the topbar and `Ctrl K` are what let an agent who is
 * mid-call carry on in another document instead of reloading and losing the call's progress. So
 * the interesting test renders the real `routeObjects` with one route swapped for a thrower, and
 * looks at what is still on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import {
  MemoryRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
  useRoutes,
  type RouteObject,
} from 'react-router-dom';
import { ErrorBoundary, RouteBoundary } from '../../src/components/ui/ErrorBoundary.js';
import { RequireAuth } from '../../src/components/auth/RequireAuth.js';
import { routeObjects } from '../../src/routes.js';
import { stage45State } from '../msw/stage45.js';

/** React logs every caught error itself; the boundary adds one line of its own. */
let errors: unknown[][] = [];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errors.push(a);
  });
});
afterEach(() => vi.restoreAllMocks());

function Boom({ message = 'שלב פגום' }: { message?: string }): never {
  throw new Error(message);
}

const inRouter = (node: ReactNode, path = '/library') =>
  render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);

describe('ErrorBoundary', () => {
  it('replaces a throwing child with the Hebrew panel instead of unmounting the tree', () => {
    inRouter(
      <ErrorBoundary where="test">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('משהו השתבש')).toBeInTheDocument();
    // The message, so a support call can quote one useful line.
    expect(screen.getByText('שלב פגום')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'נסה שוב' })).toBeInTheDocument();
    // A real navigation, not a `<Link>`: the escape hatch must not depend on a context that may
    // itself be what broke.
    expect(screen.getByRole('link', { name: 'חזרה לספרייה' })).toHaveAttribute('href', '/library');
  });

  it('is RTL, so the panel reads correctly inside an LTR-defaulting container', () => {
    inRouter(
      <ErrorBoundary where="test">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('dir', 'rtl');
  });

  it('logs to console.error and posts a client_error telemetry row', async () => {
    inRouter(
      <ErrorBoundary where="shell">
        <Boom message="נפילה" />
      </ErrorBoundary>,
    );
    expect(errors.some((a) => String(a[0]).includes('ErrorBoundary:shell'))).toBe(true);
    await waitFor(() => expect(stage45State.telemetry.some((e) => e.kind === 'client_error')).toBe(true));
  });

  it('"נסה שוב" re-renders the subtree, and a child that has recovered comes back', async () => {
    function Flaky() {
      const [ok, setOk] = useState(false);
      // The button lives outside the boundary so it survives the crash — this stands in for the
      // shell chrome fixing whatever the page choked on (a refetch, a cache that settled).
      return (
        <>
          <button onClick={() => setOk(true)}>תקן</button>
          <ErrorBoundary where="test">{ok ? <div>הכול תקין</div> : <Boom />}</ErrorBoundary>
        </>
      );
    }
    inRouter(<Flaky />);
    expect(screen.getByText('משהו השתבש')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'תקן' }));
    await userEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(screen.getByText('הכול תקין')).toBeInTheDocument();
    expect(screen.queryByText('משהו השתבש')).not.toBeInTheDocument();
  });

  it('a route boundary clears itself when the path changes', async () => {
    // `RouteBoundary` keys on the pathname, so an agent who used the still-live palette to open
    // another document does not keep staring at the panel from the page they left. Both documents
    // match the *same* route pattern on purpose: that is what keeps React reusing one boundary
    // instance, which is exactly the case a remount would have hidden.
    function Doc() {
      const { id } = useParams();
      if (id === 'a') return <Boom />;
      return <div>מסמך אחר</div>;
    }
    function Jump() {
      const go = useNavigate();
      return <button onClick={() => go('/doc/b')}>פתח מסמך אחר</button>;
    }
    render(
      <MemoryRouter initialEntries={['/doc/a']}>
        <Jump />
        <Routes>
          <Route
            path="/doc/:id"
            element={
              <RouteBoundary>
                <Doc />
              </RouteBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('משהו השתבש')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'פתח מסמך אחר' }));
    await waitFor(() => expect(screen.getByText('מסמך אחר')).toBeInTheDocument());
    expect(screen.queryByText('משהו השתבש')).not.toBeInTheDocument();
  });

  it('a route that throws keeps the shell — sidebar and palette trigger stay on screen', () => {
    // The same two-level arrangement `routes.tsx` builds: the shell outside, the route inside.
    // This is the whole point of A-8 — the agent on a call can still search and open another
    // document, instead of meeting a white page.
    function FakeShell() {
      return (
        <div>
          <nav aria-label="ניווט ראשי">ספרייה</nav>
          <button>Ctrl K</button>
          <Outlet />
        </div>
      );
    }
    const routes: RouteObject[] = [
      {
        element: (
          <ErrorBoundary where="shell">
            <FakeShell />
          </ErrorBoundary>
        ),
        children: [{ path: 'doc/:id', element: <RouteBoundary>{<Boom />}</RouteBoundary> }],
      },
    ];
    function Tree() {
      return useRoutes(routes);
    }
    render(
      <MemoryRouter initialEntries={['/doc/x']}>
        <Tree />
      </MemoryRouter>,
    );
    expect(screen.getByText('משהו השתבש')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'ניווט ראשי' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ctrl K' })).toBeInTheDocument();
  });
});

describe('routeObjects', () => {
  /**
   * A structural assertion rather than 40 render tests: what must never regress is that *every*
   * route ships with the net, including one somebody adds next year. `<Navigate>` elements are
   * exempt — a redirect has nothing to render and nothing to throw.
   */
  const leaves = (rs: RouteObject[]): RouteObject[] =>
    rs.flatMap((r) => [r, ...(r.children ? leaves(r.children) : [])]);

  it('wraps every route element in a boundary', () => {
    const unguarded = leaves(routeObjects)
      .filter((r) => r.element)
      .filter((r) => {
        const el = r.element as { type?: unknown };
        if (el.type === Navigate) return false;
        // The `Shell` branch guards through `ErrorBoundary` nested inside `RequireAuth`.
        if (el.type === RequireAuth) return false;
        return el.type !== RouteBoundary;
      });
    expect(unguarded.map((r) => r.path ?? '(index)')).toEqual([]);
  });

  it('puts the shell boundary inside RequireAuth, so a logged-out visitor still redirects', () => {
    const shellRoute = routeObjects.find((r) => r.children?.length)!;
    const el = shellRoute.element as { type: unknown; props: { children: { type: unknown } } };
    expect(el.type).toBe(RequireAuth);
    expect(el.props.children.type).toBe(ErrorBoundary);
  });
});
