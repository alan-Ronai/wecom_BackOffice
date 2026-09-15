/**
 * Wave 6 (X1): a multilingual embedder and impact-aware suggestions.
 *
 * `documents.embedding` was `vector(768)` since 0003 (nomic-embed-text). `bge-m3` returns 1024,
 * and `plugins/model.ts` refuses to boot when the configured width disagrees with the column's
 * own `atttypmod` — so the column must follow the configuration, not a number typed here.
 *
 * The resolver below is a plain-JS mirror of `apps/api/src/lib/modelSlots.ts`'s
 * `resolveModelSlots(...).embedDimension`, which is exactly what the boot check now compares
 * against. Keeping the two identical is the whole point: a deployment that sets `MODEL_TIER=1`
 * gets a 1024 column *and* a boot check expecting 1024, and a deployment that sets nothing keeps
 * 768 on both sides — no behaviour change on main.
 *
 * The one wrinkle it has to mirror: `EMBED_DIMENSION` carries a zod default of 768, so a parsed
 * config cannot tell "operator wrote 768" from "nobody set it". `resolveModelSlots` therefore
 * treats it as explicit only when it differs from 768, and so does this. An install that wants
 * 768 under a tier uses `MODEL_TIER=0` (which `deploy/e2e.env` and `deploy/ci.env` do).
 *
 * Rebuilding drops every stored vector: `ai.reindex` recomputes them, and search falls back to
 * lexical ranking until it has run — the same degradation an empty EMBED_MODEL gives.
 *
 * A-M5 — **`down` restores the width the column actually had**, not a hardcoded 768. `up` reads
 * the live `vector(n)` out of the catalogue before dropping the column and records it in
 * `schema_migration_notes`; `down` reads it back. Without that, rolling back on a tier-1 install
 * narrowed a 1024 column to 768, and re-running `up` widened it again — two full losses of every
 * vector where the operator asked for one round trip. The notes table is this migration's own and
 * is dropped by `down`, so a full rollback still leaves an empty schema.
 */

/** `MODEL_TIER_PRESETS[n].embedDimension` from `packages/shared/src/schemas/wave6.ts`. */
const TIER_EMBED_DIMENSION = { 0: 768, 1: 1024, 2: 1024, 3: 1024, 4: 1024 };
const LEGACY_EMBED_DIMENSION = 768;

/** The same precedence `resolveModelSlots` applies: explicit env → tier preset → 768. */
const resolveEmbedDimension = (env) => {
  const rawDim = env.EMBED_DIMENSION;
  const explicit = rawDim === undefined || rawDim === '' ? undefined : Number(rawDim);
  if (explicit !== undefined && (!Number.isInteger(explicit) || explicit < 1))
    throw new Error(`EMBED_DIMENSION must be a positive integer, got ${rawDim}`);
  if (explicit !== undefined && explicit !== LEGACY_EMBED_DIMENSION) return explicit;
  const rawTier = env.MODEL_TIER;
  const tier = rawTier === undefined || rawTier === '' ? undefined : Number(rawTier);
  if (tier !== undefined && Number.isInteger(tier) && tier >= 0 && tier <= 4)
    return TIER_EMBED_DIMENSION[tier];
  return explicit ?? LEGACY_EMBED_DIMENSION;
};

const dim = resolveEmbedDimension(process.env);

exports.resolveEmbedDimension = resolveEmbedDimension;

/** Where `up` writes down what it is about to destroy, so `down` can put it back. */
const NOTES = 'schema_migration_notes';
exports.NOTES_TABLE = NOTES;
const WIDTH_KEY = '0051.documents.embedding.previous_width';
exports.EMBEDDING_WIDTH_KEY = WIDTH_KEY;

/** `vector(768)` → `768`, straight out of the catalogue. Null when the column is not a vector. */
const CURRENT_WIDTH_SQL = `(select substring(format_type(a.atttypid, a.atttypmod) from '[(]([0-9]+)[)]')
     from pg_attribute a
    where a.attrelid = 'documents'::regclass and a.attname = 'embedding' and not a.attisdropped)`;

exports.up = (pgm) => {
  pgm.sql(`create table if not exists ${NOTES} (
             key text primary key,
             value text not null,
             noted_at timestamptz not null default now())`);
  pgm.sql(`insert into ${NOTES}(key, value)
           values ('${WIDTH_KEY}', coalesce(${CURRENT_WIDTH_SQL}, '${LEGACY_EMBED_DIMENSION}'))
           on conflict (key) do update set value = excluded.value, noted_at = now()`);
  pgm.sql(`alter table documents drop column embedding`);
  pgm.sql(`alter table documents add column embedding vector(${dim})`);
  pgm.createTable('step_embeddings', {
    step_id: { type: 'uuid', primaryKey: true, references: 'steps', onDelete: 'cascade' },
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    embedding: { type: `vector(${dim})`, notNull: true },
    text_hash: { type: 'text', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('step_embeddings', 'document_id', { name: 'step_embeddings_document_idx' });
  pgm.addColumns('suggestions', {
    affects: { type: 'jsonb', notNull: true, default: '[]' },
    prompt_version: 'text',
    model: 'text',
  });
  pgm.createTable('ai_eval_runs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    model: { type: 'text', notNull: true },
    prompt_version: { type: 'text', notNull: true },
    embed_model: { type: 'text', notNull: true, default: '' },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: 'timestamptz',
    cases: { type: 'integer', notNull: true, default: 0 },
    hit_target: { type: 'real', notNull: true, default: 0 },
    hit_type: { type: 'real', notNull: true, default: 0 },
    content_overlap: { type: 'real', notNull: true, default: 0 },
    notes: { type: 'text', notNull: true, default: '' },
    started_by: { type: 'uuid', references: 'users' },
  });
  pgm.createIndex('ai_eval_runs', 'started_at');
};

exports.down = (pgm) => {
  pgm.dropTable('ai_eval_runs');
  pgm.dropColumns('suggestions', ['affects', 'prompt_version', 'model']);
  pgm.dropTable('step_embeddings');
  pgm.sql(`alter table documents drop column embedding`);
  // The width `up` recorded, falling back to 0003's 768 only when there is no note to read.
  pgm.sql(`do $$
             declare w integer;
             begin
               select nullif(value, '')::integer into w
                 from ${NOTES} where key = '${WIDTH_KEY}';
               if w is null or w < 1 then w := ${LEGACY_EMBED_DIMENSION}; end if;
               execute format('alter table documents add column embedding vector(%s)', w);
             end $$;`);
  pgm.dropTable(NOTES, { ifExists: true });
};
