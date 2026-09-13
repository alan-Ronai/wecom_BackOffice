# wecom Knowledge Platform — program design and parallel lanes

Date: 2026-09-13 · Status: approved in brainstorming, awaiting written review

## 1. Goal

Turn the static wecom knowledge base (today: `index.html` + `js/` + `css/`, all state in localStorage) into a real product: a private-LAN server with a PostgreSQL database, a Node backend, a React frontend, a local AI model that turns source-document edits into card proposals, single sign-on with the company Microsoft identity, full RBAC, and a connector framework with two-way WordPress sync. Nothing is simulated: Word files are parsed for real, the model runs for real, every change is attributed to a real user.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Hosting | Private LAN, one VMware VM, Docker Compose |
| Stack | Node 22 + Fastify + TypeScript; PostgreSQL 16 + pgvector; React 18 + TypeScript + Vite; Ollama sidecar |
| Model | CPU inference (no GPU on the VM). Default `qwen2.5:3b-instruct` quantized, configurable; rule-based fallback when the model is unavailable |
| Identity | Microsoft Entra ID via OpenID Connect (primary) and Palo Alto User-ID fallback (identify LAN user by IP); local accounts only for break-glass admin and service accounts |
| Authorization | Fine-grained permissions bundled into editable roles (agent, editor, lead, admin), category scopes, Entra group → role mapping, audit log |
| Connectors | Generic contract; WordPress first; import from WP and push to WP; two-way sync with full parity |
| Conflicts | Review queue, never auto-overwrite; auto-apply only when exactly one side changed since the last sync |
| Mockups | Authored in the Claude Design project `8d3a1b0f-a941-4ceb-add4-7a58dd5a964d` before each UI-heavy stage |
| Architecture | Modular monolith: one API process with domain modules and pg-boss job queues in Postgres |

## 3. Repository layout (monorepo, pnpm workspaces)

```
apps/api              Fastify server: modules auth, rbac, content, search, sources, pipeline, connectors, sync, admin, events
apps/web              React app (port of today's UI)
packages/shared       zod schemas, TypeScript types, bidi formatter, diff, link detection (used by api and web)
packages/connectors   Connector contract + implementations (wordpress first)
packages/model        Model client (Ollama HTTP), prompt templates, JSON-schema constrained outputs, rule-based fallback
deploy/               docker-compose.yml, nginx.conf, .env.example, backup/restore scripts, INSTALL.md
docs/                 specs, ADRs, API docs export
legacy/               today's static app (moved here unchanged; reference for parity)
```

## 4. Stages

| Stage | Outcome | Spec |
|---|---|---|
| 1 Foundation | Server, schema, identity + RBAC, content API, frontend at parity with today's app, deploy on the VM | `2026-09-13-kb-platform-stage1-foundation-design.md` |
| 2 Source pipeline | Real `.docx` ingestion with tracked changes, diff engine, local model, suggestion queue, publish-to-library | own spec, section 7 below is the approved outline |
| 3 Connectors | Connector contract, WordPress two-way sync, review queue, webhooks/polling | own spec, section 8 |
| 4 Connected data | Data explorer for static files, relationship graph, field/block pages, dashboards, cross-file links | own spec, section 9 |
| 5 Admin & identity | User/role management UI, identity management, audit explorer, system page | own spec, section 10 |

Stages are the order in which value lands, not the order in which work must start. Section 5 defines lanes that run in parallel across stages.

## 5. Parallel lanes

Eight lanes, each owned by one implementer (human or agent), each with a clear deliverable and the interfaces it must respect. Lanes only communicate through the contracts in section 6, so they can proceed without waiting for each other. A lane whose upstream contract isn't implemented yet codes against the contract with fakes in tests, never with fakes in product code.

| Lane | Owns | Delivers | Depends on |
|---|---|---|---|
| **L0 Contracts** | `packages/shared`, OpenAPI, DB schema + migrations, event names, connector contract | The contracts in section 6, published first (days 1–3), then maintained | nothing |
| **L1 Platform** | `deploy/`, Docker Compose, nginx, Postgres, Ollama, backups, CI, health/system endpoints | A VM that runs the stack from a clean clone; CI running unit + integration + e2e | L0 (schema) |
| **L2 API core** | `apps/api` modules content, search, trash, notes, drafts, events (SSE) | All library endpoints of stage 1, seed import of today's content | L0 |
| **L3 Identity & RBAC** | `apps/api` modules auth, rbac, admin (users, roles, groups-map, audit, sessions) | OIDC login, Palo Alto fallback, permission middleware, admin API | L0 |
| **L4 Frontend** | `apps/web` | React port at parity, login, permission-aware UI, live updates, system page; later the stage 4/5 screens | L0 (types), mocked HTTP in tests until L2/L3 land |
| **L5 Pipeline** | `packages/model`, `apps/api` modules sources, pipeline, suggestions | docx + tracked-changes parser, paragraph diff, model prompts with schema-validated output, suggestion queue, apply-to-library | L0; uses L2's content services through their interfaces |
| **L6 Connectors** | `packages/connectors`, `apps/api` modules connectors, sync | Connector contract implementation, WordPress import/export, two-way sync with review queue, webhooks + polling | L0, L5 (suggestions are how imported changes surface) |
| **L7 Design** | Claude Design project | Mockup turns for: login/identity, admin, connectors & sync queue, data explorer, graph, dashboards, improved existing screens | none; feeds L4 |

