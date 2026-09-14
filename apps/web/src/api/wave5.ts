/**
 * Wave 5 request bridge — TEMPORARY.
 *
 * The V1–V3 routes are not in `docs/api/openapi.json` while the web lanes run, so the generated
 * client cannot type them. Every call here is still validated at runtime with `checked` against
 * `@wecom/shared`, so a drifted fixture or a backend that answers a different shape fails at the
 * call site with a typed, readable error rather than rendering `undefined` three components away.
 *
 * V6 replaces each hook body with the generated `api.*` call and deletes this file (the wave 4
 * precedent: W2-web's hand-rolled bridge, retired the same way once the routes were published).
 */
import { z } from 'zod';
import { API_BASE } from './client.js';
import { checked, checkedMaybe } from './stage45.js';

type Query = Record<string, string | number | boolean | undefined | null>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface Options {
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

/** Mirrors openapi-fetch's `{ data | error, response }` split so `checked` behaves identically. */
async function call(method: Method, path: string, opts: Options = {}) {
  const response = await globalThis.fetch(`${API_BASE}${path}${qs(opts.query)}`, {
    method,
    credentials: 'include',
    headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await response.text();
  const json: unknown = text ? (JSON.parse(text) as unknown) : undefined;
  return response.ok ? { data: json, response } : { error: json, response };
}

export const w5 = async <T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  method: Method,
  path: string,
  opts?: Options,
): Promise<T> => checked(schema, await call(method, path, opts));

export const w5Maybe = async <T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  method: Method,
  path: string,
  opts?: Options,
): Promise<T | null> => checkedMaybe(schema, await call(method, path, opts));

/** The schema a 204 route can only ever be measured against on the failure branch. */
const NEVER = z.never();

/** For 204 routes: throws the typed `ApiError` on failure, resolves `void` on success. */
export const w5Void = async (method: Method, path: string, opts?: Options): Promise<void> => {
  const res = await call(method, path, opts);
  // `checked` → `unwrap` throws the typed ApiError; on success there is nothing to parse.
  if (!res.response.ok) checked(NEVER, res);
};
