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
 *
 * That claim is now load-bearing rather than aspirational: every response-carrying call in
 * `src/api/stage4.ts` and `src/api/stage5.ts` goes through `checked`, as do the collab and
 * preferences hooks. The routes that do not are exactly the ones with nothing to parse —
 * `POST /telemetry` and `DELETE /connectors/{id}` answer 204. It is worth saying why the two
 * layers are not redundant: for a whole wave the connector-detail routes were typed by hand as the
 * list's row shape while the contract published a masked-detail shape, and neither the compiler
 * (which saw a hand-written type) nor the tests (which mocked the hand-written type) could see it.
 * A runtime parse against the schema is what turns that class of mistake into a readable error.
 */
import type { z } from 'zod';
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

/**
 * Same, but "the resource is absent" is `null` rather than a contract violation.
 *
 * 204 and 404 both mean it: a knowledge item that has never had a source document written for it
 * has no source document, and a document nobody has edited has no autosave draft. Neither is an
 * error, and neither has a body to parse.
 *
 * A 404 carrying a *code* is a different answer and is rethrown. `GET /documents/:id/source`
 * answers 404 both for "no source yet" and for `NOT_PUBLISHED` — a reader who may not see the
 * document at all (spec §5.5). Collapsing the second into `null` showed that reader an empty
 * source pane instead of the unavailable page the document query renders correctly.
 */
export function checkedMaybe<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  res: FetchResult<unknown>,
): T | null {
  if (res.response.status === 204) return null;
  if (res.response.status === 404) {
    const code = (res.error as { code?: string } | undefined)?.code;
    if (!code || code === 'NOT_FOUND') return null;
    // Falls through to `checked`, whose `unwrap` throws the typed `ApiError` the caller expects.
  }
  return checked(schema, res);
}
