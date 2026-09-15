import { describe, it, expect } from 'vitest';
import {
  buildQueryMix,
  LatencyRecorder,
  percentile,
  QUERY_CLASSES,
  summarize,
  MIN_PREFIX_CHARS,
} from '../../scripts/perf-mix.js';

/**
 * The load report (`perf-load.ts`, `docs/perf.md`) is an argument about whether the §11 NFR holds,
 * and an argument is only as good as its arithmetic. These run without Docker — the point is that
 * `pnpm test` keeps the p95 definition and the query mix honest even when nobody runs the 60 s
 * load profile.
 */
describe('perf-mix percentiles', () => {
  const asc = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100

  it('uses nearest-rank, matching perf-check', () => {
    expect(percentile(asc, 50)).toBe(50);
    expect(percentile(asc, 95)).toBe(95);
    expect(percentile(asc, 99)).toBe(99);
    expect(percentile(asc, 100)).toBe(100);
  });

  it('never reads past the end of a short sample', () => {
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2], 99)).toBe(2);
    expect(percentile([], 95)).toBeNaN();
  });

  it('sorts before summarizing, so an unsorted arrival order is still correct', () => {
    const shuffled = [...asc].reverse();
    const s = summarize(shuffled);
    expect(s.count).toBe(100);
    expect(s.p50).toBe(50);
    expect(s.p95).toBe(95);
    expect(s.p99).toBe(99);
    expect(s.max).toBe(100);
    expect(s.mean).toBeCloseTo(50.5);
  });

  it('a single outlier moves p99 and max but not p50', () => {
    const s = summarize([...Array.from({ length: 99 }, () => 10), 5000]);
    expect(s.p50).toBe(10);
    expect(s.p99).toBe(10);
    expect(s.max).toBe(5000);
  });
});

describe('perf-mix query mix', () => {
  it('is balanced across the five classes', () => {
    const mix = buildQueryMix(40, 1337);
    expect(mix).toHaveLength(200);
    for (const c of QUERY_CLASSES) expect(mix.filter((m) => m.cls === c)).toHaveLength(40);
  });

  it('is deterministic for a seed and different across seeds', () => {
    const a = buildQueryMix(10, 1).map((m) => `${m.cls}:${m.q}:${m.world ?? ''}`);
    const b = buildQueryMix(10, 1).map((m) => `${m.cls}:${m.q}:${m.world ?? ''}`);
    const c = buildQueryMix(10, 2).map((m) => `${m.cls}:${m.q}:${m.world ?? ''}`);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('shuffles, so a run does not walk one class at a time', () => {
    const mix = buildQueryMix(40, 1337);
    const runs = mix.filter((m, i) => i > 0 && m.cls === mix[i - 1].cls).length;
    // A per-class-ordered mix would give 195 of 199 adjacent pairs the same class.
    expect(runs).toBeLessThan(100);
  });

  it('gives each class the shape its name promises', () => {
    const mix = buildQueryMix(40, 1337);
    for (const m of mix.filter((x) => x.cls === 'single')) expect(m.q.split(/\s+/)).toHaveLength(1);
    for (const m of mix.filter((x) => x.cls === 'two-word')) expect(m.q.split(/\s+/)).toHaveLength(2);
    for (const m of mix.filter((x) => x.cls === 'stopword')) expect(m.q.split(/\s+/)).toHaveLength(3);
    // Three, not two: `pg_trgm` cannot index a shorter pattern and the palette never sends one
    // (`MIN_SEARCH_CHARS`), so a two-character prefix made the load gate red by construction.
    for (const m of mix.filter((x) => x.cls === 'prefix'))
      expect(m.q.length).toBeGreaterThanOrEqual(MIN_PREFIX_CHARS);
    for (const m of mix.filter((x) => x.cls === 'world-filtered')) expect(m.world).toBeTruthy();
    for (const m of mix.filter((x) => x.cls !== 'world-filtered')) expect(m.world).toBeUndefined();
  });

  it('only emits non-empty queries — search() short-circuits on an empty q', () => {
    for (const m of buildQueryMix(40, 7)) expect(m.q.trim().length).toBeGreaterThan(0);
  });
});

describe('LatencyRecorder', () => {
  it('reports per class and overall', () => {
    const r = new LatencyRecorder();
    for (const ms of [1, 2, 3]) r.record('single', ms);
    for (const ms of [100, 200]) r.record('stopword', ms);
    expect(r.stats('single').p50).toBe(2);
    expect(r.stats('stopword').max).toBe(200);
    expect(r.all().count).toBe(5);
    expect(r.all().max).toBe(200);
  });

  it('renders a table with a row per recorded class plus ALL', () => {
    const r = new LatencyRecorder();
    r.record('single', 5);
    r.record('prefix', 9);
    const lines = r.table().split('\n');
    expect(lines[0]).toContain('p95 ms');
    expect(lines.some((l) => l.startsWith('single'))).toBe(true);
    expect(lines.some((l) => l.startsWith('prefix'))).toBe(true);
    expect(lines[lines.length - 1]).toMatch(/^ALL/);
    // Classes with no samples are not invented.
    expect(lines.some((l) => l.startsWith('two-word'))).toBe(false);
  });
});
