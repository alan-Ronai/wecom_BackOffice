import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { API_BASE } from '../../api/client.js';
import { isChunkLoadError, pageReload } from '../../lib/chunkError.js';

/**
 * The missing floor under the whole SPA (acceptance review §3 A-8, §6.2, §7 item 4).
 *
 * Every page in this app handles *query* errors well — `LoadError`, `Empty`, the retry buttons —
 * which is exactly what made the absence of a render-time net easy to miss. A malformed step, an
 * unexpected `null` from a field the API grew, a division by an empty array: any of those throws
 * during render, React unmounts the entire tree, and an agent who is on a live call is looking at
 * a white page with no way back but a reload they have to think of themselves.
 *
 * Two levels, on purpose:
 *
 * - **Around `Shell`** — the last resort. If the chrome itself throws there is nothing left to
 *   keep alive, so this one replaces the screen.
 * - **Around each route element** — the useful one. The sidebar, the topbar, the notification bell
 *   and `Ctrl K` all live in `Shell`, *outside* the route's `<Outlet/>`, so a route that throws
 *   loses only the page body: the agent can still search, still open another document, still
 *   navigate. That is the difference between "the tool broke" and "this page broke".
 *
 * Recovery is offered twice because the two failures are different. `נסה שוב` re-renders the same
 * subtree, which is the right answer to a transient throw (a race against a cache that has since
 * settled). `חזרה לספרייה` is a real navigation to a known-good screen — written as an `<a>`, not
 * a `<Link>`, precisely because a boundary must not depend on any context still being usable to
 * get the user out; a full document load is the one escape that cannot itself throw.
 *
 * The route boundary also resets itself when the path changes: without that, an agent who used
 * the still-live palette to open a different document would keep staring at the panel from the
 * page they left.
 */

/** Appended to `TelemetryEventSchema` (`stage45.ts`) so a crash is visible in the usage table. */
const CLIENT_ERROR = 'client_error';

/**
 * Fire-and-forget, and deliberately not `useTelemetry`'s 10-second buffer: the batch that matters
 * is the one describing a screen the agent is about to reload away from, and a boundary is a class
 * component that cannot hold the hook anyway. Wrapped twice — `try` for a `fetch` that is missing
 * or throws synchronously (jsdom without a network stub), `.catch` for the rejection — because the
 * one thing this reporter must never do is throw from inside a component that is already broken.
 */
export function reportClientError(documentId?: string): void {
  try {
    void fetch(`${API_BASE}/telemetry`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        events: [{ kind: CLIENT_ERROR, at: new Date().toISOString(), ...(documentId ? { documentId } : {}) }],
      }),
    }).catch(() => undefined);
  } catch {
    /* telemetry is never allowed to be the reason a crash screen fails to render */
  }
}

interface Props {
  children: ReactNode;
  /** Where the throw happened, for the console line: `shell`, or the route path. */
  where: string;
  /** Changing this clears a caught error — the route path, so navigating away recovers. */
  resetKey?: string;
  /**
   * What to render instead of the panel (review M1). The panel is right for a *page*: it is the
   * whole screen and it owns the recovery. It is wrong for an overlay — a palette that throws
   * should close, not paint a crash report over a working app — so `Shell` passes `null` for the
   * three it wraps, and the throw is still logged and still reported.
   */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

class ErrorBoundaryBase extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console line is what a developer with the tab open sees; the telemetry row is what
    // anybody looking at the deployed VM a day later sees. Both, not one.
    console.error(`[ErrorBoundary:${this.props.where}]`, error, info.componentStack);
    reportClientError();
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private readonly reset = () => this.setState({ error: null });

  /** The only "retry" a stale lazy chunk can honour — see `lib/chunkError.ts`. */
  private readonly reload = () => pageReload.run();

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    /**
     * A chunk that 404s after a deploy is the one error `reset()` cannot fix: React caches the
     * rejected `import()` inside the `lazy()` wrapper, so re-rendering the same subtree replays
     * the same rejection forever (review H1). Only a document load reaches the new asset names,
     * so for this error the primary action *is* the reload — and it says so.
     */
    const stale = isChunkLoadError(error);
    return (
      <div className="error-boundary" role="alert" dir="rtl" data-where={this.props.where}>
        <div className="eb-card">
          <div className="eb-mark" aria-hidden="true">
            ⚠
          </div>
          <h2>משהו השתבש</h2>
          {/* The message, not the stack: an agent cannot act on a stack, and a support call that
              can quote one line is worth more than a screen that says only "error". */}
          <p className="eb-msg">
            {stale ? 'גרסה חדשה של המערכת פורסמה. יש לטעון את הדף מחדש.' : error.message || 'שגיאה לא צפויה'}
          </p>
          <div className="eb-actions">
            {stale ? (
              <button type="button" className="btn primary" onClick={this.reload}>
                טען מחדש
              </button>
            ) : (
              <button type="button" className="btn primary" onClick={this.reset}>
                נסה שוב
              </button>
            )}
            <a className="btn ghost" href="/library">
              חזרה לספרייה
            </a>
          </div>
          <p className="eb-note">הדיווח נשלח אוטומטית. אם זה חוזר — צלם מסך ופנה לצוות התוכן.</p>
        </div>
      </div>
    );
  }
}

/**
 * The boundary everything uses. A function component only so it can read the path and default the
 * reset key to it — everything else is the class above.
 *
 * The default is the fix for M1. The shell boundary was mounted with no `resetKey` at all, and
 * `Palette`, `Peek`, `Tour`, `Sidebar`, `TabStrip` and the notification bell all render under it:
 * one throw from any overlay replaced the entire application with the panel, and nothing short of
 * the user thinking to reload ever brought it back — `נסה שוב` re-rendered the same overlay in the
 * same state that had just thrown. Keying on the path means navigating anywhere is a recovery,
 * which is what the route boundary has always done and what nobody wired to the outer one.
 */
export function ErrorBoundary({ children, where, resetKey, fallback }: Props) {
  const loc = useLocation();
  return (
    <ErrorBoundaryBase where={where} resetKey={resetKey ?? loc.pathname} fallback={fallback}>
      {children}
    </ErrorBoundaryBase>
  );
}

/** The per-route boundary: the same thing, named by the route it guards. */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return (
    <ErrorBoundary where={loc.pathname} resetKey={loc.pathname}>
      {children}
    </ErrorBoundary>
  );
}
