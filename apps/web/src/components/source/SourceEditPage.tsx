import { Link, useParams } from 'react-router-dom';
import { useDocument } from '../../api/hooks/documents.js';
import { useCan } from '../../api/hooks/me.js';
import { SourceEditor } from './SourceEditor.js';
import { SourceHistory } from './SourceHistory.js';
import { ImportExportButtons } from './ImportExportButtons.js';

/** `/edit/:id/source` — the full-page source document editor, beside the step editor. */
export function SourceEditPage() {
  const { id = '' } = useParams();
  const doc = useDocument(id);
  const can = useCan();
  const canEdit = doc.data ? can('docs.edit', doc.data) : can('docs.edit');
  return (
    <div className="page source-edit-page" dir="rtl">
      <header className="page-head">
        <h1>מקור הידע · {doc.data?.title ?? '…'}</h1>
        <span className="grow" />
        <ImportExportButtons documentId={id} canEdit={canEdit} hasSource />
        <Link className="btn ghost" to={`/edit/${id}`}>
          לעורך תצוגת העבודה
        </Link>
        <Link className="btn ghost" to={`/doc/${id}`}>
          לתצוגת הנציג
        </Link>
      </header>
      <SourceEditor documentId={id} />
      <details className="source-history-wrap">
        <summary>היסטוריית גרסאות מקור</summary>
        <SourceHistory documentId={id} canEdit={canEdit} />
      </details>
    </div>
  );
}
