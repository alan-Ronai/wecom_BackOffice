/**
 * Recovering from a lazy chunk that is no longer on the server (post-pilot review H1).
 *
 * `src/routes.tsx` splits the heavy screens behind `React.lazy`. The chunks are content-hashed and
 * served `immutable` for 30 days, so an INSTALL upgrade that rebuilds the web image deletes every
 * file name the *currently open* tab knows about. The next `split()` route an agent opens — or the
 * lazy `RichText` the editor toggles — asks for `/assets/GraphPage-CELx9s_-.js`, gets a 404, and
 * the dynamic import rejects.
 *
 * That rejection is permanent in a way an ordinary throw is not: React caches the rejected promise
 * inside the `lazy()` wrapper, so the boundary's "נסה שוב" re-renders the *same* wrapper, gets the
 * *same* rejection, and the panel is inert forever. The only cure is a document load that fetches a
 * fresh `index.html` with the new hashed names in it.
 *
 * Two doors, because the failure arrives by two paths:
 *
 * - Vite's preload helper fires `vite:preloadError` on `window` *before* the import rejects, for a
 *   chunk it tried to preload. `installPreloadErrorReload` catches that and reloads on its own —
 *   the agent never sees a panel.
 * - An import that rejects without a preload attempt (or an event nobody listened for, e.g. a
 *   listener installed after boot) reaches the error boundary. There, `isChunkLoadError` turns the
 *   retry button into a reload, which is the only retry that can actually work.
 */

/**
 * The seam the boundary and the listener call instead of `window.location.reload()` directly.
 *
 * jsdom's `Location` is not configurable, so a test cannot spy on `reload` — and a test that
 * *really* reloaded would tear down its own renderer. One indirection keeps the assertion honest
 * ("this click reloads the page") without pretending the browser does something it does not.
 */
export const pageReload = {
  run(): void {
    window.location.reload();
  },
};

/**
 * Chrome, Firefox and Safari each word this differently and none of them use a typed error, so
 * matching the message is the only option available. Kept deliberately broad: a false positive
 * costs one reload, a false negative costs a tab that can never recover.
 */
const CHUNK_MESSAGES = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
  /chunkloaderror/i,
  /loading chunk \d+ failed/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: unknown; message?: unknown };
  if (e.name === 'ChunkLoadError') return true;
  const message = typeof e.message === 'string' ? e.message : String(error);
  return CHUNK_MESSAGES.some((re) => re.test(message));
}

/**
 * A reload that fails the same way must not become a reload loop: if the new `index.html` is also
 * broken the second attempt would throw again and spin the tab. One automatic reload per window
 * per {@link RELOAD_COOLDOWN_MS} — after that the error reaches the boundary and a human decides.
 */
const RELOAD_MARK = 'kb:chunk-reload-at';
export const RELOAD_COOLDOWN_MS = 10_000;

/** `sessionStorage` can throw (Safari private mode); a crash recovery path may not itself crash. */
function lastReloadAt(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_MARK) ?? 0);
  } catch {
    return 0;
  }
}

function markReload(at: number): void {
  try {
    window.sessionStorage.setItem(RELOAD_MARK, String(at));
  } catch {
    /* no session storage: the cooldown degrades to "always reload", which is still better */
  }
}

/** Reloads unless this window already reloaded for a chunk error moments ago. Returns whether it did. */
export function reloadForStaleChunks(now = Date.now()): boolean {
  if (now - lastReloadAt() < RELOAD_COOLDOWN_MS) return false;
  markReload(now);
  pageReload.run();
  return true;
}

/**
 * Installs the `vite:preloadError` listener. Called from `main.tsx` before the app renders, so the
 * very first route transition after a deploy is covered. Returns the uninstaller (tests, HMR).
 */
export function installPreloadErrorReload(target: Window = window): () => void {
  const onPreloadError = (event: Event): void => {
    // Preventing the default stops Vite from rethrowing the error into the page — this window is
    // about to be replaced anyway, and a duplicate uncaught rejection only adds console noise.
    event.preventDefault();
    reloadForStaleChunks();
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
