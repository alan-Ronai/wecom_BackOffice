import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Phase, Step } from '@wecom/shared';
import { useConflict, useResolveConflict } from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import type { ConflictView } from '../../api/stage5.js';
import { fmtDate, fmtTime } from '../../lib/format.js';
import { useToast } from '../ui/Toast.js';
import { Chip, LoadError } from '../ui/index.js';
import { StateChip } from './state.js';

type Side = 'ours' | 'theirs';

interface MergeRow {
  ref: string;
  heading: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  /** Both sides moved off the base — the only rows that genuinely need a human. */
  contested: boolean;
}

const stepsOf = (phases: Phase[] | null): Step[] => (phases ?? []).flatMap((p) => p.steps);
const refOf = (s: Step) => s.sourceRef ?? s.key;
const textOf = (s: Step) => s.description ?? '';

/**
 * Pairs the two sides up by the reference each paragraph carries (`§8`, and `step.sourceRef` on
 * our side), which is the only stable identity across a round trip through WordPress — positions
 * and keys do not survive it.
 */
function buildRows(c: ConflictView): MergeRow[] {
  const base = new Map(stepsOf(c.base.phases).map((s) => [refOf(s), textOf(s)]));
  const theirs = new Map(c.theirs.paragraphs.map((p) => [p.ref, p]));
  const rows: MergeRow[] = [];
  const seen = new Set<string>();

  for (const s of stepsOf(c.ours.phases)) {
    const ref = refOf(s);
    seen.add(ref);
    const t = theirs.get(ref);
    const b = base.get(ref) ?? null;
    const ourText = textOf(s);
    rows.push({
      ref,
      heading: s.title || t?.heading || ref,
      base: b,
      ours: ourText,
      theirs: t?.text ?? null,
      contested: !!t && b !== null && t.text !== b && ourText !== b && t.text !== ourText,
    });
  }
  // Paragraphs that exist only on their side: added in WordPress since the split.
  for (const p of c.theirs.paragraphs) {
    if (seen.has(p.ref)) continue;
    rows.push({
      ref: p.ref,
      heading: p.heading ?? p.ref,
      base: base.get(p.ref) ?? null,
      ours: null,
      theirs: p.text,
      contested: false,
    });
  }
  return rows;
}

/**
 * The default for each row, so the operator only has to touch what is genuinely in dispute:
 * whichever side moved off the base wins uncontested, and a row both sides edited starts on ours
 * (never silently overwritten) and is flagged.
 */
const defaultChoice = (r: MergeRow): Side => {
  if (r.ours === null) return 'ours'; // "ours" here means "do not import this new paragraph"
  if (r.theirs === null || r.theirs === r.ours) return 'ours';
  if (r.ours === r.base) return 'theirs';
  return 'ours';
};

/** Rebuilds our phases with the chosen text, which is what `resolution: 'merged'` sends. */
function mergedPhases(c: ConflictView, rows: MergeRow[], choice: Record<string, Side>): Phase[] {
  const byRef = new Map(rows.map((r) => [r.ref, r]));
  const phases: Phase[] = c.ours.phases.map((p) => ({
    ...p,
    steps: p.steps.map((s) => {
      const ref = refOf(s);
      const r = byRef.get(ref);
      if (!r || choice[ref] !== 'theirs' || r.theirs === null) return s;
      return { ...s, description: r.theirs };
    }),
  }));
  const added = rows.filter((r) => r.ours === null && choice[r.ref] === 'theirs');
  if (added.length) {
    const last = phases[phases.length - 1];
    const steps = [
      ...last.steps,
      ...added.map((r, i): Step => ({
        key: `imported-${r.ref.replace(/\W+/g, '')}`,
        num: String(last.steps.length + i + 1),
        title: r.heading,
        description: r.theirs ?? '',
        sourceRef: r.ref,
        blockRefs: [],
        deps: [],
        actions: [],
        outcomes: [],
      })),
    ];
    phases[phases.length - 1] = { ...last, steps };
  }
  return phases;
}

