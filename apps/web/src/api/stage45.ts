/**
 * Runtime contract checking for the stage 4–5 routes.
 *
 * This module used to be a second transport: a hand-rolled `fetch` bridge, written because the
 * stage 4–5 routes were not yet in `docs/api/openapi.json` and `pnpm generate:client` could not
 * type them. They are all published now, so the transport is gone and every caller goes through
 * the generated client like the rest of the app — one contract, and a route that changes shape is
 * a typecheck error rather than a runtime `TypeError`.
 *
 * What is worth keeping is the half that was never about typing: these routes are **validated at
 * runtime** against the `@wecom/shared` zod schemas the server enforces. The generated types are
 * erased at build time and describe what the contract *says*; `checked` is what notices when an
 * answer disagrees with it. While the routes are mocked that means a msw fixture which drifts from
 * the contract fails at the call site instead of rendering `undefined` three components away; once
 * they are real it means a backend that answers a different shape surfaces as a typed, readable
 * error instead of a blank screen.
 */
import type { z } from 'zod';
import { API_BASE } from './client.js';
import { ApiError, unwrap } from './unwrap.js';

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

const pathOf = (res: Response): string => {
  try {
    return new URL(res.url).pathname;
  } catch {
    return res.url || 'השרת';
  }
};

/**
 * Unwraps a generated-client result and parses it with the schema the route is built to.
 *
 * The schema is typed `ZodType<T, ZodTypeDef, unknown>` rather than `ZodType<T>`: with the input
 * side left open, `T` binds to the schema's **output**, so a field carrying `.default()` reads
 * back as present rather than optional at every call site.
 */
export function checked<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, res: FetchResult<unknown>): T {
  const data = unwrap(res);
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new ApiError(
      res.response.status,
      'CONTRACT',
      `תשובת השרת ל-${pathOf(res.response)} אינה תואמת את החוזה`,
      parsed.error.issues,
    );
  return parsed.data;
}

/* ── wave 4 bridge ─────────────────────────────────────────────────────────
 * The W1–W5 web lanes were written while their routes were still absent from
 * `docs/api/openapi.json`, so they could not use the generated client. The
 * transport below is the same bridge stages 4–5 used, restored for the wave 4
 * hooks only. W6 regenerates the contract and moves each hook onto
 * `api.GET/POST/...`; this block goes away with the last caller.
 */

type Primitive = string | number | boolean | undefined | null;

export interface StageInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, Primitive | readonly string[]>;
  signal?: AbortSignal;
}

const qs = (query?: StageInit['query']): string => {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) for (const item of v) p.append(k, String(item));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function request(path: string, init: StageInit): Promise<Response> {
  return globalThis.fetch(`${API_BASE}${path}${qs(init.query)}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    signal: init.signal,
    ...(init.body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  });
}

async function fail(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    details?: unknown;
  };
  throw new ApiError(res.status, body.code ?? 'ERROR', body.message ?? 'שגיאה', body.details);
}

/** `GET`/`POST`/… returning a JSON body that must match `schema`. */
export async function stageJson<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  path: string,
  init: StageInit = {},
): Promise<T> {
  const res = await request(path, init);
  if (!res.ok) await fail(res);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success)
    throw new ApiError(
      res.status,
      'CONTRACT',
      `תשובת השרת ל-${path} אינה תואמת את החוזה`,
      parsed.error.issues,
    );
  return parsed.data;
}

/** A route that answers 204. */
export async function stageVoid(path: string, init: StageInit = {}): Promise<void> {
  const res = await request(path, init);
  if (!res.ok) await fail(res);
}
