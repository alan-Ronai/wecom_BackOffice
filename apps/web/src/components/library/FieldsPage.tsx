import { Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { crmChip } from '@wecom/shared';
import { useDocuments } from '../../api/hooks/documents.js';
import { useFields } from '../../api/hooks/content.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { Html } from '../Fmt.js';
import { fmtDate } from '../../lib/format.js';
import { useEntityDialogs } from './dialogs.js';
import { LoadError } from '../ui/index.js';

/** Port of legacy KB.views.fields. */
export function FieldsPage() {
  const go = useNavigate();
  const fields = useFields();
  const docs = useDocuments({ sort: 'wave' });
  const dialogs = useEntityDialogs();
  const list = fields.data ?? [];
  const usage = (name: string) => (docs.data?.items ?? []).filter((c) => c.crmFields.includes(name)).length;
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
                      onClick={() => dialogs.showField(f.name)}
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
                        <span>ב-{usage(f.name)} מסמכים</span>
                        <span>·</span>
                        <span>עודכן {fmtDate(f.updatedAt)}</span>
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
