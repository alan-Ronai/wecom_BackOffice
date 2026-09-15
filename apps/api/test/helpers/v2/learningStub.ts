import type pg from 'pg';

/**
 * V1's migration 0046 creates the learning item tables. This lane's worktree may predate it, so
 * tests create the spec-§3 shape when absent. Column names match the spec verbatim; V6 verifies
 * parity against 0046 when both are on main.
 */
export async function ensureLearningTables(pool: pg.Pool): Promise<void> {
  const r = await pool.query(`select to_regclass('learning_items') as t`);
  if (r.rows[0]?.t) return;
  await pool.query(`
    create table learning_items (
      id uuid primary key default gen_random_uuid(),
      kind text not null check (kind in ('briefing','quiz')),
      title text not null,
      description text not null default '',
      world_slug text,
      status text not null default 'draft' check (status in ('draft','published','archived')),
      current_version integer not null default 0,
      pass_mark integer,
      max_attempts integer,
      estimated_minutes integer,
      created_by uuid references users,
      updated_by uuid references users,
      published_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );
    create table learning_item_versions (
      id uuid primary key default gen_random_uuid(),
      item_id uuid not null references learning_items on delete cascade,
      version integer not null,
      snapshot jsonb not null,
      author_id uuid references users,
      label text not null default '',
      created_at timestamptz not null default now(),
      unique (item_id, version)
    );
    create table briefing_entries (
      id uuid primary key default gen_random_uuid(),
      item_id uuid not null references learning_items on delete cascade,
      position integer not null,
      document_id uuid not null references documents,
      step_key text,
      note text not null default ''
    );
    create table quiz_questions (
      id uuid primary key default gen_random_uuid(),
      item_id uuid not null references learning_items on delete cascade,
      position integer not null,
      document_id uuid not null references documents,
      step_key text,
      stem text not null,
      kind text not null check (kind in ('single','multi','order','free')),
      options jsonb not null default '[]',
      explanation text not null default '',
      generated boolean not null default false,
      model_conf numeric
    );
  `);
}

const pins = async (pool: pg.Pool, documentIds: string[]) => {
  const r = await pool.query(`select id, current_version from documents where id = any($1::uuid[])`, [
    documentIds,
  ]);
  return r.rows.map((x) => ({ documentId: x.id as string, version: x.current_version as number }));
};

export interface SeedQuestion {
  stem: string;
  kind: 'single' | 'multi' | 'order' | 'free';
  options: { id: string; text: string; correct: boolean }[];
  explanation?: string;
}

export async function seedQuiz(
  pool: pg.Pool,
  o: {
    documentId: string;
    title: string;
    worldSlug: string | null;
    passMark: number | null;
    maxAttempts: number | null;
    questions: SeedQuestion[];
  },
): Promise<string> {
  const r = await pool.query(
    `insert into learning_items(kind, title, world_slug, status, current_version, pass_mark, max_attempts, published_at)
     values ('quiz', $1, $2, 'published', 1, $3, $4, now()) returning id`,
    [o.title, o.worldSlug, o.passMark, o.maxAttempts],
  );
  const id = r.rows[0].id as string;
  let pos = 0;
  for (const q of o.questions)
    await pool.query(
      `insert into quiz_questions(item_id, position, document_id, stem, kind, options, explanation) values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, pos++, o.documentId, q.stem, q.kind, JSON.stringify(q.options), q.explanation ?? ''],
    );
  await pool.query(
    `insert into learning_item_versions(item_id, version, snapshot, label) values ($1, 1, $2, 'v1')`,
    [
      id,
      JSON.stringify({
        item: {
          id,
          kind: 'quiz',
          title: o.title,
          worldSlug: o.worldSlug,
          passMark: o.passMark,
          maxAttempts: o.maxAttempts,
        },
        sourceVersions: await pins(pool, [o.documentId]),
      }),
    ],
  );
  return id;
}

export async function seedBriefing(
  pool: pg.Pool,
  o: { documentIds: string[]; title: string; worldSlug: string | null },
): Promise<string> {
  const r = await pool.query(
    `insert into learning_items(kind, title, world_slug, status, current_version, published_at)
     values ('briefing', $1, $2, 'published', 1, now()) returning id`,
    [o.title, o.worldSlug],
  );
  const id = r.rows[0].id as string;
  let pos = 0;
  for (const d of o.documentIds)
    await pool.query(
      `insert into briefing_entries(item_id, position, document_id, note) values ($1,$2,$3,'')`,
      [id, pos++, d],
    );
  await pool.query(
    `insert into learning_item_versions(item_id, version, snapshot, label) values ($1, 1, $2, 'v1')`,
    [
      id,
      JSON.stringify({
        item: { id, kind: 'briefing', title: o.title, worldSlug: o.worldSlug },
        sourceVersions: await pins(pool, o.documentIds),
      }),
    ],
  );
  return id;
}
