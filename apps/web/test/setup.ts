import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './msw/server.js';
import { resetState } from './msw/handlers.js';
import { __resetUiPrefsCache } from '../src/api/hooks/uiPrefs.js';

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
