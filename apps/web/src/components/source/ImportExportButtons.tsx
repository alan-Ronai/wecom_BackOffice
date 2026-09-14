import { useRef } from 'react';
import { exportDocxUrl, useImportDocx } from '../../api/hooks/sourcedocs.js';
import { useToast } from '../ui/Toast.js';

/** Import a `.docx` as a new source version (editors) and export the current one (everyone). */
export function ImportExportButtons({
  documentId,
  canEdit,
  hasSource,
}: {
  documentId: string;
  canEdit: boolean;
  hasSource: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const importM = useImportDocx(documentId);
  const toast = useToast();
  return (
    <>
      {canEdit ? (
        <>
          <button
            type="button"
            className="btn ghost"
            disabled={importM.isPending}
            onClick={() => input.current?.click()}
          >
            {importM.isPending ? 'מייבא…' : 'ייבוא מ-Word'}
          </button>
          <input
            ref={input}
            type="file"
            accept=".docx"
            hidden
            aria-label="קובץ Word לייבוא"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const s = await importM.mutateAsync(f);
                toast(`יובא כגרסת מקור ${s.version}`, 'ok');
              } catch (err) {
                toast(err instanceof Error ? err.message : 'הייבוא נכשל', 'warn');
              }
            }}
          />
        </>
      ) : null}
      {hasSource ? (
        <a className="btn ghost" href={exportDocxUrl(documentId)} download>
          ייצוא ל-Word
        </a>
      ) : null}
    </>
  );
}
