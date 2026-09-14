import { useState } from 'react';
import { useRestoreSource, useSourceVersion, useSourceVersions } from '../../api/hooks/sourcedocs.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { fmtDate } from '../../lib/format.js';

/** Source version list, newest first, with a preview and (for editors) restore-as-new-version. */
export function SourceHistory({ documentId, canEdit }: { documentId: string; canEdit: boolean }) {
  const versions = useSourceVersions(documentId);
  const [open, setOpen] = useState<number | null>(null);
  const preview = useSourceVersion(documentId, open ?? undefined);
  const restore = useRestoreSource(documentId);
  const modal = useModal();
  const toast = useToast();
  const items = versions.data;
  if (!items?.length) return <div className="muted">אין גרסאות מקור</div>;
  const latest = items[0].version;
  return (
    <div className="source-history" dir="rtl">
      <ul className="version-list">
        {items.map((v) => (
          <li key={v.version} className={open === v.version ? 'on' : ''}>
            <button type="button" className="linklike" onClick={() => setOpen(v.version)}>
              גרסה {v.version} · {v.label || 'ללא תיאור'} · {v.authorName} · {fmtDate(v.createdAt)}
            </button>
            {canEdit && v.version !== latest ? (
              <button
                type="button"
                className="btn ghost sm"
                onClick={async () => {
                  if (
                    !(await modal.confirm(
                      'שחזור גרסת מקור',
                      `לשחזר את גרסה ${v.version} כגרסה חדשה?`,
                      'שחזר',
                    ))
                  )
                    return;
                  await restore.mutateAsync(v.version);
                  toast('הגרסה שוחזרה', 'ok');
                }}
              >
                שחזר
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {preview.data ? (
        <article className="prose source-html" dangerouslySetInnerHTML={{ __html: preview.data.html }} />
      ) : null}
    </div>
  );
}
