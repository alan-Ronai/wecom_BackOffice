import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './msw/server.js';
import { resetState } from './msw/handlers.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  // `globals: false` means Testing Library never registers its own auto-cleanup.
  cleanup();
  server.resetHandlers();
  window.sessionStorage.clear();
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
