/**
 * Wave 6 request bridge, for the routes that are not in `docs/api/openapi.json` while the X lanes
 * run in parallel.
 *
 * Same origin, same credentials and the same error envelope as the generated client, and every
 * response is parsed with the `@wecom/shared` schema the route is built to — so a msw fixture or a
 * server that drifts from `CONTRACTS-wave6.md` fails at the call site with a readable Hebrew
 * error instead of rendering `undefined` three components away.
 *
 * X6 deletes this file: once the routes are published, each caller marked `// X6: api.*` becomes a
 * one-line `api.GET/POST/PUT/DELETE` through the generated client and `checked(...)`.
 */
import type { z } from 'zod';
import { ApiError } from './unwrap.js';

const BASE = '/api/v1';
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface W6Opts {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

const url = (path: string, query?: W6Opts['query']): string => {
  const u = new URL(BASE + path, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {}))
    if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
};

async function raw(method: Method, path: string, opts: W6Opts = {}): Promise<Response> {
  const res = await fetch(url(path, opts.query), {
    method,
    credentials: 'same-origin',
    headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = res.statusText || 'שגיאה';
    try {
      const j = (await res.json()) as { code?: string; message?: string };
      code = j.code ?? code;
      message = j.message ?? message;
    } catch {
      /* no body — keep the status line */
    }
    throw new ApiError(res.status, code, message);
  }
  return res;
}

/** A JSON route, parsed with its schema. */
export async function w6<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  method: Method,
  path: string,
  opts?: W6Opts,
): Promise<T> {
  const res = await raw(method, path, opts);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success)
    throw new ApiError(
      res.status,
      'CONTRACT',
      `תשובת השרת ל-${BASE}${path} אינה תואמת את החוזה`,
      parsed.error.issues,
    );
  return parsed.data;
}

/** A route with nothing to parse (204). */
export async function w6Void(method: Method, path: string, opts?: W6Opts): Promise<void> {
  await raw(method, path, opts);
}

/** A non-JSON body — the JSONL transcript export. */
export async function w6Text(path: string, opts?: W6Opts): Promise<string> {
  return (await raw('GET', path, opts)).text();
}
