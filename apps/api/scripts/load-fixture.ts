/**
 * Load-test fixture generator (§11: "library reads < 300 ms p95 with 5,000 documents").
 *
 * Generates N realistic Hebrew documents — varied categories/waves/priorities, 5-15 steps
 * each, occasional shared blocks, CRM field references and cross-document links — and
 * inserts them directly with batched, multi-row SQL (not one row at a time, and not
 * through the HTTP API) so 5,000 documents load in seconds rather than minutes.
 *
 * Usage: `pnpm --filter @wecom/api load:fixture --docs 5000 [--reset]`
 * Also importable directly (`loadFixture(pool, { docs, reset })`) — `perf-check.ts` uses
 * this to seed its own testcontainers database.
 */
import pg from 'pg';
import { loadConfig } from '../src/config.js';

const CATEGORIES = ['sim', 'tech', 'billing', 'plans', 'intl', 'ops'] as const;
const WAVES = [1, 2, 3] as const;
const PRIORITIES = ['hh', 'h', 'm', 'l'] as const;
const STATUSES = ['draft', 'review', 'published', 'partial'] as const;
// Weighted so most of the library reads like a maintained knowledge base.
const STATUS_WEIGHTS = [0.1, 0.15, 0.65, 0.1];

const TOPIC_NOUNS = [
  'גלישה',
  'חיוב',
  'eSIM',
  'SIM',
  'נדידה בינלאומית',
  'מסלול גלישה',
  'החלפת מכשיר',
  'שדרוג חבילה',
  'ביטול קו',
  'הקפאת קו',
  'תשלום מרוכז',
  'הוראת קבע',
  'זיכוי',
  'תלונה',
  'שדרוג רשת',
  'תמיכה טכנית',
  'ניתוב שיחות',
  'הודעות קוליות',
  'אינטרנט סלולרי',
  'רומינג',
  'הגבלת גלישה',
  'שירותי ערך מוסף',
  'שחרור מכשיר',
  'ניוד מספר',
  'הקמת חשבון',
  'עדכון פרטים',
  'שינוי מסלול',
  'קידום מכירה',
  'תקלת רשת',
];
const VERBS = ['בדיקת', 'טיפול ב', 'פתיחת', 'סגירת', 'עדכון', 'אישור', 'ביטול', 'שחזור', 'הפעלת', 'ניתוק'];
const CRM_FIELD_NAMES = [
  'crm.subscriber.status',
  'crm.plan.code',
  'crm.device.imei',
  'crm.billing.balance',
  'crm.contact.phone',
  'crm.contact.email',
  'crm.line.msisdn',
  'crm.account.tier',
  'crm.roaming.flag',
  'crm.ticket.id',
  'crm.address.city',
  'crm.payment.method',
  'crm.plan.dataCap',
  'crm.line.status',
  'crm.discount.code',
  'crm.contract.endDate',
  'crm.sim.iccid',
  'crm.device.model',
  'crm.usage.mb',
  'crm.esim.activationCode',
];
const BLOCK_TITLES = [
  'אימות זהות לקוח',
  'הצעת שדרוג',
  'סגירת שיחה סטנדרטית',
  'בדיקת זכאות למבצע',
  'תסריט הרגעה',
  'איסוף פרטי תקלה',
  'הפניה לתמיכה טכנית',
  'אישור ביטול',
  'בדיקת חוב פתוח',
  'הצעת מסלול חלופי',
  'תיעוד פנייה',
  'הפניה למחלקה מוסמכת',
];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function weightedStatus(rng: () => number): (typeof STATUSES)[number] {
  let r = rng();
  for (let i = 0; i < STATUS_WEIGHTS.length; i++) {
    if (r < STATUS_WEIGHTS[i]) return STATUSES[i];
    r -= STATUS_WEIGHTS[i];
  }
  return 'published';
}
/** Deterministic, seedable PRNG (mulberry32) — reproducible fixture runs. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slugify = (title: string, i: number): string =>
  `doc-${i}-` +
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `doc-${i}`;

export interface LoadFixtureOptions {
  docs: number;
  reset?: boolean;
  seed?: number;
  log?: (msg: string) => void;
  /** Rows per multi-row INSERT / documents per transaction batch. */
  batchSize?: number;
}
export interface LoadFixtureResult {
  documents: number;
  steps: number;
  fieldRefs: number;
  links: number;
  ms: number;
}

/**
 * Builds `n` in-memory documents (title/description/phases/steps/…), grouped into
 * batches, then inserts each batch with one multi-row statement per table.
 */
