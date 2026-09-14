/**
 * Stage 4–5 routes, typed from the **zod contract** in `@wecom/shared` instead of the generated
 * `schema.d.ts`.
 *
 * Backend lanes A and B are adding these routes concurrently (`docs/api/CONTRACTS-stage4-5.md`),
 * so they are not in `docs/api/openapi.json` yet and `pnpm generate:client` cannot type them.
 * `packages/shared/src/schemas/stage45.ts` *is* the contract both sides are building against, so
 * this module goes through the same origin, the same credentials and the same `ApiError` as
 * `src/api/client.ts` — it just derives its types with `z.infer` and validates every response.
 *
 * That validation is deliberate: while the routes are mocked, a msw fixture that drifts from the
 * contract fails at the call site instead of rendering `undefined`; once the real routes land, a
 * backend that answers a different shape surfaces as a typed error rather than a `TypeError`.
 *
 * When these paths appear in `openapi.json`, delete the wrapper for that route and call
 * `api.GET(...)` — everything here is a per-route function, so the migration is mechanical.
 */
import { z } from 'zod';
import { API_BASE } from './client.js';
import { ApiError } from './unwrap.js';

type Primitive = string | number | boolean | undefined | null;

export interface StageInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, Primitive>;
  signal?: AbortSignal;
}

const qs = (query?: Record<string, Primitive>): string => {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
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

/**
 * `GET`/`POST`/… returning a JSON body that must match `schema`.
 *
 * The schema is typed `ZodType<T, ZodTypeDef, unknown>` rather than `ZodType<T>`: with the input
 * side left open, `T` binds to the schema's **output**, so a field carrying `.default()` reads
 * back as present rather than optional at every call site.
 */
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

/** A route that answers 204 (telemetry, presence heartbeat). */
export async function stageVoid(path: string, init: StageInit = {}): Promise<void> {
  const res = await request(path, init);
  if (!res.ok) await fail(res);
}

/** Same as `stageJson`, but "not there yet" (404/501) is `null` rather than an error. */
export async function stageMaybe<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  path: string,
  init: StageInit = {},
): Promise<T | null> {
  const res = await request(path, init);
  if (res.status === 204 || res.status === 404 || res.status === 501) return null;
  if (!res.ok) await fail(res);
  const parsed = schema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}
