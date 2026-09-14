import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { LearningItem, LearningItemPatch } from '@wecom/shared';
import {
  useCreateLearningItem,
  useDeleteLearningItem,
  useLearningItem,
  useLearningVersions,
  usePatchLearningItem,
  usePublishLearningItem,
} from '../../../api/hooks/learningManage.js';
import { useCan } from '../../../api/hooks/me.js';
import { useWorlds } from '../../../api/hooks/taxonomy.js';
import { ago } from '../../../lib/format.js';
import { Hamburger } from '../../shell/MobileDrawer.js';
import { useModal } from '../../ui/Modal.js';
import { useToast } from '../../ui/Toast.js';
import { Empty, LoadError } from '../../ui/index.js';
import { RichText } from '../../source/RichText.js';
import { AssignDialog } from './AssignDialog.js';
import { BriefingBuilder } from './BriefingBuilder.js';
import { CompletionDashboard } from './CompletionDashboard.js';
import { ItemPreview } from './ItemPreview.js';
import { KIND_LABEL, LSTATUS_LABEL, LSTATUS_TONE } from './LearningManagePage.js';
import { QuizBuilder } from './QuizBuilder.js';

/** Builder shell (spec §5): metadata, the kind-specific builder, preview, publish, assign, completion. */
export function LearningItemEditor() {
  const { id } = useParams<{ id?: string }>();
  const [sp] = useSearchParams();
  const isNew = !id;
  const can = useCan();
  const go = useNavigate();
  const modal = useModal();
  const toast = useToast();
  const item = useLearningItem(id);
  const versions = useLearningVersions(id);
  const worlds = useWorlds();
  const create = useCreateLearningItem();
  const patch = usePatchLearningItem(id ?? '');
  const publish = usePublishLearningItem(id ?? '');
  const del = useDeleteLearningItem();
  const [assignOpen, setAssignOpen] = useState(false);
  const [tab, setTab] = useState<'build' | 'completion'>('build');
  const mayManage = can('learning.manage');
  const mayPublish = can('learning.publish');
  /** `/learning/manage/new` creates exactly once, even under StrictMode's double effect. */
  const creating = useRef(false);

  useEffect(() => {
    if (!isNew || creating.current) return;
    creating.current = true;
    const kind: LearningItem['kind'] = sp.get('kind') === 'briefing' ? 'briefing' : 'quiz';
    void create
      .mutateAsync({ kind, title: kind === 'quiz' ? 'שאלון חדש' : 'תדריך חדש' })
      .then((created) => go(`/learning/manage/${created.id}`, { replace: true }))
      .catch(() => toast('יצירת פריט הלמידה נכשלה', 'warn'));
  }, [isNew, create, sp, go, toast]);

  if (!mayManage)
    return (
      <div className="page">
        <Empty title="אין הרשאה לניהול למידה">המסך מיועד לעורכי תוכן.</Empty>
      </div>
    );
  if (item.isError)
    return (
      <div className="page">
        <LoadError what="פריט הלמידה" error={item.error} />
      </div>
    );
  if (!item.data) return <div className="route-loading">טוען…</div>;
  const it = item.data;

  const save = (body: LearningItemPatch) =>
    patch.mutateAsync(body).catch(() => toast('השמירה נכשלה', 'warn'));

  const doPublish = async () => {
    const label = await modal.prompt('פרסום פריט למידה', 'תיאור הגרסה');
    if (!label?.trim()) return;
    try {
      await publish.mutateAsync({ label: label.trim() });
      toast('פריט הלמידה פורסם', 'ok');
    } catch {
      toast('הפרסום נכשל', 'warn');
    }
  };

  const doDelete = async () => {
    if (
      !(await modal.confirm(
        'למחוק את פריט הלמידה?',
        'הקצאות והשלמות קיימות יישמרו בהיסטוריה.',
        'מחק',
        'danger',
      ))
    )
      return;
    try {
      await del.mutateAsync(it.id);
      go('/learning/manage');
    } catch {
      toast('המחיקה נכשלה', 'warn');
    }
  };

  return (
    <div className="page item-editor-page">
      <div className="topbar">
        <Hamburger />
        <h1>
          {KIND_LABEL[it.kind]}: {it.title}
        </h1>
        <span className={'chip ' + LSTATUS_TONE[it.status]}>{LSTATUS_LABEL[it.status]}</span>
        {it.needsUpdate ? <span className="chip chip-red">דורש עדכון</span> : null}
        <span className="grow" />
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            modal.open({
              title: 'תצוגה מקדימה',
              body: <ItemPreview item={it} />,
              buttons: [{ label: 'סגור' }],
            })
          }
        >
          תצוגה מקדימה
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => setAssignOpen(true)}
          disabled={it.status !== 'published'}
          title={it.status !== 'published' ? 'ניתן להקצות רק פריט שפורסם' : undefined}
        >
          הקצה
        </button>
        {mayPublish ? (
          <button type="button" className="btn primary sm" onClick={() => void doPublish()}>
            פרסם
          </button>
        ) : null}
      </div>
      <nav className="tabs" role="tablist" aria-label="תצוגה">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'build'}
          className={'facet' + (tab === 'build' ? ' on' : '')}
          onClick={() => setTab('build')}
        >
          עריכה
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'completion'}
          className={'facet' + (tab === 'completion' ? ' on' : '')}
          onClick={() => setTab('completion')}
        >
          השלמה
        </button>
      </nav>
      {tab === 'completion' ? (
        <CompletionDashboard itemId={it.id} />
      ) : (
        <div className="item-editor">
          <div>
            <label>
              כותרת
              <input
                aria-label="כותרת"
                defaultValue={it.title}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== it.title) void save({ title: v });
                }}
              />
            </label>
            <RichText
              value={it.description}
              onChange={(html) => {
                if (html !== it.description) void save({ description: html });
              }}
              compact
              label="הקדמה"
            />
            {it.kind === 'briefing' ? <BriefingBuilder item={it} /> : <QuizBuilder item={it} />}
          </div>
          <aside className="side">
            <label>
              עולם תוכן
              <select
                aria-label="עולם תוכן"
                value={it.worldSlug ?? ''}
                onChange={(e) => void save({ worldSlug: e.target.value || null })}
              >
                <option value="">כללי</option>
                {(worlds.data ?? []).map((w) => (
                  <option key={w.slug} value={w.slug}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              זמן משוער (דקות)
              <input
                aria-label="זמן משוער (דקות)"
                type="number"
                min={1}
                defaultValue={it.estimatedMinutes ?? ''}
                onBlur={(e) =>
                  void save({ estimatedMinutes: e.target.value ? Number(e.target.value) : null })
                }
              />
            </label>
            {it.kind === 'quiz' ? (
              <>
                <label>
                  ציון עובר (%)
                  <input
                    aria-label="ציון עובר (%)"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={it.passMark ?? 80}
                    onBlur={(e) => void save({ passMark: Number(e.target.value) || 80 })}
                  />
                </label>
                <label>
                  מספר ניסיונות מרבי
                  <select
                    aria-label="מספר ניסיונות מרבי"
                    value={it.maxAttempts ?? ''}
                    onChange={(e) =>
                      void save({ maxAttempts: e.target.value ? Number(e.target.value) : null })
                    }
                  >
                    {/* `null` is unlimited retakes — the owner's ruling (spec §1.4). */}
                    <option value="">ללא הגבלה</option>
                    {[1, 2, 3, 5, 10].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <div className="kv">
              <span>גרסה</span>
              <b>{it.currentVersion}</b>
              <span>עודכן</span>
              <b>{ago(it.updatedAt)}</b>
            </div>
            {versions.data?.length ? (
              <ul className="version-list">
                {versions.data.map((v) => (
                  <li key={v.version}>
                    גרסה {v.version} · {v.label} · {v.authorName} · {ago(v.createdAt)}
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" className="btn sm danger" onClick={() => void doDelete()}>
              מחק
            </button>
          </aside>
        </div>
      )}
      {assignOpen ? <AssignDialog itemId={it.id} onClose={() => setAssignOpen(false)} /> : null}
    </div>
  );
}
