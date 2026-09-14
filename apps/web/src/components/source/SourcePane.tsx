import { Link } from 'react-router-dom';
import { rawRevisionUrl, useSourceDocument } from '../../api/hooks/sourcedocs.js';
import { Empty, LoadError } from '../ui/index.js';
import { ImportExportButtons } from './ImportExportButtons.js';

/**
 * Read-only view of the HTML source document ("מקור האמת").
 *
 * The HTML is run through the server-side allowlist sanitizer on every save and on every import,
 * so what comes back from `GET /documents/:id/source` is already safe to render as-is.
 */
export function SourcePane({
  documentId,
  canEdit,
  sourceId,
  latestRevisionId,
}: {
  documentId: string;
  canEdit: boolean;
  sourceId?: string | null;
  latestRevisionId?: string | null;
}) {
  const q = useSourceDocument(documentId);
  if (q.isPending) return <div className="muted">טוען מקור…</div>;
  if (q.error) return <LoadError what="מסמך המקור" error={q.error} />;
  if (!q.data)
    return (
      <Empty title="אין עדיין מסמך מקור לפריט זה">
        {canEdit ? (
          <Link className="btn" to={`/edit/${documentId}/source`}>
            צור מסמך מקור
          </Link>
        ) : null}
        <ImportExportButtons documentId={documentId} canEdit={canEdit} hasSource={false} />
      </Empty>
    );
  return (
    <section className="source-pane" dir="rtl">
      <header className="source-pane-head">
        <span className="muted">
          גרסת מקור {q.data.version}
          {q.data.updatedByName ? ` · ${q.data.updatedByName}` : ''}
        </span>
        <span className="grow" />
        {canEdit ? (
          <Link className="btn" to={`/edit/${documentId}/source`}>
            ערוך מקור
          </Link>
        ) : null}
        <ImportExportButtons documentId={documentId} canEdit={canEdit} hasSource />
        {sourceId && latestRevisionId ? (
          <a className="btn ghost" href={rawRevisionUrl(sourceId, latestRevisionId)}>
            הורד קובץ מקור
          </a>
        ) : null}
      </header>
      <article className="prose source-html" dangerouslySetInnerHTML={{ __html: q.data.html }} />
    </section>
  );
}
