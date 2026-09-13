import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SuggestionPayload } from '@wecom/shared';
import {
  useDecideSuggestion,
  useEditSuggestion,
  useProcessSource,
  usePublishSuggestions,
  useRevision,
  useSources,
  useSuggestions,
  useUploadSource,
} from '../../api/hooks/pipeline.js';
import { useHealth } from '../../api/hooks/admin.js';
import { useFields } from '../../api/hooks/content.js';
import { useCan } from '../../api/hooks/me.js';
import { fmtTime } from '../../lib/format.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { Fmt } from '../Fmt.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { SuggestionCard } from './SuggestionCard.js';
import { LoadError } from '../ui/index.js';

/** Port of views-sources.js on the pipeline API: tracked changes plus the review panel. */
export function SourcesPage() {
  const { id } = useParams<{ id?: string }>();
  const go = useNavigate();
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const sources = useSources();
  const fields = useFields();
  const health = useHealth();
  const process = useProcessSource();
  const upload = useUploadSource();
  const decide = useDecideSuggestion();
  const edit = useEditSuggestion();
  const publish = usePublishSuggestions();
  const [viewChanges, setViewChanges] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = sources.data ?? [];
  const current = list.find((s) => s.id === id) ?? list.find((s) => s.syncState === 'pending') ?? list[0];
  const revision = useRevision(current?.id, 'latest');
  const suggestions = useSuggestions(current ? { sourceId: current.id } : {});

  const items = suggestions.data?.items ?? [];
  const pending = items.filter((s) => s.status === 'pending').length;
  const accepted = items.filter((s) => s.status === 'accepted').length;
  const canReview = can('suggestions.review');
  const canApply = can('suggestions.apply');

  const paragraphs = (revision.data?.paragraphs ?? []).filter(
    (p) => !viewChanges || p.runs.some((r) => r.add || r.del || r.chg) || p.isNew,
  );

  const doPublish = async () => {
    // The route applies the accepted suggestions of one source, so it needs that source's id.
    if (!current) return;
    const ok = await modal.confirm(
      'פרסום לספרייה',
      `${accepted} הצעות יוחלו על הספרייה ויירשמו כגרסאות חדשות.`,
      'פרסם',
      'primary',
    );
    if (!ok) return;
    const res = await publish.mutateAsync(current.id);
    toast(`פורסמו ${res.applied} שינויים`, 'ok');
  };

  return (
    <div className="src-layout">
      <aside className="src-side">
        <div
          className="logo"
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          onClick={() => go('/library')}
        >
          wecom.
        </div>
        <div className="sec-title">מסמכי מקור</div>
        <div className="docs">
          {list.map((s) => (
            <div
              key={s.id}
              className={'sdoc' + (current?.id === s.id ? ' on' : '')}
              role="button"
              tabIndex={0}
              onClick={() => go(`/sources/${s.id}`, { replace: true })}
            >
              <span className="r">
                <span>{s.title}</span>
                <span className="ext">{s.ext}</span>
              </span>
              <span className={'st' + (s.pendingSuggestions ? ' warn' : '')}>
                {s.pendingSuggestions
                  ? `${s.pendingSuggestions} שינויים לא מעובדים`
                  : `מסונכרן · ${s.linkedDocuments} כרטיסים`}
              </span>
            </div>
          ))}
          {can('sources.manage') ? (
            <div
              className="src-add"
              style={{ textAlign: 'center', justifyContent: 'center' }}
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
            >
              + קשר מסמך / תיקייה
            </div>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.docx,.json"
            aria-label="קשר מסמך מקור"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              await upload.mutateAsync(f);
              toast('המסמך נקשר · יעובד בסריקה הבאה', 'ok');
            }}
          />
        </div>
        <div className="model">
          <div className={health.data?.model ? 'on' : 'dim'}>
            <i />
            {health.data?.model ? 'מודל מקומי · פעיל' : 'מודל מקומי · לא זמין'}
          </div>
          <div className="dim">עיבוד על השרת הפנימי בלבד · לא נשלח לענן</div>
          <div className="dim">
            <span>סריקה אחרונה</span>
            <bdi className="lat" dir="ltr">
              {current?.lastSyncedAt ? fmtTime(current.lastSyncedAt) : '—'}
            </bdi>
          </div>
        </div>
      </aside>

      <div className="src-main">
        {sources.isError ? (
          <LoadError what="מסמכי מקור" error={sources.error} />
        ) : !current ? (
          <div className="empty">אין מסמכי מקור</div>
        ) : (
          <>
            <div className="topbar h56">
              <Hamburger />
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }}
              >
                {current.title}
              </span>
              {current.pendingSuggestions ? (
                <span className="chip chip-amber">{current.pendingSuggestions} שינויים מסומנים</span>
              ) : (
                <span className="chip chip-green">מסונכרן</span>
              )}
              <div className="actions">
                <button className="btn sm" disabled title="הורדת הקובץ תתאפשר כשהחיבור למקור יפורסם">
                  פתח ב-{current.ext === '.xlsx' ? 'Excel' : 'Word'}
                </button>
                {can('sources.manage') ? (
                  <button className="btn navy sm" onClick={() => process.mutate(current.id)}>
                    ⟳ עבד שינויים
                  </button>
                ) : null}
              </div>
            </div>
            <div className="viewbar">
              <span>מציג:</span>
              <span
                className={'facet' + (viewChanges ? ' on' : '')}
                style={{ padding: '3px 9px', fontSize: 11.5 }}
                role="button"
                tabIndex={0}
                onClick={() => setViewChanges(true)}
              >
                שינויים בלבד
              </span>
              <span
                className={'facet' + (!viewChanges ? ' on' : '')}
                style={{ padding: '3px 9px', fontSize: 11.5 }}
                role="button"
                tabIndex={0}
                onClick={() => setViewChanges(false)}
              >
                כל המסמך
              </span>
              <span className="legend">
                <span>
                  <i style={{ background: 'var(--ok-mark)' }} />
                  נוסף
                </span>
                <span>
                  <i style={{ background: 'var(--del-mark)' }} />
                  נמחק
                </span>
                <span>
                  <i style={{ background: 'var(--warn-mark)' }} />
                  שונה
                </span>
              </span>
            </div>
            <div className="src-page-wrap">
              <div className="src-page">
                {!paragraphs.length ? (
                  <div className="small muted">
                    {viewChanges ? 'אין שינויים מסומנים במסמך זה · עבור ל"כל המסמך"' : 'אין פסקאות'}
                  </div>
                ) : null}
                {paragraphs.map((p) => (
                  <div className={'para' + (p.isNew ? ' new' : '')} key={p.ref}>
                    {p.isNew ? <span className="tagn">פסקה חדשה</span> : null}
                    <b className="h">
                      {p.ref} {p.heading}{' '}
                    </b>
                    {p.runs.map((run, i) =>
                      run.code ? (
                        <bdi
                          key={i}
                          className="lat"
                          dir="ltr"
                          style={{ background: 'var(--surface-3)', padding: '1px 6px', borderRadius: 4 }}
                        >
                          {run.t}
                        </bdi>
                      ) : (
                        <Fmt
                          key={i}
                          className={run.del ? 'r-del' : run.add ? 'r-add' : run.chg ? 'r-chg' : undefined}
                          text={run.t}
                          fields={fields.data ?? []}
                          docs={[]}
                          noCrm
                        />
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <aside className="src-panel">
        <div className="hd">
          <b>הצעות לכרטיסים</b>
          <span>{pending ? `${pending} ממתינות` : 'אין שינויים ממתינים'}</span>
          {canReview && pending ? (
            <span
              className="all"
              role="button"
              tabIndex={0}
              onClick={async () => {
                for (const s of items.filter((x) => x.status === 'pending'))
                  await decide.mutateAsync({ id: s.id, decision: 'accept' });
              }}
            >
              אשר הכל
            </span>
          ) : null}
        </div>
        <div className="body">
          {!items.length ? (
            <div className="empty">
              <b>המסמך מסונכרן</b>
              כשיסומנו שינויים במעקב (Track Changes) הם יופיעו כאן כהצעות
            </div>
          ) : null}
          {items.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              canReview={canReview}
              canApply={canApply}
              onDecide={(decision) => decide.mutate({ id: s.id, decision })}
              onEdit={(text) => {
                const base = s.editedPayload ?? s.payload;
                const next: SuggestionPayload =
                  base.type === 'update-step'
                    ? { ...base, addActions: [text] }
                    : base.type === 'new-card'
                      ? { ...base, title: text }
                      : base;
                edit.mutate({ id: s.id, editedPayload: next });
              }}
            />
          ))}
          <div className="sug-info">
            <b>מה המנוע בודק</b> · שינוי סף/ערכים → עדכון שלב · פסקה חדשה → כרטיס חדש או שלב · טקסט זהה ב-2+
            פרקים → בלוק משותף · שדה CRM לא מוכר → התראה · פסקה שנמחקה → הוצאה משימוש
          </div>
        </div>
        <div className="foot">
          <span>{accepted} מאושרות</span>
          {canApply ? (
            <button className="btn sm primary" disabled={!accepted} onClick={() => void doPublish()}>
              פרסם לספרייה
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
