import { useState } from 'react';
import { wordDiff } from '@wecom/shared';
import { useAudit } from '../../api/hooks/admin.js';
import { fmtDate, fmtTime } from '../../lib/format.js';
import { useModal } from '../ui/Modal.js';
import { Html } from '../Fmt.js';

export function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const audit = useAudit(entityType ? { entityType } : {});
  const modal = useModal();
  const items = audit.data?.items ?? [];

  const showDiff = (before: unknown, after: unknown) => {
    const d = wordDiff(JSON.stringify(before ?? {}, null, 2), JSON.stringify(after ?? {}, null, 2));
    modal.open({
      title: 'לפני / אחרי',
      wide: true,
      body: (
        <div className="diff-cols">
          <div className="diff-col">
            <div className="eyebrow">לפני</div>
            <Html as="pre" html={d.a} />
          </div>
          <div className="diff-col">
            <div className="eyebrow cur">אחרי</div>
            <Html as="pre" html={d.b} />
          </div>
        </div>
      ),
      buttons: [{ label: 'סגור' }],
    });
  };

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>
            יומן פעולות<span>{audit.data?.total ?? 0} רשומות</span>
          </h1>
          <p>כל פעולה משנה נרשמת בתוך אותה טרנזקציה, עם המצב לפני ואחרי.</p>
        </div>
        <div className="facets">
          <select aria-label="סוג ישות" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">הכל</option>
            <option value="document">מסמכים</option>
            <option value="block">בלוקים</option>
            <option value="user">משתמשים</option>
            <option value="role">תפקידים</option>
          </select>
        </div>
      </div>
      {!items.length ? (
        <div className="empty">
          <b>אין רשומות</b>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>מתי</th>
              <th>מי</th>
              <th>פעולה</th>
              <th>ישות</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td>
                  {fmtDate(e.at)} {fmtTime(e.at)}
                </td>
                <td>{e.actorName ?? 'מערכת'}</td>
                <td>
                  <bdi className="lat" dir="ltr">
                    {e.action}
                  </bdi>
                </td>
                <td>
                  {e.entityType}
                  <div className="small muted">
                    <bdi className="lat" dir="ltr">
                      {e.entityId ?? ''}
                    </bdi>
                  </div>
                </td>
                <td>
                  <button className="btn xs" onClick={() => showDiff(e.before, e.after)}>
                    לפני / אחרי
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
