/**
 * Wave 6 request bridge — TEMPORARY, for the non-streaming X2/X3 routes that are not in
 * `docs/api/openapi.json` while the web lanes run. Every call is validated at runtime with
 * `checked`/`checkedMaybe` against `@wecom/shared`, so a drifted fixture or a backend that
 * answers a different shape fails at the call site rather than three components away.
 *
 * X6 replaces each hook body with the generated `api.*` call and deletes this file (precedent:
 * V4b's stage bridges). Every call site is marked `// X6: api.*`.
 *
 * The SSE chat stream is NOT here — see `aiStream.ts`, which stays: the generated client cannot
 * consume a streaming body.
 */
import type { z } from 'zod';
import { API_BASE } from './client.js';
import { checked, checkedMaybe } from './stage45.js';
import { unwrap } from './unwrap.js';

type Query = Record<string, string | number | boolean | undefined | null>;
export type W6Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface W6Options {
  query?: Query;
  body?: unknown;
}

const qs = (q?: Query): string => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Mirrors openapi-fetch's `{ data | error, response }` split, so `checked`/`unwrap` work unchanged. */
async function call(
  method: W6Method,
  path: string,
  opts: W6Options = {},
): Promise<{ data?: unknown; error?: unknown; response: Response }> {
  const response = await globalThis.fetch(`${API_BASE}${path}${qs(opts.query)}`, {
    method,
    credentials: 'include',
    headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return response.ok ? { data: json, response } : { error: json, response };
}

export const w6 = async <T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  method: W6Method,
  path: string,
  opts?: W6Options,
): Promise<T> => checked(schema, await call(method, path, opts));

export const w6Maybe = async <T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  method: W6Method,
  path: string,
  opts?: W6Options,
): Promise<T | null> => checkedMaybe(schema, await call(method, path, opts));

/** For the 204 routes: nothing to parse, but a failure still has to raise the typed `ApiError`. */
export const w6Void = async (method: W6Method, path: string, opts?: W6Options): Promise<void> => {
  const r = await call(method, path, opts);
  if (!r.response.ok) unwrap(r);
};

/**
 * A non-JSON body — X4b's JSONL transcript export. It cannot go through `call`, which reads the
 * body as JSON, so it repeats the fetch and raises the same typed `ApiError` on a failure.
 */
export const w6Text = async (path: string, opts?: W6Options): Promise<string> => {
  const response = await globalThis.fetch(`${API_BASE}${path}${qs(opts?.query)}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    let error: unknown;
    try {
      error = await response.json();
    } catch {
      error = undefined;
    }
    unwrap({ error, response });
  }
  return response.text();
};
