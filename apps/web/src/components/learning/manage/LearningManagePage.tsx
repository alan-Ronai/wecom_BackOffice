import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { LearningKind, LearningStatus } from '@wecom/shared';
import {
  useCreateLearningItem,
  useDocumentLearning,
  useLearningItems,
} from '../../../api/hooks/learningManage.js';
import { useCan } from '../../../api/hooks/me.js';
import { useWorlds } from '../../../api/hooks/taxonomy.js';
import { counted, entries, questions, users } from '../../../lib/count.js';
import { ago } from '../../../lib/format.js';
import { Hamburger } from '../../shell/MobileDrawer.js';
import { useModal } from '../../ui/Modal.js';
import { useToast } from '../../ui/Toast.js';
import { Chip, Empty, LoadError } from '../../ui/index.js';
import { worldLabel } from '../../taxonomy/TypeBadge.js';
import { LearningDashboardPanel } from './LearningDashboardPanel.js';

export const KIND_LABEL: Record<LearningKind, string> = { briefing: 'תדריך', quiz: 'שאלון' };
export const LSTATUS_LABEL: Record<LearningStatus, string> = {
  draft: 'טיוטה',
  published: 'פורסם',
  archived: 'ארכיון',
};
export const LSTATUS_TONE: Record<LearningStatus, string> = {
  draft: 'chip-amber',
  published: 'chip-green',
  archived: 'chip-gray',
};

/** The editor's learning manager (spec §5): list, filters, create, dashboard strip. */
export function LearningManagePage() {
  const can = useCan();
  const go = useNavigate();
  const modal = useModal();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const kind = (sp.get('kind') as LearningKind | null) ?? undefined;
  const status = (sp.get('status') as LearningStatus | null) ?? undefined;
  const world = sp.get('world') ?? undefined;
  /** The article's `LearningBadge` (V4a) links here with the document it sits on. */
  const documentId = sp.get('documentId') ?? undefined;
  const [q, setQ] = useState(sp.get('q') ?? '');
  const mayManage = can('learning.manage');
  // `enabled`: without the permission every one of these is a guaranteed 403, and asking anyway
  // costs a round trip on a screen that is about to render the empty state instead.
  const list = useLearningItems({ kind, status, world, q: q || undefined }, mayManage && !documentId);
  const forDoc = useDocumentLearning(documentId, mayManage);
  const worlds = useWorlds();
  const create = useCreateLearningItem();
  // One list to render: the document-scoped one when filtering, else the manager list.
  const cards = documentId ? (forDoc.data?.items ?? []) : (list.data?.items ?? []);
  const loadError = documentId ? forDoc.error : list.error;

  if (!mayManage)
    return (
      <div className="page">
        <Empty title="אין הרשאה לניהול למידה">המסך מיועד לעורכי תוכן.</Empty>
      </div>
    );

  const set = (k: string, v?: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };

  const createItem = async (k: LearningKind) => {
    const title = await modal.prompt(k === 'quiz' ? 'שאלון חדש' : 'תדריך חדש', 'כותרת');
    if (!title?.trim()) return;
    try {
      const item = await create.mutateAsync({ kind: k, title: title.trim(), worldSlug: world ?? null });
      go(`/learning/manage/${item.id}`);
    } catch {
      toast('יצירת פריט הלמידה נכשלה', 'warn');
    }
  };

  return (
    <div className="page learning-manage">
      <div className="topbar">
        <Hamburger />
        <h1>ניהול למידה</h1>
        <span className="grow" />
        <button type="button" className="btn sm" onClick={() => void createItem('briefing')}>
          ✚ תדריך
        </button>
        <button type="button" className="btn primary sm" onClick={() => void createItem('quiz')}>
          ✚ שאלון
        </button>
      </div>
      <LearningDashboardPanel world={world} />
      <div className="facets" aria-label="סינון">
        <label className="small">
          סוג
          <select
            aria-label="סוג"
            value={kind ?? ''}
            onChange={(e) => set('kind', e.target.value || undefined)}
          >
            <option value="">הכל</option>
            <option value="briefing">תדריך</option>
            <option value="quiz">שאלון</option>
          </select>
        </label>
        <label className="small">
          סטטוס
          <select
            aria-label="סטטוס"
            value={status ?? ''}
            onChange={(e) => set('status', e.target.value || undefined)}
          >
            <option value="">הכל</option>
            {(['draft', 'published', 'archived'] as LearningStatus[]).map((s) => (
              <option key={s} value={s}>
                {LSTATUS_LABEL[s]}
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
        <input
          aria-label="חיפוש"
          placeholder="חיפוש…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            set('q', e.target.value || undefined);
          }}
        />
      </div>
      {documentId ? (
        <div className="chips" aria-live="polite">
          <span className="chip chip-amber">
            מסונן לפי פריט ידע{' '}
            <button
              type="button"
              aria-label="בטל סינון לפי פריט ידע"
              onClick={() => set('documentId', undefined)}
            >
              ✕
            </button>
          </span>
          <Link className="linklike" to={`/doc/${documentId}`}>
            לפריט הידע
          </Link>
        </div>
      ) : null}
      {loadError ? <LoadError what="פריטי למידה" error={loadError} /> : null}
      {(documentId ? forDoc.data : list.data) && cards.length === 0 ? (
        <Empty title={documentId ? 'אין פריטי למידה לפריט ידע זה' : 'אין פריטי למידה'}>
          צרו תדריך או שאלון מפריטי ידע שפורסמו.
        </Empty>
      ) : null}
      <div className="grid" data-testid="learning-items">
        {cards.map((c) => (
          <article
            key={c.id}
            className="tcard"
            onClick={() => go(`/learning/manage/${c.id}`)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                go(`/learning/manage/${c.id}`);
              }
            }}
          >
            <div className="chips">
              <Chip>{KIND_LABEL[c.kind]}</Chip>
              <span className={'chip ' + LSTATUS_TONE[c.status]}>{LSTATUS_LABEL[c.status]}</span>
              {c.worldSlug ? <Chip>{worldLabel(c.worldSlug)}</Chip> : null}
              {c.needsUpdate ? <span className="chip chip-red">דורש עדכון</span> : null}
            </div>
            <div className="title">{c.title}</div>
            <div className="desc">
              {c.kind === 'quiz' ? questions(c.questionCount) : entries(c.entryCount)} ·{' '}
              {counted(c.assignedUsers, users, 'הוקצה', 'הוקצו')}
              {c.completionRate !== null ? ` · ${Math.round(c.completionRate * 100)}%` : ''} · עודכן{' '}
              {ago(c.updatedAt)}
            </div>
            <Link className="linklike" to={`/learning/manage/${c.id}`} onClick={(e) => e.stopPropagation()}>
              פתח
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
