import { Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { crmChip } from '@wecom/shared';
import { useDocuments } from '../../api/hooks/documents.js';
import { useDeleteField, useFields } from '../../api/hooks/content.js';
import { useCan } from '../../api/hooks/me.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { Html } from '../Fmt.js';
import { fmtDate } from '../../lib/format.js';
import { LoadError } from '../ui/index.js';
import { counted, documents as nDocs } from '../../lib/count.js';

/** Port of legacy KB.views.fields. */
export function FieldsPage() {
  const go = useNavigate();
  const fields = useFields();
  const docs = useDocuments({ sort: 'wave' });
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const removeField = useDeleteField();
  const list = fields.data ?? [];
  const usage = (name: string) => (docs.data?.items ?? []).filter((c) => c.crmFields.includes(name)).length;
  /**
   * `DELETE /fields/{name}` has existed since stage 1 with no UI (review "missing features"), so
   * a field retired in the CRM could only be removed with curl. Deletion is destructive for every
   * document that references the field — the chips become "שדה לא מוכר" — so the confirmation
   * names the count, and the row keeps its "open usage" behaviour for checking first.
   */
  const deleteField = async (name: string) => {
    const n = usage(name);
    const ok = await modal.confirm(
      'מחיקת שדה CRM',
      `השדה ${name} יימחק מ-crm-fields.json.` +
        (n
          ? ` ${counted(n, nDocs, 'מפנה', 'מפנים')} אליו — הצ׳יפים יסומנו כשדה לא מוכר.`
          : ' אף מסמך לא מפנה אליו.'),
      'מחק שדה',
      'danger',
    );
    if (!ok) return;
    await removeField.mutateAsync(name);
    toast(`השדה ${name} נמחק`, 'ok');
  };

  const groups: [string, typeof list][] = [
    ['שינויים לבדיקה', list.filter((f) => f.status !== 'ok')],
    ['שדות פעילים', list.filter((f) => f.status === 'ok')],
  ];

  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/library')}>
            ספרייה
          </a>
          <span className="sep">/</span>
          <b>שדות CRM</b>
        </div>
        <div className="actions">
          <span className="chip chip-gray">
            <bdi className="lat" dir="ltr">
              crm-fields.json
            </bdi>
            {` · ${list.length} שדות`}
          </span>
        </div>
      </div>
      <div className="scroll-area">
        <div className="lib-body">
          <div className="lib-head">
            <div>
              <h1>
                שדות CRM<span>{list.filter((f) => f.status !== 'ok').length} שינויים השבוע</span>
              </h1>
              <p>
                כל שדה מזוהה אוטומטית בטקסט השלבים ומוצג כצ׳יפ עם כיוון קבוע. שדה ששונה שמו מסומן באדום עד
                שהמסמכים יעודכנו.
              </p>
            </div>
          </div>
          {fields.isError ? <LoadError what="שדות CRM" error={fields.error} /> : null}
          {fields.isPending ? <div className="route-loading">טוען…</div> : null}
          <div className="grid">
            {groups.map(([label, fs]) =>
              fs.length ? (
                <Fragment key={label}>
                  <div className="rule" data-testid="rule">
                    <span>{label}</span>
                  </div>
                  {fs.map((f) => (
                    <div
                      className="tcard"
                      key={f.name}
                      role="button"
                      tabIndex={0}
                      // The card opens the field's own page now that there is one; the quick
                      // popover stays for CRM chips inline in step text, where a route change
                      // would lose the reader's place.
                      onClick={() => go(`/fields/${encodeURIComponent(f.name)}`)}
                    >
                      <div className="chips">
                        <span
                          className={
                            'chip ' +
                            (f.status === 'renamed'
                              ? 'chip-red'
                              : f.status === 'new'
                                ? 'chip-amber'
                                : 'chip-green')
                          }
                        >
                          {f.status === 'renamed' ? 'שונה שם' : f.status === 'new' ? 'חדש' : 'תקין'}
                        </span>
                      </div>
                      <Html
                        className="title"
                        as="div"
                        html={
                          crmChip(f) +
                          (f.renamedTo ? ' → ' + crmChip({ name: f.renamedTo, status: 'new' }) : '')
                        }
                      />
                      <div className="desc">{f.path}</div>
                      <div className="meta">
                        <span>ב-{nDocs(usage(f.name))}</span>
                        <span>·</span>
                        <span>עודכן {fmtDate(f.updatedAt)}</span>
                        {can('fields.edit') ? (
                          <button
                            className="btn xs danger card-del"
                            aria-label={`מחק את השדה ${f.name}`}
                            title="מחיקת שדה"
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteField(f.name);
                            }}
                          >
                            🗑 מחק
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </Fragment>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </>
  );
}
