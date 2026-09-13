# Stage 1 — Foundation: server, schema, identity, RBAC, content API, frontend port

Date: 2026-09-13 · Status: approved section by section in brainstorming, awaiting written review
Program context: `2026-09-13-kb-platform-program-and-lanes.md`

## 1. Runtime and repository layout

**Containers (Docker Compose on the LAN VM)**

| Service | Image / base | Role |
|---|---|---|
| `api` | Node 22, Fastify, TypeScript | REST API, SSE, pg-boss job workers (parsing, model calls, sync) in the same process |
| `db` | PostgreSQL 16 + pgvector | All data; pg-boss queues; nightly `pg_dump` to a mounted volume |
| `ollama` | ollama/ollama (CPU) | Local model; model name from `.env` (`MODEL_NAME=qwen2.5:3b-instruct-q4_K_M`) |
| `web` | nginx | Serves the built React app, proxies `/api` and `/events` to `api`, TLS with an internal-CA certificate |

`.env` holds: `DATABASE_URL`, `SESSION_SECRET`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `PALOALTO_HOST`, `PALOALTO_API_KEY`, `PALOALTO_SUBNETS`, `MODEL_URL`, `MODEL_NAME`, `WP_*` (stage 3), `BACKUP_DIR`. `deploy/INSTALL.md` documents a clean install, upgrade, backup and restore. `GET /api/v1/system/health` returns DB, model, queue and connector status; the frontend shows it on `/admin/system`.

