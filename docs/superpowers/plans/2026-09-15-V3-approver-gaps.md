# V3 — Approver Role & Knowledge Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch on the PRD §11 approver role as configuration (`workflow.requireApprover`), and turn the PRD §13 "use usage data to find knowledge gaps" deferral into a nightly, idempotent, evidence-backed gap list with dismiss/resolve — `GET/PUT /admin/workflow`, `GET /gaps`, `POST /gaps/:id/dismiss`, `POST /gaps/:id/resolve`, `POST /gaps/detect`, plus the 403 `APPROVER_REQUIRED` gate on review decisions.

**Architecture:** One new API module `apps/api/src/modules/gaps/` (migration `0041_knowledge_gaps.js`; `heuristics.ts` = five pure-SQL detectors returning `{kind,key,title,evidence,score,…}` rows; `repo.ts` = idempotent upsert on `(kind,key)`, list/dismiss/resolve, auto-resolve when a linked document is published; `routes.ts`; `jobs.ts` = pg-boss `gaps.detect` nightly + manual route). Thresholds come from V0's `getWorkflowSettings`. A second small file `apps/api/src/modules/admin/workflow.ts` exposes the settings (`system.admin`) and is registered from `admin/routes.ts`. The approver gate is a guard inside wave 3's review-decision handler, driven by the same settings reader. Tables owned by V2 (`learning_attempts`) may not exist yet — the failed-question detector probes `to_regclass` and returns `[]` until they do.

**Tech Stack:** Node 22, Fastify 5, pg 8, pg-boss, zod 3, `@wecom/shared` (`wave5.ts` gap/workflow schemas, `getWorkflowSettings/putWorkflowSettings` from `apps/api/src/lib/workflowSettings.ts`), vitest 2, testcontainers Postgres.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave5-learning-design.md` §1.6 (approver), §1.7 (gap heuristics), §3 (`knowledge_gaps`, settings), §4 "Approver & gaps", §5 gaps/approver behaviour, §7 tests. Contract: `docs/api/CONTRACTS-wave5.md` (V3 rows). Consumes `docs/superpowers/plans/2026-09-15-V0-wave5-contracts.md` Tasks 1–5.

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`. Run from the repo root (`pnpm --filter @wecom/api …`) or `cd apps/api && pnpm vitest run <file>`.
- Schemas only from `@wecom/shared` (`GapSchema`, `GapsQuerySchema`, `GapsResponseSchema`, `GapDismissBodySchema`, `GapResolveBodySchema`, `GapDetectResultSchema`, `WorkflowSettingsSchema`, `WorkflowSettingsPutSchema`, `GapKindSchema`); never re-declare a body/response locally (path params only).
- Permissions exactly: `gaps.read` (list), `gaps.manage` (dismiss/resolve/detect), `system.admin` (workflow settings). Events only `gap.detected`; notification kind `gap`. Queue only `QUEUES.gapsDetect`.
- Migration file for this lane: `apps/api/migrations/0041_knowledge_gaps.js`. No foreign keys to V1/V2 tables.
- Append-only touches outside the module: `apps/api/src/modules/index.ts` (one import + one list entry), `apps/api/src/modules/admin/routes.ts` (one import + one `register`), `apps/api/src/modules/collab/reviews.ts` (the approver guard inside the review-decision handler and the `canApprove` field on queue rows), `packages/shared/src/schemas/stage45.ts` (one additive optional field `canApprove` on the review queue row — documented below; if the controller prefers, V6 can move it), `apps/api/test/int/scope-leak.test.ts` (rows for `/gaps`). Never edit `app.ts`, anything under `apps/web/`, or `wave5.ts` (V0 owns it).
- Hebrew for user-facing strings, English for identifiers and logs. Commit after every task; end every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File structure

```
apps/api/migrations/0041_knowledge_gaps.js              knowledge_gaps + gap_runs (new)
apps/api/src/modules/gaps/stem.ts                        normalizeStem (pure) (new)
apps/api/src/modules/gaps/heuristics.ts                  five detectors → GapCandidate[] (new)
apps/api/src/modules/gaps/repo.ts                        upsertCandidates, listGaps, getGap, dismissGap, resolveGap, autoResolvePublished, lastRunAt, recordRun (new)
apps/api/src/modules/gaps/detect.ts                      runDetection(deps): GapDetectResult (orchestrates heuristics + repo + notifications) (new)
apps/api/src/modules/gaps/routes.ts                      GET /gaps, POST /gaps/:id/dismiss|resolve, POST /gaps/detect (new)
apps/api/src/modules/gaps/jobs.ts                        nightly gaps.detect (new)
apps/api/src/modules/gaps/index.ts                       module: routes + jobs (new)
apps/api/src/modules/admin/workflow.ts                   GET/PUT /admin/workflow (new)
apps/api/src/modules/admin/routes.ts                     (modify: register workflow)
apps/api/src/modules/collab/reviews.ts                   (modify: APPROVER_REQUIRED guard, canApprove on rows)
packages/shared/src/schemas/stage45.ts                   (modify: ReviewQueue row += canApprove?: boolean)
apps/api/src/modules/index.ts                            (modify: register gaps)
apps/api/test/unit/gaps-stem.test.ts                     (new)
apps/api/test/gaps.test.ts                               integration: heuristics, idempotence, list/dismiss/resolve, permissions, detect route (new)
apps/api/test/workflow-approver.test.ts                  integration: settings round trip, approver gate on/off (new)
apps/api/test/migrations.test.ts                         (modify: tables + unique index)
apps/api/test/int/scope-leak.test.ts                     (modify: /gaps in the permission tables)
docs/api/openapi.json                                    (regenerate)
```

## Names other lanes consume

- `apps/api/src/modules/gaps/repo.ts`: `autoResolvePublished(q): Promise<number>` (V2/V6 may call it after a publish; the nightly job calls it too).
- `apps/api/src/modules/gaps/detect.ts`: `runDetection(deps: DetectDeps): Promise<GapDetectResult>` with `DetectDeps = { db: pg.Pool; notifier: Notifier; taxonomy: TaxonomyResolver; log: FastifyBaseLogger }`.
- Tables: `knowledge_gaps(id, kind, key, title, evidence, score, status, suggested_action, document_id, topic_id, world_slug, first_seen_at, last_seen_at, dismissed_by, dismissed_reason, dismissed_at, resolved_document_id, resolved_at)` unique `(kind, key)`; `gap_runs(id, started_at, finished_at, detected, updated, resolved, error)`.
- `apps/api/src/modules/admin/workflow.ts`: routes only; settings are read everywhere through `getWorkflowSettings` (V0).
- Review queue rows gain `canApprove: boolean` (true when `requireApprover` is off, or the caller holds the `approver` role).
- Error code `APPROVER_REQUIRED` (403) from `POST /documents/:id/review-decision`.

---

### Task 1: Migration 0041 — `knowledge_gaps`, `gap_runs`

**Files:**
- Create: `apps/api/migrations/0041_knowledge_gaps.js`
- Modify: `apps/api/test/migrations.test.ts`

**Interfaces:**
- Consumes: `users`, `documents`, `topics` tables (FKs to `users`/`documents` only; `topic_id` has no FK so a dropped topic does not block).
- Produces: the two tables above.

- [ ] **Step 1: Add the failing migration assertion** — inside the existing `run('migrations', …)` block, before `'rolls back cleanly'`:

```ts
  it('creates knowledge_gaps with its unique (kind,key) index and gap_runs', async () => {
    const t = await pool.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name in ('knowledge_gaps','gap_runs') order by 1",
    );
    expect(t.rows.map((r) => r.table_name)).toEqual(['gap_runs', 'knowledge_gaps']);
    const idx = await pool.query(
      "select indexname from pg_indexes where tablename='knowledge_gaps' and indexname='knowledge_gaps_kind_key_uniq'",
    );
    expect(idx.rowCount).toBe(1);
    const chk = await pool.query(
      `select pg_get_constraintdef(c.oid) def from pg_constraint c join pg_class t on t.oid=c.conrelid
       where t.relname='knowledge_gaps' and c.conname='knowledge_gaps_kind_check'`,
    );
    expect(chk.rows[0].def).toContain('zero_results');
  });
```

