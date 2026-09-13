import createClient from 'openapi-fetch';
import type { KbPaths } from './paths.js';

/**
 * Same-origin `/api/v1`, resolved against `location.origin` so the client also works where
 * `fetch` refuses relative URLs (jsdom/undici under Vitest).
 */
export const API_BASE =
  typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
    ? `${window.location.origin}/api/v1`
    : '/api/v1';

/**
 * Typed by `paths.d.ts` until `docs/api/openapi.json` carries the stage-1 routes; the generated
 * `schema.d.ts` is still produced by `pnpm generate:client` and takes over once it does.
 */
export const api = createClient<KbPaths>({
  baseUrl: API_BASE,
  credentials: 'include',
  // Resolve `fetch` per call instead of capturing it at module load, so an interceptor
  // installed later (msw in tests, instrumentation in the browser) is actually used.
  fetch: (request) => globalThis.fetch(request),
});
