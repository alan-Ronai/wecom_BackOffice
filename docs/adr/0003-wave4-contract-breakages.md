# ADR 0003 — Wave 4 contract breakages

Date: 2026-09-14 · Status: accepted

## Context

ADR 0001 is explicit: "a breaking change (renamed field, removed permission, changed event payload, dropped column) needs a new ADR in this folder before merge." Wave 4 shipped five contract changes in `packages/shared`. ADR 0002 covers two of them — the `DocumentStatusSchema` and `DocumentKindSchema` widenings — and its reasoning is sound: both are widenings, and TypeScript flags any consumer that switches exhaustively.

The other four were merged with no ADR, and the parallel-lane model has exactly one control stopping eight lanes from silently breaking each other's consumers: this folder. It did not catch the `CategorySchema` change, and the cost was a crash-on-any-admin-created-world spread across ~21 web components (C-C1). This ADR records all four and states the migration note their consumers needed and did not have.

## Decision

### 1. `CategorySchema`: `z.enum([...six slugs])` → `z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/)`

`packages/shared/src/schemas/common.ts`. Worlds are data as of W1 (`worlds` table, `POST /worlds`), so the six seeded slugs stopped being the whole domain and the enum had to go.

This is **not** a widening in ADR 0002's sense. For a *request* consumer it is a widening; for every *response* consumer it is a narrowing loss, because `Category` stops being a union the compiler can exhaust over. Concretely:

- `Record<Category, T>` was a total map the compiler checked. It is now `Record<string, T>`, and a lookup that used to be `T` is now `T | undefined` **only if the consumer opts into `noUncheckedIndexedAccess`** — otherwise the compiler keeps typing it `T` and the runtime returns `undefined`. Every such lookup must be given an explicit fallback.
- `CategorySchema.options` no longer exists. A picker built from it must read `GET /worlds` instead.

### 2. `topicId` removed from `CreateDocumentBodySchema`

`packages/shared/src/schemas/api.ts`. A dropped request field, named in ADR 0001's list. Documents belong to topics through `document_topics` (many-to-many) as of W1, so the single-id field could not express the model. Replaced by `topics: IdSchema[]`, which names topic **ids**, not the legacy integer `topic_id`. Migration 0030 turns each legacy `topic_id` into a `topics` row (slug `topic-<n>`) and a `document_topics` membership.

### 3. `categoryScopes` → `worldScopes` on `MeSchema`

`packages/shared/src/schemas/identity.ts`. A renamed field, also named in ADR 0001's list. Scopes are world scopes as of W1, and a document belongs to several worlds, so the scope test is an **intersection with the document's world set** (`document_worlds`), never a comparison against `documents.category`. A client that intersects against the primary world is stricter than the server and silently hides edit affordances the API would accept.

Both spellings are emitted for one release — the API derives them from one `resolvedScopes` in `auth/routes.ts`, `auth/permissions.ts` and `plugins/testUser.ts` — but the shape shipped inverted, with the old name mandatory and the new one optional. As of the wave-4 fix pass (C-I2) `worldScopes` is required-and-nullable and `categoryScopes` is `.optional()` and marked `@deprecated`, so `worldScopes` has two states (`null` = unscoped, array = the scope set) rather than three. `categoryScopes` is removed after wave 4.

### 4. `SearchResponseSchema` groups gain `'tags'`

`packages/shared/src/schemas/api.ts`. A changed response shape: `/search` may now return a group whose `type` is `'tags'`. Benign in practice — no consumer switches exhaustively over the group type, and an unrecognised group renders as its generic row — but a consumer that maps group type to an icon or a label needs the new arm, and one that asserts on the group list in a test will see an extra entry.

## Consequences

- The `CategorySchema` change is the one to watch on rebase. Any `Record<Category, …>` or `CATS[x]` lookup is no longer compiler-checked: give it a fallback, or read the taxonomy from `GET /worlds`. A picker or a colour map keyed on the six seeded slugs is a bug the moment an admin creates a world, and it fails quietly (a missing option) or loudly (a crash on `.name` of `undefined`) depending on the site.
- Nothing here needs a data migration beyond 0030/0031, which already ran.
- 0036 carries the forward fixups the wave still needed (`doc_type` for `T-`/`I-` codes, `search_text` for text bodies); see its header.
