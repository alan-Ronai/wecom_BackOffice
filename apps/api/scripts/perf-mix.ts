/**
 * The query mix and the statistics behind `perf-load.ts` (§11 / F-5: "search p95 < 500 ms at
 * 5,000 documents", under concurrent load rather than the one-request-at-a-time shape
 * `perf-check.ts` measures).
 *
 * Kept as its own module, with no database or Fastify import, so the mix and the percentile
 * maths are unit-testable (`test/perf/perf-mix.test.ts`) without Docker: a load report is only
 * worth reading if the numbers in it are computed correctly, and "the p95 helper is right" is
 * exactly the kind of thing a 60-second load run cannot tell you.
 *
 * The vocabulary is the fixture's own (`load-fixture.ts`: TOPIC_NOUNS, VERBS, BLOCK_TITLES), so
 * every query in the mix actually matches rows. A mix of misses would measure the empty-result
 * path, which is the fast one and therefore the wrong one to gate on.
 */

/** The five shapes §7 item 12 asks for, reported separately because they cost very different things. */
export const QUERY_CLASSES = ['single', 'two-word', 'prefix', 'stopword', 'world-filtered'] as const;
export type QueryClass = (typeof QUERY_CLASSES)[number];

export interface PerfQuery {
  cls: QueryClass;
  /** The `q=` value. */
  q: string;
  /** The `world=` facet, set only for the `world-filtered` class. */
  world?: string;
}

const NOUNS = [
  'גלישה',
  'חיוב',
  'eSIM',
  'SIM',
  'נדידה',
  'מסלול',
  'מכשיר',
  'חבילה',
  'קו',
  'תשלום',
  'זיכוי',
  'תלונה',
  'רשת',
  'תמיכה',
  'שיחות',
  'הודעות',
  'אינטרנט',
  'רומינג',
  'שירותי',
  'מספר',
  'חשבון',
  'פרטים',
  'מכירה',
  'תקלת',
  'לקוח',
  'אימות',
  'זהות',
  'הצעת',
  'סגירת',
  'בדיקת',
  'זכאות',
  'תסריט',
  'איסוף',
  'הפניה',
  'אישור',
  'ביטול',
  'שדרוג',
  'הפעלת',
  'ניתוק',
  'עדכון',
];

/** Two-word queries the fixture's `VERB + NOUN` titles really contain. */
const VERBS = ['בדיקת', 'טיפול', 'פתיחת', 'סגירת', 'עדכון', 'אישור', 'ביטול', 'שחזור', 'הפעלת', 'ניתוק'];

/**
 * Words from `search_hebrew_stopwords` (migration 0023). `kb_tsquery` strips these, so a
 * stopword-heavy query is the one where the `ilike` arms do all of the work and the `tsquery`
 * rank contributes nothing — the shape most likely to blow the budget.
 */
const STOPWORDS = ['של', 'את', 'על', 'עם', 'זה', 'כל', 'יש', 'לא', 'מה', 'אם'];

/**
 * `apps/web`'s `MIN_SEARCH_CHARS`. Duplicated rather than imported: this script must not pull the
 * web package into the API's dependency graph, and the number is the product's contract with the
 * palette, not an implementation detail of either side.
 */
export const MIN_PREFIX_CHARS = 3;
/** Nouns long enough to cut a `MIN_PREFIX_CHARS` prefix that is still a prefix and not the word. */
const PREFIX_NOUNS = NOUNS.filter((n) => n.length > MIN_PREFIX_CHARS);

export const WORLDS = ['sim', 'tech', 'billing', 'plans', 'intl', 'ops'] as const;

/** Deterministic PRNG (same generator `load-fixture.ts` uses), so a mix is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

/**
 * `perClass * 5` queries, evenly split across the classes and shuffled so a run does not walk one
 * class at a time (which would let the buffer cache warm per class and flatter the slow ones).
 */
export function buildQueryMix(perClass = 40, seed = 1337): PerfQuery[] {
  const rng = mulberry32(seed);
  const out: PerfQuery[] = [];
  for (let i = 0; i < perClass; i++) {
    out.push({ cls: 'single', q: pick(rng, NOUNS) });
    out.push({ cls: 'two-word', q: `${pick(rng, VERBS)} ${pick(rng, NOUNS)}` });
    /**
     * The palette searches as the user types, but only from `MIN_SEARCH_CHARS` (3) on — below
     * that `isSearchable` sends nothing and the palette answers from local hits. The generator
     * used to issue two-character prefixes, which `pg_trgm` cannot index at all, so the `prefix`
     * class was over the 500 ms budget *by construction* and the gate was permanently red. A
     * gate that is always red stops being read, and the shortest prefix the product actually
     * sends is three characters.
     */
    const whole = pick(rng, PREFIX_NOUNS);
    const cut = Math.max(MIN_PREFIX_CHARS, Math.min(whole.length - 1, MIN_PREFIX_CHARS + Math.floor(rng() * 3)));
    out.push({ cls: 'prefix', q: whole.slice(0, cut) });
    out.push({
      cls: 'stopword',
      q: `${pick(rng, STOPWORDS)} ${pick(rng, NOUNS)} ${pick(rng, STOPWORDS)}`,
    });
    out.push({ cls: 'world-filtered', q: pick(rng, NOUNS), world: pick(rng, WORLDS) });
  }
  // Fisher-Yates on the same seeded stream.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface Stats {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/**
 * Nearest-rank percentile on an already-sorted ascending array — the same definition
 * `perf-check.ts` uses, so the two reports' p95s mean the same thing.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function summarize(samples: readonly number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  return {
    count: s.length,
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s.length ? s[s.length - 1] : NaN,
  };
}

/** Collects latencies per class plus an `all` bucket, and renders the report table. */
export class LatencyRecorder {
  private readonly byClass = new Map<string, number[]>();

  record(cls: string, ms: number): void {
    let a = this.byClass.get(cls);
    if (!a) this.byClass.set(cls, (a = []));
    a.push(ms);
  }

  classes(): string[] {
    return [...this.byClass.keys()];
  }

  /** The raw latencies for a class, so two recorders can be merged. */
  samples(cls: string): readonly number[] {
    return this.byClass.get(cls) ?? [];
  }

  stats(cls: string): Stats {
    return summarize(this.byClass.get(cls) ?? []);
  }

  all(): Stats {
    return summarize([...this.byClass.values()].flat());
  }

  /** Fixed-width table, the same layout `perf-check.ts` prints. */
  table(order: readonly string[] = QUERY_CLASSES): string {
    const pad = (s: string, n: number) => s.padEnd(n);
    const lines = [
      pad('query class', 18) +
        pad('n', 8) +
        pad('p50 ms', 10) +
        pad('p95 ms', 10) +
        pad('p99 ms', 10) +
        'max ms',
    ];
    const row = (name: string, s: Stats) =>
      pad(name, 18) +
      pad(String(s.count), 8) +
      pad(s.p50.toFixed(1), 10) +
      pad(s.p95.toFixed(1), 10) +
      pad(s.p99.toFixed(1), 10) +
      s.max.toFixed(1);
    for (const c of order) if (this.byClass.has(c)) lines.push(row(c, this.stats(c)));
    for (const c of this.classes()) if (!order.includes(c)) lines.push(row(c, this.stats(c)));
    lines.push(row('ALL', this.all()));
    return lines.join('\n');
  }
}