- [ ] **Step 2: Run to verify failure** — `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts` → FAIL (tables missing).

- [ ] **Step 3: Write the migration**

```js
/** Wave 5 (V3): knowledge gaps found by the nightly heuristics (spec §1.7, §3) and their run log. */
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('knowledge_gaps', {
    id: id(pgm),
    kind: {
      type: 'text',
      notNull: true,
      check: "kind in ('zero_results','feedback_cluster','stale_high_traffic','topic_without_procedure','failed_question')",
    },
    key: { type: 'text', notNull: true },
    title: { type: 'text', notNull: true },
    evidence: { type: 'jsonb', notNull: true, default: '{}' },
    score: { type: 'numeric(10,3)', notNull: true, default: 0 },
    status: { type: 'text', notNull: true, default: 'open', check: "status in ('open','dismissed','resolved')" },
    suggested_action: {
      type: 'text',
      notNull: true,
      check: "suggested_action in ('create','update','add_question','review')",
    },
    document_id: { type: 'uuid', references: 'documents', onDelete: 'set null' },
    topic_id: 'uuid', // topics.id; no FK so V1/V2 ordering and topic deletion never block
    world_slug: 'text',
    first_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    dismissed_by: { type: 'uuid', references: 'users' },
    dismissed_reason: 'text',
    dismissed_at: 'timestamptz',
    resolved_document_id: { type: 'uuid', references: 'documents', onDelete: 'set null' },
    resolved_at: 'timestamptz',
  });
  pgm.addConstraint('knowledge_gaps', 'knowledge_gaps_kind_check', {
    check: "kind in ('zero_results','feedback_cluster','stale_high_traffic','topic_without_procedure','failed_question')",
  });
  pgm.createIndex('knowledge_gaps', ['kind', 'key'], { unique: true, name: 'knowledge_gaps_kind_key_uniq' });
  pgm.createIndex('knowledge_gaps', ['status', 'score'], { name: 'knowledge_gaps_status_score_idx' });
  pgm.createIndex('knowledge_gaps', 'document_id', { name: 'knowledge_gaps_document_idx' });
  pgm.createTable('gap_runs', {
    id: id(pgm),
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: 'timestamptz',
    detected: { type: 'integer', notNull: true, default: 0 },
    updated: { type: 'integer', notNull: true, default: 0 },
    resolved: { type: 'integer', notNull: true, default: 0 },
    error: 'text',
  });
};
exports.down = (pgm) => {
  pgm.dropTable('gap_runs');
  pgm.dropTable('knowledge_gaps');
};
```
Note: the inline `check` on `kind` and the explicit `addConstraint` produce two constraints; keep only the explicit one (drop the inline `check:` from the `kind` column) so the name `knowledge_gaps_kind_check` is deterministic.

- [ ] **Step 4: Run** — `RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts test/migrate.test.ts` → PASS (incl. rollback-to-empty).
- [ ] **Step 5: Commit** — `git add apps/api/migrations/0041_knowledge_gaps.js apps/api/test/migrations.test.ts && git commit -m "feat(api): migration 0041 — knowledge_gaps and gap_runs"`

---

### Task 2: Stem normaliser (pure) and the gaps repo

**Files:**
- Create: `apps/api/src/modules/gaps/stem.ts`, `apps/api/src/modules/gaps/repo.ts`
- Test: `apps/api/test/unit/gaps-stem.test.ts`, `apps/api/test/gaps.test.ts` (first describe)

**Interfaces:**
- Produces:
```ts
// stem.ts
export function normalizeStem(q: string): string; // lowercase, trim, collapse whitespace, strip one Hebrew prefix letter (ו ה ב ל מ ש כ) from words of length ≥ 4, drop punctuation and Hebrew niqqud
// repo.ts
export interface GapCandidate { kind: GapKind; key: string; title: string; evidence: Record<string, unknown>; score: number; suggestedAction: 'create'|'update'|'add_question'|'review'; documentId: string|null; topicId: string|null; worldSlug: string|null }
export async function upsertCandidates(tx: Tx, cands: GapCandidate[]): Promise<{ detected: number; updated: number; newIds: string[] }>;
export async function listGaps(q: Q, query: GapsQuery, worldScopes: readonly string[] | null): Promise<{ items: Gap[]; total: number }>;
export async function getGap(q: Q, id: string): Promise<Gap | null>;
export async function dismissGap(tx: Tx, id: string, reason: string, userId: string): Promise<Gap | null>;
export async function resolveGap(tx: Tx, id: string, documentId: string): Promise<Gap | null>;
export async function autoResolvePublished(q: Q): Promise<number>;
export async function lastRunAt(q: Q): Promise<string | null>;
export async function recordRun(q: Q, r: { detected: number; updated: number; resolved: number; error?: string }, startedAt: Date): Promise<void>;
```

- [ ] **Step 1: Unit test for the stem**

`apps/api/test/unit/gaps-stem.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeStem } from '../../src/modules/gaps/stem.js';

describe('normalizeStem', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeStem('  APN   Settings ')).toBe('apn settings');
  });
  it('strips one Hebrew prefix letter from words of four letters or more', () => {
    expect(normalizeStem('והחשבונית')).toBe('חשבונית');
    expect(normalizeStem('בחו"ל')).toBe('חו"ל'.replace('"', ''));
    expect(normalizeStem('של')).toBe('של'); // short words untouched
    expect(normalizeStem('לנדידה בחול')).toBe('נדידה חול');
  });
  it('drops punctuation and niqqud', () => {
    expect(normalizeStem('eSIM?!')).toBe('esim');
    expect(normalizeStem('שָׁלוֹם')).toBe('שלום');
  });
  it('is idempotent', () => {
    const once = normalizeStem('ולהפעלת eSIM!!');
    expect(normalizeStem(once)).toBe(once);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd apps/api && pnpm vitest run test/unit/gaps-stem.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `stem.ts`**

```ts
const PREFIXES = new Set(['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ']);
const NIQQUD = /[֑-ׇ]/g;
const PUNCT = /[^\p{L}\p{N}\s]/gu;

/**
 * A cheap, deterministic stem for clustering zero-result searches: "והחשבונית" and "חשבונית"
 * are the same gap. One prefix letter only — stripping two would fold "מהיר" into "היר".
 */
export function normalizeStem(q: string): string {
  const words = q
    .toLowerCase()
    .replace(NIQQUD, '')
    .replace(PUNCT, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length >= 4 && PREFIXES.has(w[0]!) ? w.slice(1) : w));
  return words.join(' ');
}
```
(Adjust the `בחו"ל` expectation in the test to `'חול'` — the quote is punctuation and the prefix is stripped; the test above spells the same value defensively.)

