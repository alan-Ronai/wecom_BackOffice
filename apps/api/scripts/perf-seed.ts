/**
 * The 5,000-document corpus `perf-load.ts` measures against.
 *
 * `load-fixture.ts` already builds realistic documents/phases/steps/actions/field-refs/links, so
 * this reuses it rather than growing a second generator. What it adds is everything wave 4 put
 * into the search path and the fixture predates, and whose absence would have made the load run
 * measure a much easier query than production runs:
 *
 *   - `document_worlds` rows. `search()` narrows every document-bearing group with
 *     `exists (select 1 from document_worlds …)` for a world-scoped caller and for `?world=`.
 *     The fixture inserts documents directly, so without this pass that EXISTS matches nothing
 *     and a world-filtered query returns instantly for the wrong reason.
 *   - `tags`, so the `tags` group (`d.tags && $1::text[]`) has something to find, and so the
 *     `search_vector` trigger's tag weighting (migration 0030) is exercised.
 *   - `topics` + `document_topics`, for the `?topic=` facet.
 *   - a spread of `doc_type`, and a slice of real type-T/`kind='text'` documents with
 *     `body_html`, which is the only thing the `scripts` group ever matches — and it matches it
 *     with `ilike '%…%'` over the whole HTML body.
 *
 * Deterministic: everything derives from `seed`, so a before/after comparison is over the same
 * corpus rather than two different ones.
 */
import type pg from 'pg';
import { loadFixture } from './load-fixture.js';
import { mulberry32, WORLDS } from './perf-mix.js';

const TAGS = [
  'גלישה',
  'חיוב',
  'נדידה',
  'esim',
  'מכשיר',
  'מסלול',
  'תקלה',
  'זיכוי',
  'ניוד',
  'רשת',
  'תשלום',
  'הקפאה',
  'שדרוג',
  'ביטול',
  'תמיכה',
  'מכירה',
];
const DOC_TYPES = ['R', 'R', 'R', 'M', 'O', 'E', 'S', 'I'];
const TOPIC_NAMES = ['הצטרפות', 'תקלות נפוצות', 'חיובים וזיכויים', 'שירותים בחו"ל'];

/** Script bodies for the type-T slice — long enough that `body_html ilike '%…%'` is real work. */
const SCRIPT_PARAGRAPHS = [
  'שלום, הגעת למוקד השירות. אני כאן כדי לעזור לך עם הבקשה שלך בנוגע לחבילת הגלישה והחיוב החודשי.',
  'אני רואה שהקו שלך פעיל ושהמסלול הנוכחי כולל גלישה בארץ ללא הגבלה, אך נדידה בינלאומית אינה מופעלת.',
  'כדי להפעיל רומינג לחו"ל עלי לאמת את זהותך מול פרטי החשבון, ולאחר מכן נעדכן את המסלול במערכת ה-CRM.',
  'במידה ומדובר בתקלת רשת, אבדוק את סטטוס האנטנות באזור שלך ואפתח קריאת שירות לתמיכה הטכנית.',
  'לסיום, אשלח לך הודעה עם סיכום השיחה, מספר הפנייה, והצעדים הבאים לטיפול בבקשה.',
];

export interface SeedResult {
  documents: number;
  stepDocuments: number;
  textDocuments: number;
  steps: number;
  links: number;
  ms: number;
}

const pick = <T>(rng: () => number, a: readonly T[]): T => a[Math.floor(rng() * a.length)];

