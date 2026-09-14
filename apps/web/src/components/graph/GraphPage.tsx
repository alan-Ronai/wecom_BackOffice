import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGraph, useImpact } from '../../api/hooks/stage4.js';
import type { GraphNode, GraphResponse } from '../../api/stage4.js';
import { CATS, LINK_TYPES, LINK_TYPE_LABEL, NODE_KINDS, NODE_KIND_KEYS } from '../../lib/constants.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { LoadError } from '../ui/index.js';
import { ImpactPanel } from './ImpactPanel.js';
import { createLayout, type LayoutNode } from './layout.js';

const W = 1000;
const H = 640;
/** Enough iterations that the first paint is already readable, cheap enough to run inline. */
const WARMUP = 160;

const colourOf = (n: GraphNode): string =>
  n.kind === 'document' && n.category ? CATS[n.category].color : NODE_KINDS[n.kind].color;

const radiusOf = (n: GraphNode): number => Math.min(20, 8 + Math.sqrt(n.degree) * 2.6);

/**
 * `/graph` — the relationship graph (design card 5b).
 *
 * Rendered as plain SVG over a force layout written in `layout.ts`: the VM has no internet, so a
 * graph library from a CDN is not available, and the physics that makes this screen legible is
 * ~60 lines. Focus lives in the querystring (`?focus=doc:<id>&depth=2`) so a particular view of
 * the graph is a link someone can paste into a ticket.
 */
