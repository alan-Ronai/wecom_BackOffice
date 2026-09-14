import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSyncLink, useSyncLinks } from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import type { SyncCounts, SyncLinkState, SyncLinksQuery } from '../../api/stage5.js';
import { ago } from '../../lib/format.js';
import { useDebounced } from '../../lib/useDebounced.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';
import { StateChip, direction } from './state.js';

/** Tabs mirror `SyncQueueResponse.counts`, so the labels and the numbers cannot drift. */
const TABS: [label: string, state: SyncLinkState | null, count: keyof SyncCounts | null][] = [
  ['הכל', null, null],
  ['זהים', 'synced', 'synced'],
  ['ממתין לייבוא', 'pending_import', 'pendingImport'],
  ['ממתין לדחיפה', 'pending_push', 'pendingPush'],
  ['קונפליקט', 'conflict', 'conflict'],
];

export function SyncQueuePage() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const can = useCan();
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 200);

  // The tab lives in the URL so "1 קונפליקט" on the connector registry can link straight to it.
  const state = (sp.get('state') as SyncLinkState | null) ?? null;
  const query: SyncLinksQuery = { ...(state ? { state } : {}), ...(q ? { q } : {}) };
  const links = useSyncLinks(query);
  const sync = useSyncLink();

  const items = links.data?.items ?? [];
  const counts = links.data?.counts;
  const mayWrite = can('sources.manage');

  if (!can('sources.manage') && !can('suggestions.apply'))
    return (
      <div className="empty">
        <b>אין הרשאה לתור הסנכרון</b>
        נדרשת ההרשאה sources.manage
      </div>
    );

  const runOne = async (id: string, dir: 'import' | 'push') => {
    try {
      const r = await sync.mutateAsync({ id, direction: dir });
      toast(
        r.errors.length ? `הסנכרון נכשל · ${r.errors[0]}` : dir === 'import' ? 'נקלט מהמקור' : 'נדחף למקור',
        r.errors.length ? 'warn' : 'ok',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'הסנכרון נכשל', 'warn');
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          <b>תור סנכרון</b>
        </div>
        <div className="facets" style={{ marginInlineStart: 'auto' }}>
          <input
            aria-label="חיפוש בתור"
            placeholder="חפש מסמך"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn sm" onClick={() => nav('/sync/parity')}>
            דו״ח התאמה
          </button>
        </div>
      </div>

      <div className="scroll-area">
        <div className="lib-body">
          {links.isError ? <LoadError what="תור הסנכרון" error={links.error} /> : null}

          <div className="pill-toggle" role="tablist" aria-label="סינון לפי מצב">
            {TABS.map(([label, value, countKey]) => (
              <span
                key={label}
                role="tab"
                tabIndex={0}
                aria-selected={state === value}
                className={state === value ? 'on' : ''}
                onClick={() => {
                  const next = new URLSearchParams(sp);
                  if (value) next.set('state', value);
                  else next.delete('state');
                  setSp(next, { replace: true });
                }}
              >
                {label}
                {countKey && counts ? ` ${counts[countKey]}` : ''}
              </span>
            ))}
          </div>

          {!items.length && !links.isPending ? (
            <div className="empty">
              <b>אין פריטים במצב הזה</b>
              בחרו לשונית אחרת או נקו את החיפוש
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>מסמך</th>
                  <th>מחבר</th>
                  <th>מצב</th>
                  <th>גרסה מקומית</th>
                  <th>סונכרן</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((l) => {
                  const dir = direction(l);
                  return (
                    <tr key={l.id}>
                      <td>
                        <button className="linkish" onClick={() => nav(`/doc/${l.documentId}`)}>
                          {l.title}
                        </button>
                        <div className="small muted">
                          {l.remoteUrl ? (
                            <a href={l.remoteUrl} target="_blank" rel="noreferrer">
                              <bdi className="lat" dir="ltr">
                                {l.externalId}
                              </bdi>{' '}
                              ↗
                            </a>
                          ) : (
                            <bdi className="lat" dir="ltr">
                              {l.externalId}
                            </bdi>
                          )}
                        </div>
                      </td>
                      <td>{l.connectorName}</td>
                      <td>
                        <StateChip state={l.state} />
                      </td>
                      <td>
                        v{l.currentLocalVersion}
                        {l.baseLocalVersion !== null && l.baseLocalVersion !== l.currentLocalVersion ? (
                          <div className="small muted">בסיס v{l.baseLocalVersion}</div>
                        ) : null}
                      </td>
                      <td>{l.lastSyncedAt ? ago(l.lastSyncedAt) : 'מעולם לא'}</td>
                      <td className="row-actions">
                        {l.state === 'conflict' ? (
                          <button className="btn xs danger" onClick={() => nav(`/sync/conflicts/${l.id}`)}>
                            פתור קונפליקט
                          </button>
                        ) : dir && mayWrite ? (
                          <button
                            className="btn xs"
                            disabled={sync.isPending}
                            onClick={() => void runOne(l.id, dir)}
                          >
                            {dir === 'import' ? 'ייבא עכשיו' : 'דחוף עכשיו'}
                          </button>
                        ) : (
                          <span className="small muted">אין פעולה</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
