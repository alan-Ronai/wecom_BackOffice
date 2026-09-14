import type { Queryable } from '../../lib/sql.js';
import { normalizeStem } from './stem.js';
import type { GapCandidate } from './repo.js';

type Q = Queryable;

export interface Thresholds {
  zeroResultMin: number;
  feedbackClusterMin: number;
  staleDays: number;
  failedQuestionRate: number;
}

/** Zero-result searches in the last 7 days, clustered by normalised stem (the stem is not SQL-expressible). */
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
      kind: 'zero_results' as const,
      key: stem,
      title: `חיפושים ללא תוצאה: ${stem}`,
      evidence: {
        count: c.count,
        samples: [...c.samples],
        lastAt: new Date(c.last).toISOString(),
        windowDays: 7,
      },
      score: c.count,
      suggestedAction: 'create' as const,
      documentId: null,
      topicId: null,
      worldSlug: null,
    }));
}

/** Documents carrying at least N open `no_answer` / `missing` reports: the agents already said what is missing. */
export async function feedbackClusters(q: Q, t: Thresholds): Promise<GapCandidate[]> {
  const r = await q.query<{
    document_id: string;
    title: string;
    world_slug: string;
    open: string;
    kinds: string[];
  }>(
    `select f.document_id, d.title, f.world_slug, count(*) open, array_agg(distinct f.kind) kinds
     from feedback f join documents d on d.id = f.document_id and d.deleted_at is null
     where f.kind in ('no_answer','missing') and f.status in ('new','in_review','needs_update')
     group by f.document_id, d.title, f.world_slug
     having count(*) >= $1`,
    [t.feedbackClusterMin],
  );
  return r.rows.map((x) => ({
    kind: 'feedback_cluster' as const,
    key: x.document_id,
    title: `דיווחים חוזרים על חוסר מידע: ${x.title}`,
    evidence: { open: Number(x.open), kinds: x.kinds },
    score: Number(x.open) * 2,
    suggestedAction: 'update' as const,
    documentId: x.document_id,
    topicId: null,
    worldSlug: x.world_slug,
  }));
}

/**
 * Top-decile traffic (cumulative `recent_views.count`) that has not been updated for `staleDays`.
 *
 * `cume_dist`, not `percent_rank`: the latter is `(rank-1)/(n-1)` and so is 0 for *every* row of a
 * one-row window, which would silently switch the detector off on a young or lightly-used
 * installation — exactly where a single much-read stale item matters most. `cume_dist` is the
 * fraction of rows at or below this one, which is what "top decile" means, and is 1 for a lone row.
 */
export async function staleHighTraffic(q: Q, t: Thresholds): Promise<GapCandidate[]> {
  const r = await q.query<{ id: string; title: string; category: string; views: string; updated_at: Date }>(
    `with traffic as (
       select d.id, d.title, d.category, d.updated_at, coalesce(sum(v.count),0) views,
              cume_dist() over (order by coalesce(sum(v.count),0)) pr
       from documents d left join recent_views v on v.document_id = d.id
       where d.deleted_at is null and d.status in ('published','partial')
       group by d.id
     )
     select id, title, category, views, updated_at from traffic
     where pr >= 0.9 and views > 0 and updated_at < now() - ($1::int * interval '1 day')`,
    [t.staleDays],
  );
  return r.rows.map((x) => ({
    kind: 'stale_high_traffic' as const,
    key: x.id,
    title: `פריט נצפה שלא עודכן: ${x.title}`,
    evidence: {
      views: Number(x.views),
      updatedAt: new Date(x.updated_at).toISOString(),
      staleDays: t.staleDays,
    },
    score: Math.log10(Number(x.views) + 1) * 3,
    suggestedAction: 'update' as const,
    documentId: x.id,
    topicId: null,
    worldSlug: x.category,
  }));
}

/** Topics agents actually open that hold no published R (route) or O (operation) item. */
export async function topicsWithoutProcedure(q: Q): Promise<GapCandidate[]> {
  const r = await q.query<{ id: string; name: string; slug: string; views: string }>(
    `select t.id, t.name, w.slug, sum(tv.count) views
     from topics t join worlds w on w.id = t.world_id
     join topic_views tv on tv.topic_id = t.id
     where t.active
       and not exists (
         select 1 from document_topics dt join documents d on d.id = dt.document_id
         where dt.topic_id = t.id and d.deleted_at is null
           and d.status in ('published','partial') and d.doc_type in ('R','O')
       )
     group by t.id, t.name, w.slug
     having sum(tv.count) > 0`,
  );
  return r.rows.map((x) => ({
    kind: 'topic_without_procedure' as const,
    key: x.id,
    title: `נושא ללא מסלול טיפול או תפעול: ${x.name}`,
    evidence: { views: Number(x.views) },
    score: Math.log10(Number(x.views) + 1) * 2 + 1,
    suggestedAction: 'create' as const,
    documentId: null,
    topicId: x.id,
    worldSlug: x.slug,
  }));
}

/**
 * Quiz questions failed by at least `failedQuestionRate` of attempts — either the question is
 * wrong or the material behind it is. Reads V1/V2 tables, which do not exist until those lanes
 * merge, so the presence probe comes first: the nightly job must never fail on a missing table.
 * `learning_attempts.answers` is `{ [questionId]: { selected, correct } }` (V2's contract).
 */
export async function failedQuestions(q: Q, t: Thresholds): Promise<GapCandidate[]> {
  const has = await q.query<{ a: string | null; b: string | null }>(
    `select to_regclass('public.learning_attempts')::text a, to_regclass('public.quiz_questions')::text b`,
  );
  if (!has.rows[0].a || !has.rows[0].b) return [];
  const r = await q.query<{
    question_id: string;
    item_id: string;
    document_id: string | null;
    stem: string;
    attempts: string;
    failed: string;
  }>(
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
    kind: 'failed_question' as const,
    key: x.question_id,
    title: `שאלה שנכשלת לעיתים קרובות: ${x.stem.slice(0, 80)}`,
    evidence: { attempts: Number(x.attempts), failed: Number(x.failed), itemId: x.item_id },
    score: (Number(x.failed) / Number(x.attempts)) * 5,
    suggestedAction: 'add_question' as const,
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
