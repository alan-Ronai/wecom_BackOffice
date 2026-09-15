/**
 * H1 — a lazy chunk that no longer exists must not strand the tab.
 *
 * The scenario is an INSTALL upgrade: the web image is rebuilt, every asset gets a new content
 * hash, and a tab that has been open since before the deploy still holds the old file names. The
 * moment that tab opens a `split()` route the dynamic import 404s. React caches the rejected
 * promise inside `lazy()`, so the old "נסה שוב" replayed the same rejection forever — which is
 * exactly what these tests would catch coming back: they assert the panel offers a *reload*, and
 * that Vite's own `vite:preloadError` reloads before a panel is ever needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense, lazy } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ErrorBoundary } from '../../src/components/ui/ErrorBoundary.js';
import {
  RELOAD_COOLDOWN_MS,
  installPreloadErrorReload,
  isChunkLoadError,
  pageReload,
  reloadForStaleChunks,
} from '../../src/lib/chunkError.js';

/** The message Chrome produces for a hashed chunk that a deploy removed. */
const VITE_MESSAGE =
  'Failed to fetch dynamically imported module: http://kb.test/assets/GraphPage-CELx9s_-.js';

let reloads = 0;
let uninstall: (() => void) | undefined;
beforeEach(() => {
  reloads = 0;
  vi.spyOn(pageReload, 'run').mockImplementation(() => {
    reloads += 1;
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  vi.restoreAllMocks();
});

describe('isChunkLoadError', () => {
  it('recognises what each browser says about a chunk that is gone', () => {
    expect(isChunkLoadError(new Error(VITE_MESSAGE))).toBe(true);
    // Firefox and Safari word it differently; webpack-era bundles use a named error.
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('boom'), { name: 'ChunkLoadError' }))).toBe(true);
  });

  it('leaves an ordinary render throw alone, so its retry stays a re-render', () => {
    expect(isChunkLoadError(new Error('שלב פגום'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('the boundary, when a lazy route chunk fails to load', () => {
  /** The real failure: `lazy()` over an `import()` that rejects. */
  const Broken = lazy(() => Promise.reject(new Error(VITE_MESSAGE)));

  const renderBroken = () =>
    render(
      <MemoryRouter initialEntries={['/graph']}>
        <ErrorBoundary where="/graph">
          <Suspense fallback={<div>טוען…</div>}>
            <Broken />
          </Suspense>
        </ErrorBoundary>
      </MemoryRouter>,
    );

  it('offers a reload instead of a retry that can only fail again', async () => {
    renderBroken();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('גרסה חדשה של המערכת פורסמה. יש לטעון את הדף מחדש.')).toBeInTheDocument();
    // The inert button is gone: nothing on this panel re-renders the cached rejection.
    expect(screen.queryByRole('button', { name: 'נסה שוב' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'טען מחדש' }));
    expect(reloads).toBe(1);
  });

  it('still leaves the escape hatch to the library', async () => {
    renderBroken();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'חזרה לספרייה' })).toHaveAttribute('href', '/library');
  });
});

describe('vite:preloadError', () => {
  it('reloads without the agent ever meeting the panel', () => {
    uninstall = installPreloadErrorReload();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reloads).toBe(1);
  });

  it('reloads at most once per cooldown, so a still-broken deploy cannot spin the tab', () => {
    const t0 = 1_700_000_000_000;
    expect(reloadForStaleChunks(t0)).toBe(true);
    expect(reloadForStaleChunks(t0 + 500)).toBe(false);
    expect(reloadForStaleChunks(t0 + RELOAD_COOLDOWN_MS + 1)).toBe(true);
    expect(reloads).toBe(2);
  });

  it('stops listening once uninstalled', () => {
    installPreloadErrorReload()();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reloads).toBe(0);
  });
});
