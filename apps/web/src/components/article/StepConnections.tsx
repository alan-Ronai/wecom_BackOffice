import { useNavigate } from 'react-router-dom';
import type { Document } from '@wecom/shared';
import { crmChip, crmIn, stepText, stripFmt } from '@wecom/shared';
import { useBlockUsage } from '../../api/hooks/content.js';
import { useSources } from '../../api/hooks/pipeline.js';
import { Html } from '../Fmt.js';
import type { ResolvedStep } from '../../lib/steps.js';
import type { FieldInfo } from '../../lib/format.js';

/** Port of legacy KB.stepConnections: shared block, CRM fields, dependencies and the source §. */
export function StepConnections({
  doc,
  step,
  steps,
  fields,
  onOpenStep,
}: {
  doc: Document;
  step: ResolvedStep;
  steps: ResolvedStep[];
  fields: FieldInfo[];
  onOpenStep: (key: string) => void;
}) {
  const go = useNavigate();
  const usage = useBlockUsage(step.blockId);
  const sources = useSources();
  const sameBlock = (usage.data ?? []).filter((u) => u.documentId !== doc.id);
  const crm = crmIn(
    stepText(step, step.block),
    fields.map((f) => f.name),
  );
  const deps = step.deps.map((k) => steps.find((s) => s.key === k)).filter(Boolean) as ResolvedStep[];
  const i = steps.findIndex((s) => s.key === step.key);
  const prevNext = [
    i > 0 ? `קודם ${steps[i - 1].num}` : null,
    i >= 0 && i < steps.length - 1 ? `הבא ${steps[i + 1].num}` : null,
  ].filter(Boolean);
  const src = sources.data?.find((s) => s.id === doc.sourceId);

  return (
    <div className="conn">
      <div className="eyebrow">קשרים של השלב</div>
      <div className="grid4">
        <div className="c">
          <span className="k">⧉ אותו בלוק ב־</span>
          <span className="v">
            {sameBlock.length
              ? sameBlock.slice(0, 3).map((u, n) => (
                  <span key={u.documentId}>
                    {n ? ' · ' : ''}
                    <a className="doc-link" data-doc={u.documentId}>
                      {u.title}
                    </a>
                  </span>
                ))
              : step.blockId
                ? 'רק במסמך זה'
                : '—'}
          </span>
        </div>
        <div className="c">
          <span className="k">▦ שדות CRM</span>
          <span className="v">
            {crm.length ? (
              <Html
                html={crm
                  .map((n) => crmChip(fields.find((f) => f.name === n) ?? { name: n, status: 'unknown' }))
                  .join(' ')}
              />
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="c">
          <span className="k">↳ תלוי ב־</span>
          <span className="v">
            {deps.length
              ? deps.map((d, n) => (
                  <span key={d.key}>
                    {n ? ' · ' : ''}
                    <a
                      className="doc-link"
                      data-nopeek=""
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenStep(d.key)}
                    >
                      שלב {d.num} {stripFmt(d.title)}
                    </a>
                  </span>
                ))
              : '—'}
            {prevNext.length ? <div className="small muted">{prevNext.join(' · ')}</div> : null}
          </span>
        </div>
        <div
          className="c"
          style={src ? { cursor: 'pointer' } : undefined}
          role={src ? 'button' : undefined}
          tabIndex={src ? 0 : undefined}
          onClick={src ? () => go(`/sources/${src.id}`) : undefined}
        >
          <span className="k">§ מקור</span>
          <span className="v">
            {src
              ? `${src.title} ${step.sourceRef ?? doc.sourceRef ?? ''} · ${
                  src.syncState === 'pending' ? 'שינויים ממתינים' : 'מסונכרן'
                }`
              : 'נכתב ישירות בספרייה'}
          </span>
        </div>
      </div>
    </div>
  );
}
