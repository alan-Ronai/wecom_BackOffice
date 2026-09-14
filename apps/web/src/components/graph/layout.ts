/**
 * A small Fruchterman–Reingold force layout, written here on purpose.
 *
 * The platform runs on an air-gapped LAN VM, so a CDN graph library (d3-force and friends) is not
 * an option, and vendoring one for a single screen is a lot of surface for ~60 lines of physics.
 * The classic FR model is: every pair of nodes repels with `k²/d`, every edge attracts with
 * `d²/k`, and a "temperature" caps how far a node may move per step, cooling to zero so the
 * layout settles instead of jittering forever.
 *
 * `step()` is one iteration and does no I/O, so the caller decides the cadence: `DataGraph` runs a
 * synchronous warm-up (deterministic first paint, and deterministic in tests) and then hands the
 * remaining iterations to `requestAnimationFrame`.
 */

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutOptions {
  width: number;
  height: number;
  /** Iterations before the temperature reaches zero. */
  iterations?: number;
  /** Pinned at the centre and never moved — the focused node, when there is one. */
  anchor?: string;
}

export interface Layout {
  nodes: LayoutNode[];
  /** Advances the simulation by one iteration. Returns false once it has cooled. */
  step: () => boolean;
  /** How much heat is left, 1 → 0. */
  alpha: () => number;
}

/**
 * Deterministic seeding. `Math.random()` would give a different picture on every render (and an
 * untestable one), so positions start on a golden-angle spiral keyed by index: no two nodes share
 * a position — which would make the repulsion force explode — and the same graph always lays out
 * the same way.
 */
const seed = (i: number, n: number, w: number, h: number): { x: number; y: number } => {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const r = (Math.min(w, h) / 2.4) * Math.sqrt((i + 0.5) / Math.max(1, n));
  return { x: w / 2 + r * Math.cos(i * golden), y: h / 2 + r * Math.sin(i * golden) };
};

export function createLayout(
  ids: string[],
  edges: LayoutEdge[],
  { width, height, iterations = 260, anchor }: LayoutOptions,
): Layout {
  const nodes: LayoutNode[] = ids.map((id, i) => ({ id, ...seed(i, ids.length, width, height) }));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  // Only edges whose both ends are on screen can pull on anything.
  const links = edges
    .map((e) => ({ a: index.get(e.from), b: index.get(e.to) }))
    .filter((l): l is { a: number; b: number } => l.a !== undefined && l.b !== undefined && l.a !== l.b);

  const area = width * height;
  const k = Math.sqrt(area / Math.max(1, nodes.length)) * 0.75;
  let temp = Math.min(width, height) / 6;
  const cooling = temp / (iterations + 1);
  const dx = new Float64Array(nodes.length);
  const dy = new Float64Array(nodes.length);

  const anchorIndex = anchor !== undefined ? index.get(anchor) : undefined;
  if (anchorIndex !== undefined) {
    nodes[anchorIndex].x = width / 2;
    nodes[anchorIndex].y = height / 2;
  }

  const step = (): boolean => {
    if (temp <= 0) return false;
    dx.fill(0);
    dy.fill(0);

    // Repulsion, every pair once.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let ex = nodes[i].x - nodes[j].x;
        let ey = nodes[i].y - nodes[j].y;
        let d = Math.hypot(ex, ey);
        if (d < 0.01) {
          // Coincident nodes have no direction to push along; nudge them apart deterministically.
          ex = ((i % 7) - 3) / 10 || 0.1;
          ey = ((j % 7) - 3) / 10 || 0.1;
          d = Math.hypot(ex, ey);
        }
        const f = (k * k) / d / d;
        dx[i] += ex * f;
        dy[i] += ey * f;
        dx[j] -= ex * f;
        dy[j] -= ey * f;
      }
    }

    // Attraction along edges.
    for (const { a, b } of links) {
      const ex = nodes[a].x - nodes[b].x;
      const ey = nodes[a].y - nodes[b].y;
      const d = Math.max(0.01, Math.hypot(ex, ey));
      const f = d / k;
      dx[a] -= ex * f;
      dy[a] -= ey * f;
      dx[b] += ex * f;
      dy[b] += ey * f;
    }

    // Gravity, so disconnected components drift back instead of off-canvas.
    for (let i = 0; i < nodes.length; i++) {
      dx[i] += (width / 2 - nodes[i].x) * 0.012;
      dy[i] += (height / 2 - nodes[i].y) * 0.012;
    }

    const pad = 24;
    for (let i = 0; i < nodes.length; i++) {
      if (i === anchorIndex) continue;
      const d = Math.max(0.01, Math.hypot(dx[i], dy[i]));
      const capped = Math.min(d, temp);
      nodes[i].x = Math.min(width - pad, Math.max(pad, nodes[i].x + (dx[i] / d) * capped));
      nodes[i].y = Math.min(height - pad, Math.max(pad, nodes[i].y + (dy[i] / d) * capped));
    }

    temp = Math.max(0, temp - cooling);
    return temp > 0;
  };

  return { nodes, step, alpha: () => temp / (Math.min(width, height) / 6) };
}
