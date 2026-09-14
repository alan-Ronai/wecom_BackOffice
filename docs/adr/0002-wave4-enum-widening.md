# ADR 0002 — Wave 4 enum widening

Date: 2026-09-14 · Status: accepted

## Context

PRD §10 requires a "לא בתוקף" status distinct from archive, and folding scripts into documents (spec §2.1) needs a text rendering kind.

## Decision

`DocumentStatusSchema` gains `'invalid'`; `DocumentKindSchema` gains `'text'`. Both are widenings: every existing value stays valid, existing rows are untouched, and the API check constraints are widened by migrations 0030 (kind) and 0031 (status). Consumers that switch exhaustively over these enums must add the new arm (TypeScript flags them).

## Consequences

Wave 3 lanes rebase and add the two arms where the compiler asks. No data migration.
