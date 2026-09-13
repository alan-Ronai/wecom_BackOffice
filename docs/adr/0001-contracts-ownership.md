# ADR 0001 — Contract ownership

Date: 2026-09-13 · Status: accepted

## Context
Eight lanes implement the platform in parallel. They must agree on schemas, permissions, events, migrations, and connector/model interfaces without blocking each other.

## Decision
`packages/shared`, `packages/connectors/src/contract.ts`, `packages/model/src/contract.ts`, `apps/api/migrations`, and `docs/api/openapi.json` are owned by lane L0. Other lanes propose changes by pull request; a breaking change (renamed field, removed permission, changed event payload, dropped column) needs a new ADR in this folder before merge. Additive changes need only the PR.

## Consequences
Lanes can code against fixed names from day 3; CI fails when the generated OpenAPI drifts from the committed file, which forces the API and web client to move together.