- [ ] **Step 4: Integration test for the repo** — `apps/api/test/gaps.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';
import { withTransaction } from '../src/lib/sql.js';
import * as repo from '../src/modules/gaps/repo.js';

const run = integration ? describe : describe.skip;
run('gaps', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;
  let lead: Awaited<ReturnType<typeof makeUser>>;
  let agent: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    editor = await makeUser(db.pool, { name: 'עורך', perms: ['docs.read', 'gaps.read'] });
    lead = await makeUser(db.pool, { name: 'מוביל', perms: ['docs.read', 'gaps.read', 'gaps.manage'] });
    agent = await makeUser(db.pool, { name: 'נציג', perms: ['docs.read'] });
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  const cand = (over: Partial<repo.GapCandidate> = {}): repo.GapCandidate => ({
    kind: 'zero_results',
    key: 'esim',
    title: 'חיפושים ללא תוצאה: esim',
    evidence: { count: 5, samples: ['eSIM', 'esim הפעלה'] },
    score: 5,
    suggestedAction: 'create',
    documentId: null,
    topicId: null,
    worldSlug: null,
    ...over,
  });

  describe('repo', () => {
    it('upserts idempotently on (kind,key), bumping last_seen_at and evidence on repeat', async () => {
      const first = await withTransaction(db.pool, (tx) => repo.upsertCandidates(tx, [cand()]));
      expect(first).toMatchObject({ detected: 1, updated: 0 });
      const before = await db.pool.query("select last_seen_at, first_seen_at from knowledge_gaps where kind='zero_results' and key='esim'");
      await new Promise((r) => setTimeout(r, 20));
      const second = await withTransaction(db.pool, (tx) => repo.upsertCandidates(tx, [cand({ score: 7, evidence: { count: 7 } })]));
      expect(second).toMatchObject({ detected: 0, updated: 1 });
      const after = await db.pool.query("select last_seen_at, first_seen_at, score, evidence from knowledge_gaps where kind='zero_results' and key='esim'");
      expect(after.rowCount).toBe(1);
      expect(new Date(after.rows[0].last_seen_at).getTime()).toBeGreaterThan(new Date(before.rows[0].last_seen_at).getTime());
      expect(after.rows[0].first_seen_at).toEqual(before.rows[0].first_seen_at);
      expect(Number(after.rows[0].score)).toBe(7);
      expect(after.rows[0].evidence).toEqual({ count: 7 });
    });
    it('does not reopen a dismissed gap on repeat, and lists by status', async () => {
      const g = (await repo.listGaps(db.pool, { page: 1, pageSize: 20, status: 'open' }, null)).items[0]!;
      const dismissed = await withTransaction(db.pool, (tx) => repo.dismissGap(tx, g.id, 'לא רלוונטי', lead.id));
      expect(dismissed?.status).toBe('dismissed');
      await withTransaction(db.pool, (tx) => repo.upsertCandidates(tx, [cand()]));
      const still = await repo.getGap(db.pool, g.id);
      expect(still?.status).toBe('dismissed');
      expect((await repo.listGaps(db.pool, { page: 1, pageSize: 20, status: 'open' }, null)).total).toBe(0);
      expect((await repo.listGaps(db.pool, { page: 1, pageSize: 20, status: 'dismissed' }, null)).total).toBe(1);
    });
  });
});
```

- [ ] **Step 5: Implement `repo.ts`**

```ts
import type pg from 'pg';
import type { Gap, GapKind } from '@wecom/shared';
import type { z } from 'zod';
import type { GapsQuerySchema } from '@wecom/shared';
import type { Tx } from '../../lib/sql.js';

type Q = pg.Pool | pg.PoolClient;
export type GapsQuery = z.infer<typeof GapsQuerySchema>;

export interface GapCandidate {
  kind: GapKind;
  key: string;
  title: string;
  evidence: Record<string, unknown>;
  score: number;
  suggestedAction: 'create' | 'update' | 'add_question' | 'review';
  documentId: string | null;
  topicId: string | null;
  worldSlug: string | null;
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const toGap = (r: Record<string, unknown>): Gap => ({
  id: r.id as string,
  kind: r.kind as Gap['kind'],
  key: r.key as string,
  title: r.title as string,
  score: Number(r.score),
  status: r.status as Gap['status'],
  evidence: (r.evidence as Record<string, unknown>) ?? {},
  suggestedAction: r.suggested_action as Gap['suggestedAction'],
  documentId: (r.document_id as string | null) ?? null,
  topicId: (r.topic_id as string | null) ?? null,
  worldSlug: (r.world_slug as string | null) ?? null,
  firstSeenAt: iso(r.first_seen_at as Date)!,
  lastSeenAt: iso(r.last_seen_at as Date)!,
  dismissedReason: (r.dismissed_reason as string | null) ?? null,
  resolvedDocumentId: (r.resolved_document_id as string | null) ?? null,
});

/**
 * Idempotent: the (kind,key) pair is the identity. A repeat sighting refreshes evidence, score
 * and `last_seen_at` but never touches `status` — a dismissed gap stays dismissed until the
 * operator reopens it by resolving/unresolving, and a resolved one stays resolved.
 */
export async function upsertCandidates(tx: Tx, cands: GapCandidate[]): Promise<{ detected: number; updated: number; newIds: string[] }> {
  let detected = 0;
  let updated = 0;
  const newIds: string[] = [];
  for (const c of cands) {
    const r = await tx.query<{ id: string; inserted: boolean }>(
      `insert into knowledge_gaps(kind, key, title, evidence, score, suggested_action, document_id, topic_id, world_slug)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (kind, key) do update
         set title = excluded.title, evidence = excluded.evidence, score = excluded.score,
             suggested_action = excluded.suggested_action, document_id = excluded.document_id,
             topic_id = excluded.topic_id, world_slug = excluded.world_slug, last_seen_at = now()
       returning id, (xmax = 0) as inserted`,
      [c.kind, c.key, c.title, JSON.stringify(c.evidence), c.score, c.suggestedAction, c.documentId, c.topicId, c.worldSlug],
    );
    if (r.rows[0].inserted) {
      detected++;
      newIds.push(r.rows[0].id);
    } else updated++;
  }
  return { detected, updated, newIds };
}

const SELECT = `select g.* from knowledge_gaps g`;

export async function listGaps(q: Q, query: GapsQuery, worldScopes: readonly string[] | null): Promise<{ items: Gap[]; total: number }> {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return '$' + params.length;
  };
  const where = [`g.status = ${p(query.status)}`];
  if (query.kind) where.push(`g.kind = ${p(query.kind)}`);
  if (query.world) where.push(`g.world_slug = ${p(query.world)}`);
  // A world-scoped editor sees gaps in their worlds plus world-less gaps (zero-result searches carry no world).
  if (worldScopes) where.push(`(g.world_slug is null or g.world_slug = any(${p([...worldScopes])}::text[]))`);
  const w = 'where ' + where.join(' and ');
  const total = await q.query<{ n: string }>(`select count(*) n from knowledge_gaps g ${w}`, params);
  const rows = await q.query(
    `${SELECT} ${w} order by g.score desc, g.last_seen_at desc limit ${p(query.pageSize)} offset ${p((query.page - 1) * query.pageSize)}`,
    params,
  );
  return { items: rows.rows.map(toGap), total: Number(total.rows[0].n) };
}

export async function getGap(q: Q, id: string): Promise<Gap | null> {
  const r = await q.query(`${SELECT} where g.id=$1`, [id]);
  return r.rowCount ? toGap(r.rows[0]) : null;
}

export async function dismissGap(tx: Tx, id: string, reason: string, userId: string): Promise<Gap | null> {
  const r = await tx.query(
    `update knowledge_gaps set status='dismissed', dismissed_by=$2, dismissed_reason=$3, dismissed_at=now()
     where id=$1 and status='open' returning *`,
    [id, userId, reason],
  );
  return r.rowCount ? toGap(r.rows[0]) : null;
}

/** Links a gap to the document that answers it. If that document is already published the gap resolves now; otherwise on its next publish (autoResolvePublished). */
export async function resolveGap(tx: Tx, id: string, documentId: string): Promise<Gap | null> {
  const r = await tx.query(
    `update knowledge_gaps g set resolved_document_id=$2,
        status = case when exists (select 1 from documents d where d.id=$2 and d.status in ('published','partial') and d.deleted_at is null) then 'resolved' else g.status end,
        resolved_at = case when exists (select 1 from documents d where d.id=$2 and d.status in ('published','partial') and d.deleted_at is null) then now() else g.resolved_at end
     where g.id=$1 and g.status <> 'resolved' returning *`,
    [id, documentId],
  );
  return r.rowCount ? toGap(r.rows[0]) : null;
}

/**
 * Closes the loop without an operator: a gap linked to a document (explicitly via resolve, or
 * implicitly by kind `stale_high_traffic`/`feedback_cluster`/`failed_question` on `document_id`)
 * is resolved once that document has a published version newer than the gap's last sighting.
 */
export async function autoResolvePublished(q: Q): Promise<number> {
  const r = await q.query(
    `update knowledge_gaps g set status='resolved', resolved_at=now()
     where g.status='open'
       and exists (
         select 1 from document_versions v
         where v.document_id = coalesce(g.resolved_document_id, g.document_id)
           and v.kind = 'published' and v.created_at > g.last_seen_at
       )`,
  );
  return r.rowCount ?? 0;
}

export async function lastRunAt(q: Q): Promise<string | null> {
  const r = await q.query<{ finished_at: Date | null }>('select finished_at from gap_runs where finished_at is not null order by finished_at desc limit 1');
  return r.rowCount ? iso(r.rows[0].finished_at) : null;
}

export async function recordRun(q: Q, r: { detected: number; updated: number; resolved: number; error?: string }, startedAt: Date): Promise<void> {
  await q.query(
    'insert into gap_runs(started_at, finished_at, detected, updated, resolved, error) values ($1, now(), $2, $3, $4, $5)',
    [startedAt, r.detected, r.updated, r.resolved, r.error ?? null],
  );
}
```

