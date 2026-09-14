import { Link, useSearchParams } from 'react-router-dom';
import type { Gap } from '@wecom/shared';
import { useDetectGaps, useDismissGap, useGaps, useResolveGap } from '../../api/hooks/gaps.js';
import { useCan } from '../../api/hooks/me.js';
import { useWorlds } from '../../api/hooks/taxonomy.js';
import { ago } from '../../lib/format.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { worldLabel } from '../taxonomy/TypeBadge.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { Chip, Empty, LoadError } from '../ui/index.js';
import { DocumentPicker } from '../learning/manage/DocumentPicker.js';

export const GAP_KIND_LABEL: Record<Gap['kind'], string> = {
  zero_results: 'חיפושים ללא תוצאה',
  feedback_cluster: 'ריבוי משובים',
  stale_high_traffic: 'פריט נצפה שלא עודכן',
  topic_without_procedure: 'נושא ללא מסלול טיפול',
  failed_question: 'שאלה שנכשלת',
};

const ACTION_LABEL: Record<Gap['suggestedAction'], string> = {
  create: 'צור פריט',
  update: 'עדכן פריט',
  add_question: 'הוסף שאלה',
  review: 'בדוק',
};

const STATUS_LABEL: Record<Gap['status'], string> = {
  open: 'פתוחים',
  dismissed: 'נדחו',
  resolved: 'טופלו',
};

/** Spec §1.7 / §5: ranked heuristics with their evidence — the loop the PRD §13 asks for. */
export function GapsPage() {
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const kind = (sp.get('kind') as Gap['kind'] | null) ?? undefined;
  const status = (sp.get('status') as Gap['status'] | null) ?? 'open';
  const world = sp.get('world') ?? undefined;
  const mayRead = can('gaps.read');
  const mayManage = can('gaps.manage');
  const gaps = useGaps({ kind, status, world }, mayRead);
  const worlds = useWorlds();
  const dismiss = useDismissGap();
  const resolve = useResolveGap();
  const detect = useDetectGaps();

  if (!mayRead)
    return (
      <div className="page">
        <Empty title="אין הרשאה לצפייה בפערי ידע">המסך מיועד לעורכי תוכן.</Empty>
      </div>
    );

  const set = (k: string, v?: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };

  const doDismiss = async (g: Gap) => {
    const reason = await modal.prompt('דחיית פער', 'סיבה');
    if (!reason?.trim()) return;
    try {
      await dismiss.mutateAsync({ id: g.id, reason: reason.trim() });
    } catch {
      toast('הדחייה נכשלה', 'warn');
    }
  };

  const doResolve = (g: Gap) => {
    const dispose = modal.open({
      title: 'סימון כטופל',
      body: (
        <DocumentPicker
          label="הפריט שסוגר את הפער"
          onPick={(d) => {
            dispose();
            void resolve
              .mutateAsync({ id: g.id, documentId: d.id })
              .then(() => toast('הפער סומן כטופל', 'ok'))
              .catch(() => toast('הפעולה נכשלה', 'warn'));
          }}
        />
      ),
      buttons: [{ label: 'ביטול' }],
    });
  };

  /** "צור פריט" pre-fills the new draft's title from the term nobody found (`?title=`, wave 4 D-M6). */
  const actionHref = (g: Gap) =>
    g.suggestedAction === 'create'
      ? `/edit/new?title=${encodeURIComponent(g.key)}`
      : g.documentId
        ? `/edit/${g.documentId}`
        : g.topicId
          ? `/topic/${g.topicId}`
          : '/library';

  return (
    <div className="page gaps-page">
      <div className="topbar">
        <Hamburger />
        <h1>פערי ידע</h1>
        {gaps.data?.lastRunAt ? <small>זיהוי אחרון {ago(gaps.data.lastRunAt)}</small> : null}
        <span className="grow" />
        {mayManage ? (
          <button
            type="button"
            className="btn sm"
            disabled={detect.isPending}
            onClick={() =>
              void detect
                .mutateAsync()
                .then((r) => toast(`זוהו ${r.detected}, עודכנו ${r.updated}`, 'ok'))
                .catch(() => toast('הזיהוי נכשל', 'warn'))
            }
          >
            הרץ זיהוי עכשיו
          </button>
        ) : null}
      </div>
      <div className="facets" aria-label="סינון">
        {(['open', 'dismissed', 'resolved'] as Gap['status'][]).map((s) => (
          <button
            key={s}
            type="button"
            className={'facet' + (status === s ? ' on' : '')}
            onClick={() => set('status', s)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
        <span className="vsep" />
        <label className="small">
          סוג
          <select
            aria-label="סוג פער"
            value={kind ?? ''}
            onChange={(e) => set('kind', e.target.value || undefined)}
          >
            <option value="">הכל</option>
            {(Object.keys(GAP_KIND_LABEL) as Gap['kind'][]).map((k) => (
              <option key={k} value={k}>
                {GAP_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="small">
          עולם תוכן
          <select
            aria-label="עולם תוכן"
            value={world ?? ''}
            onChange={(e) => set('world', e.target.value || undefined)}
          >
            <option value="">הכל</option>
            {(worlds.data ?? []).map((w) => (
              <option key={w.slug} value={w.slug}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {gaps.isError ? <LoadError what="פערי ידע" error={gaps.error} /> : null}
      {gaps.data && !gaps.data.items.length ? (
        <Empty title="אין פערים ברשימה">הזיהוי רץ מדי לילה; אפשר להריץ ידנית.</Empty>
      ) : null}
      <div className="gap-list">
        {(gaps.data?.items ?? []).map((g) => (
          <article key={g.id} className="gap card">
            <div className="score" aria-label="ציון">
              {g.score.toFixed(1)}
            </div>
            <div>
              <div className="chips">
                <Chip>{GAP_KIND_LABEL[g.kind]}</Chip>
                {g.worldSlug ? <Chip>{worldLabel(g.worldSlug)}</Chip> : null}
                <small>נראה לראשונה {ago(g.firstSeenAt)}</small>
              </div>
              <h3>{g.title}</h3>
              <pre className="evidence">{JSON.stringify(g.evidence, null, 1)}</pre>
              {g.dismissedReason ? (
                <p>
                  <b>נדחה:</b> {g.dismissedReason}
                </p>
              ) : null}
              {g.resolvedDocumentId ? (
                <p>
                  <Link to={`/doc/${g.resolvedDocumentId}`}>הפריט שסגר את הפער</Link>
                </p>
              ) : null}
            </div>
            <div className="row-actions">
              <Link className="btn sm primary" to={actionHref(g)}>
                {ACTION_LABEL[g.suggestedAction]}
              </Link>
              {mayManage && g.status === 'open' ? (
                <>
                  <button type="button" className="btn sm" onClick={() => doResolve(g)}>
                    סמן כטופל
                  </button>
                  <button type="button" className="btn sm" onClick={() => void doDismiss(g)}>
                    דחה
                  </button>
                </>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
