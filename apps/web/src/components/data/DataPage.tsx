import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useDataFiles,
  useDataPreview,
  usePutMapping,
  useReimport,
  useUploadDataFile,
} from '../../api/hooks/stage4.js';
import { useCan } from '../../api/hooks/me.js';
import type { DataFile } from '../../api/stage4.js';
import { SYNC_STATE } from '../../lib/constants.js';
import { ago } from '../../lib/format.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { LoadError } from '../ui/index.js';
import { useToast } from '../ui/Toast.js';
import { MappingEditor } from './MappingEditor.js';

const ICON: Record<DataFile['kind'], string> = { json: '📄', csv: '📊' };

/**
 * `/data` and `/data/:sourceId` — the json/csv half of the source pipeline (design card 5a).
 *
 * Word sources are reviewed paragraph-by-paragraph on `/sources`; a data file has no prose to
 * diff, so what it needs instead is a *schema*: which column becomes which card field. Re-import
 * then replays the rows through the same suggestion pipeline, which is why the success state
 * links straight to `/sources/:id` — that is where the resulting suggestions are reviewed.
 */
export function DataPage() {
  const { sourceId } = useParams<{ sourceId?: string }>();
  const go = useNavigate();
  const can = useCan();
  const toast = useToast();
  const files = useDataFiles();
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useUploadDataFile();
  const [queued, setQueued] = useState<string | null>(null);

  const list = files.data?.items ?? [];
  const current = list.find((f) => f.sourceId === sourceId) ?? list[0];
  const canManage = can('sources.manage');

  return (
    <div className="data-layout">
      <aside className="src-side">
        <div className="logo" role="button" tabIndex={0} onClick={() => go('/library')}>
          wecom.
        </div>
        <div className="sec-title">קבצי נתונים · {list.length}</div>
        {/* The main sidebar also lists `topics.json` & co. as legacy source rows, so this list is
            addressable on its own rather than by filename alone. */}
        <div className="docs" data-testid="data-files">
          {list.map((f) => {
            const st = SYNC_STATE[f.syncState];
            return (
              <div
                key={f.sourceId}
                className={'sdoc' + (current?.sourceId === f.sourceId ? ' on' : '')}
                role="button"
                tabIndex={0}
                onClick={() => go(`/data/${f.sourceId}`, { replace: true })}
              >
                <span className="r">
                  <span>
                    {ICON[f.kind]}{' '}
                    <bdi className="lat" dir="ltr">
                      {f.title}
                    </bdi>
                  </span>
                  <span className="ext" aria-label={st.label} title={st.label}>
                    {st.mark}
                  </span>
                </span>
                <span className={'st' + (f.syncState === 'synced' ? '' : ' warn')}>
                  {f.rows} שורות
                  {f.mapping.every((m) => m.field === 'ignore')
                    ? ' · לא ממופה'
                    : f.lastSyncedAt
                      ? ` · ייבוא ${ago(f.lastSyncedAt)}`
                      : ''}
                </span>
              </div>
            );
          })}
          {canManage ? (
            <div
              className="src-add"
              style={{ textAlign: 'center', justifyContent: 'center' }}
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
            >
              ✚ העלה JSON / CSV
            </div>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv"
            aria-label="העלה קובץ נתונים"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const created = await upload.mutateAsync(f);
              toast('הקובץ הועלה · מפו את העמודות כדי לייבא', 'ok');
              go(`/data/${created.sourceId}`);
            }}
          />
        </div>
        <div className="model">
          <div className="dim">כל קובץ הוא מקור מסוג JSON/CSV עם מיפוי סכימה.</div>
        </div>
      </aside>

      <div className="src-main">
        {files.isError ? (
          <LoadError what="קבצי נתונים" error={files.error} />
        ) : !current ? (
          <div className="empty">
            <b>אין קבצי נתונים</b>
            העלו JSON או CSV כדי למפות אותו לכרטיסי ידע
          </div>
        ) : (
          <DataFileView
            file={current}
            canManage={canManage}
            queued={queued === current.sourceId}
            onQueued={() => setQueued(current.sourceId)}
          />
        )}
      </div>
    </div>
  );
}

function DataFileView({
  file,
  canManage,
  queued,
  onQueued,
}: {
  file: DataFile;
  canManage: boolean;
  queued: boolean;
  onQueued: () => void;
}) {
  const go = useNavigate();
  const toast = useToast();
  const preview = useDataPreview(file.sourceId);
  const putMapping = usePutMapping(file.sourceId);
  const reimport = useReimport(file.sourceId);
  const st = SYNC_STATE[file.syncState];

  const doReimport = async () => {
    const res = await reimport.mutateAsync();
    onQueued();
    toast(
      res.duplicate ? 'הקובץ לא השתנה מאז הייבוא האחרון' : 'הקובץ נשלח לעיבוד · ההצעות ייווצרו ברקע',
      res.duplicate ? 'warn' : 'ok',
    );
  };

  return (
    <>
      <div className="topbar h56">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/data')}>
            נתונים
          </a>
          <span className="sep">/</span>
          <b>
            <bdi className="lat" dir="ltr">
              {file.title}
            </bdi>
          </b>
        </div>
        <span className="chip chip-gray">{file.kind.toUpperCase()}</span>
        <span className={'chip ' + st.cls}>{st.label}</span>
        <span className="small muted">
          {file.rows} שורות · {file.lastSyncedAt ? `ייבוא אחרון ${ago(file.lastSyncedAt)}` : 'טרם יובא'}
        </span>
        <div className="actions">
          {canManage ? (
            <button className="btn navy sm" disabled={reimport.isPending} onClick={() => void doReimport()}>
              ⟳ {reimport.isPending ? 'מייבא…' : 'ייבא מחדש'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="scroll-area">
        <div className="lib-body">
          {queued ? (
            <div className="data-banner" role="status">
              <b>הייבוא נשלח לעיבוד</b>
              <span>השורות עוברות דרך מנוע ההצעות · כל שינוי יופיע כהצעה לאישור.</span>
              <button className="btn sm primary" onClick={() => go(`/sources/${file.sourceId}`)}>
                עבור להצעות
              </button>
            </div>
          ) : null}

          <MappingEditor
            file={file}
            canManage={canManage}
            saving={putMapping.isPending}
            onSave={async (m) => {
              await putMapping.mutateAsync({ mapping: m });
              toast('המיפוי נשמר', 'ok');
            }}
          />

          <section className="card data-card">
            <div className="hd">
              <b>תצוגה מקדימה</b>
              <span className="small muted">
                {preview.data ? `${preview.data.rows.length} מתוך ${preview.data.total} שורות` : '…'}
              </span>
            </div>
            {preview.isError ? (
              <LoadError what="תצוגה מקדימה" error={preview.error} />
            ) : (
              <div className="data-scroll">
                <table className="table" data-testid="data-preview">
                  <thead>
                    <tr>
                      {(preview.data?.columns ?? file.columns).map((c) => (
                        <th key={c}>
                          <bdi className="lat" dir="ltr">
                            {c}
                          </bdi>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(preview.data?.rows ?? []).map((row, i) => (
                      <tr key={i}>
                        {(preview.data?.columns ?? file.columns).map((c) => (
                          <td key={c}>{row[c] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.data && !preview.data.rows.length ? (
                  <div className="small muted" style={{ padding: 12 }}>
                    אין שורות להצגה
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
