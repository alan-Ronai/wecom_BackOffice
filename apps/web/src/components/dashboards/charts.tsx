/**
 * The two chart marks the dashboards need, written by hand.
 *
 * No chart library: the VM is offline, and these are a stacked ring and a horizontal bar list —
 * a dependency for that is more code to audit than the marks themselves. Both are inline SVG, so
 * every colour is a CSS custom property and light/dark follow the app theme for free.
 *
 * Accessibility: the SVG is `role="img"` with an `aria-label` that states the whole series in
 * words, because a screen reader cannot read a shape. Each series *also* renders as a real
 * text legend/row next to the mark, so the numbers are never colour-only.
 */

export interface Slice {
  label: string;
  value: number;
  /** Any CSS colour; the tiles pass tokens (`var(--ok)`) so both themes are handled. */
  color: string;
}

const sum = (slices: Slice[]): number => slices.reduce((t, s) => t + s.value, 0);
const pct = (v: number, total: number): number => (total > 0 ? Math.round((v / total) * 100) : 0);

/**
 * A donut: one arc per slice, drawn with `stroke-dasharray` on a circle so no path maths is
 * needed and the stroke width is the ring thickness.
 */
export function Donut({
  slices,
  center,
  caption,
  size = 108,
}: {
  slices: Slice[];
  center: string;
  caption: string;
  size?: number;
}) {
  const total = sum(slices);
  const r = size / 2 - 9;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="chart-donut">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={`${caption}: ${slices.map((s) => `${s.label} ${s.value}`).join(', ')}`}
      >
        <circle cx={size / 2} cy={size / 2} r={r} className="donut-track" />
        {slices.map((s) => {
          const len = total > 0 ? (s.value / total) * circumference : 0;
          const dash = `${len} ${circumference - len}`;
          const el = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              className="donut-arc"
              style={{ stroke: s.color }}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
        <text className="donut-center" x={size / 2} y={size / 2 + 6} textAnchor="middle">
          {center}
        </text>
      </svg>
      <ul className="chart-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} aria-hidden="true" />
            <span>{s.label}</span>
            <b>{s.value}</b>
            <span className="small muted">{pct(s.value, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface Bar {
  label: string;
  value: number;
  /** Denominator for "13/18"-style rows; defaults to the largest value in the series. */
  of?: number;
  color?: string;
  onClick?: () => void;
}

/**
 * Horizontal bars. Rendered as a list of rows rather than one big SVG so each row keeps its own
 * text, stays selectable, and can be a button when it drills into a list.
 */
export function BarList({
  bars,
  caption,
  suffix,
}: {
  bars: Bar[];
  caption: string;
  /** Rendered after each value, e.g. `%`. */
  suffix?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.of ?? b.value));
  return (
    <div
      className="chart-bars"
      role="img"
      aria-label={`${caption}: ${bars.map((b) => `${b.label} ${b.value}${suffix ?? ''}`).join(', ')}`}
    >
      {bars.map((b) => {
        const denominator = b.of ?? max;
        const width = Math.min(100, Math.round((b.value / Math.max(1, denominator)) * 100));
        const Row = b.onClick ? 'button' : 'div';
        return (
          <Row
            key={b.label}
            className="bar-row"
            {...(b.onClick ? { type: 'button' as const, onClick: b.onClick } : {})}
          >
            <span className="bar-label">{b.label}</span>
            <span className="bar-track" aria-hidden="true">
              <i style={{ width: `${width}%`, background: b.color ?? 'var(--red)' }} />
            </span>
            <span className="bar-value">
              {b.value}
              {suffix ?? ''}
              {b.of !== undefined ? <span className="muted">/{b.of}</span> : null}
            </span>
          </Row>
        );
      })}
      {!bars.length ? <div className="small muted">אין נתונים</div> : null}
    </div>
  );
}

/** A single big number with a caption — the unit every tile leads with. */
export function Stat({ value, label, tone }: { value: number | string; label: string; tone?: string }) {
  return (
    <div className={'stat' + (tone ? ' ' + tone : '')}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
