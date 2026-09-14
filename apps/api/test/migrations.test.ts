import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { DEFAULT_ROLES, PERMISSIONS } from '@wecom/shared';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
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
    ])
      expect(names, t).toContain(t);
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
  it('rolls back cleanly', async () => {
    await runner({
      databaseUrl: c.getConnectionUri(),
      dir: 'migrations',
      direction: 'down',
      // Every migration, not a hard-coded nine: each new lane adds files, and a fixed
      // count silently stopped asserting that the newest ones have a working `down`.
      count: Infinity,
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
