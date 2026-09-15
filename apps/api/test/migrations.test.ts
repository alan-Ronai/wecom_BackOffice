import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readdir } from 'node:fs/promises';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { DEFAULT_ROLES, PERMISSIONS } from '@wecom/shared';

/** However many migrations exist right now — avoids a hardcoded count going stale. */
const migrationCount = async () => (await readdir('migrations')).filter((f) => f.endsWith('.js')).length;

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
      'worlds',
      'topics',
      'document_worlds',
      'document_topics',
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
  it('seeds wave 5 permissions, the approver role, and widens notification kinds', async () => {
    const p = await pool.query(
      "select name from permissions where name in ('learning.read','learning.manage','learning.publish','gaps.read','gaps.manage') order by 1",
    );
    expect(p.rows.map((r) => r.name)).toEqual([
      'gaps.manage',
      'gaps.read',
      'learning.manage',
      'learning.publish',
      'learning.read',
    ]);
    const role = await pool.query("select system from roles where name='approver'");
    expect(role.rows[0]?.system).toBe(true);
    const rp = await pool.query(
      `select rp.permission from role_permissions rp join roles r on r.id=rp.role_id where r.name='approver' order by 1`,
    );
    expect(rp.rows.map((x) => x.permission)).toEqual([
      'docs.publish',
      'docs.read',
      'docs.read_unpublished',
      'learning.publish',
      'notes.write',
      'suggestions.apply',
    ]);
    // The `notifications.kind` check is a closed list; without 0038 widening it, V2's first
    // refresh notification would be a 23514 at insert time rather than a contract mismatch.
    const u = await pool.query(
      `insert into users(subject, source, display_name) values ('w5-kind','local','w5') returning id`,
    );
    for (const kind of ['learning', 'gap'])
      await pool.query(`insert into notifications(user_id, kind, title) values ($1, $2, 't')`, [
        u.rows[0].id,
        kind,
      ]);
    await expect(
      pool.query(`insert into notifications(user_id, kind, title) values ($1, 'bogus', 't')`, [u.rows[0].id]),
    ).rejects.toThrow(/notifications_kind_check/);
    await pool.query(`delete from users where id=$1`, [u.rows[0].id]); // cascades the notifications
    const ws = await pool.query("select value from app_settings where key='workflow'");
    expect(ws.rowCount).toBe(1);
  });
  it('creates the wave 5 learning content tables', async () => {
    const r = await pool.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name in ('learning_items','learning_item_versions','briefing_entries','quiz_questions') order by 1",
    );
    expect(r.rows.map((x) => x.table_name)).toEqual([
      'briefing_entries',
      'learning_item_versions',
      'learning_items',
      'quiz_questions',
    ]);
    const c = await pool.query(
      "select column_name from information_schema.columns where table_name='learning_items' and column_name in ('kind','status','pass_mark','max_attempts','world_slug','deleted_at') order by 1",
    );
    expect(c.rows.map((x) => x.column_name)).toEqual([
      'deleted_at',
      'kind',
      'max_attempts',
      'pass_mark',
      'status',
      'world_slug',
    ]);
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

  it('creates the wave 4 source document tables and backfills from accepted revisions', async () => {
    const t = await pool.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name in ('source_documents','source_document_versions','assets') order by 1",
    );
    expect(t.rows.map((r) => r.table_name)).toEqual([
      'assets',
      'source_document_versions',
      'source_documents',
    ]);
    const u = await pool.query(
      "select indexname from pg_indexes where tablename='assets' and indexdef ilike '%unique%(sha256)%'",
    );
    expect(u.rowCount).toBe(1);
  });

  it('creates the feedback tables with their check constraints', async () => {
    const cols = await pool.query(
      `select column_name from information_schema.columns where table_name='feedback' order by ordinal_position`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'id',
      'document_id',
      'document_version',
      'doc_type',
      'world_slug',
      'step_key',
      'kind',
      'text',
      'status',
      'user_id',
      'created_at',
      'assignee_id',
      'decision_note',
      'decided_by',
      'decided_at',
      'resolved_version',
    ]);
    const alerts = await pool.query(`select to_regclass('feedback_alerts') as t`);
    expect(alerts.rows[0].t).toBe('feedback_alerts');
    await expect(
      pool.query(`insert into feedback(document_id, document_version, world_slug, kind, user_id)
                  values (gen_random_uuid(), 1, 'sim', 'bogus', gen_random_uuid())`),
    ).rejects.toThrow(/feedback_kind_check|violates check constraint/);
  });
  it('creates the wave 4 usage tables and the zero-result partial index', async () => {
    const t = await pool.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name in ('search_log','topic_views') order by 1",
    );
    expect(t.rows.map((r) => r.table_name)).toEqual(['search_log', 'topic_views']);
    const idx = await pool.query(
      "select indexname, indexdef from pg_indexes where tablename='search_log' and indexname='search_log_zero_idx'",
    );
    expect(idx.rowCount).toBe(1);
    expect(idx.rows[0].indexdef).toMatch(/WHERE \(results = 0\)/);
    const fk = await pool.query(
      "select count(*)::int n from information_schema.table_constraints where table_name='topic_views' and constraint_type='FOREIGN KEY'",
    );
    // only users; deliberately no FK to topics (W1's table)
    expect(fk.rows[0].n).toBe(1);
  });
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
  /**
   * Post-pilot M6. Every trigram index 0044 adds has to be one the planner can actually choose,
   * because a GIN index that is never read is pure write amplification on the ingest path. The
   * `blocks` predicate ORs title, description, script and the `block_actions` aggregate, and a
   * bitmap OR needs *every* arm indexable — so `blocks_title_trgm` could never be used for it.
   */
  it('0044 indexes only the columns a search predicate can be driven by, and not blocks.title', async () => {
    const idx = await pool.query(
      "select indexname from pg_indexes where indexname like '%\\_trgm' and schemaname='public' order by 1",
    );
    const names = idx.rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        'documents_body_html_trgm',
        'documents_code_trgm',
        'documents_description_trgm',
        'step_actions_text_trgm',
        'steps_description_trgm',
        'steps_script_trgm',
        'steps_title_trgm',
      ]),
    );
    expect(names).not.toContain('blocks_title_trgm');
  });

  it('0035 keeps both the tags term and the Hebrew stopword filter in the search vector', async () => {
    // 0030 added tags but dropped 0027's stopword filter; 0035 is the one definition with both.
    await pool.query(
      `insert into documents(slug, title, description, category, wave, priority, tags)
       values ('w6-vec','מסמך על גלישה','', 'tech', 1, 'm', array['apnfix'])`,
    );
    const vec = (await pool.query(`select search_vector::text v from documents where slug='w6-vec'`)).rows[0]
      .v as string;
    expect(vec).toMatch(/'apnfix':/);
    expect(vec).not.toMatch(/'על':/);
    await pool.query(`delete from documents where slug='w6-vec'`);
  });
  it('a wave-4-only rollback leaves 0027 in force on both sides of the stopword rule', async () => {
    // A-I8: 0030.down used to restore *0007*'s definition, not the one that was live when it
    // ran (0027's). Rolling back only wave 4 — down through 0035…0030, exactly what a bad
    // wave-4 deploy does — would then leave `kb_tsquery`/`kb_tsquery_prefix` stripping Hebrew
    // stopwords at query time while the index side stopped stripping them: the two halves
    // 0027 exists to keep in step, out of step again, with no test noticing.
    const move = (direction: 'up' | 'down', count?: number) =>
      runner({
        databaseUrl: c.getConnectionUri(),
        dir: 'migrations',
        direction,
        count,
        migrationsTable: 'pgmigrations',
        ignorePattern: 'package\\.json',
        log: () => undefined,
      });
    // Everything from 0030 up — wave 4 and whatever later waves added on top of it — so the
    // rollback really stops at 0029 whatever the highest number currently is. Counting only
    // `003x` silently stopped short once wave 5 added 0040+, leaving 0030 — the migration that
    // drops 0027's Hebrew stopword filter — still applied, and the assertion below failing.
    const fromWave4 = (await readdir('migrations')).filter((f) => {
      const n = Number(/^(\d{4})_/.exec(f)?.[1] ?? NaN);
      return n >= 30;
    }).length;
    await move('down', fromWave4);
    await pool.query(
      `insert into documents(slug, title, description, category, wave, priority)
       values ('w6-stop','חוב של לקוח','', 'tech', 1, 'm')`,
    );
    const vec = (await pool.query(`select search_vector::text v from documents where slug='w6-stop'`)).rows[0]
      .v as string;
    expect(vec).toMatch(/'חוב':/);
    expect(vec).toMatch(/'לקוח':/);
    expect(vec).not.toMatch(/'של':/); // 0027's ts_delete(…, kb_stopwords()) is still in force
    expect(
      (
        await pool.query(
          `select 1 from documents where slug='w6-stop' and search_vector @@ kb_tsquery('חוב של לקוח')`,
        )
      ).rowCount,
    ).toBe(1);
    await pool.query(`delete from documents where slug='w6-stop'`);
    await move('up');
  }, 120000);

  it('creates the wave 5 tracking tables (0040)', async () => {
    const r = await pool.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name in ('learning_audiences','learning_assignments','learning_attempts','learning_acknowledgements','document_change_flags') order by 1",
    );
    expect(r.rows.map((x) => x.table_name)).toEqual([
      'document_change_flags',
      'learning_acknowledgements',
      'learning_assignments',
      'learning_attempts',
      'learning_audiences',
    ]);
    const cols = await pool.query(
      "select column_name from information_schema.columns where table_name='learning_assignments' and column_name in ('reminded_at','refresh_reason','item_version')",
    );
    expect(cols.rowCount).toBe(3);
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