- [ ] **Step 6: Run** — `pnpm vitest run test/unit/gaps-stem.test.ts && RUN_INTEGRATION=1 pnpm vitest run test/gaps.test.ts` → PASS.
- [ ] **Step 7: Commit** — `feat(api): gaps repo (idempotent upsert, list/dismiss/resolve, auto-resolve) and Hebrew stem normaliser`

---

### Task 3: The five heuristics

**Files:**
- Create: `apps/api/src/modules/gaps/heuristics.ts`
- Test: `apps/api/test/gaps.test.ts` (second describe)

**Interfaces:**
- Consumes: `search_log(q, results, at)`, `feedback(document_id, kind, status, world_slug)`, `recent_views(document_id, count, viewed_at)`, `documents(id, title, status, updated_at, doc_type, category, deleted_at)`, `document_topics`, `topics(id, name, world_id)`, `worlds(id, slug)`, `topic_views(topic_id, count)`, optionally `learning_attempts(answers)` + `quiz_questions` (V2/V1 — probed with `to_regclass`; see the Cross-lane note), settings `gaps.*` from `WorkflowSettings`.
- Produces:
```ts
export interface Thresholds { zeroResultMin: number; feedbackClusterMin: number; staleDays: number; failedQuestionRate: number }
export async function zeroResultClusters(q: Q, t: Thresholds): Promise<GapCandidate[]>;
export async function feedbackClusters(q: Q, t: Thresholds): Promise<GapCandidate[]>;
export async function staleHighTraffic(q: Q, t: Thresholds): Promise<GapCandidate[]>;
export async function topicsWithoutProcedure(q: Q): Promise<GapCandidate[]>;
export async function failedQuestions(q: Q, t: Thresholds): Promise<GapCandidate[]>;
export async function allHeuristics(q: Q, t: Thresholds): Promise<GapCandidate[]>;
```

- [ ] **Step 1: Write the failing tests** — append to `gaps.test.ts` a `describe('heuristics', …)` with one fixture per detector:

```ts
  describe('heuristics', () => {
    const T = { zeroResultMin: 3, feedbackClusterMin: 2, staleDays: 180, failedQuestionRate: 0.5 };
    let docId: string;
    beforeAll(async () => {
      // world + topic + one published, high-traffic, stale document
      await db.pool.query(`insert into worlds(slug, name, position) values ('tech','טכני',0) on conflict (slug) do nothing`);
      const w = await db.pool.query(`select id from worlds where slug='tech'`);
      const t = await db.pool.query(
        `insert into topics(world_id, slug, name) values ($1,'apn-no-proc','APN בלי נוהל') returning id`, [w.rows[0].id],
      );
      const d = await db.pool.query(
        `insert into documents(slug, title, description, category, wave, priority, kind, status, doc_type, current_version, updated_at)
         values ('stale-doc','מסמך ישן','', 'tech', 1, 'h', 'steps', 'published', 'I', 1, now() - interval '200 days') returning id`,
      );
      docId = d.rows[0].id;
      await db.pool.query(`insert into document_worlds(document_id, world_slug) values ($1,'tech')`, [docId]);
      await db.pool.query(`insert into document_topics(document_id, topic_id) values ($1,$2)`, [docId, t.rows[0].id]);
      await db.pool.query(`insert into topic_views(user_id, topic_id, count) values ($1,$2,4)`, [agent.id, t.rows[0].id]);
      // views: this doc is the only one with views → top decile
      await db.pool.query(`insert into recent_views(user_id, document_id, count) values ($1,$2,50)`, [agent.id, docId]);
      // zero-result searches: 3 spellings of the same stem, 1 unrelated
      for (const q of ['eSIM', 'esim!', 'והesim', 'xyz']) {
        await db.pool.query(`insert into search_log(user_id, q, results) values ($1,$2,0)`, [agent.id, q]);
      }
      // feedback cluster: two open no_answer on the doc
      for (const k of ['no_answer', 'missing']) {
        await db.pool.query(
          `insert into feedback(document_id, document_version, world_slug, kind, text, status, user_id) values ($1,1,'tech',$2,'',$3,$4)`,
          [docId, k, 'new', agent.id],
        );
      }
    }, 60000);

    it('clusters zero-result searches by stem at the threshold', async () => {
      const out = await heur.zeroResultClusters(db.pool, T);
      const esim = out.find((c) => c.key === 'esim');
      expect(esim).toBeDefined();
      expect(esim!.evidence).toMatchObject({ count: 3 });
      expect((esim!.evidence.samples as string[]).length).toBeGreaterThan(0);
      expect(out.find((c) => c.key === 'xyz')).toBeUndefined();
      expect(esim!.suggestedAction).toBe('create');
    });
    it('clusters open no_answer/missing feedback per document', async () => {
      const out = await heur.feedbackClusters(db.pool, T);
      const g = out.find((c) => c.documentId === docId);
      expect(g).toMatchObject({ kind: 'feedback_cluster', key: docId, worldSlug: 'tech', suggestedAction: 'update' });
      expect(g!.evidence).toMatchObject({ open: 2 });
    });
    it('flags top-decile traffic documents not updated within staleDays', async () => {
      const out = await heur.staleHighTraffic(db.pool, T);
      expect(out.find((c) => c.documentId === docId)).toMatchObject({ kind: 'stale_high_traffic', suggestedAction: 'update' });
      expect(await heur.staleHighTraffic(db.pool, { ...T, staleDays: 400 })).toEqual([]);
    });
    it('flags viewed topics that have no published R/O item', async () => {
      const out = await heur.topicsWithoutProcedure(db.pool);
      const g = out.find((c) => c.title.includes('APN בלי נוהל'));
      expect(g).toMatchObject({ kind: 'topic_without_procedure', worldSlug: 'tech', suggestedAction: 'create' });
      // adding a published R item to the topic clears it
      const r = await db.pool.query(
        `insert into documents(slug, title, description, category, wave, priority, kind, status, doc_type, current_version)
         values ('apn-route','מסלול APN','', 'tech', 1, 'h', 'steps', 'published', 'R', 1) returning id`,
      );
      await db.pool.query(`insert into document_topics(document_id, topic_id) values ($1,$2)`, [r.rows[0].id, g!.topicId]);
      expect((await heur.topicsWithoutProcedure(db.pool)).find((c) => c.topicId === g!.topicId)).toBeUndefined();
    });
    it('returns no failed-question gaps while the learning tables are absent', async () => {
      const has = await db.pool.query(`select to_regclass('public.learning_attempts') t`);
      if (has.rows[0].t) return; // V2 merged: covered by the cross-lane test in V6
      expect(await heur.failedQuestions(db.pool, T)).toEqual([]);
    });
  });
```
Add `import * as heur from '../src/modules/gaps/heuristics.js';` at the top. If `documents` requires other not-null columns in the current schema (check `0003_content.js` and later `addColumns`), extend the inserts — the assertions stay.

- [ ] **Step 2: Run to verify failure** — `RUN_INTEGRATION=1 pnpm vitest run test/gaps.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `heuristics.ts`**

```ts
import type pg from 'pg';
import { normalizeStem } from './stem.js';
import type { GapCandidate } from './repo.js';

type Q = pg.Pool | pg.PoolClient;
export interface Thresholds {
  zeroResultMin: number;
  feedbackClusterMin: number;
  staleDays: number;
  failedQuestionRate: number;
}

