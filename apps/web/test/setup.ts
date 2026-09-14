import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { server } from './msw/server.js';
import { resetState } from './msw/handlers.js';
import { __resetUiPrefsCache } from '../src/api/hooks/uiPrefs.js';

/**
 * Text queries skip `aria-hidden` subtrees as well as `script`/`style` (the library default).
 *
 * The app renders chrome that deliberately duplicates on-screen text for a non-screen medium —
 * the A4 `PrintFrame` header repeats "<category> · N שלבים · v<version>", decorative icons repeat
 * their button's label — and marks it `aria-hidden` precisely because a reader should meet it
 * once. A `getByText` that matches the hidden copy is matching something no user can perceive, so
 * once several lanes' screens shared one article page those queries started finding two nodes and
 * throwing. Aligning the text queries with the accessibility tree keeps every assertion pointed at
 * what is actually on screen.
 *
 * `asyncUtilTimeout` is Testing Library's own budget for `waitFor` / `findBy*`, and it is
 * independent of vitest's `testTimeout` (`vite.config.ts`). Its 1000 ms default is what a
 * first-render `waitFor` races under the fully parallel run: before its first real node appears, a
 * route does four to six msw round trips, and — since the heavy screens became `React.lazy` routes
 * — a dynamic `import()` that Vite has to transform along with everything it pulls in. That is
 * comfortably under a second on a warm worker and regularly over it on a cold one, which is why
 * these specs passed file-by-file, failed in the full suite, and failed in a *different* set every
 * run on the same commit.
 *
 * 5 s is still a real failure signal — `testTimeout` is 15 s and nothing here polls that long on
 * success. It changes nothing about what the assertions mean: a genuinely broken query still
 * fails, it just fails for its own reason instead of racing the scheduler.
 */
configure({
  asyncUtilTimeout: 5000,
  defaultIgnore: 'script, style, [aria-hidden="true"], [aria-hidden="true"] *',
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  // `globals: false` means Testing Library never registers its own auto-cleanup.
  cleanup();
  server.resetHandlers();
  window.sessionStorage.clear();
  window.localStorage.clear();
  __resetUiPrefsCache();
  resetState();
});
afterAll(() => server.close());

if (!window.matchMedia)
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

if (!window.scrollTo) window.scrollTo = (() => {}) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

class ES {
  onmessage: null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
(globalThis as unknown as { EventSource: unknown }).EventSource = ES;

if (!navigator.clipboard)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: () => Promise.resolve() },
  });

if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:stub';
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};

// ProseMirror (TipTap, wave 4 source editor) needs DOM APIs jsdom lacks.
if (!(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent)
  (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent = class extends Event {};
if (!(globalThis as { DragEvent?: unknown }).DragEvent)
  (globalThis as { DragEvent?: unknown }).DragEvent = class extends Event {};
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}
if (!document.elementFromPoint) document.elementFromPoint = () => null;
