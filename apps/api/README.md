# @wecom/api

Fastify 5 API for the wecom Knowledge Platform. Every request and response is typed with the zod
schemas exported by `@wecom/shared`; `docs/api/openapi.json` is generated from those schemas.

## Layout

```
src/app.ts                 buildApp(): logging → db → boss → caller plugins → events → swagger → routes
src/config.ts              env config (zod)
src/lib/sql.ts             withTransaction(pool, fn), Tx
src/lib/audit.ts           audit(tx, entry) → audit id
src/lib/events.ts          EventBus over Postgres LISTEN/NOTIFY (`app.events`)
src/lib/http.ts            httpError / notFound / forbidden / badRequest
src/lib/user.ts            ReqUser, requireUser(req), hasScope(user, category)
src/modules/index.ts       registerModules(v1) — the single /api/v1 registration point
src/jobs/index.ts          startJobs(app): trash.purge (03:00 Asia/Jerusalem), search.reindex
src/seed.ts                runSeed(pool) + CLI
seed/convert-legacy.mjs    legacy/js/*.js → seed/*.json (committed)
```

### Modules

| Module | Routes |
| --- | --- |
| `documents` | list / get / create / patch, `PUT :id/structure` (If-Match etag), publish, versions, version snapshot, diff with blame, restore, delete, pin, view, links, related |
| `blocks` | CRUD, usage, versions; updating a block recomputes every document that embeds it |
| `fields` | list with usage counts, usage, upsert (rename), soft delete |
| `scripts` | list / create / update / delete |
| `notes` | list, create, delete (author or `notes.moderate`), like toggle |
| `drafts` | per-document and `new:<id>` drafts, "other editor" indicator, my-drafts list |
| `search` | grouped search (blocks, steps, documents, fields, scripts) with optional model re-ranking |
| `trash` | list with impact, restore, purge, restore-all, empty (`x-confirm: empty`) |
| `preferences` | `GET/PUT /me/preferences` |
| `events` | `GET /events` — SSE stream of the event bus (hidden from OpenAPI) |

Documents are stored normalised (`documents` / `phases` / `steps` / `step_actions` /
`step_outcomes` / `step_branches` / `step_branch_options`) and assembled into the shared `Document`
schema on read. Saving a structure rewrites those rows in one transaction and recomputes
`step_field_refs`, `document_links` and `documents.search_text` with the shared detectors.
Publishing freezes the assembled document into `document_versions`.

### Cross-lane exports

| Name | Path |
| --- | --- |
| `audit(tx, entry)` | `src/lib/audit.ts` |
| `app.events.publish(tx, makeEvent(name, payload))` | `src/lib/events.ts` |
| `registerModules(v1)` | `src/modules/index.ts` |
| `publishDocument(tx, doc, { actorId, label, suggestionId?, markPartial?, kind? })` | `src/modules/documents/publish.ts` |
| `publishBlock(tx, block, { actorId, label })` | `src/modules/blocks/publish.ts` |

Queue names always come from `QUEUES` in `src/plugins/boss.ts`; `app.boss` may be `null`.

## Events

`document.published`, `document.updated`, `document.deleted`, `job.failed` (names from `EVENTS` in
`@wecom/shared`, payloads built with `makeEvent`). They travel over the `kb_events` NOTIFY channel,
so several API instances stay consistent, and reach browsers through `GET /api/v1/events`.

## Running

```bash
pnpm --filter @wecom/api dev            # tsx watch
pnpm --filter @wecom/api migrate        # node-pg-migrate up
pnpm --filter @wecom/api convert:legacy # regenerate seed/*.json from legacy/js
pnpm --filter @wecom/api seed           # load seed/*.json (idempotent)
pnpm openapi                            # regenerate docs/api/openapi.json + web client types
```

## Tests

```bash
pnpm --filter @wecom/api test                    # unit only
RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int
```

Integration tests start a `pgvector/pgvector:pg16` testcontainer per file and run the migrations.
Set `TEST_DATABASE_URL` to a running Postgres to create throwaway databases on it instead — much
faster to iterate on. Helpers live in `test/helpers/`: `startTestDb()`, `buildTestApp(pool, url)`,
the `x-test-user` fake-auth plugin and `makeUser` / `auth` fixtures.

## Jobs

`startJobs(app)` runs from `registerModules` on `onReady` and is a no-op in tests or when pg-boss
is down. `trash.purge` is scheduled at 03:00 Asia/Jerusalem and hard-deletes anything soft-deleted
longer than `TRASH_DAYS` (default 30); `search.reindex` recomputes derived text for every document.
A failing worker publishes `job.failed`.
