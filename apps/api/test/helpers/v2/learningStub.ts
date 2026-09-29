import type pg from 'pg';

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
  /**
   * A-I2: the snapshot carries the questions, with the ids the rows actually got.
   *
   * The player and the grader read `learning_item_versions.snapshot` for the version the
   * assignment pins, exactly as V1's `publishItem` writes it (`{ item: LearningItem,
   * sourceVersions }` with `item.questions` and `item.entries` inside). A stub whose snapshot
   * held only the item header would make every seeded quiz answer with no questions at all.
   */
  const questions = [];
  for (const q of o.questions) {
    const qr = await pool.query(
      `insert into quiz_questions(item_id, position, document_id, stem, kind, options, explanation) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [id, pos++, o.documentId, q.stem, q.kind, JSON.stringify(q.options), q.explanation ?? ''],
    );
    questions.push({
      id: qr.rows[0].id as string,
      documentId: o.documentId,
      stepKey: null,
      stem: q.stem,
      kind: q.kind,
      options: q.options,
      explanation: q.explanation ?? '',
      generated: false,
      modelConf: null,
    });
  }
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
          entries: [],
          questions,
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
  const entries = [];
  for (const d of o.documentIds) {
    const er = await pool.query(
      `insert into briefing_entries(item_id, position, document_id, note) values ($1,$2,$3,'') returning id`,
      [id, pos++, d],
    );
    entries.push({ id: er.rows[0].id as string, documentId: d, stepKey: null, note: '' });
  }
  await pool.query(
    `insert into learning_item_versions(item_id, version, snapshot, label) values ($1, 1, $2, 'v1')`,
    [
      id,
      JSON.stringify({
        item: { id, kind: 'briefing', title: o.title, worldSlug: o.worldSlug, entries, questions: [] },
        sourceVersions: await pins(pool, o.documentIds),
      }),
    ],
  );
  return id;
}
