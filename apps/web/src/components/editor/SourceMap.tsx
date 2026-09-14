import { useMemo } from 'react';
import type { Document } from '@wecom/shared';
import { useRevision } from '../../api/hooks/pipeline.js';
import { allSteps } from '../../lib/steps.js';
import { LoadError } from '../ui/index.js';

const runText = (runs: { t: string }[]) => runs.map((r) => r.t).join('');

/**
 * Card 6c's "מיפוי מקור ↔ שלבים".
 *
 * A document derived from a Word procedure carries `sourceRef` (`§4.8`) on each step; the source
 * revision carries the paragraphs with the same refs. This panel puts them side by side and makes
 * the gap visible, because that gap has a consequence the editor cannot otherwise show: **a
 * paragraph nobody mapped never produces a suggestion** when the source changes. A procedure can
 * be updated upstream and the knowledge item silently never hear about it.
 *
 * Clicking a paragraph assigns its ref to the selected step, which is the whole repair.
 */
export function SourceMap({
  doc,
  selectedKey,
  onAssignRef,
  onSelectStep,
}: {
  doc: Document;
  selectedKey: string | null;
  onAssignRef: (stepKey: string, ref: string) => void;
  onSelectStep: (key: string) => void;
}) {
  const revision = useRevision(doc.sourceId ?? undefined, 'latest');
  const steps = useMemo(() => allSteps(doc), [doc]);

  const byRef = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of steps) {
      if (!s.sourceRef) continue;
      m.set(s.sourceRef, [...(m.get(s.sourceRef) ?? []), s.key]);
    }
    return m;
  }, [steps]);

  if (!doc.sourceId)
    return (
      <div className="empty">
        <b>המסמך לא נגזר ממסמך מקור</b>
        מיפוי פסקאות זמין רק לפריטים שיובאו מ-Word
      </div>
    );
  if (revision.isError) return <LoadError what="מסמך המקור" error={revision.error} />;

  const paragraphs = (revision.data?.paragraphs ?? []).filter((p) => runText(p.runs).trim());
  const mapped = paragraphs.filter((p) => byRef.has(p.ref)).length;

  return (
    <div className="source-map" data-testid="source-map">
      <div className="sm-cols">
        <div className="sm-col">
          <div className="eyebrow">פסקאות המקור</div>
          {paragraphs.map((p) => {
            const hit = byRef.get(p.ref);
            return (
              <button
                key={p.ref}
                className={'sm-row' + (hit ? ' mapped' : '')}
                aria-label={`פסקה ${p.ref}${hit ? ' · ממופה' : ' · לא ממופה'}`}
                disabled={!selectedKey}
                title={selectedKey ? 'שייך לשלב הנבחר' : 'בחרו שלב כדי לשייך'}
                onClick={() => selectedKey && onAssignRef(selectedKey, p.ref)}
              >
                <bdi className="lat" dir="ltr">
                  {p.ref}
                </bdi>
                <span className="tx">{p.heading ?? runText(p.runs).slice(0, 60)}</span>
                {hit ? <span className="chip chip-green">✓</span> : null}
              </button>
            );
          })}
        </div>

        <div className="sm-col">
          <div className="eyebrow">שלבים</div>
          {steps.map((s) => (
            <button
              key={s.key}
              className={'sm-row' + (s.sourceRef ? ' mapped' : '') + (s.key === selectedKey ? ' on' : '')}
              aria-label={`שלב ${s.num} · ${s.sourceRef ? 'ממופה ל-' + s.sourceRef : 'לא ממופה'}`}
              onClick={() => onSelectStep(s.key)}
            >
              <span className="num">{s.num}</span>
              <span className="tx">{s.title || '—'}</span>
              {s.sourceRef ? (
                <bdi className="lat chip chip-green" dir="ltr">
                  {s.sourceRef}
                </bdi>
              ) : (
                <span className="chip chip-amber">לא ממופה</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="sm-foot">
        {mapped} מתוך {paragraphs.length} פסקאות ממופות · פסקה לא ממופה לא תיצור הצעה אוטומטית
      </div>
    </div>
  );
}
