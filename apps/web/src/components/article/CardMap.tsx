import type { Document } from '@wecom/shared';
import type { ResolvedStep } from '../../lib/steps.js';

/** Port of the legacy "מפת הכרטיס" card. */
export function CardMap({
  doc,
  steps,
  activeKey,
  results,
  linksIn,
  linksOut,
  onSelect,
}: {
  doc: Document;
  steps: ResolvedStep[];
  activeKey: string | null;
  results: Record<string, unknown>;
  linksIn: number;
  linksOut: number;
  onSelect: (key: string) => void;
}) {
  const active = steps.find((s) => s.key === activeKey);
  const last = steps[steps.length - 1];
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        מפת הכרטיס
      </div>
      <div className="map">
        {doc.phases.map((p) => {
          if (!p.steps.length) return null;
          const nums = p.steps.map((s) => s.num);
          const rng = nums.length > 1 ? `${nums[0]}–${nums[nums.length - 1]}` : nums[0];
          const allDone = p.steps.every((s) => results[s.key]);
          const here = active?.phase.id === p.id;
          return (
            <div
              key={p.id}
              className={(p.route ? 'in' : '') + (here ? ' here' : '')}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(p.steps[0].key)}
            >
              <span className={'d' + (allDone ? ' done' : here ? ' cur' : '')} />
              {(p.label || 'שלבים') + ' · ' + rng}
              {here ? <span className="here-tag">כאן</span> : null}
            </div>
          );
        })}
        {last?.outcomes.some((o) => o.kind === 'alert') ? (
          <div>
            <span className="d" />
            הסלמה · מומחי תמיכה
          </div>
        ) : null}
      </div>
      <div className="map-foot">
        <span>נכנס מ־: {linksIn} כרטיסים</span>
        <span>יוצא ל־: {linksOut}</span>
      </div>
    </div>
  );
}