/** Zero-result searches in the last 7 days, clustered by normalised stem (done in Node: the stem is not SQL-expressible). */
export async function zeroResultClusters(q: Q, t: Thresholds): Promise<GapCandidate[]> {
  const r = await q.query<{ q: string; n: string; last: Date }>(
    `select q, count(*) n, max(at) last from search_log
     where results = 0 and at > now() - interval '7 days' and length(trim(q)) >= 2
     group by q`,
  );
  const clusters = new Map<string, { count: number; samples: Set<string>; last: Date }>();
  for (const row of r.rows) {
    const stem = normalizeStem(row.q);
    if (!stem) continue;
    const c = clusters.get(stem) ?? { count: 0, samples: new Set<string>(), last: row.last };
    c.count += Number(row.n);
    if (c.samples.size < 5) c.samples.add(row.q);
    if (row.last > c.last) c.last = row.last;
    clusters.set(stem, c);
  }
  return [...clusters.entries()]
    .filter(([, c]) => c.count >= t.zeroResultMin)
    .map(([stem, c]) => ({
      kind: 'zero_results',
      key: stem,
      title: `חיפושים ללא תוצאה: ${stem}`,
      evidence: { count: c.count, samples: [...c.samples], lastAt: c.last.toISOString(), windowDays: 7 },
      score: c.count,
      suggestedAction: 'create',
      documentId: null,
      topicId: null,
      worldSlug: null,
    }));
}

/** Documents with ≥ N open feedback of kind no_answer / missing. */
export async function feedbackClusters(q: Q, t: Thresholds): Promise<GapCandidate[]> {
  const r = await q.query<{ document_id: string; title: string; world_slug: string; open: string; kinds: string[] }>(
    `select f.document_id, d.title, f.world_slug, count(*) open, array_agg(distinct f.kind) kinds
     from feedback f join documents d on d.id = f.document_id and d.deleted_at is null
     where f.kind in ('no_answer','missing') and f.status in ('new','in_review','needs_update')
     group by f.document_id, d.title, f.world_slug
     having count(*) >= $1`,
    [t.feedbackClusterMin],
  );
  return r.rows.map((x) => ({
    kind: 'feedback_cluster',
    key: x.document_id,
    title: `דיווחים חוזרים על חוסר מידע: ${x.title}`,
    evidence: { open: Number(x.open), kinds: x.kinds },
    score: Number(x.open) * 2,
    suggestedAction: 'update',
    documentId: x.document_id,
    topicId: null,
    worldSlug: x.world_slug,
  }));
}

/** Top-decile traffic (cumulative recent_views.count) that has not been updated for staleDays. */
export async function staleHighTraffic(q: Q, t: Thresholds): Promise<GapCandidate[]> {
  const r = await q.query<{ id: string; title: string; category: string; views: string; updated_at: Date }>(
    `with traffic as (
       select d.id, d.title, d.category, d.updated_at, coalesce(sum(v.count),0) views,
              percent_rank() over (order by coalesce(sum(v.count),0)) pr
       from documents d left join recent_views v on v.document_id = d.id
       where d.deleted_at is null and d.status in ('published','partial')
       group by d.id
     )
     select id, title, category, views, updated_at from traffic
     where pr >= 0.9 and views > 0 and updated_at < now() - ($1::int * interval '1 day')`,
    [t.staleDays],
  );
  return r.rows.map((x) => ({
    kind: 'stale_high_traffic',
    key: x.id,
    title: `פריט נצפה שלא עודכן: ${x.title}`,
    evidence: { views: Number(x.views), updatedAt: new Date(x.updated_at).toISOString(), staleDays: t.staleDays },
    score: Math.log10(Number(x.views) + 1) * 3,
    suggestedAction: 'update',
    documentId: x.id,
    topicId: null,
    worldSlug: x.category,
  }));
}

/** Topics agents actually open that contain no published R (route) or O (operation) item. */
export async function topicsWithoutProcedure(q: Q): Promise<GapCandidate[]> {
  const r = await q.query<{ id: string; name: string; slug: string; views: string }>(
    `select t.id, t.name, w.slug, sum(tv.count) views
     from topics t join worlds w on w.id = t.world_id
     join topic_views tv on tv.topic_id = t.id
     where t.active
       and not exists (
         select 1 from document_topics dt join documents d on d.id = dt.document_id
         where dt.topic_id = t.id and d.deleted_at is null and d.status in ('published','partial') and d.doc_type in ('R','O')
       )
     group by t.id, t.name, w.slug
     having sum(tv.count) > 0`,
  );
  return r.rows.map((x) => ({
    kind: 'topic_without_procedure',
    key: x.id,
    title: `נושא ללא מסלול טיפול או תפעול: ${x.name}`,
    evidence: { views: Number(x.views) },
    score: Math.log10(Number(x.views) + 1) * 2 + 1,
    suggestedAction: 'create',
    documentId: null,
    topicId: x.id,
    worldSlug: x.slug,
  }));
}

/**
 * Quiz questions failed by ≥ rate of attempts. Reads V1/V2 tables; absent until they merge,
 * so probe first and return [] rather than throwing (the nightly job must never fail on it).
 * `learning_attempts.answers` is `{ [questionId]: { correct: boolean } }` (V2 contract).
 */
export async function failedQuestions(q: Q, t: Thresholds): Promise<GapCandidate[]> {
  const has = await q.query<{ a: string | null; b: string | null }>(
    `select to_regclass('public.learning_attempts')::text a, to_regclass('public.quiz_questions')::text b`,
  );
  if (!has.rows[0].a || !has.rows[0].b) return [];
  const r = await q.query<{ question_id: string; item_id: string; document_id: string | null; stem: string; attempts: string; failed: string }>(
    `with per as (
       select (kv.key)::uuid question_id, (kv.value->>'correct')::boolean correct
       from learning_attempts a, jsonb_each(a.answers) kv
       where a.finished_at is not null and a.finished_at > now() - interval '90 days'
     )
     select p.question_id, qq.item_id, qq.document_id, qq.stem, count(*) attempts,
            count(*) filter (where not p.correct) failed
     from per p join quiz_questions qq on qq.id = p.question_id
     group by p.question_id, qq.item_id, qq.document_id, qq.stem
     having count(*) >= 5 and (count(*) filter (where not p.correct))::float / count(*) >= $1`,
    [t.failedQuestionRate],
  );
  return r.rows.map((x) => ({
    kind: 'failed_question',
    key: x.question_id,
    title: `שאלה שנכשלת לעיתים קרובות: ${x.stem.slice(0, 80)}`,
    evidence: { attempts: Number(x.attempts), failed: Number(x.failed), itemId: x.item_id },
    score: (Number(x.failed) / Number(x.attempts)) * 5,
    suggestedAction: 'add_question',
    documentId: x.document_id,
    topicId: null,
    worldSlug: null,
  }));
}