export async function seedPerfCorpus(
  pool: pg.Pool,
  opts: { docs: number; seed?: number; log?: (m: string) => void },
): Promise<SeedResult> {
  const log = opts.log ?? (() => undefined);
  const started = Date.now();
  const seed = opts.seed ?? 42;
  const rng = mulberry32(seed);
  // ~8 % of a real library is scripts/text items; the rest are procedures.
  const textDocs = Math.round(opts.docs * 0.08);
  const stepDocs = opts.docs - textDocs;

  log(`loading ${stepDocs} step documents via load-fixture...`);
  const base = await loadFixture(pool, { docs: stepDocs, seed, log: (m) => log('  ' + m) });

  log(`adding ${textDocs} type-T text documents...`);
  {
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < textDocs; i++) {
      const world = pick(rng, WORLDS);
      const title = `תסריט ${pick(rng, TOPIC_NAMES)} ${i + 1}`;
      const body =
        '<p>' +
        Array.from({ length: 3 + Math.floor(rng() * 3) }, () => pick(rng, SCRIPT_PARAGRAPHS)).join(
          '</p><p>',
        ) +
        '</p>';
      const p = params.length;
      values.push(
        `($${p + 1},$${p + 2},'',$${p + 3},3,'m','text','published','T',$${p + 4},$${p + 5},$${p + 6})`,
      );
      params.push(
        `perf-script-${i}`,
        title,
        world,
        body,
        // search_text mirrors the body so the tsvector has the script's words in it.
        body.replace(/<[^>]+>/g, ' '),
        [pick(rng, TAGS), pick(rng, TAGS)],
      );
    }
    // One statement per 500 rows: 6 params each, comfortably under the 65535 bind-parameter cap.
    const CHUNK = 500 * 6;
    for (let off = 0, vi = 0; off < params.length; off += CHUNK, vi += 500) {
      const slice = params.slice(off, off + CHUNK);
      const n = slice.length / 6;
      const vs: string[] = [];
      for (let k = 0; k < n; k++) {
        const p = k * 6;
        vs.push(
          `($${p + 1},$${p + 2},'',$${p + 3},3,'m','text','published','T',$${p + 4},$${p + 5},$${p + 6}::text[])`,
        );
      }
      await pool.query(
        `insert into documents(slug, title, description, category, wave, priority, kind, status, doc_type, body_html, search_text, tags)
         values ${vs.join(',')}`,
        slice,
      );
    }
  }

  log('spreading doc_type over the step documents...');
  // `hashtext` is stable per row, so the spread is deterministic without a per-row round trip.
  // Masked rather than `abs()`-ed: `hashtext` can return INT_MIN, whose `abs` overflows.
  await pool.query(
    `update documents d set doc_type = t.v
       from (select v, i - 1 i from unnest($1::text[]) with ordinality as u(v, i)) t
      where d.kind <> 'text' and ((hashtext(d.id::text) & 2147483647) % $2::int) = t.i`,
    [DOC_TYPES, DOC_TYPES.length],
  );

  log('assigning tags...');
  await pool.query(
    `update documents d
        set tags = array[
              ($1::text[])[(hashtext(d.id::text) & 2147483647) % array_length($1::text[],1) + 1],
              ($1::text[])[(hashtext(d.id::text || 'b') & 2147483647) % array_length($1::text[],1) + 1],
              ($1::text[])[(hashtext(d.id::text || 'c') & 2147483647) % array_length($1::text[],1) + 1]
            ]
      where d.kind <> 'text'`,
    [TAGS],
  );

  log('building document_worlds memberships...');
  await pool.query(
    `insert into document_worlds(document_id, world_slug)
     select id, category from documents on conflict do nothing`,
  );
  // ~30 % of documents belong to a second world, so the EXISTS is not one row per document.
  await pool.query(
    `insert into document_worlds(document_id, world_slug)
     select d.id, w.slug from documents d
       join worlds w
         on w.slug = ($1::text[])[(hashtext(d.id::text || 'w') & 2147483647) % array_length($1::text[],1) + 1]
      where (hashtext(d.id::text || 'x') & 2147483647) % 10 < 3 and w.slug <> d.category
     on conflict do nothing`,
    [[...WORLDS]],
  );

  log('building topics and memberships...');
  for (const name of TOPIC_NAMES) {
    await pool.query(
      `insert into topics(world_id, slug, name, position)
       select w.id, $1, $2, 0 from worlds w on conflict do nothing`,
      [`perf-${TOPIC_NAMES.indexOf(name)}`, name],
    );
  }
  await pool.query(
    `insert into document_topics(document_id, topic_id)
     select d.id, t.id from documents d
       join worlds w on w.slug = d.category
       join topics t on t.world_id = w.id
      where t.slug = 'perf-' || ((hashtext(d.id::text || 't') & 2147483647) % $1::int)
     on conflict do nothing`,
    [TOPIC_NAMES.length],
  );

  // The planner is only as good as its statistics, and everything above was written in bulk.
  log('analyzing...');
  await pool.query('analyze');

  const total = (await pool.query('select count(*)::int n from documents where deleted_at is null')).rows[0]
    .n as number;
  return {
    documents: total,
    stepDocuments: base.documents,
    textDocuments: textDocs,
    steps: base.steps,
    links: base.links,
    ms: Date.now() - started,
  };
}