export async function loadFixture(pool: pg.Pool, opts: LoadFixtureOptions): Promise<LoadFixtureResult> {
  const log = opts.log ?? (() => undefined);
  const started = Date.now();
  const rng = mulberry32(opts.seed ?? 42);
  const batchSize = opts.batchSize ?? 200;

  if (opts.reset) {
    log('resetting fixture data (documents, blocks, crm_fields)...');
    await pool.query('delete from documents');
    await pool.query('delete from blocks');
    await pool.query('delete from crm_fields');
  }

  // Shared blocks and CRM fields: small, fixed pools referenced by many documents/steps.
  const blockIds: string[] = [];
  {
    const rows: unknown[] = [];
    const values: string[] = [];
    BLOCK_TITLES.forEach((title, i) => {
      const p = i * 2;
      values.push(`($${p + 1},$${p + 2},'step')`);
      rows.push(`blk-fixture-${i}`, title);
    });
    const r = await pool.query(
      `insert into blocks(slug, title, kind) values ${values.join(',')}
       on conflict (slug) do update set title=excluded.title returning id`,
      rows,
    );
    blockIds.push(...r.rows.map((x) => x.id as string));
    for (const id of blockIds) {
      await pool.query(
        `insert into block_actions(block_id, position, text) values ($1,0,$2) on conflict do nothing`,
        [id, 'בצע לפי הנוהל המעודכן ותעד בכרטיס הלקוח'],
      );
    }
  }
  {
    const values: string[] = [];
    const params: unknown[] = [];
    CRM_FIELD_NAMES.forEach((name, i) => {
      const p = i * 2;
      values.push(`($${p + 1},$${p + 2},'ok')`);
      params.push(name, `CRM > ${name}`);
    });
    await pool.query(
      `insert into crm_fields(name, path, status) values ${values.join(',')} on conflict (name) do nothing`,
      params,
    );
  }

  let totalSteps = 0;
  let totalFieldRefs = 0;
  let totalLinks = 0;
  const allDocIds: string[] = [];

  for (let batchStart = 0; batchStart < opts.docs; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, opts.docs);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const docIds: string[] = [];
      const docParams: unknown[] = [];
      const docValues: string[] = [];
      const docSearchText: string[] = [];
      const docMeta: { wave: number; category: string; steps: { key: string }[] }[] = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const category = pick(rng, CATEGORIES);
        const wave = pick(rng, WAVES);
        const priority = pick(rng, PRIORITIES);
        const status = weightedStatus(rng);
        const verb = pick(rng, VERBS);
        const noun = pick(rng, TOPIC_NOUNS);
        const title = `${verb} ${noun} — תרחיש ${i + 1}`;
        const description = `נוהל טיפול ב${noun} עבור נציגי מוקד, גל ${wave}, קטגוריה ${category}.`;
        const nSteps = 5 + Math.floor(rng() * 11); // 5..15
        const stepTextParts: string[] = [];
        const steps: { key: string }[] = [];
        for (let s = 0; s < nSteps; s++) {
          const stepNoun = pick(rng, TOPIC_NOUNS);
          stepTextParts.push(`${VERBS[s % VERBS.length]} ${stepNoun}`, `ודא עדכון ${stepNoun} במערכת`);
          steps.push({ key: `s${s + 1}` });
        }
        const searchText = stepTextParts.join(' \n ');
        docSearchText.push(searchText);
        docMeta.push({ wave, category, steps });
        const p = docParams.length;
        docValues.push(
          `($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},'steps',$${p + 7},$${p + 8})`,
        );
        docParams.push(slugify(title, i), title, description, category, wave, priority, status, searchText);
      }

      const inserted = await client.query(
        `insert into documents(slug, title, description, category, wave, priority, kind, status, search_text)
         values ${docValues.join(',')} returning id`,
        docParams,
      );
      inserted.rows.forEach((r) => {
        docIds.push(r.id as string);
        allDocIds.push(r.id as string);
      });

      // One phase per document, all steps in it — keeps the fixture generator simple
      // while still exercising exactly the join shape production documents use.
      const phaseValues: string[] = [];
      const phaseParams: unknown[] = [];
      docIds.forEach((id) => {
        const p = phaseParams.length;
        phaseValues.push(`($${p + 1},0,'p1',$${p + 2})`);
        phaseParams.push(id, `שלבי הטיפול`);
      });
      const phaseRows = await client.query(
        `insert into phases(document_id, position, phase_key, label) values ${phaseValues.join(',')} returning id, document_id`,
        phaseParams,
      );
      const phaseIdByDoc = new Map(phaseRows.rows.map((r) => [r.document_id as string, r.id as string]));

      const stepValues: string[] = [];
      const stepParams: unknown[] = [];
      docIds.forEach((id, idx) => {
        const phaseId = phaseIdByDoc.get(id)!;
        const meta = docMeta[idx];
        meta.steps.forEach((s, si) => {
          const useBlock = rng() < 0.15;
          const blockId = useBlock ? pick(rng, blockIds) : null;
          const stepTitle = `${pick(rng, VERBS)} ${pick(rng, TOPIC_NOUNS)}`;
          const p = stepParams.length;
          stepValues.push(`($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7})`);
          stepParams.push(phaseId, id, si, s.key, String(si + 1), stepTitle, blockId);
        });
      });
      const stepRows = await client.query(
        `insert into steps(phase_id, document_id, position, step_key, num, title, block_id)
         values ${stepValues.join(',')} returning id, document_id, step_key`,
        stepParams,
      );
      totalSteps += stepRows.rowCount ?? 0;

      const actionValues: string[] = [];
      const actionParams: unknown[] = [];
      let fieldRefBatch = 0;
      const fieldRefValues: string[] = [];
      const fieldRefParams: unknown[] = [];
      stepRows.rows.forEach((r) => {
        const stepId = r.id as string;
        const nActions = 1 + Math.floor(rng() * 4); // 1..4
        for (let a = 0; a < nActions; a++) {
          const p = actionParams.length;
          actionValues.push(`($${p + 1},$${p + 2},$${p + 3},$${p + 4})`);
          actionParams.push(
            stepId,
            a,
            `a${a + 1}`,
            `${pick(rng, VERBS)} ${pick(rng, TOPIC_NOUNS)} בהתאם לנוהל`,
          );
        }
        // CRM refs: ~25% of steps cite a field the way an editor would ("עדכן crm.plan.code").
        if (rng() < 0.25) {
          const field = pick(rng, CRM_FIELD_NAMES);
          const p = fieldRefParams.length;
          fieldRefValues.push(`($${p + 1},$${p + 2})`);
          fieldRefParams.push(stepId, field);
          fieldRefBatch++;
        }
      });
      if (actionValues.length)
        await client.query(
          `insert into step_actions(step_id, position, action_key, text) values ${actionValues.join(',')}`,
          actionParams,
        );
      if (fieldRefValues.length) {
        await client.query(
          `insert into step_field_refs(step_id, field_name) values ${fieldRefValues.join(',')} on conflict do nothing`,
          fieldRefParams,
        );
        totalFieldRefs += fieldRefBatch;
      }

      // Cross-document links: ~10% of documents in this batch link to an earlier one
      // (so the graph grows as the fixture grows, like a real, cross-referenced library).
      if (allDocIds.length > docIds.length) {
        const linkValues: string[] = [];
        const linkParams: unknown[] = [];
        docIds.forEach((id) => {
          if (rng() < 0.1) {
            const target = allDocIds[Math.floor(rng() * (allDocIds.length - docIds.length))];
            const p = linkParams.length;
            linkValues.push(`($${p + 1},$${p + 2},'related','detected')`);
            linkParams.push(id, target);
          }
        });
        if (linkValues.length) {
          await client.query(
            `insert into document_links(from_document_id, to_document_id, type, origin) values ${linkValues.join(',')}`,
            linkParams,
          );
          totalLinks += linkValues.length;
        }
      }

      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    log(`  ${Math.min(batchEnd, opts.docs)}/${opts.docs} documents loaded`);
  }

  // Without this, the planner works from stale (pre-load, near-empty-table) statistics
  // until autovacuum's autoanalyze eventually catches up — in the meantime a filtered
  // `documents` scan is misestimated at ~1 row instead of hundreds, so the planner
  // chooses a per-row nested loop over the card-count subqueries instead of a single
  // hash/merge join. Measured effect on `GET /documents` at 5,000 documents: ~1045 ms
  // (stale stats) vs ~18 ms (fresh stats) for the same query — the whole reason this
  // call is here rather than left to autovacuum's own schedule.
  log('analyzing...');
  await pool.query(
    'analyze documents, phases, steps, step_actions, step_outcomes, step_field_refs, document_links, blocks, crm_fields',
  );

  return {
    documents: opts.docs,
    steps: totalSteps,
    fieldRefs: totalFieldRefs,
    links: totalLinks,
    ms: Date.now() - started,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const docsArg = args.indexOf('--docs');
  const docs = docsArg >= 0 ? Number(args[docsArg + 1]) : 5000;
  const reset = args.includes('--reset');
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  try {
    console.log(
      `load-fixture: generating ${docs} documents into ${config.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`,
    );
    const result = await loadFixture(pool, { docs, reset, log: (m) => console.log(m) });
    console.log(
      `load-fixture: done in ${(result.ms / 1000).toFixed(1)}s — ${result.documents} documents, ${result.steps} steps, ${result.fieldRefs} CRM field refs, ${result.links} links`,
    );
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
