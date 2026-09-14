import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeleteScript, useScripts, useUpsertScript } from '../../api/hooks/content.js';
import { useCan } from '../../api/hooks/me.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';
import { copy, fmtDate } from '../../lib/format.js';
import type { ScriptRow } from '../../api/types.js';

/**
 * `POST`/`PUT`/`DELETE /scripts` have existed since stage 1 with no UI (review "missing
 * features"), so the phrasing agents read out to customers could only be changed by an operator
 * with database access. This is that UI: the `scripts.json` source file the sidebar has always
 * linked to, made editable.
 */
interface Draft {
  id?: string;
  title: string;
  text: string;
  tags: string;
}

const emptyDraft: Draft = { title: '', text: '', tags: '' };

function ScriptForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
  busy,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const valid = draft.title.trim().length > 0 && draft.text.trim().length > 0;
  return (
    <form
      className="card script-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit();
      }}
    >
      <div className="eyebrow">{draft.id ? 'עריכת תסריט' : 'תסריט חדש'}</div>
      <label>
        שם התסריט
        <input
          type="text"
          aria-label="שם התסריט"
          value={draft.title}
          autoFocus
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </label>
      <label>
        נוסח
        <textarea
          aria-label="נוסח התסריט"
          rows={4}
          value={draft.text}
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
        />
      </label>
      <label>
        תגיות (מופרדות בפסיק)
        <input
          type="text"
          aria-label="תגיות"
          value={draft.tags}
          onChange={(e) => onChange({ ...draft, tags: e.target.value })}
        />
      </label>
      <div className="row">
        <button className="btn primary sm" type="submit" disabled={!valid || busy}>
          {draft.id ? 'שמור שינויים' : 'צור תסריט'}
        </button>
        <button className="btn sm" type="button" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </form>
  );
}

export function ScriptsPage() {
  const go = useNavigate();
  const scripts = useScripts();
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const upsert = useUpsertScript();
  const remove = useDeleteScript();
  const [draft, setDraft] = useState<Draft | null>(null);

  const list: ScriptRow[] = scripts.data ?? [];
  const mayEdit = can('scripts.edit');

  const submit = async () => {
    if (!draft) return;
    await upsert.mutateAsync({
      id: draft.id,
      title: draft.title.trim(),
      text: draft.text.trim(),
      tags: draft.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
    toast(draft.id ? 'התסריט עודכן' : 'התסריט נוצר', 'ok');
    setDraft(null);
  };

  const del = async (s: ScriptRow) => {
    const ok = await modal.confirm(
      'מחיקת תסריט',
      `"${s.title}" יימחק.` +
        (s.usedIn.length ? ` הוא משמש ב-${s.usedIn.length} מסמכים — הנוסח יוסר מהם.` : ''),
      'מחק',
      'danger',
    );
    if (!ok) return;
    await remove.mutateAsync(s.id);
    toast('התסריט נמחק', 'ok');
  };

  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/library')}>
            ספרייה
          </a>
          <span className="sep">/</span>
          <b>תסריטים</b>
        </div>
        <div className="actions">
          <span className="chip chip-gray">
            <bdi className="lat" dir="ltr">
              scripts.json
            </bdi>
            {` · ${list.length} תסריטים`}
          </span>
          {mayEdit ? (
            <button className="btn primary" onClick={() => setDraft({ ...emptyDraft })}>
              ✚ תסריט חדש
            </button>
          ) : null}
        </div>
      </div>

      <div className="scroll-area">
        <div className="lib-body">
          <div className="lib-head">
            <div>
              <h1>
                תסריטים<span>{list.length} נוסחים</span>
              </h1>
              <p>נוסח מוכן שנציג מקריא ללקוח. משמש ב״הסבר ללקוח״ בתוך שלב, ובבלוקים משותפים מסוג תסריט.</p>
            </div>
          </div>

          {scripts.isError ? <LoadError what="תסריטים" error={scripts.error} /> : null}

          {draft ? (
            <ScriptForm
              draft={draft}
              onChange={setDraft}
              onSubmit={() => void submit()}
              onCancel={() => setDraft(null)}
              busy={upsert.isPending}
            />
          ) : null}

          <div className="grid">
            {!list.length && !scripts.isError && !scripts.isPending ? (
              <div className="empty" style={{ gridColumn: '1/-1' }}>
                <b>אין עדיין תסריטים</b>
                {mayEdit ? 'צרו תסריט ראשון כדי שנציגים יוכלו להקריא נוסח אחיד' : ''}
              </div>
            ) : null}
            {list.map((s) => (
              <div className="tcard" key={s.id}>
                <div className="chips">
                  {(s.tags ?? []).map((t) => (
                    <span className="chip chip-gray" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
                <div className="title">{s.title}</div>
                <div className="desc script">{s.text}</div>
                <div className="meta">
                  <span>משמש ב-{s.usedIn.length} מסמכים</span>
                  <span>·</span>
                  <span>עודכן {fmtDate(s.updatedAt)}</span>
                  <button
                    className="btn xs"
                    aria-label={`העתק את ${s.title}`}
                    onClick={() => {
                      void copy(s.text);
                      toast('הועתק ללוח', 'ok');
                    }}
                  >
                    העתק
                  </button>
                  {mayEdit ? (
                    <>
                      <button
                        className="btn xs"
                        aria-label={`ערוך את ${s.title}`}
                        onClick={() =>
                          setDraft({
                            id: s.id,
                            title: s.title,
                            text: s.text,
                            tags: (s.tags ?? []).join(', '),
                          })
                        }
                      >
                        ✏️ ערוך
                      </button>
                      <button
                        className="btn xs danger"
                        aria-label={`מחק את ${s.title}`}
                        onClick={() => void del(s)}
                      >
                        🗑 מחק
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
