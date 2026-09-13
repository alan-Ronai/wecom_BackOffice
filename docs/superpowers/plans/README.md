# Implementation plans — wecom Knowledge Platform

Specs: `../specs/2026-09-13-kb-platform-program-and-lanes.md` (program, lanes, contracts) and `../specs/2026-09-13-kb-platform-stage1-foundation-design.md` (stage 1).

One plan per lane. Lanes run in parallel; each plan lists the exact names it consumes from L0 and the names it produces for others.

| Lane | Plan | Start after | Produces for |
|---|---|---|---|
| L0 Contracts & scaffold | `2026-09-13-L0-contracts-and-scaffold.md` | — | everyone (schemas, permissions, events, migrations, connector/model contracts, API + web skeletons, CI) |
| L1 Platform & deploy | `2026-09-13-L1-platform-deploy.md` | L0 Task 13 | the VM, Compose, TLS, backups, pg-boss plugin, system health |
| L2 API core | `2026-09-13-L2-api-core.md` | L0 Task 14 | content/search/trash/notes/drafts/events routes, `audit()`, `publishDocument()`, `publishBlock()`, seed |
| L3 Identity & RBAC | `2026-09-13-L3-identity-rbac.md` | L0 Task 14 | `req.user`, permission enforcement, auth + admin routes, identity sync job |
| L4 Frontend | `2026-09-13-L4-frontend-port.md` | L0 Task 15 | the React app (parity + login + admin + system) |
| L5 Source pipeline | `2026-09-13-L5-source-pipeline.md` | L0 Tasks 4, 12, 14 | docx/text parsers, diff, Ollama client, suggestions, apply-to-library, `SourceRevisionService.ingest()` |
| L6 Connectors & WordPress sync | `2026-09-13-L6-connectors-wordpress-sync.md` | L0 Task 11, L5 ingest interface | connector registry, WordPress + JSON/CSV connectors, two-way sync, review queue |
| L7 Design mockups | `2026-09-13-L7-design-mockups.md` | — | Claude Design turns 3–6 that L4 implements next |

## How to run lanes concurrently

1. Execute L0 first (about three days); merge to `main` after Task 16 so CI protects the contracts.
2. Start L1, L2, L3, L4, L5, L7 on separate branches (`lane/l1-platform`, …), each in its own git worktree. Rebase on `main` daily.
3. L6 starts once L5's `SourceRevisionService.ingest` signature is merged (it only needs the interface, not the model).
4. Cross-lane names are frozen by L0 and ADR 0001. A lane that needs a new field adds a migration + schema change through a PR against `main` labelled `contract`; the other lanes pick it up on their next rebase.
5. Integration checkpoints: end of week 2 (API core + auth + web shell on Compose), week 4 (pipeline end to end with the rule model), week 6 (stage-1 acceptance on the VM, WordPress sync demo), week 8 (stage 4/5 screens).

Each plan is written for a worker with no prior context: run it with the subagent-driven-development skill (one fresh worker per task, review between tasks) or executing-plans (batches with checkpoints).

## Canonical cross-lane names (authoritative)

| Concern | Name | Owner |
|---|---|---|
| pg-boss decorator + queue catalogue | `app.boss`, `QUEUES` in `apps/api/src/plugins/boss.ts` (`pipeline.process`, `sources.watch`, `connector.run`, `connector.webhook`, `identity.sync`, `trash.purge`, `search.reindex`, `system.backup-check`) | L1 |
| Audit | `audit(tx, entry)` in `apps/api/src/lib/audit.ts`; wrapper `app.audit(req, action, entityType, entityId, before, after)` | L2 (function), L3 (wrapper) |
| Events | `app.events.publish(tx, makeEvent(name, payload))` from `apps/api/src/lib/events.ts` | L2 |
| Auth | `req.user: AuthUser { id, displayName, roles, permissions, categoryScopes, sessionId }`; route `config.requires` enforced by `apps/api/src/plugins/auth.ts` | L3 |
| Module registration | `registerModules(v1)` in `apps/api/src/modules/index.ts` | L2 |
| Pipeline entry | `SourceRevisionService.ingest(sourceId, content, actorId, raw?)` | L5 |
| Content publish | `publishDocument(tx, doc, { actorId, label, suggestionId? })`, `publishBlock(tx, block, { actorId, label })` | L2 |

Each affected plan carries the same list under "Cross-lane reconciliation"; when a plan's body disagrees with it, the reconciliation section wins.