export async function allHeuristics(q: Q, t: Thresholds): Promise<GapCandidate[]> {
  const parts = await Promise.all([
    zeroResultClusters(q, t),
    feedbackClusters(q, t),
    staleHighTraffic(q, t),
    topicsWithoutProcedure(q),
    failedQuestions(q, t),
  ]);
  return parts.flat();
}
```

- [ ] **Step 4: Run** — `RUN_INTEGRATION=1 pnpm vitest run test/gaps.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(api): five knowledge-gap heuristics over search log, feedback, views, topics and quiz attempts`

---

### Task 4: Detection orchestrator, routes, job, module registration

**Files:**
- Create: `apps/api/src/modules/gaps/detect.ts`, `apps/api/src/modules/gaps/routes.ts`, `apps/api/src/modules/gaps/jobs.ts`, `apps/api/src/modules/gaps/index.ts`
- Modify: `apps/api/src/modules/index.ts`, `apps/api/test/int/scope-leak.test.ts`
- Test: `apps/api/test/gaps.test.ts` (third describe)

**Interfaces:**
- Produces: `runDetection(deps)`, routes `GET /gaps`, `POST /gaps/:id/dismiss`, `POST /gaps/:id/resolve`, `POST /gaps/detect`; job `QUEUES.gapsDetect` at `30 3 * * *` Asia/Jerusalem; notification kind `gap` to every `gaps.manage` holder in the gap's world (or every holder when world-less) via `app.taxonomy.usersWithPermissionInWorld` / `leadIds`-style fallback, deduped per run; event `gap.detected` per new gap.

- [ ] **Step 1: Write the failing route tests** — append to `gaps.test.ts`:

```ts
  describe('routes', () => {
    it('detect (gaps.manage) upserts, records the run and notifies once per new gap', async () => {
      const seen: { kind: string; title: string }[] = [];
      app.notifier.swap({ notify: async (n) => { seen.push({ kind: n.kind, title: n.title }); } });
      const r1 = await app.inject({ method: 'POST', url: '/api/v1/gaps/detect', headers: auth(lead) });
      expect(r1.statusCode).toBe(200);
      const body = r1.json();
      expect(body.detected).toBeGreaterThan(0);
      expect(seen.filter((s) => s.kind === 'gap').length).toBe(body.detected);
      const r2 = await app.inject({ method: 'POST', url: '/api/v1/gaps/detect', headers: auth(lead) });
      expect(r2.json().detected).toBe(0);
      expect(r2.json().updated).toBeGreaterThan(0);
      const runs = await db.pool.query('select count(*)::int n from gap_runs');
      expect(runs.rows[0].n).toBeGreaterThanOrEqual(2);
    });
    it('GET /gaps lists open gaps ranked, with lastRunAt; agents are refused', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/v1/gaps', headers: auth(editor) });
      expect(r.statusCode).toBe(200);
      const j = r.json();
      expect(j.lastRunAt).not.toBeNull();
      expect(j.items.length).toBeGreaterThan(0);
      for (let i = 1; i < j.items.length; i++) expect(j.items[i - 1].score).toBeGreaterThanOrEqual(j.items[i].score);
      expect((await app.inject({ method: 'GET', url: '/api/v1/gaps', headers: auth(agent) })).statusCode).toBe(403);
    });
    it('a world-scoped editor sees only their worlds plus world-less gaps', async () => {
      const scoped = await makeUser(db.pool, { perms: ['docs.read', 'gaps.read'], scopes: ['sim'] });
      const r = await app.inject({ method: 'GET', url: '/api/v1/gaps', headers: auth(scoped) });
      for (const g of r.json().items) expect(g.worldSlug === null || g.worldSlug === 'sim').toBe(true);
    });
    it('dismiss needs gaps.manage and a reason; resolve links a document and resolves when it is published', async () => {
      const list = (await app.inject({ method: 'GET', url: '/api/v1/gaps?kind=feedback_cluster', headers: auth(lead) })).json();
      const g = list.items[0];
      expect((await app.inject({ method: 'POST', url: `/api/v1/gaps/${g.id}/dismiss`, headers: auth(editor), payload: { reason: 'x' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: `/api/v1/gaps/${g.id}/dismiss`, headers: auth(lead), payload: {} })).statusCode).toBe(400);
      const zr = (await app.inject({ method: 'GET', url: '/api/v1/gaps?kind=zero_results', headers: auth(lead) })).json().items[0];
      const res = await app.inject({ method: 'POST', url: `/api/v1/gaps/${zr.id}/resolve`, headers: auth(lead), payload: { documentId: g.documentId } });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('resolved'); // the linked document is already published
      const dis = await app.inject({ method: 'POST', url: `/api/v1/gaps/${g.id}/dismiss`, headers: auth(lead), payload: { reason: 'כפילות' } });
      expect(dis.json()).toMatchObject({ status: 'dismissed', dismissedReason: 'כפילות' });
      const audit = await db.pool.query(`select action from audit_log where entity_type='gap' and entity_id=$1 order by at`, [g.id]);
      expect(audit.rows.map((r) => r.action)).toContain('gaps.dismiss');
    });
  });
```

- [ ] **Step 2: Run to verify failure** — routes 404.

- [ ] **Step 3: Implement**

`detect.ts`:
```ts
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { GapDetectResult, Notifier, TaxonomyResolver } from '@wecom/shared';
import { getWorkflowSettings } from '../../lib/workflowSettings.js';
import { withTransaction } from '../../lib/sql.js';
import { allHeuristics } from './heuristics.js';
import { autoResolvePublished, getGap, recordRun, upsertCandidates } from './repo.js';

export interface DetectDeps {
  db: pg.Pool;
  notifier: Notifier;
  taxonomy: TaxonomyResolver;
  log: FastifyBaseLogger;
  /** Publishes `gap.detected`; injected so the module can pass `app.events.publish(tx, …)`. */
  publish?: (tx: pg.PoolClient, gapId: string, kind: string) => Promise<void>;
}

/** One detection run: heuristics → idempotent upsert → auto-resolve → notify new gaps → run log. Never throws past the run log. */
export async function runDetection(d: DetectDeps): Promise<GapDetectResult> {
  const started = new Date();
  try {
    const s = await getWorkflowSettings(d.db);
    const cands = await allHeuristics(d.db, s.gaps);
    const result = await withTransaction(d.db, async (tx) => {
      const up = await upsertCandidates(tx, cands);
      const resolved = await autoResolvePublished(tx);
      for (const id of up.newIds) {
        const g = await getGap(tx, id);
        if (g && d.publish) await d.publish(tx, g.id, g.kind);
      }
      return { ...up, resolved };
    });
    // Notifications outside the transaction: a failed notify must not undo the run.
    for (const id of result.newIds) {
      const g = await getGap(d.db, id);
      if (!g) continue;
      const users = await d.taxonomy.usersWithPermissionInWorld('gaps.manage', g.worldSlug ?? '*');
      if (!users.length) continue;
      await d.notifier.notify({ userIds: users, kind: 'gap', title: g.title, body: `פער ידע חדש (${g.kind})`, href: '/gaps', entityType: 'gap', entityId: g.id });
    }
    const out = { detected: result.detected, updated: result.updated, resolvedAutomatically: result.resolved, tookMs: Date.now() - started.getTime() };
    await recordRun(d.db, { detected: out.detected, updated: out.updated, resolved: out.resolvedAutomatically }, started);
    return out;
  } catch (err) {
    d.log.error({ err }, 'gap detection failed');
    await recordRun(d.db, { detected: 0, updated: 0, resolved: 0, error: (err as Error).message }, started).catch(() => undefined);
    throw err;
  }
}
```
`usersWithPermissionInWorld(perm, '*')`: read W1's `PgTaxonomy` implementation; if `'*'` is not already treated as "any world", call it with each active world slug and union the ids (query `select slug from worlds where active`) — implement that fallback inside `detect.ts` as `recipientsFor(d, worldSlug)` and use it, so `PgTaxonomy` is not edited.

`routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GapDetectResultSchema, GapDismissBodySchema, GapResolveBodySchema, GapSchema, GapsQuerySchema, GapsResponseSchema, IdSchema, makeEvent } from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { runDetection, type DetectDeps } from './detect.js';
import * as repo from './repo.js';

const Params = z.object({ id: IdSchema });