Critical path: L0 (3 days) → L2/L3/L5 in parallel → L4 integration → L1 deploy. L6 starts after L0 and the L5 suggestion interface exist. L7 runs from day 1.

### Suggested sequencing per lane (two-week units)

- **Weeks 1–2**: L0 publishes contracts; L1 compose + CI; L2 documents/versions/blocks/fields; L3 OIDC + sessions + permissions; L4 shell, library, article; L5 docx parser + diff; L7 admin and login mockups.
- **Weeks 3–4**: L2 search, trash, notes, drafts, SSE; L3 Palo Alto fallback, admin API, audit; L4 editor, history, trash, palette, sources against real API; L5 model client, prompts, suggestion queue; L6 connector contract + WordPress read; L7 connectors and data-explorer mockups.
- **Weeks 5–6**: Stage 1 acceptance on the VM; L5 apply-to-library and end-to-end pipeline; L6 two-way sync and review queue; L4 admin and identity screens; L7 graph and dashboards.
- **Weeks 7–8**: Stage 4 connected-data features (L2 graph API + L4 screens); stage 5 admin UI polish; hardening, backups, load test with the full library.

## 6. Contracts (owned by L0, versioned, breaking changes require a note in `docs/adr/`)

1. **Database schema** — node-pg-migrate migrations in `apps/api/migrations`. Tables per the stage-1 spec §2. Lanes add columns only through new migrations reviewed by L0.
2. **Shared schemas** — zod schemas in `packages/shared/src/schemas/*` for Document, Phase, Step, Action, Outcome, Branch, Block, CrmField, Script, Note, Version, Suggestion, Source, Connector, User, Role, Permission, AuditEntry, and every request/response body. OpenAPI 3.1 is generated from them into `docs/api/openapi.json`; the frontend client is generated from that file.
3. **Permissions catalogue** — `packages/shared/src/permissions.ts` exports the permission strings and default role bundles. API routes declare `requires(...)`; the web hides controls by the same names.
4. **Events** — SSE event names and payloads in `packages/shared/src/events.ts`: `document.published`, `document.updated`, `document.deleted`, `suggestion.created`, `suggestion.decided`, `sync.completed`, `sync.conflict`, `job.failed`, `system.status`.
5. **Connector contract** — `packages/connectors/src/contract.ts`:
   - `describe(): ConnectorInfo` (id, name, capabilities: read, write, webhooks, identity)
   - `testConnection(config)`
   - `listRemote(config, since?)` → `RemoteItem[]` (external id, title, hash, updated_at, kind)
   - `fetch(config, externalId)` → `SourceContent` (normalized paragraphs with headings, plus raw)
   - `push(config, externalId | null, LibraryContent)` → `RemoteRef` (creates or updates)
   - `parseWebhook(request)` → `RemoteChange[]` (optional)
   - `mapIdentity?(...)` (optional, for identity connectors)
   Connectors never touch the database; the sync module does.
6. **Model contract** — `packages/model/src/index.ts`: `proposeChanges(ctx: { before, after, linkedCards, fields, blocks }) → Suggestion[]` where the output is validated against the Suggestion zod schema; any invalid output is retried once, then falls back to the rule engine. Prompts are Hebrew, few-shot, and stored as versioned files.
7. **Pipeline interfaces** — `SourceRevisionService.ingest(sourceId, content)`, `DiffService.paragraphDiff(prevRevision, nextRevision)`, `SuggestionService.create/decide/apply`. L6 calls `ingest`; L5 owns everything after it.

## 7. Stage 2 outline — source pipeline