export function ConflictPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const can = useCan();
  const conflict = useConflict(id);
  const resolve = useResolveConflict();
  const [choice, setChoice] = useState<Record<string, Side>>({});

  const rows = useMemo(() => (conflict.data ? buildRows(conflict.data) : []), [conflict.data]);
  const pick = (r: MergeRow): Side => choice[r.ref] ?? defaultChoice(r);
  const contested = rows.filter((r) => r.contested);

  if (!can('suggestions.apply'))
    return (
      <div className="empty">
        <b>אין הרשאה לפתור קונפליקטים</b>
        נדרשת ההרשאה suggestions.apply
      </div>
    );
  if (conflict.isError) return <LoadError what="הקונפליקט" error={conflict.error} />;
  if (!conflict.data) return <div className="route-loading">טוען…</div>;
  const c = conflict.data;

  const submit = async (resolution: 'ours' | 'theirs' | 'merged') => {
    try {
      await resolve.mutateAsync({
        id: c.link.id,
        resolution,
        ...(resolution === 'merged' ? { merged: { phases: mergedPhases(c, rows, choice) } } : {}),
        label: `פתרון קונפליקט סנכרון · ${c.link.connectorName}`,
      });
      toast('הקונפליקט נפתר', 'ok');
      nav('/sync');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'הפתרון נכשל', 'warn');
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          <button className="linkish" onClick={() => nav('/sync')}>
            תור סנכרון
          </button>
          {' / '}
          <b>{c.link.title}</b>
          <StateChip state={c.link.state} />
        </div>
        <div className="facets" style={{ marginInlineStart: 'auto' }}>
          <button className="btn sm" disabled={resolve.isPending} onClick={() => void submit('theirs')}>
            קח הכל מ-{c.link.connectorName}
          </button>
          <button className="btn sm" disabled={resolve.isPending} onClick={() => void submit('ours')}>
            שמור את שלנו
          </button>
          <button
            className="btn primary sm"
            disabled={resolve.isPending}
            onClick={() => void submit('merged')}
          >
            שמור מיזוג
          </button>
        </div>
      </div>

      <div className="scroll-area">
        <div className="lib-body">
          <p className="small muted">
            שני הצדדים השתנו מאז הסנכרון האחרון (
            {c.link.lastSyncedAt
              ? `${fmtDate(c.link.lastSyncedAt)} ${fmtTime(c.link.lastSyncedAt)}`
              : 'מעולם לא'}
            ) · בסיס v{c.base.version ?? '—'} · אצלנו v{c.ours.version} · גיבוב מרוחק{' '}
            <bdi className="lat" dir="ltr">
              {c.theirs.hash}
            </bdi>
            {contested.length ? ` · ${contested.length} פסקאות בהתנגשות` : ' · אין פסקה בהתנגשות'}
          </p>

          <div className="merge-head">
            <span className="eyebrow">בסיס</span>
            <span className="eyebrow">{c.link.connectorName}</span>
            <span className="eyebrow cur">הספרייה</span>
          </div>

          {rows.map((r) => {
            const side = pick(r);
            return (
              <section key={r.ref} className={'merge-row' + (r.contested ? ' contested' : '')}>
                <div className="merge-ref">
                  <bdi className="lat" dir="ltr">
                    {r.ref}
                  </bdi>{' '}
                  {r.heading}
                  {r.contested ? <Chip tone="chip-red">שני הצדדים השתנו</Chip> : null}
                  {r.ours === null ? <Chip tone="chip-blue">נוסף במקור</Chip> : null}
                  {r.theirs === null ? <Chip tone="chip-gray">רק אצלנו</Chip> : null}
                </div>
                <div className="merge-cols">
                  <div className="merge-col base">{r.base ?? <span className="muted">—</span>}</div>
                  <div className={'merge-col' + (side === 'theirs' ? ' chosen' : '')}>
                    {r.theirs ?? <span className="muted">—</span>}
                    {r.theirs !== null && r.theirs !== r.ours ? (
                      <button
                        className="btn xs"
                        aria-label={`קח מ-${c.link.connectorName} · ${r.ref}`}
                        aria-pressed={side === 'theirs'}
                        onClick={() => setChoice((s) => ({ ...s, [r.ref]: 'theirs' }))}
                      >
                        {r.ours === null ? 'ייבא פסקה' : `קח מ-${c.link.connectorName}`}
                      </button>
                    ) : null}
                  </div>
                  <div className={'merge-col' + (side === 'ours' ? ' chosen' : '')}>
                    {r.ours ?? <span className="muted">לא קיים אצלנו</span>}
                    {r.theirs !== null && r.theirs !== r.ours ? (
                      <button
                        className="btn xs"
                        aria-label={`השאר את שלנו · ${r.ref}`}
                        aria-pressed={side === 'ours'}
                        onClick={() => setChoice((s) => ({ ...s, [r.ref]: 'ours' }))}
                      >
                        {r.ours === null ? 'אל תייבא' : 'השאר את שלנו'}
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
