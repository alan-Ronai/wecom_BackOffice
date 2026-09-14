import { Fragment, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { crmChip } from '@wecom/shared';
import { useFieldPage, useImpact, useRenameField } from '../../api/hooks/stage4.js';
import { useDeleteField } from '../../api/hooks/content.js';
import { useCan } from '../../api/hooks/me.js';
import type { FieldPage as FieldPageData } from '../../api/stage4.js';
import { CATS } from '../../lib/constants.js';
import { fmtDate } from '../../lib/format.js';
import { Fmt, Html } from '../Fmt.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';

const ALERT_TONE: Record<string, string> = {
  renamed: 'chip-red',
  unknown: 'chip-amber',
  retired: 'chip-amber',
  new: 'chip-blue',
};

const STATUS_LABEL: Record<string, string> = {
  ok: 'תקין',
  renamed: 'שונה שם',
  new: 'חדש',
  retired: 'פג תוקף',
};

/**
 * `/fields/:name` — the CRM field page (design card 5c).
 *
 * A CRM field is referenced *by name, in prose*, inside step text across many documents. Renaming
 * it in the CRM therefore silently breaks every one of those references, which is the bug this
 * page exists to make visible and fixable: the usage table says exactly where the name appears,
 * and "עדכן את כל ההפניות" rewrites them all in one server-side transaction that publishes a
 * version per document.
 */
export function FieldPage() {
  const { name = '' } = useParams<{ name: string }>();
  const decoded = decodeURIComponent(name);
  const go = useNavigate();
  const can = useCan();
  const page = useFieldPage(decoded);

  if (page.isError) {
    return (
      <>
        <FieldTopbar name={decoded} go={go} />
        <div className="scroll-area">
          <div className="lib-body">
            <LoadError what={`השדה ${decoded}`} error={page.error} />
          </div>
        </div>
      </>
    );
  }
  if (!page.data) {
    return (
      <>
        <FieldTopbar name={decoded} go={go} />
        <div className="scroll-area">
          <div className="lib-body">
            <div className="empty">טוען…</div>
          </div>
        </div>
      </>
    );
  }

  return <FieldPageBody data={page.data} canEdit={can('fields.edit')} />;
}

function FieldTopbar({ name, go }: { name: string; go: (to: string) => void }) {
  return (
    <div className="topbar">
      <Hamburger />
      <div className="crumb">
        <a role="button" tabIndex={0} onClick={() => go('/data')}>
          נתונים
        </a>
        <span className="sep">/</span>
        <a role="button" tabIndex={0} onClick={() => go('/fields')}>
          שדות CRM
        </a>
        <span className="sep">/</span>
        <b>{name}</b>
      </div>
    </div>
  );
}

function FieldPageBody({ data, canEdit }: { data: FieldPageData; canEdit: boolean }) {
  const go = useNavigate();
  const modal = useModal();
  const toast = useToast();
  const { field, usage, history, alerts } = data;
  const rename = useRenameField(field.name);
  const del = useDeleteField();
  const impact = useImpact(`field:${field.name}`);
  const [busy, setBusy] = useState(false);

  // Usage rows are grouped by document, so "this field appears in 3 documents" and "in 7 steps"
  // are two different numbers and the table says both instead of conflating them.
  const byDocument = usage.reduce<Record<string, FieldPageData['usage']>>((acc, row) => {
    (acc[row.documentId] ??= []).push(row);
    return acc;
  }, {});

  const doRename = () => {
    const draft = { newName: field.renamedTo ?? field.name, updateReferences: true, label: '' };
    modal.open({
      title: 'שינוי שם השדה',
      body: <RenameBody field={field.name} documents={data.documents} draft={draft} />,
      buttons: [
        {
          label: 'עדכן הכל',
          cls: 'primary',
          onClick: () => {
            const newName = draft.newName.trim();
            if (!newName || newName === field.name) {
              toast('בחרו שם חדש ושונה מהנוכחי', 'warn');
              return false;
            }
            setBusy(true);
            void rename
              .mutateAsync({
                newName,
                updateReferences: draft.updateReferences,
                label: draft.label.trim() || `שינוי שם שדה: ${field.name} ← ${newName}`,
              })
              .then((res) => {
                toast(
                  res.updatedDocuments
                    ? `השם עודכן · ${res.updatedDocuments} מסמכים עודכנו ו-${res.versionsCreated} גרסאות נוצרו`
                    : 'השם עודכן · ההפניות לא שונו',
                  'ok',
                );
                go(`/fields/${encodeURIComponent(newName)}`, { replace: true });
              })
              .catch((e: Error) => toast(e.message, 'warn'))
              .finally(() => setBusy(false));
          },
        },
        { label: 'בטל' },
      ],
    });
  };

  const doDelete = async () => {
    const affected = impact.data?.affectedDocuments ?? data.documents;
    const ok = await modal.confirm(
      'מחיקת שדה CRM',
      affected
        ? `${affected} מסמכים מפנים ל-${field.name}. אחרי המחיקה הצ׳יפים בטקסט יסומנו כשדה לא מוכר עד שהטקסט יעודכן.`
        : `אף מסמך לא מפנה ל-${field.name} — המחיקה בטוחה.`,
      'מחק שדה',
      'danger',
    );
    if (!ok) return;
    await del.mutateAsync(field.name);
    toast('השדה נמחק', 'ok');
    go('/fields');
  };

  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/data')}>
            נתונים
          </a>
          <span className="sep">/</span>
          <a role="button" tabIndex={0} onClick={() => go('/fields')}>
            שדות CRM
          </a>
          <span className="sep">/</span>
          <b>{field.name}</b>
        </div>
        <span className={'chip ' + (ALERT_TONE[field.status] ?? 'chip-green')}>
          {STATUS_LABEL[field.status] ?? field.status}
        </span>
        <div className="actions">
          {canEdit ? (
            <>
              <button className="btn sm" disabled={busy} onClick={doRename}>
                ✎ שנה שם ועדכן הפניות
              </button>
              <button className="btn sm danger" onClick={() => void doDelete()}>
                🗑 מחק שדה
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="scroll-area">
        <div className="lib-body">
          <div className="lib-head">
            <div>
              <h1>
                <Html
                  as="span"
                  html={
                    crmChip(field) +
                    (field.renamedTo ? ' → ' + crmChip({ name: field.renamedTo, status: 'new' }) : '')
                  }
                />
                <span>
                  ב-{data.documents} מסמכים · {usage.length} שלבים
                </span>
              </h1>
              <p>{field.note ?? 'שדה CRM שמזוהה אוטומטית בטקסט השלבים ומוצג כצ׳יפ עם כיוון קבוע.'}</p>
            </div>
          </div>

          {alerts.map((a, i) => (
            <div className="data-banner" key={i} role="alert">
              <span className={'chip ' + (ALERT_TONE[a.kind] ?? 'chip-gray')}>
                {a.kind === 'renamed'
                  ? 'שונה שם'
                  : a.kind === 'retired'
                    ? 'פג תוקף'
                    : a.kind === 'new'
                      ? 'חדש'
                      : 'לא מוכר'}
              </span>
              <span>{a.message}</span>
            </div>
          ))}

          <section className="card data-card">
            <div className="hd">
              <b>הגדרה</b>
            </div>
            <dl className="deflist">
              <div>
                <dt>נתיב</dt>
                <dd>{field.path || '—'}</dd>
              </div>
              <div>
                <dt>סטטוס</dt>
                <dd>{STATUS_LABEL[field.status] ?? field.status}</dd>
              </div>
              <div>
                <dt>בתוקף מ-</dt>
                <dd>{field.effectiveFrom ? fmtDate(field.effectiveFrom) : '—'}</dd>
              </div>
              <div>
                <dt>עודכן</dt>
                <dd>{fmtDate(field.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="card data-card">
            <div className="hd">
              <b>שימוש במסמכים · {data.documents}</b>
              <span className="small muted">לחיצה פותחת את המסמך בשלב המדויק</span>
            </div>
            <div className="data-scroll">
              <table className="table" data-testid="field-usage">
                <thead>
                  <tr>
                    <th>מסמך</th>
                    <th>שלב</th>
                    <th>הטקסט שמפנה</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byDocument).map(([documentId, rows]) => (
                    <Fragment key={documentId}>
                      {rows.map((row, i) => (
                        <tr
                          key={row.stepKey}
                          role="button"
                          tabIndex={0}
                          className="rowlink"
                          onClick={() => go(`/doc/${row.documentId}/${row.stepKey}`)}
                        >
                          <td>{i === 0 ? `${CATS[row.category].icon} ${row.title}` : ''}</td>
                          <td>
                            {row.stepNum} · {row.stepTitle}
                          </td>
                          <td>
                            <Fmt text={row.text} fields={[field]} docs={[]} />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {!usage.length ? (
                <div className="small muted" style={{ padding: 12 }}>
                  אף מסמך לא מפנה לשדה זה
                </div>
              ) : null}
            </div>
          </section>

          <section className="card data-card">
            <div className="hd">
              <b>ציר זמן</b>
            </div>
            <ol className="timeline">
              {history.map((h, i) => (
                <li key={i}>
                  <span className="dot" />
                  <div>
                    <b>{h.action}</b>
                    <span className="small muted">
                      {' '}
                      {fmtDate(h.at)}
                      {h.actorName ? ` · ${h.actorName}` : ''}
                    </span>
                    <div className="small muted">{summarise(h.before, h.after)}</div>
                  </div>
                </li>
              ))}
              {!history.length ? <li className="small muted">אין היסטוריה</li> : null}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}

/** One-line "x ← y" of whatever the audit row happened to record. */
function summarise(before: unknown, after: unknown): string {
  const f = (v: unknown) =>
    v == null ? '—' : typeof v === 'object' ? Object.values(v as object).join(' · ') : String(v);
  return `${f(before)} ← ${f(after)}`;
}

/**
 * The rename form writes into the caller's `draft` object rather than lifting state, because the
 * modal's button callbacks are registered once and need the latest values at click time.
 */
function RenameBody({
  field,
  documents,
  draft,
}: {
  field: string;
  documents: number;
  draft: { newName: string; updateReferences: boolean; label: string };
}) {
  const [newName, setNewName] = useState(draft.newName);
  const [updateReferences, setUpdateReferences] = useState(draft.updateReferences);
  const [label, setLabel] = useState(draft.label);
  draft.newName = newName;
  draft.updateReferences = updateReferences;
  draft.label = label;

  return (
    <div className="form">
      <label>
        שם חדש
        <input
          aria-label="שם חדש"
          type="text"
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          aria-label="עדכן את כל ההפניות"
          checked={updateReferences}
          onChange={(e) => setUpdateReferences(e.target.checked)}
        />
        עדכן את כל ההפניות ({documents})
      </label>
      <p className="small muted">
        כל הפניה תשתנה מ-{field} ל-{newName || '…'}. הפעולה תיצור גרסה חדשה בכל מסמך שמושפע.
      </p>
      <label>
        מה השתנה (תווית הגרסה)
        <input
          aria-label="מה השתנה"
          type="text"
          value={label}
          placeholder={`שינוי שם שדה: ${field} ← ${newName || '…'}`}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
    </div>
  );
}