export default function gapsRoutes(deps: () => DetectDeps) {
  return async function routes(app: FastifyInstance) {
    app.get('/gaps', { config: { requires: ['gaps.read'] }, schema: { tags: ['gaps'], querystring: GapsQuerySchema, response: { 200: GapsResponseSchema } } }, async (req) => {
      const user = requireUser(req);
      const query = req.query as repo.GapsQuery;
      const { items, total } = await repo.listGaps(app.db, query, user.worldScopes);
      return { items, total, page: query.page, pageSize: query.pageSize, lastRunAt: await repo.lastRunAt(app.db) };
    });

    app.post('/gaps/:id/dismiss', { config: { requires: ['gaps.manage'] }, schema: { tags: ['gaps'], params: Params, body: GapDismissBodySchema, response: { 200: GapSchema } } }, async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const { reason } = req.body as { reason: string };
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getGap(tx, id);
        if (!before) throw notFound('הפער');
        const g = await repo.dismissGap(tx, id, reason, user.id);
        if (!g) throw notFound('הפער');
        await audit(tx, { actorId: user.id, action: 'gaps.dismiss', entityType: 'gap', entityId: id, before: { status: before.status }, after: { status: 'dismissed', reason }, requestId: req.id, ip: req.ip });
        return g;
      });
    });

    app.post('/gaps/:id/resolve', { config: { requires: ['gaps.manage'] }, schema: { tags: ['gaps'], params: Params, body: GapResolveBodySchema, response: { 200: GapSchema } } }, async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const { documentId } = req.body as { documentId: string };
      return withTransaction(app.db, async (tx) => {
        const doc = await tx.query('select id from documents where id=$1 and deleted_at is null', [documentId]);
        if (!doc.rowCount) throw notFound('המסמך');
        const before = await repo.getGap(tx, id);
        if (!before) throw notFound('הפער');
        const g = await repo.resolveGap(tx, id, documentId);
        if (!g) throw notFound('הפער');
        await audit(tx, { actorId: user.id, action: 'gaps.resolve', entityType: 'gap', entityId: id, before: { status: before.status }, after: { status: g.status, documentId }, requestId: req.id, ip: req.ip });
        return g;
      });
    });

    app.post('/gaps/detect', { config: { requires: ['gaps.manage'] }, schema: { tags: ['gaps'], response: { 200: GapDetectResultSchema } } }, async (req) => {
      const user = requireUser(req);
      const r = await runDetection({ ...deps(), publish: (tx, gapId, kind) => app.events.publish(tx, makeEvent('gap.detected', { gapId, kind })) });
      await app.audit(req, 'gaps.detect', 'gap_run', null, null, { ...r, by: user.id });
      return r;
    });
  };
}
```
(`app.audit(req, …)` is L3's wrapper; if its signature differs, read `apps/api/src/plugins/auth.ts` and match.)

`jobs.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { makeEvent } from '@wecom/shared';
import { QUEUES } from '../../plugins/boss.js';
import { runDetection, type DetectDeps } from './detect.js';

export async function startGapJobs(app: FastifyInstance, deps: () => DetectDeps): Promise<void> {
  const boss = app.boss;
  if (!boss || app.config.NODE_ENV === 'test') return;
  await boss.work(QUEUES.gapsDetect, async () => {
    const r = await runDetection({ ...deps(), publish: (tx, gapId, kind) => app.events.publish(tx, makeEvent('gap.detected', { gapId, kind })) });
    app.log.info(r, 'gap detection run');
  });
  try {
    await boss.schedule(QUEUES.gapsDetect, '30 3 * * *', {}, { tz: 'Asia/Jerusalem' });
  } catch (err) {
    app.log.warn({ err }, 'could not schedule gaps.detect');
  }
}
```
`index.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import gapsRoutes from './routes.js';
import { startGapJobs } from './jobs.js';
import type { DetectDeps } from './detect.js';

/** V3 module: routes + nightly job. Deps resolved lazily so tests can swap notifier/taxonomy. */
export default async function gapsModule(app: FastifyInstance) {
  const deps = (): DetectDeps => ({ db: app.db, notifier: app.notifier, taxonomy: app.taxonomy, log: app.log });
  await app.register(gapsRoutes(deps));
  app.addHook('onReady', async () => {
    await startGapJobs(app, deps);
  });
}
```
`modules/index.ts`: add `import gaps from './gaps/index.js'; // wave 5 V3: knowledge gaps` and `gaps` at the end of the list.

`scope-leak.test.ts`: add `/api/v1/gaps` to the table of routes a read-only reader (no `gaps.read`) must get 403 from, and to the world-scope table if it has a generic shape (the gap fixture there: insert one `knowledge_gaps` row with `world_slug='billing'` and assert a `sim`-scoped `gaps.read` user does not see it).

- [ ] **Step 4: Run** — `RUN_INTEGRATION=1 pnpm vitest run test/gaps.test.ts test/int/scope-leak.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(api): gaps routes, detection run with notifications, nightly gaps.detect job`

---

### Task 5: Workflow settings routes

**Files:**
- Create: `apps/api/src/modules/admin/workflow.ts`
- Modify: `apps/api/src/modules/admin/routes.ts`
- Test: `apps/api/test/workflow-approver.test.ts` (first describe)