- **Ingestion**: `.docx` uploaded or dropped from a watched folder. Parsed with JSZip + fast-xml-parser: paragraphs, headings (numbering like 4.8 kept), tables flattened, and tracked changes (`w:ins`, `w:del`, `w:moveFrom/To`) captured as runs with author/date. Comments (`comments.xml`) attached to paragraphs. Each ingest creates a `source_revision` with a content hash; identical hashes are ignored.
- **Diff**: paragraph alignment between the previous accepted revision and the new one (by heading number, then by similarity ≥ 0.6), producing added / removed / changed paragraphs with word-level diffs. Tracked changes, when present, are used directly instead of inferred.
- **Mapping**: paragraphs ↔ steps via `document_links` of type `derived_from_source` (anchor = heading number). First-time mapping is proposed by the model and confirmed by an editor.
- **Model**: for each changed paragraph, build a compact context (old text, new text, the mapped step(s), CRM field catalogue, shared blocks that match) and ask for structured proposals: `update-step`, `new-card`, `new-step`, `update-block`, `deprecate-step`, `field-alert`. Output is JSON validated by schema, with confidence and rationale in Hebrew. Batch jobs run in pg-boss with concurrency 1 on CPU; results appear via SSE.
- **Review**: the sources screen already built (accept / reject / edit / undo, publish accepted). Applying creates versions, cards and block versions exactly as today, attributed to the reviewer, with the suggestion id in the version label.
- **Acceptance**: upload the real "נהלי תמיכה טכנית" docx with a tracked change → within one job cycle a suggestion targeting the right step exists; accepting it publishes a new version and the diff shows the change.

## 8. Stage 3 outline — connectors and WordPress two-way sync

- **Registry**: `connectors` table (type, name, config JSON encrypted at rest, enabled, schedule, last_run, health). Admin UI to add, test and schedule.
- **WordPress read**: REST API (`/wp-json/wp/v2/posts|pages`, custom post types configurable), application-password auth. Polling on schedule plus an optional WP webhook (a tiny plugin or WP Webhooks) posting to `/api/v1/connectors/:id/webhook`. Each changed post becomes a `source_revision` (HTML → normalized paragraphs) and enters the stage-2 pipeline, so editors find ready suggestions at login.
- **WordPress write**: publishing a linked document renders it to WordPress HTML (steps, branches, scripts as semantic blocks) and updates the post; the remote `modified` timestamp and hash are recorded as the sync baseline.
- **Two-way rules**: a link table `sync_links` (document ↔ remote item, baseline hashes both sides). On each run: remote changed only → import as suggestions; local changed only → push; both changed → `sync.conflict` and a three-column merge view (base, WP, ours) in the review queue; nothing is overwritten until a lead resolves it. Parity report page lists every link with its state.
- **Acceptance**: edit a WP page → suggestion appears; accept and publish → WP page updated; edit both → conflict shown, merge resolves it.

## 9. Stage 4 outline — connected data

- **Data explorer**: every static file (`topics.json`, `intl-roaming.json`, `crm-fields.json`, `scripts.json`, uploaded JSON/CSV) is a `source` of kind `json`/`csv` with a schema mapping (which column is title, category, field name…). Explorer screen shows files, row counts, sync state, and lets an editor map columns to card fields and re-import.
- **Relationship graph**: `document_links` rendered as an interactive graph (documents, blocks, fields, sources as nodes; typed edges), filter by type/category, click-through, "what breaks if I delete this".
- **Field and block pages**: each CRM field and shared block gets a page: definition, history, every step that uses it, alerts (renamed, unknown), one-click "update all references".
- **Dashboards**: coverage (cards without documents, partial documents), freshness (last update per category), usage (views, call-mode completions, outcomes chosen), pipeline (suggestions pending/accepted/rejected per source), sync parity.
- **Cross-file linking**: link tokens `[[doc:]]`, `[[field:]]`, `[[block:]]`, `[[source:§]]` resolved everywhere with hover peeks; backlinks computed server-side.

## 10. Stage 5 outline — admin and identity

- Users list (source, roles, groups, last login, active), role editor (permissions matrix), group→role mapping, session revocation, audit explorer (filter by user/entity/date, before/after diff), system page (DB size, job queue, model status and latency, connector health, backups), configuration UI for identity providers with a "test login" button.

## 11. Non-functional requirements

- Hebrew-first UI, RTL, the existing bidi/type system; all user-facing text in Hebrew, logs in English.
- Response time under 300 ms for library reads with 5,000 documents; search under 500 ms.
- All data encrypted in transit inside the LAN (nginx TLS with an internal CA certificate); secrets only in `.env`; connector configs encrypted at rest.
- Daily backups, tested restore script, documented in `deploy/INSTALL.md`.
- Tests: unit (Vitest), API integration (testcontainers Postgres), e2e (Playwright), plus a contract test that fails CI if OpenAPI and the frontend client drift.
