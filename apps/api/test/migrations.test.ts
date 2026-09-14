import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readdir } from 'node:fs/promises';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { readdirSync } from 'node:fs';
import { DEFAULT_ROLES, PERMISSIONS } from '@wecom/shared';

/** However many migrations exist right now — avoids a hardcoded count going stale. */
const migrationCount = async () => (await readdir('migrations')).filter((f) => f.endsWith('.js')).length;

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
/** Counted, not hard-coded: every lane that adds a migration must still roll back to empty. */
const MIGRATION_COUNT = readdirSync('migrations').filter((f) => /^\d+_.+\.js$/.test(f)).length;
run('migrations', () => {
  let c: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  beforeAll(async () => {
    c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    pool = new pg.Pool({ connectionString: c.getConnectionUri() });
    await runner({
      databaseUrl: c.getConnectionUri(),
      dir: 'migrations',
      direction: 'up',
      migrationsTable: 'pgmigrations',
      ignorePattern: 'package\\.json',
      log: () => undefined,
    });
  }, 120000);
  afterAll(async () => {
    await pool?.end();
    await c?.stop();
  });
  it('creates all stage-1 tables', async () => {
    const r = await pool.query(
      "select table_name from information_schema.tables where table_schema='public' order by 1",
    );
    const names = r.rows.map((x) => x.table_name);
    for (const t of [
      'users',
      'roles',
      'permissions',
      'role_permissions',
      'user_roles',
      'groups_map',
      'documents',
      'document_versions',
      'phases',
      'steps',
      'step_actions',
      'step_outcomes',
      'step_branches',
      'step_branch_options',
      'blocks',
      'block_actions',
      'block_outcomes',
      'block_versions',
      'crm_fields',
      'step_field_refs',
      'scripts',
      'script_refs',
      'document_links',
      'notes',
      'note_likes',
      'pins',
      'recent_views',
      'drafts',
      'user_preferences',
      'sources',
      'source_revisions',
      'suggestions',
      'sessions',
      'audit_log',
      'connectors',
      'sync_links',
      'telemetry_events',
    ])
      expect(names, t).toContain(t);
    // Stage 4 columns the data explorer reads back.
    const cols = await pool.query(
      `select table_name || '.' || column_name c from information_schema.columns
        where table_schema='public' and (table_name, column_name) in (('sources','columns'), ('source_revisions','data_rows'))`,
    );
    expect(cols.rows.map((x) => x.c).sort()).toEqual(['source_revisions.data_rows', 'sources.columns']);
  });
  it('seeds permissions and default roles that match packages/shared', async () => {
    // `PERMISSIONS`/`DEFAULT_ROLES` are duplicated verbatim in 0002_identity.js;
    // nothing asserted they agree, so a permission added on one side was silent.
    expect((await pool.query('select count(*)::int as n from permissions')).rows[0].n).toBe(
      PERMISSIONS.length,
    );
    expect((await pool.query('select name from permissions order by name')).rows.map((r) => r.name)).toEqual(
      [...PERMISSIONS].sort(),
    );
    expect((await pool.query('select name from roles order by name')).rows.map((r) => r.name)).toEqual(
      Object.keys(DEFAULT_ROLES).sort(),
    );
    for (const [name, perms] of Object.entries(DEFAULT_ROLES)) {
      const r = await pool.query(
        `select rp.permission from role_permissions rp join roles r on r.id=rp.role_id
           where r.name=$1 order by rp.permission`,
        [name],
      );
      expect(
        r.rows.map((x) => x.permission),
        name,
      ).toEqual([...perms].sort());
    }
  });
  it('seeds the wave 4 permissions and role grants', async () => {
    const p = await pool.query(
      "select name from permissions where name in ('taxonomy.manage','docs.read_unpublished','feedback.manage','analytics.read') order by 1",
    );
    expect(p.rows.map((r) => r.name)).toEqual([
      'analytics.read',
      'docs.read_unpublished',
      'feedback.manage',
      'taxonomy.manage',
    ]);
    const rp = await pool.query(
      `select r.name role, rp.permission from role_permissions rp join roles r on r.id=rp.role_id
       where rp.permission in ('taxonomy.manage','docs.read_unpublished','feedback.manage','analytics.read') order by 1,2`,
    );
    const grants = rp.rows.map((x) => x.role + ':' + x.permission);
    expect(grants).toEqual(
      expect.arrayContaining([
        'editor:docs.read_unpublished',
        'editor:feedback.manage',
        'editor:analytics.read',
        'lead:taxonomy.manage',
        'admin:taxonomy.manage',
      ]),
    );
    expect(grants).not.toContain('agent:docs.read_unpublished');
    expect(grants).not.toContain('editor:taxonomy.manage');
  });
  it('adds the wave 4 governance columns and the status check', async () => {
    const cols = await pool.query(
      `select column_name from information_schema.columns where table_name='documents'
         and column_name in ('owner_id','editor_id','approver_id','published_at','source_review_needed','source_review_reason','source_review_at')
       order by 1`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'approver_id',
      'editor_id',
      'owner_id',
      'published_at',
      'source_review_at',
      'source_review_needed',
      'source_review_reason',
    ]);
    const sv = await pool.query(
      "select 1 from information_schema.columns where table_name='document_versions' and column_name='source_version'",
    );
    expect(sv.rowCount).toBe(1);
    await expect(
      pool.query(
        "insert into documents(slug,title,category,wave,priority,status) values ('bad-status','x','sim',1,'m','bogus')",
      ),
    ).rejects.toThrow(/documents_status_check/);
  });

  it('rolls back cleanly', async () => {
    await runner({
      databaseUrl: c.getConnectionUri(),
      dir: 'migrations',
      direction: 'down',
      count: await migrationCount(),
      migrationsTable: 'pgmigrations',
      ignorePattern: 'package\\.json',
      log: () => undefined,
    });
    const r = await pool.query(
      "select count(*)::int as n from information_schema.tables where table_schema='public' and table_name<>'pgmigrations'",
    );
    expect(r.rows[0].n).toBe(0);
  });
});