**Interfaces:**
- Consumes: `getWorkflowSettings`, `putWorkflowSettings` (V0), `WorkflowSettingsSchema`, `WorkflowSettingsPutSchema`.
- Produces: `GET /admin/workflow` → `WorkflowSettings`; `PUT /admin/workflow` body `WorkflowSettingsPut` → `WorkflowSettings`, audit `admin.workflow.update`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
run('workflow settings and approver gate', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    admin = await makeUser(db.pool, { name: 'אדמין' });
    editor = await makeUser(db.pool, { name: 'עורך', perms: ['docs.read', 'docs.edit'] });
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  describe('GET/PUT /admin/workflow', () => {
    it('returns defaults, accepts a deep partial, and audits', async () => {
      const g = await app.inject({ method: 'GET', url: '/api/v1/admin/workflow', headers: auth(admin) });
      expect(g.statusCode).toBe(200);
      expect(g.json()).toMatchObject({ requireApprover: false, learning: { defaultPassMark: 80, defaultMaxAttempts: null }, gaps: { staleDays: 180 } });
      const p = await app.inject({ method: 'PUT', url: '/api/v1/admin/workflow', headers: auth(admin), payload: { requireApprover: true, gaps: { staleDays: 90 } } });
      expect(p.statusCode).toBe(200);
      expect(p.json()).toMatchObject({ requireApprover: true, learning: { defaultPassMark: 80 }, gaps: { staleDays: 90, zeroResultMin: 3 } });
      expect((await app.inject({ method: 'GET', url: '/api/v1/admin/workflow', headers: auth(admin) })).json().gaps.staleDays).toBe(90);
      expect((await app.inject({ method: 'GET', url: '/api/v1/admin/workflow', headers: auth(editor) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PUT', url: '/api/v1/admin/workflow', headers: auth(admin), payload: { gaps: { staleDays: 5 } } })).statusCode).toBe(400);
      const a = await db.pool.query(`select action from audit_log where action='admin.workflow.update'`);
      expect(a.rowCount).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure** — 404.

- [ ] **Step 3: Implement `admin/workflow.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { WORKFLOW_SETTINGS_KEY, WorkflowSettingsPutSchema, WorkflowSettingsSchema, type WorkflowSettingsPut } from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { getWorkflowSettings, putWorkflowSettings } from '../../lib/workflowSettings.js';

/** Wave 5 V3: operator-editable workflow settings (approver switch, learning defaults, gap thresholds). */
export default async function workflowRoutes(app: FastifyInstance) {
  app.get('/workflow', { config: { requires: ['system.admin'] }, schema: { tags: ['admin'], response: { 200: WorkflowSettingsSchema } } }, async (req) => {
    requireUser(req);
    return getWorkflowSettings(app.db);
  });
  app.put('/workflow', { config: { requires: ['system.admin'] }, schema: { tags: ['admin'], body: WorkflowSettingsPutSchema, response: { 200: WorkflowSettingsSchema } } }, async (req) => {
    const user = requireUser(req);
    const patch = req.body as WorkflowSettingsPut;
    return withTransaction(app.db, async (tx) => {
      const before = await getWorkflowSettings(tx);
      const after = await putWorkflowSettings(tx, patch, user.id);
      await audit(tx, { actorId: user.id, action: 'admin.workflow.update', entityType: 'app_settings', entityId: WORKFLOW_SETTINGS_KEY, before, after, requestId: req.id, ip: req.ip });
      return after;
    });
  });
}
```
`admin/routes.ts`: `import workflow from './workflow.js'; // wave 5 V3` and `await app.register(workflow);` after `identity`.

- [ ] **Step 4: Run** — `RUN_INTEGRATION=1 pnpm vitest run test/workflow-approver.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(api): GET/PUT /admin/workflow settings`

---

### Task 6: Approver gate on review decisions

**Files:**
- Modify: `apps/api/src/modules/collab/reviews.ts`, `packages/shared/src/schemas/stage45.ts` (`ReviewQueueResponseSchema` row += `canApprove: z.boolean().optional()`)
- Test: `apps/api/test/workflow-approver.test.ts` (second describe)

**Interfaces:**
- Consumes: `getWorkflowSettings`, `user.roles` (`AuthUser.roles: string[]`, populated by the auth plugin from `user_roles`; the test fake-auth header accepts `roles`).
- Produces: 403 `APPROVER_REQUIRED` ("נדרש תפקיד מאשר כדי להחליט על בקשת בדיקה") on `POST /documents/:id/review-decision` when `requireApprover` is on and `!user.roles.includes('approver')`; `canApprove` on each `GET /reviews` row; helper `export async function assertCanApprove(q, user): Promise<void>` and `export async function canApprove(q, user): Promise<boolean>` in `apps/api/src/modules/collab/approver.ts`.

- [ ] **Step 1: Failing test** — append to `workflow-approver.test.ts`:

```ts
  describe('approver gate', () => {
    const roleHeader = (u: { header: string }, roles: string[]) => {
      const parsed = JSON.parse(u.header);
      return { 'x-test-user': JSON.stringify({ ...parsed, roles }) };
    };
    let docId: string;
    let lead: Awaited<ReturnType<typeof makeUser>>;
    beforeAll(async () => {
      lead = await makeUser(db.pool, { name: 'מוביל', perms: ['docs.read', 'docs.read_unpublished', 'docs.edit', 'docs.publish'] });
      const c = await app.inject({ method: 'POST', url: '/api/v1/documents', headers: auth(lead), payload: { title: 'לבדיקה', description: '', category: 'sim', wave: 1, priority: 'h', kind: 'steps' } });
      docId = c.json().id;
      await app.inject({ method: 'PUT', url: '/api/v1/admin/workflow', headers: auth(admin), payload: { requireApprover: false } });
    });
    const requestReview = () => app.inject({ method: 'POST', url: `/api/v1/documents/${docId}/request-review`, headers: auth(lead), payload: {} });
    const decide = (h: Record<string, string>) => app.inject({ method: 'POST', url: `/api/v1/documents/${docId}/review-decision`, headers: h, payload: { decision: 'changes', note: 'x' } });

    it('off: docs.publish alone decides', async () => {
      expect((await requestReview()).statusCode).toBe(201);
      expect((await decide(auth(lead))).statusCode).toBe(200);
      const q = await app.inject({ method: 'GET', url: '/api/v1/reviews', headers: auth(lead) });
      expect(q.json().items.every((r: { canApprove: boolean }) => r.canApprove === true)).toBe(true);
    });
    it('on: a non-approver gets 403 APPROVER_REQUIRED, an approver-role holder decides, queue rows say who can', async () => {
      await app.inject({ method: 'PUT', url: '/api/v1/admin/workflow', headers: auth(admin), payload: { requireApprover: true } });
      expect((await requestReview()).statusCode).toBe(201);
      const denied = await decide(auth(lead));
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe('APPROVER_REQUIRED');
      const q1 = await app.inject({ method: 'GET', url: '/api/v1/reviews?status=open', headers: auth(lead) });
      expect(q1.json().items[0].canApprove).toBe(false);
      const ok = await decide(roleHeader(lead, ['lead', 'approver']));
      expect(ok.statusCode).toBe(200);
      await app.inject({ method: 'PUT', url: '/api/v1/admin/workflow', headers: auth(admin), payload: { requireApprover: false } });
    });
  });
```
(Check the exact `request-review` body/status in `reviews.ts:66-140` and `RequestReviewBodySchema`; adjust the payload, keep the assertions.)

- [ ] **Step 2: Run to verify failure** — `canApprove` undefined; 403 not raised.

- [ ] **Step 3: Implement**

`apps/api/src/modules/collab/approver.ts`:
```ts
import type pg from 'pg';
import { httpError } from '../../lib/http.js';
import type { ReqUser } from '../../lib/user.js';
import { getWorkflowSettings } from '../../lib/workflowSettings.js';

export const APPROVER_ROLE = 'approver';

/** Spec §1.6: with `workflow.requireApprover` on, `docs.publish` alone no longer decides reviews. */
export async function canApprove(q: pg.Pool | pg.PoolClient, user: ReqUser): Promise<boolean> {
  const s = await getWorkflowSettings(q);
  return !s.requireApprover || user.roles.includes(APPROVER_ROLE);
}

export async function assertCanApprove(q: pg.Pool | pg.PoolClient, user: ReqUser): Promise<void> {
  if (!(await canApprove(q, user)))
    throw httpError(403, 'APPROVER_REQUIRED', 'נדרש תפקיד מאשר כדי להחליט על בקשת בדיקה');
}
```
`reviews.ts`: in the review-decision handler, right after `const user = requireUser(req);` add `await assertCanApprove(app.db, user);` (before the transaction, so no lock is taken for a refused caller). In `GET /reviews`, compute `const can = await canApprove(app.db, user);` once and add `canApprove: can` to every item. `stage45.ts`: `ReviewRequestSchema.extend({ title: z.string(), category: CategorySchema, canApprove: z.boolean().optional() })`.

- [ ] **Step 4: Run** — `RUN_INTEGRATION=1 pnpm vitest run test/workflow-approver.test.ts test/int/stage5-collab.test.ts` (or whatever the wave 3 review test file is called: `ls apps/api/test | grep -i review`) → PASS.
- [ ] **Step 5: Commit** — `feat(api): approver gate on review decisions behind workflow.requireApprover; canApprove on queue rows`

---

### Task 7: OpenAPI, full gate, lane report

**Files:**
- Modify: `docs/api/openapi.json` (regenerate), `.superpowers/sdd/program/V3-report.md` (git-ignored, write in the worktree)

- [ ] **Step 1: Regenerate the contract** — root `pnpm openapi`; `git diff --stat docs/api/openapi.json` shows only `/gaps*`, `/admin/workflow`, and the `canApprove` field.
- [ ] **Step 2: Gate** — `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wecom/shared test`, `cd apps/api && pnpm vitest run test/unit`, `RUN_INTEGRATION=1 pnpm test:int` (known flakes under load: `boss.test.ts`, `sources/routes.test.ts` — re-run in isolation), `pnpm lint`.
- [ ] **Step 3: Report** — per task: commits, test counts, deviations; the exact exports in "Names other lanes consume"; a note for V4b: `/gaps` UI reads `GapsResponseSchema.lastRunAt`, actions `dismiss`/`resolve`/`detect`; "צור פריט" should open `/edit/new?title=<gap.evidence.samples[0] ?? gap.title>`; the approver switch lives in `GET/PUT /admin/workflow`; review queue rows carry `canApprove`.
- [ ] **Step 4: Commit** — `chore(api): regenerate OpenAPI for wave 5 V3 routes`.

---

## Cross-lane note (V2 dependency)

`failedQuestions` reads `learning_attempts.answers` as `{ [questionId]: { correct: boolean } }` and `quiz_questions(id, item_id, document_id, stem)`. V2's plan must write `answers` in that shape (per question id, with a boolean `correct`) — if V2 stores answers differently, V6 adapts this one query, not the schema. Until V2 merges the detector returns `[]` (probed with `to_regclass`), so V3 is green standalone.

## Self-review

- Spec coverage: §1.6 (Tasks 5–6), §1.7 all five heuristics with thresholds from settings (Task 3), evidence + suggested action + dismiss with reason + auto-resolve on publish (Tasks 2, 4), nightly job + manual run (Task 4), `GET/PUT /admin/workflow` (Task 5), 403 `APPROVER_REQUIRED` and "the review queue shows who can approve" (Task 6). Notification kind `gap` and event `gap.detected` (Task 4).
- Placeholders: none. Where a wave 3 detail must be read (request-review payload, `app.audit` signature, review test file name), the step names the file and keeps the assertion.
- Type consistency: `GapCandidate` shape is identical in `repo.ts`, `heuristics.ts` and the test; `runDetection`/`DetectDeps` names match between `detect.ts`, `routes.ts`, `jobs.ts`, `index.ts`; `canApprove`/`assertCanApprove` match between `approver.ts`, `reviews.ts` and the test.
