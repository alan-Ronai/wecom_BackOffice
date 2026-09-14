import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSyncLinks } from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import type { SyncLinkRow } from '../../api/stage5.js';
import { ago } from '../../lib/format.js';
import { LoadError } from '../ui/index.js';
import { StateChip } from './state.js';

/**
 * The parity report answers one question the queue cannot: per connector, how much of what it
 * owns is actually in step. The queue is a worklist; this is the standing.
 */
export function ParityPage() {
  const nav = useNavigate();
  const can = useCan();
  // Page size is deliberately large: a report that silently covered the first fifty links would
  // report parity for a sample and call it the whole.
  const links = useSyncLinks({ pageSize: 200 });

  const groups = useMemo(() => {
    const byConnector = new Map<string, { name: string; rows: SyncLinkRow[] }>();
    for (const l of links.data?.items ?? []) {
      const g = byConnector.get(l.connectorId) ?? { name: l.connectorName, rows: [] };
      g.rows.push(l);
      byConnector.set(l.connectorId, g);
    }
    return [...byConnector.entries()].map(([id, g]) => ({
      id,
      name: g.name,
      rows: g.rows,
      inStep: g.rows.filter((r) => r.state === 'synced').length,
      conflicts: g.rows.filter((r) => r.state === 'conflict').length,
    }));
  }, [links.data]);

  if (!can('sources.manage') && !can('suggestions.apply'))
    return (
      <div className="empty">
        <b>אין הרשאה לדו״ח ההתאמה</b>
        נדרשת ההרשאה sources.manage
      </div>
    );

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          <button className="linkish" onClick={() => nav('/sync')}>
            תור סנכרון
          </button>
          {' / '}
          <b>דו״ח התאמה</b>
        </div>
      </div>

      <div className="scroll-area">
        <div className="lib-body">
          {links.isError ? <LoadError what="דו״ח ההתאמה" error={links.error} /> : null}
          {!groups.length && !links.isPending ? (
            <div className="empty">
              <b>אין קישורי סנכרון</b>
              חברו מסמכים למחבר כדי לראות התאמה
            </div>
          ) : null}

          {groups.map((g) => (
            <section key={g.id} className="parity-group">
              <div className="lib-head">
                <div>
                  <h1>
                    {g.name}
                    <span>
                      {g.inStep} מתוך {g.rows.length} זהים
                      {g.conflicts ? ` · ${g.conflicts} קונפליקטים` : ''}
                    </span>
                  </h1>
                </div>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>מסמך</th>
                    <th>מזהה חיצוני</th>
                    <th>מצב</th>
                    <th>שינוי מרוחק</th>
                    <th>שינוי מקומי</th>
                    <th>סונכרן</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <button className="linkish" onClick={() => nav(`/doc/${l.documentId}`)}>
                          {l.title}
                        </button>
                      </td>
                      <td>
                        <bdi className="lat" dir="ltr">
                          {l.externalId}
                        </bdi>
                      </td>
                      <td>
                        <StateChip state={l.state} />
                      </td>
                      <td>{l.remoteChanged ? 'כן' : '—'}</td>
                      <td>{l.localChanged ? `כן · v${l.currentLocalVersion}` : '—'}</td>
                      <td>{l.lastSyncedAt ? ago(l.lastSyncedAt) : 'מעולם לא'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
