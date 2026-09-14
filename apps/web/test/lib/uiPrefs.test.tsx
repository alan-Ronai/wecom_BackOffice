/**
 * The layering `src/api/hooks/uiPrefs.ts` describes, pinned.
 *
 * Two claims in that module's header are the ones worth testing, because getting either backwards
 * is invisible until a user changes machines. First: `localStorage` is a *cache*, not the copy of
 * record — a read layers the server's answer over the mirror, so the server wins on every key it
 * returns and the mirror only fills the gaps. Second: a failed write must not lose the toggle —
 * the mirror already holds it, and the UI is expected to stay on the value the user picked rather
 * than snapping back.
 *
 * The header used to cite this file before it existed. It exists now.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '../msw/server.js';
import { useUiPrefs, DEFAULT_UI_PREFS } from '../../src/api/hooks/uiPrefs.js';

const LS_KEY = 'wecom.ui-prefs';

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

/** `GET /me/preferences` answering exactly these keys, and nothing else. */
const serverPrefs = (prefs: Record<string, unknown>) =>
  server.use(http.get('/api/v1/me/preferences', () => HttpResponse.json(prefs)));

describe('useUiPrefs · the server is the copy of record, localStorage is the cache', () => {
  it('paints from the mirror before the server has answered', async () => {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ density: 'compact' }));
    let release: (() => void) | undefined;
    const answered = new Promise<void>((r) => (release = r));
    server.use(
      http.get('/api/v1/me/preferences', async () => {
        await answered;
        return HttpResponse.json({ density: 'comfortable' });
      }),
    );

    const { result } = renderHook(() => useUiPrefs(), { wrapper });
    // First paint, server still in flight: the mirror is what the user sees.
    expect(result.current.prefs.density).toBe('compact');

    act(() => release?.());
    // …and the server's answer replaces it the moment it lands.
    await waitFor(() => expect(result.current.prefs.density).toBe('comfortable'));
  });

  it('lets the server win per key, without erasing mirror keys it does not mention', async () => {
    window.localStorage.setItem(
      LS_KEY,
      JSON.stringify({ density: 'compact', libraryView: 'list', tourDone: true }),
    );
    // The server knows about density only — the other two are still mirror-only.
    serverPrefs({ density: 'comfortable' });

    const { result } = renderHook(() => useUiPrefs(), { wrapper });
    await waitFor(() => expect(result.current.prefs.density).toBe('comfortable'));
    expect(result.current.prefs.libraryView).toBe('list');
    expect(result.current.prefs.tourDone).toBe(true);
  });

  it('falls back to the defaults when neither side has an opinion', async () => {
    serverPrefs({});
    const { result } = renderHook(() => useUiPrefs(), { wrapper });
    await waitFor(() => expect(result.current.prefs.density).toBe(DEFAULT_UI_PREFS.density));
    expect(result.current.prefs.savedViewId).toBe(null);
  });

  it('ignores a corrupt mirror rather than throwing on first paint', async () => {
    window.localStorage.setItem(LS_KEY, '{not json');
    serverPrefs({});
    const { result } = renderHook(() => useUiPrefs(), { wrapper });
    await waitFor(() => expect(result.current.prefs.density).toBe(DEFAULT_UI_PREFS.density));
  });
});

describe('useUiPrefs · a failed write must not lose the toggle', () => {
  it('keeps the picked value when PUT /me/preferences fails', async () => {
    serverPrefs({ density: 'comfortable' });
    server.use(
      http.put('/api/v1/me/preferences', () =>
        HttpResponse.json({ code: 'ERROR', message: 'boom' }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useUiPrefs(), { wrapper });
    await waitFor(() => expect(result.current.prefs.density).toBe('comfortable'));

    act(() => result.current.save({ density: 'compact' }));

    // The write lost; the value the user picked did not.
    await waitFor(() => expect(result.current.prefs.density).toBe('compact'));
    expect(JSON.parse(window.localStorage.getItem(LS_KEY) ?? '{}').density).toBe('compact');
  });

  it('survives a localStorage that refuses to be written to', async () => {
    serverPrefs({});
    const setItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
    try {
      const { result } = renderHook(() => useUiPrefs(), { wrapper });
      await waitFor(() => expect(result.current.prefs.density).toBe('comfortable'));
      act(() => result.current.save({ density: 'compact' }));
      // No throw, and the in-memory cache still carries the change for this session.
      await waitFor(() => expect(result.current.prefs.density).toBe('compact'));
    } finally {
      window.localStorage.setItem = setItem;
    }
  });
});
