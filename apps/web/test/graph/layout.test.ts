import { describe, expect, it } from 'vitest';
import { createLayout } from '../../src/components/graph/layout.js';

const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const edges = [
  { from: 'a', to: 'b' },
  { from: 'b', to: 'c' },
  { from: 'a', to: 'c' },
  { from: 'd', to: 'e' },
];

const run = (l: ReturnType<typeof createLayout>, n: number) => {
  for (let i = 0; i < n; i++) if (!l.step()) break;
};

describe('force layout', () => {
  it('is deterministic — the same graph lays out the same way twice', () => {
    const a = createLayout(ids, edges, { width: 600, height: 400 });
    const b = createLayout(ids, edges, { width: 600, height: 400 });
    run(a, 200);
    run(b, 200);
    expect(a.nodes).toEqual(b.nodes);
  });

  it('keeps every node inside the canvas and never produces NaN', () => {
    const l = createLayout(ids, edges, { width: 600, height: 400 });
    run(l, 400);
    for (const n of l.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(600);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(400);
    }
  });

  it('pulls connected nodes closer than unconnected ones', () => {
    const l = createLayout(ids, edges, { width: 600, height: 400 });
    run(l, 400);
    const at = new Map(l.nodes.map((n) => [n.id, n]));
    const d = (p: string, q: string) => Math.hypot(at.get(p)!.x - at.get(q)!.x, at.get(p)!.y - at.get(q)!.y);
    // a–b share an edge; a–f share nothing at all.
    expect(d('a', 'b')).toBeLessThan(d('a', 'f'));
  });

  it('pins the anchor at the centre', () => {
    const l = createLayout(ids, edges, { width: 600, height: 400, anchor: 'a' });
    run(l, 400);
    const a = l.nodes.find((n) => n.id === 'a')!;
    expect(a.x).toBe(300);
    expect(a.y).toBe(200);
  });

  it('cools to a stop instead of running forever', () => {
    const l = createLayout(ids, edges, { width: 600, height: 400, iterations: 20 });
    run(l, 100);
    expect(l.step()).toBe(false);
    expect(l.alpha()).toBe(0);
  });

  it('survives a single node and an empty graph', () => {
    const one = createLayout(['solo'], [], { width: 300, height: 300 });
    run(one, 50);
    expect(Number.isFinite(one.nodes[0].x)).toBe(true);

    const none = createLayout([], [], { width: 300, height: 300 });
    run(none, 50);
    expect(none.nodes).toEqual([]);
  });

  it('ignores edges whose endpoints are not on screen', () => {
    const l = createLayout(['a', 'b'], [{ from: 'a', to: 'ghost' }], { width: 300, height: 300 });
    run(l, 60);
    expect(l.nodes.every((n) => Number.isFinite(n.x))).toBe(true);
  });
});
