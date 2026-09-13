import { useNavigate } from 'react-router-dom';
import { useDocuments } from '../../api/hooks/documents.js';
import { useFields } from '../../api/hooks/content.js';
import { useEntityDialogs } from './dialogs.js';

/** "נוצר אוטומטית · מהנתונים" — the two most-used fields and this week's changes. */
export function AutoCrmCard() {
  const nav = useNavigate();
  const fields = useFields();
  const docs = useDocuments({ sort: 'wave' });
  const dialogs = useEntityDialogs();
  const list = fields.data ?? [];
  const cards = docs.data?.items ?? [];
  const usage = (name: string) => cards.filter((c) => c.crmFields.includes(name)).length;

  const top = list
    .map((f) => ({ f, n: usage(f.name) }))
    .filter((x) => x.n)
    .sort((a, b) => b.n - a.n)
    .slice(0, 2);
  const changed = list.filter((f) => f.status !== 'ok').slice(0, 2);

  return (
    <div className="tcard auto" role="button" tabIndex={0} onClick={() => nav('/fields')}>
      <div className="eyebrow">נוצר אוטומטית · מהנתונים</div>
      <div className="title">שדות CRM שמשתנים השבוע</div>
      <div className="rows">
        {top.map(({ f, n }) => (
          <div key={f.name}>
            <code
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                dialogs.showField(f.name);
              }}
            >
              {f.name}
            </code>
            <span>ב-{n} מסמכים</span>
          </div>
        ))}
        {changed.map((f) => (
          <div key={f.name}>
            <code
              className="hot"
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                dialogs.showField(f.name);
              }}
            >
              {f.name}
            </code>
            <span className="hot">
              {f.status === 'renamed' ? `שונה שם · בדוק ${usage(f.name)}` : 'שדה חדש'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
