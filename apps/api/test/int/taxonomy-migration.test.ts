import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { readdirSync } from 'node:fs';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
const files = readdirSync('migrations')
  .filter((f) => /^\d+_.+\.js$/.test(f))
  .sort();
const BEFORE_0030 = files.findIndex((f) => f.startsWith('0030_'));
const migrate = (url: string, direction: 'up' | 'down', count?: number) =>
  runner({
    databaseUrl: url,
    dir: 'migrations',
    direction,
    count,
    migrationsTable: 'pgmigrations',
    ignorePattern: 'package\\.json',
    log: () => undefined,
  });

const D_STEPS = '11111111-1111-4111-8111-111111111111';
const D_CARD = '22222222-2222-4222-8222-222222222222';
const D_CODE = '33333333-3333-4333-8333-333333333333';
const S1 = '44444444-4444-4444-8444-444444444444';
const U = '55555555-5555-4555-8555-555555555555';

run('0030_taxonomy', () => {
  let c: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  beforeAll(async () => {
    c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    pool = new pg.Pool({ connectionString: c.getConnectionUri() });
    await migrate(c.getConnectionUri(), 'up', BEFORE_0030);
    // legacy rows: a step document in tech/topic 11, a card-only topic 11 in tech, a coded intl doc, one script used by the step doc, a scoped role
    await pool.query(
      `insert into users(id, subject, source, email, display_name, initials) values ($1,'x','local','x@t','X','X')`,
      [U],
    );
    await pool.query(
      `insert into documents(id, slug, title, description, category, wave, priority, kind, status, topic_id) values
      ($1,'browsing','גלישה','',  'tech',1,'hh','steps','published',11),
      ($2,'topic-11','כרטיס גלישה','תיאור','tech',1,'hh','steps','draft',11),
      ($3,'pdf-011','אבחון נדידה','','intl',2,'h','steps','published',42)`,
      [D_STEPS, D_CARD, D_CODE],
    );
    await pool.query(`update documents set code='M-00' where id=$1`, [D_CODE]);
    await pool.query(`insert into phases(document_id, position, phase_key, label) values ($1,0,'p1','')`, [
      D_STEPS,
    ]);
    await pool.query(
      `insert into scripts(id, title, text, tags, created_by, updated_by) values ($1,'סיווג','"שורה 1"\n<b>','{"x"}',$2,$2)`,
      [S1, U],
    );
    await pool.query(`insert into script_refs(script_id, document_id, step_key) values ($1,$2,'s1')`, [
      S1,
      D_STEPS,
    ]);
    await pool.query(
      `insert into user_roles(user_id, role_id, category_scope) select $1, id, '{"tech"}' from roles where name='editor'`,
      [U],
    );
    await migrate(c.getConnectionUri(), 'up', 1);
  }, 180000);
  afterAll(async () => {
    await pool?.end();
    await c?.stop();
  });

  it('seeds worlds and backfills topics, memberships and doc types', async () => {
    const w = await pool.query('select slug, position from worlds order by position');
    expect(w.rows.map((r) => r.slug)).toEqual(['sim', 'tech', 'billing', 'plans', 'intl', 'ops']);
    const t = await pool.query(
      `select t.slug, t.name, w.slug world from topics t join worlds w on w.id=t.world_id order by t.slug`,
    );
    expect(t.rows).toEqual([
      { slug: 'topic-11', name: 'כרטיס גלישה', world: 'tech' }, // the card row wins the name
      { slug: 'topic-42', name: 'אבחון נדידה', world: 'intl' },
    ]);
    const dt = await pool.query(
      `select d.slug, t.slug topic from document_topics x join documents d on d.id=x.document_id join topics t on t.id=x.topic_id order by 1`,
    );
    expect(dt.rows).toEqual([
      { slug: 'browsing', topic: 'topic-11' },
      { slug: 'pdf-011', topic: 'topic-42' },
      { slug: 'topic-11', topic: 'topic-11' },
    ]);
    const dw = await pool.query(
      `select count(*)::int n from document_worlds dw join documents d on d.id=dw.document_id and d.category=dw.world_slug`,
    );
    expect(dw.rows[0].n).toBe(4); // three legacy docs + the folded script
    const types = await pool.query(`select slug, doc_type, kind from documents order by slug`);
    expect(types.rows).toEqual([
      { slug: 'browsing', doc_type: 'R', kind: 'steps' },
      { slug: 'pdf-011', doc_type: 'M', kind: 'steps' },
      // A-M10: the fold slug is 12 hex characters, not 8 — 32 bits against a unique constraint
      // aborts the whole migration on a collision.
      { slug: 'script-444444444444', doc_type: 'T', kind: 'text' },
      { slug: 'topic-11', doc_type: 'I', kind: 'steps' },
    ]);
    const cols = await pool.query(
      `select column_name from information_schema.columns where table_name='documents' and column_name in ('topic_id','tags','body_html','doc_type') order by 1`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual(['body_html', 'doc_type', 'tags']);
  });

  it('folds scripts into type-T documents with links and a system version', async () => {
    const s = await pool.query(
      `select title, body_html, tags, category, status, current_version from documents where id=$1`,
      [S1],
    );
    expect(s.rows[0]).toEqual({
      title: 'סיווג',
      body_html: '<p>"שורה 1"<br>&lt;b&gt;</p>',
      tags: ['x'],
      category: 'tech',
      status: 'published',
      current_version: 1,
    });
    const v = await pool.query(
      `select version, kind, label, snapshot->>'kind' k, snapshot->>'docType' dt from document_versions where document_id=$1`,
      [S1],
    );
    expect(v.rows).toEqual([{ version: 1, kind: 'system', label: 'הומר מתסריט', k: 'text', dt: 'T' }]);
    const l = await pool.query(
      `select from_document_id, from_step_key, type, origin from document_links where to_document_id=$1`,
      [S1],
    );
    expect(l.rows).toEqual([
      { from_document_id: D_STEPS, from_step_key: 's1', type: 'link', origin: 'explicit' },
    ]);
    const gone = await pool.query(
      `select table_name from information_schema.tables where table_name in ('scripts','script_refs')`,
    );
    expect(gone.rowCount).toBe(0);
  });

  it('renames the scope column and indexes tags into the search vector', async () => {
    const r = await pool.query(`select world_scope from user_roles where user_id=$1`, [U]);
    expect(r.rows[0].world_scope).toEqual(['tech']);
    await pool.query(`update documents set tags='{"apn-fix"}' where id=$1`, [D_STEPS]);
    const hit = await pool.query(
      `select id from documents where search_vector @@ plainto_tsquery('simple','apn-fix')`,
    );
    expect(hit.rows.map((x) => x.id)).toEqual([D_STEPS]);
  });

  it('rolls back to the 0029 shape', async () => {
    await migrate(c.getConnectionUri(), 'down', 1);
    const tables = await pool.query(
      `select table_name from information_schema.tables where table_schema='public' and table_name in ('worlds','topics','document_worlds','document_topics','scripts','script_refs') order by 1`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(['script_refs', 'scripts']);
    const s = await pool.query(`select title, text, tags from scripts where id=$1`, [S1]);
    expect(s.rows[0]).toEqual({ title: 'סיווג', text: '"שורה 1"\n<b>', tags: ['x'] });
    expect(
      (
        await pool.query(`select count(*)::int n from script_refs where script_id=$1 and document_id=$2`, [
          S1,
          D_STEPS,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect((await pool.query(`select topic_id from documents where id=$1`, [D_STEPS])).rows[0].topic_id).toBe(
      11,
    );
    expect((await pool.query(`select count(*)::int n from documents where id=$1`, [S1])).rows[0].n).toBe(0);
    expect(
      (await pool.query(`select category_scope from user_roles where user_id=$1`, [U])).rows[0]
        .category_scope,
    ).toEqual(['tech']);
    await migrate(c.getConnectionUri(), 'up', 1); // leave the container migrated for a re-run
  });
});
