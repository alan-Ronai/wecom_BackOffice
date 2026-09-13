# `@wecom/web`

The React SPA. Hebrew/RTL, keyboard-first, talks to `@wecom/api` over the same origin.

## The API contract is generated, never hand-written

`src/api/schema.d.ts` is the **single source of truth** for every request and response shape. It is
generated from `docs/api/openapi.json` — which the API itself emits (`pnpm --filter @wecom/api
openapi`) — and it is `.gitignore`d, so it can never drift from the spec that produced it.

```
apps/api routes  ──►  docs/api/openapi.json  ──►  src/api/schema.d.ts  ──►  src/api/client.ts
                        (pnpm openapi)          (pnpm generate:client)
```

`generate:client` runs as a prerequisite of `typecheck`, `test` **and** `build`, so any change to
the published contract that this app has not caught up with fails the build rather than surfacing
as a runtime `TypeError` in front of a user.

There used to be a second, hand-maintained contract (`src/api/paths.d.ts`) that the client, the msw
handlers and the e2e specs all encoded. It has been deleted. Do not reintroduce one: if a route is
missing, add it to the API and regenerate.

### The `/api/v1` prefix

The API serves everything under `/api/v1`, so the generated path keys look like
`"/api/v1/documents"`, while the client sets `baseUrl` to `<origin>/api/v1` and calls
`api.GET('/documents')`.

Two ways to reconcile that; this repo picks the first:

1. **Strip the prefix from the generated keys** (`scripts/strip-api-prefix.mjs`, run as the second
   half of `generate:client`). One 30-line script, and ~100 call sites stay short and unchanged.
2. Set `baseUrl` to `location.origin` and repeat `/api/v1` in every call site.

The script only rewrites top-level quoted path keys, and it **fails the build** if it finds zero
keys to strip or if any `/api/v1` remains afterwards — so it cannot silently half-apply and leave
the client and the contract disagreeing.

SSE is the one route that does not go through `openapi-fetch` (it is not JSON), so
`src/api/events.ts` builds its URL from the same `API_BASE`: `<origin>/api/v1/events`.

## Mocks

`test/msw/` backs both the unit suite and `pnpm e2e`. The handlers return the **real** response
envelopes (`{ items, total, page, pageSize }` for paginated lists, `{ items }` for unpaginated ones,
`{ document, version, auditId }` for publish/restore, …), and `test/msw/fixtures.test.ts` parses
every handler's output with the matching `@wecom/shared` response schema, so the mocks cannot drift
from the contract without a test failing.

`public/mockServiceWorker.js` is a dev/test artifact. `deploy/Dockerfile.web` deletes it from the
built image — an interception-capable service worker has no business in production.

## Scripts

| script | what it does |
| --- | --- |
| `pnpm dev` | Vite dev server on :5173, proxying `/api` (and `/events`) to :3000 |
| `pnpm generate:client` | regenerate `schema.d.ts` from `docs/api/openapi.json`, then strip the prefix |
| `pnpm typecheck` / `build` / `test` | each regenerates the client first |
| `pnpm e2e` | Playwright against the msw-backed app |

The real, no-mocks gate lives at the repo root: `pnpm e2e:real` (Postgres in Docker, migrated and
seeded, the real API, the built SPA, and `e2e/real/*.spec.ts`). See the root `README.md`.
