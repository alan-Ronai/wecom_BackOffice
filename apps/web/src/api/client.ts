import createClient from 'openapi-fetch';
import type { paths } from './schema.js';

/**
 * Same-origin `/api/v1`, resolved against `location.origin` so the client also works where
 * `fetch` refuses relative URLs (jsdom/undici under Vitest).
 */
export const API_BASE =
  typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
    ? `${window.location.origin}/api/v1`
    : '/api/v1';

/**
 * Typed by the generated `schema.d.ts` — the single source of truth, produced from
 * `docs/api/openapi.json` by `pnpm generate:client`. That step also strips the `/api/v1` prefix
 * from the generated path keys (`scripts/strip-api-prefix.mjs`) so they match `API_BASE`, which
 * already carries it. Any drift between the published contract and this app is a typecheck error.
 */
export const api = createClient<paths>({
  baseUrl: API_BASE,
  credentials: 'include',
  // Resolve `fetch` per call instead of capturing it at module load, so an interceptor
  // installed later (msw in tests, instrumentation in the browser) is actually used.
  fetch: (request) => globalThis.fetch(request),
});

/**
 * `multipart/form-data` upload against the same base and credentials as `api`.
 *
 * OpenAPI describes these routes with a multipart body, which `openapi-fetch` cannot type or
 * serialise, so the one file-upload route goes through here instead of being cast at the call
 * site. The response is still shaped by the generated contract — see `UploadSourceResult`.
 */
export async function apiUpload<T>(
  path: string,
  form: FormData,
): Promise<{ data?: T; error?: unknown; response: Response }> {
  const response = await globalThis.fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  // Mirror openapi-fetch's split so `unwrap` raises the same typed ApiError as every other call.
  return response.ok ? { data: body as T, response } : { error: body, response };
}