**Repository** — monorepo with pnpm workspaces: `apps/api`, `apps/web`, `packages/shared`, `packages/connectors`, `packages/model`, `deploy`, `docs`, `legacy` (today's static app moved unchanged as the parity reference). ESLint + Prettier + TypeScript strict everywhere; CI (GitHub Actions or the LAN runner) runs lint, unit, integration and e2e on every push.

## 2. Data model

All tables have `id uuid`, `created_at`, `updated_at`; content tables also have `created_by`, `updated_by`, `deleted_at`, `deleted_by`.

**Content**

- `documents`: slug, title, description, category (enum sim/tech/billing/plans/intl/ops), wave (1–3), priority (hh/h/m/l), kind (steps/retention), status (draft/review/published/partial/archived), current_version int, source_id → sources, source_ref text, code text (R-01 style), search_vector tsvector (generated from title, description and step text; config `simple` plus a Hebrew stopword list), embedding vector(768).
- `document_versions`: document_id, version int, snapshot jsonb (whole document as the shared `Document` schema), author_id, label, kind (published/restore/system/sync), suggestion_id nullable. Unique (document_id, version).
- `phases`: document_id, position, label, note, route.
- `steps`: phase_id, position, step_key (stable id used in links/goto, e.g. `s11`), num text (display, e.g. `1א`), title, description, hint, tone, block_id nullable, script text, source_ref text, deps text[] (step_keys), extras jsonb (signals, pillars, stages, objection, principles for retention docs).
- `step_actions`: step_id, position, text.
- `step_outcomes`: step_id, position, kind (ok/next/alert), text, goto_step_key.
- `step_branches`: step_id, question; `step_branch_options`: branch_id, position, kind (if/then), label, text, goto_step_key.
- `blocks`: slug, title, kind (step/script), description, script text, current_version; `block_actions`, `block_outcomes` as above; `block_versions` (snapshot jsonb, version, author, label).
- `crm_fields`: name (unique), status (ok/renamed/new/retired), renamed_to, path, effective_from, note. `step_field_refs`: step_id, field_name (recomputed on every structure save by the shared detector).
- `scripts`: title, text, tags text[]; `script_refs`: script_id, document_id, step_id.
- `document_links`: from_document_id, from_step_key nullable, to_document_id nullable, to_block_id nullable, to_field_name nullable, to_source_id nullable, type (next/prerequisite/shares_block/same_field/derived_from_source/related/link), origin (explicit/detected). Recomputed on save for detected links; explicit links are editable.
- `notes`: document_id, step_key nullable, author_id, text; `note_likes` (note_id, user_id).
- `pins` (user_id, document_id), `recent_views` (user_id, document_id, viewed_at, count), `drafts` (user_id, document_id nullable for new docs, payload jsonb, updated_at), `user_preferences` (theme, font, panel, call_mode, sidebar).

**Sources and pipeline (created now, used from stage 2)**

- `sources`: kind (docx/wordpress/json/csv), connector_id nullable, external_id, title, ext, mapping jsonb (column → field for json/csv), sync_state (synced/pending/processing/error), last_hash, last_synced_at.
- `source_revisions`: source_id, hash, raw (bytea or text), paragraphs jsonb (normalized: ref, heading, runs with ins/del/author/date), imported_at, imported_by, accepted bool.
- `suggestions`: source_revision_id, anchor (paragraph ref), type (update-step/new-card/new-step/update-block/deprecate-step/field-alert), target_document_id, target_step_key, target_block_id, payload jsonb, confidence numeric, rationale text, status (pending/accepted/rejected/applied), decided_by, decided_at, edited_payload jsonb, applied_version_id.

**Identity and admin**

- `users`: subject (unique per source), source (entra/paloalto/local), email, display_name, initials, active bool, last_login_at, password_hash (local only).
- `roles` (name, description, system bool), `permissions` (name, resource, description), `role_permissions`, `user_roles` (user_id, role_id, category_scope text[] nullable, granted_by, granted_at), `groups_map` (idp_group_id, idp_group_name, role_id).
- `sessions`: user_id, token_hash, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at.
- `audit_log`: actor_id, action (docs.publish…), entity_type, entity_id, before jsonb, after jsonb, ip, at, request_id.

**Deletion and trash** — soft delete via `deleted_at`; `GET /trash` reads documents, blocks, fields and scripts with `deleted_at` set within 30 days; a nightly job hard-deletes older rows (versions are kept). Restore clears `deleted_at` and writes a `document_versions` row of kind `system` ("שוחזר מסל מיחזור"). Impact ("N קישורים שבורים") = count of `document_links` pointing at the deleted entity.

**Migrations and seed** — node-pg-migrate; `pnpm --filter api seed` loads `legacy/js/data.js` + `data-docs.js` content (converted once into `apps/api/seed/*.json`) as the initial library, and today's seeded versions of the flagship document as real `document_versions` rows.

## 3. Identity and RBAC

**Providers**

1. **Entra ID (OIDC, primary)** — authorization code + PKCE with the `openid profile email` scopes and the `groups` claim (Graph fallback `GET /me/memberOf` when the token overflows). Callback creates/updates the `users` row and applies `groups_map`. A nightly job re-syncs active users and group membership via Graph with a client-credentials token; users no longer in any mapped group lose their mapped roles, users disabled in Entra are deactivated and their sessions revoked.
2. **Palo Alto User-ID (fallback)** — when `AUTH_FALLBACK=paloalto` and no session exists, the API queries the firewall XML API (`type=op`, `show user ip-user-mapping ip "<ip>"`) for the request's source IP, restricted to `PALOALTO_SUBNETS`. A `DOMAIN\user` answer creates/matches a `users` row with source `paloalto` and starts a session. Role assignment for these users is manual (admin) or through `groups_map` once Entra sync provides groups for the same email.
3. **Local** — break-glass admin created by `pnpm --filter api create-admin`; service accounts for connectors. Login form only reachable at `/login/local`.

**Sessions** — httpOnly, `SameSite=Lax`, secure cookie holding a random token; `sessions` row with 8-hour sliding expiry; revocable from admin; `/auth/me` returns user, roles, effective permissions, category scopes, preferences.

**Permissions** (`packages/shared/src/permissions.ts`): `docs.read, docs.create, docs.edit, docs.publish, docs.delete, docs.restore, blocks.edit, fields.edit, scripts.edit, notes.write, notes.moderate, suggestions.review, suggestions.apply, sources.manage, connectors.manage, users.manage, roles.manage, audit.read, system.admin`.

**Default roles**: agent (docs.read, notes.write); editor (agent + docs.create, docs.edit, suggestions.review, scripts.edit); lead (editor + docs.publish, docs.delete, docs.restore, blocks.edit, fields.edit, suggestions.apply, sources.manage, notes.moderate); admin (all). Roles are editable except that `admin` cannot lose `roles.manage`/`users.manage`. `user_roles.category_scope` limits docs.* permissions to listed categories.

**Enforcement** — one Fastify plugin resolves the session once per request and attaches `req.user` with a permission `Set`; routes declare `config: { requires: ['docs.publish'], scope: 'document' }` and the plugin checks permission and category scope before the handler. Every mutating handler writes `audit_log` (before/after) inside the same transaction. The web app receives the permission list at login and uses `can('docs.publish', doc)` to hide or disable controls; server checks remain authoritative.

## 4. API surface (`/api/v1`, JSON, zod-validated, OpenAPI generated)

- Auth: `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/local` (break-glass), `GET /auth/providers`.
- Documents: `GET /documents` (query: q, category, wave, priority, status, pinned, recent, page, pageSize; returns cards with computed counts), `POST /documents`, `GET /documents/:id`, `PATCH /documents/:id`, `PUT /documents/:id/structure` (phases/steps JSON; header `If-Match` etag → 412 on conflict), `POST /documents/:id/publish` (label), `GET /documents/:id/versions`, `GET /documents/:id/versions/:v`, `GET /documents/:id/diff?from=&to=`, `POST /documents/:id/restore/:v`, `DELETE /documents/:id`, `POST /documents/:id/pin`, `DELETE /documents/:id/pin`, `POST /documents/:id/view`, `GET /documents/:id/links`, `GET /documents/:id/related`.
- Blocks: CRUD, `GET /blocks/:id/usage`, `GET /blocks/:id/versions`. Fields: CRUD, `GET /fields/:name/usage`. Scripts: CRUD.
- Notes: `GET/POST /documents/:id/notes`, `DELETE /notes/:id`, `POST /notes/:id/like`. Drafts: `GET/PUT/DELETE /documents/:id/draft`, `GET/PUT /drafts/new/:draftId`.
- Search: `GET /search?q=&types=&limit=` → groups (documents, steps, blocks, fields, scripts) with highlights; full-text first, vector re-rank when the model's embedding endpoint is available.
- Trash: `GET /trash`, `POST /trash/:type/:id/restore`, `DELETE /trash/:type/:id`, `POST /trash/restore-all`, `DELETE /trash` (empty).
- Sources & suggestions (stage 2 implements handlers; routes and schemas exist now): `GET /sources`, `POST /sources/upload`, `POST /sources/:id/process`, `GET /sources/:id/revisions/:rev`, `GET /suggestions`, `POST /suggestions/:id/accept|reject|reset`, `PUT /suggestions/:id/edit`, `POST /suggestions/publish`.
- Preferences: `GET/PUT /me/preferences`.
- Admin: `GET/POST/PATCH /admin/users`, `GET/POST/PATCH/DELETE /admin/roles`, `GET/PUT /admin/groups-map`, `GET /admin/sessions`, `DELETE /admin/sessions/:id`, `GET /admin/audit`, `GET /admin/system`.
- Events: `GET /events` (SSE) with the names in `packages/shared/src/events.ts`; the server emits inside the transaction commit hook.
- Conventions: error envelope `{ code, message, details?, requestId }`; pagination `{ items, total, page, pageSize }`; rate limits on `/auth/*`; request ids in logs and audit.

## 5. Frontend port (`apps/web`)

- React 18, TypeScript strict, Vite, React Router (routes mirror today's hashes: `/library/:category?`, `/doc/:id/:step?`, `/edit/:id`, `/history/:id/:v?`, `/trash`, `/sources/:id?`, `/pinned`, `/recent`, `/drafts`, `/fields`, `/blocks`, `/admin/*`, `/login`).
- Server state with TanStack Query; the generated OpenAPI client; SSE hook invalidates queries by event; optimistic updates for pins, notes, outcome picks.
- Global stylesheet = today's `app.css` tokens (light/dark, Plex/Rubik switch) unchanged; components split by the same boundaries as today's files: `Shell` (sidebar/rail, tab strip), `Library`, `Article` (call mode, connections, panel, split), `Editor`, `History`, `Trash`, `Sources`, `Palette`, `Peek`, `Settings`, plus new `Login`, `Admin/*`, `SystemStatus`.
- `packages/shared` provides the bidi formatter, word diff, link/field detection, so the API computes `step_field_refs` and `document_links` with the same code the UI renders with.
- Per-user state that was in localStorage (pins, recent, drafts, call progress, preferences) moves to the API; call-mode progress stays client-side (sessionStorage) since it's per call.
- Feature parity checklist (acceptance): every capability in `legacy/README.md`'s screen table works against the API; plus login screen with provider buttons, permission-aware buttons, "עורך אחר עובד על המסמך" indicator (from drafts table), system status page, and an empty-state onboarding for a fresh install.

## 6. Testing, seeding, acceptance

- Unit (Vitest): shared formatter/diff/link detection, RBAC resolution, session handling.
- API integration (Vitest + testcontainers Postgres): every route, permission denial paths, etag conflicts, trash purge, audit rows.
- E2E (Playwright, against Compose): login (Entra mocked with a local OIDC test issuer; Palo Alto mocked by a stub HTTP server), library → call mode → outcome flow, editor publish → version → history restore, trash restore, search.
- Contract test: OpenAPI generated in CI must equal the committed file; frontend client regenerated from it.
- Seed: first login shows the same library as today's static app (23 documents, 4 blocks, 14 fields, 7 scripts, 52 cards, flagship version history).
- Stage-1 done when: the VM runs the stack from `deploy/INSTALL.md`, an Entra (or fallback) user can log in, the parity checklist passes, backups restore, and CI is green.