export function GraphPage() {
  const [params, setParams] = useSearchParams();
  const focus = params.get('focus') ?? undefined;
  const depth = Number(params.get('depth') ?? 2);
  const types = useMemo(() => (params.get('types') ?? '').split(',').filter(Boolean), [params]);

  const graph = useGraph({
    focus,
    depth,
    ...(types.length ? { types: types.join(',') } : {}),
  });
  const [selected, setSelected] = useState<string | undefined>(focus);
  const impact = useImpact(selected);

  // A focus change comes from the URL (a link, the back button), so the selection follows it.
  useEffect(() => setSelected(focus), [focus]);

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const data: GraphResponse = graph.data ?? { nodes: [], edges: [], truncated: false };
  const counts = NODE_KIND_KEYS.map(
    (k) => [k, data.nodes.filter((n) => n.kind === k).length] as [string, number],
  );
  const selectedNode = data.nodes.find((n) => n.id === selected);

  return (
    <>
      <div className="topbar h56">
        <Hamburger />
        <div className="crumb">
          <b>גרף קשרים</b>
        </div>
        {counts.map(([kind, n]) => (
          <span className="chip chip-gray" key={kind}>
            {NODE_KINDS[kind].plural} {n}
          </span>
        ))}
        <div className="actions">
          {focus ? (
            <button className="btn sm" onClick={() => setParam('focus', undefined)}>
              נקה מיקוד
            </button>
          ) : null}
          <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            עומק
            <select
              aria-label="עומק המיקוד"
              value={String(depth)}
              onChange={(e) => setParam('depth', e.target.value)}
            >
              {[1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="viewbar graph-bar">
        <span>סוג קשר:</span>
        {LINK_TYPES.map(([value, label]) => {
          const on = !types.length || types.includes(value);
          return (
            <span
              key={value}
              className={'facet' + (on ? ' on' : '')}
              style={{ padding: '3px 9px', fontSize: 11.5 }}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              onClick={() => {
                const base = types.length ? types : LINK_TYPES.map(([v]) => v);
                const next = base.includes(value) ? base.filter((t) => t !== value) : [...base, value];
                setParam(
                  'types',
                  next.length && next.length < LINK_TYPES.length ? next.join(',') : undefined,
                );
              }}
            >
              <i className={'gedge-key t-' + value} />
              {label}
            </span>
          );
        })}
        <span className="legend">
          {NODE_KIND_KEYS.map((k) => (
            <span key={k}>
              <i style={{ background: NODE_KINDS[k].color, borderRadius: '50%' }} />
              {NODE_KINDS[k].plural}
            </span>
          ))}
        </span>
      </div>

      <div className="graph-layout">
        <div className="graph-canvas">
          {graph.isError ? (
            <LoadError what="גרף הקשרים" error={graph.error} />
          ) : !data.nodes.length ? (
            <div className="empty">
              <b>{graph.isPending ? 'טוען את הגרף…' : 'אין קשרים להצגה'}</b>
              {graph.isPending ? null : 'נסו לנקות את המיקוד או את מסנני סוג הקשר'}
            </div>
          ) : (
            <GraphCanvas
              data={data}
              focus={focus}
              selected={selected}
              onSelect={setSelected}
              onFocus={(id) => setParam('focus', id)}
            />
          )}
          {data.truncated ? (
            <div className="small muted graph-truncated">
              הגרף נחתך — מקדו על צומת כדי לראות את כל הקשרים שלו.
            </div>
          ) : null}
        </div>

        <ImpactPanel
          node={selectedNode}
          impact={impact.data}
          loading={impact.isPending && !!selected}
          error={impact.isError ? impact.error : undefined}
          onFocus={() => selected && setParam('focus', selected)}
        />
      </div>
    </>
  );
}

function GraphCanvas({
  data,
  focus,
  selected,
  onSelect,
  onFocus,
}: {
  data: GraphResponse;
  focus?: string;
  selected?: string;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  // Keyed by the node set, so selecting a node does not re-run the physics but a new subgraph does.
  const signature = data.nodes.map((n) => n.id).join('|') + '#' + data.edges.length + '#' + (focus ?? '');
  const nodeIds = data.nodes.map((n) => n.id);
  const edges = data.edges;
  const layout = useMemo(
    () => {
      const l = createLayout(nodeIds, edges, { width: W, height: H, anchor: focus });
      for (let i = 0; i < WARMUP; i++) if (!l.step()) break;
      return l;
    },
    // `signature` *is* the identity of the subgraph; `nodeIds`/`edges` are fresh arrays every
    // render and would re-run the physics (and restart the animation) on every unrelated state change.
    [signature],
  );

  const [positions, setPositions] = useState<LayoutNode[]>(() => layout.nodes.map((n) => ({ ...n })));
  const raf = useRef<number | null>(null);

  /**
   * The warm-up above already produced a readable layout; the remaining iterations are animated so
   * the graph visibly settles rather than snapping. `requestAnimationFrame` is cancelled on unmount
   * and whenever the subgraph changes, so a stale simulation can never keep painting.
   */
  useEffect(() => {
    setPositions(layout.nodes.map((n) => ({ ...n })));
    if (typeof requestAnimationFrame !== 'function') return;
    const tick = () => {
      const alive = layout.step();
      setPositions(layout.nodes.map((n) => ({ ...n })));
      raf.current = alive ? requestAnimationFrame(tick) : null;
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [layout]);

  const at = new Map(positions.map((p) => [p.id, p]));

  return (
    /*
      `role="group"`, not `role="img"`. An image is an opaque leaf — AT is told there is nothing
      inside worth visiting — and every node in here is a `role="button" tabIndex={0}` that a
      keyboard user is expected to reach. Declaring both says two contradictory things about the
      same subtree, and the one that wins is the one that hides the interactive half.
    */
    <svg
      className="graph-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label={`גרף קשרים · ${data.nodes.length} צמתים · ${data.edges.length} קשרים`}
      data-testid="graph-svg"
    >
      <g className="gedges">
        {data.edges.map((e, i) => {
          const a = at.get(e.from);
          const b = at.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={`${e.from}->${e.to}:${e.type}:${i}`}
              className={'gedge t-' + e.type + (e.origin === 'detected' ? ' detected' : '')}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              data-type={e.type}
            >
              <title>
                {LINK_TYPE_LABEL[e.type]}
                {e.fromStepKey ? ` · שלב ${e.fromStepKey}` : ''}
              </title>
            </line>
          );
        })}
      </g>
      <g className="gnodes">
        {data.nodes.map((n) => {
          const p = at.get(n.id);
          if (!p) return null;
          const r = radiusOf(n);
          const docId = n.kind === 'document' ? n.id.slice('doc:'.length) : undefined;
          return (
            <g
              key={n.id}
              className={
                'gnode kind-' + n.kind + (selected === n.id ? ' sel' : '') + (focus === n.id ? ' focus' : '')
              }
              transform={`translate(${p.x} ${p.y})`}
              role="button"
              tabIndex={0}
              // `Peek` delegates hover previews off `[data-doc]` anywhere in the app, so a document
              // node gets the same card preview as a document link, for free.
              data-doc={docId}
              data-node={n.id}
              aria-label={`${NODE_KINDS[n.kind].label}: ${n.label}`}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) onFocus(n.id);
                else onSelect(n.id);
              }}
              onDoubleClick={() => onFocus(n.id)}
            >
              <circle r={r} style={{ fill: colourOf(n) }} />
              {n.status === 'renamed' || n.status === 'draft' ? (
                <circle className="flag" r={4} cx={-r} />
              ) : null}
              <text className="glabel" y={r + 13}>
                {n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label}
              </text>
              <title>{`${NODE_KINDS[n.kind].icon} ${n.label} · ${n.degree} קשרים`}</title>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
