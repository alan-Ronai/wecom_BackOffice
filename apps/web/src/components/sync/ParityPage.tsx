import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateSyncLink, useParity } from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import { ApiError } from '../../api/unwrap.js';
import type { ParityConnector, ParityUnlinkedRemote } from '../../api/stage5.js';
import { ago } from '../../lib/format.js';
import { LoadError } from '../ui/index.js';
import { useToast } from '../ui/Toast.js';
import { StateChip } from './state.js';
import { counted, documents as nDocs, items as nItems } from '../../lib/count.js';

/** Design 4d shows seven characters. A full sha256 in a table cell is noise, not information. */
const shortHash = (h: string | null): string => (h ? h.slice(0, 7) : '—');

/**
 * The parity report answers one question the queue cannot: per connector, how much of what it owns
 * is actually in step — and, crucially, what is on *neither* list.
 *
 * The queue is built out of `sync_links`, so by construction it can only show rows that already
 * have a link. The two things most worth knowing are the ones with no link at all: a published
 * document nobody ever connected, and a remote page nobody ever imported. Those come from
 * `GET /sync/parity`, which is also where each side's content hash comes from — the queue carries
 * a state pill and a version number, and neither answers "is this the same content".
 */
export function ParityPage() {
  const nav = useNavigate();
  const can = useCan();
  const mayLink = can('sources.manage');
  const report = useParity(undefined, { enabled: mayLink || can('suggestions.apply') });

  if (!mayLink && !can('suggestions.apply'))
    return (
      <div className="empty">
        <b>אין הרשאה לדו״ח ההתאמה</b>
        נדרשת ההרשאה sources.manage
      </div>
    );

  const groups = report.data?.connectors ?? [];

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
          {report.isError ? <LoadError what="דו״ח ההתאמה" error={report.error} /> : null}
          {!groups.length && !report.isPending ? (
            <div className="empty">
              <b>אין מחברים</b>
              הגדירו מחבר כדי לראות התאמה
            </div>
          ) : null}

          {groups.map((g) => (
            <ConnectorParity key={g.connectorId} group={g} mayLink={mayLink} />
          ))}
        </div>
      </div>
    </>
  );
}

function ConnectorParity({ group: g, mayLink }: { group: ParityConnector; mayLink: boolean }) {
  const nav = useNavigate();
  const inStep = g.items.filter((r) => r.state === 'synced').length;
  const conflicts = g.items.filter((r) => r.state === 'conflict').length;

  return (
    <section className="parity-group">
      <div className="lib-head">
        <div>
          <h1>
            {g.connectorName}
            <span>
              {inStep} מתוך {g.items.length} זהים
              {conflicts ? ` · ${conflicts} קונפליקטים` : ''}
            </span>
          </h1>
        </div>
      </div>

      {/*
        An unreachable remote is stated once, at the top, rather than repeated as "—" down a
        column: every row's remote side is unknown for the same single reason, and a table full of
        dashes reads as "everything was deleted", which is the opposite of what happened.
      */}
      {!g.remoteAvailable ? (
        <div className="parity-warn" role="status">
          לא ניתן היה לקרוא את הצד המרוחק · הערכים המרוחקים אינם מעודכנים בדו״ח הזה
        </div>
      ) : null}

      <table className="table">
        <thead>
          <tr>
            <th>מסמך</th>
            <th>מזהה חיצוני</th>
            <th>{g.connectorName}</th>
            <th>הספרייה</th>
            <th>מצב</th>
            <th>סונכרן</th>
          </tr>
        </thead>
        <tbody>
          {g.items.map((l) => (
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
              {/*
                Each side gets its own cell with its own fingerprint and its own timestamp, which is
                what design 4d asks for. The remote hash is shown against the baseline both sides
                agreed on, so "moved" is visible without having to read the state pill.
              */}
              <td>
                {l.unlinkedReason === 'remote_missing' ? (
                  <span className="chip chip-gray" title="הפריט אינו קיים עוד בצד המרוחק">
                    נמחק מרחוק
                  </span>
                ) : l.unlinkedReason === 'remote_unavailable' ? (
                  <span className="small muted">לא נקרא</span>
                ) : (
                  <>
                    <bdi className="lat" dir="ltr" title={l.remoteHash ?? ''}>
                      {shortHash(l.remoteHash)}
                    </bdi>
                    {l.remoteHash && l.remoteHash !== l.baseRemoteHash ? (
                      <span className="chip chip-amber" title={`בסיס ${shortHash(l.baseRemoteHash)}`}>
                        השתנה
                      </span>
                    ) : null}
                    <div className="small muted">{l.remoteUpdatedAt ? ago(l.remoteUpdatedAt) : '—'}</div>
                  </>
                )}
              </td>
              <td>
                <bdi className="lat" dir="ltr" title={l.localHash}>
                  {shortHash(l.localHash)}
                </bdi>
                <span className="small muted"> v{l.currentLocalVersion}</span>
                {l.localChanged ? (
                  <span className="chip chip-amber" title={`בסיס v${l.baseLocalVersion ?? 0}`}>
                    השתנה
                  </span>
                ) : null}
              </td>
              <td>
                <StateChip state={l.state} />
              </td>
              <td>{l.lastSyncedAt ? ago(l.lastSyncedAt) : 'מעולם לא'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Unlinked group={g} mayLink={mayLink} />
    </section>
  );
}

/**
 * The two lists the queue structurally cannot show. Linking is a pairing, so it takes one of each:
 * a document is selected, then a remote item's "קשר" completes the pair. Offering "קשר" on a
 * document alone would have to invent an `externalId`, and inventing one is how a link gets made to
 * a page that does not exist.
 */
function Unlinked({ group: g, mayLink }: { group: ParityConnector; mayLink: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  const create = useCreateSyncLink();
  const toast = useToast();
  const nav = useNavigate();
  const docs = g.unlinked.documents;
  const remote = g.unlinked.remote;

  if (!docs.length && !remote.length) return null;

  const link = async (item: ParityUnlinkedRemote) => {
    if (!picked) return;
    try {
      await create.mutateAsync({
        connectorId: g.connectorId,
        documentId: picked,
        externalId: item.externalId,
      });
      setPicked(null);
      toast('הקישור נוצר · יסונכרן בריצה הבאה', 'ok');
    } catch (e) {
      // 409 is the interesting one: somebody linked one of these two ends while this page was open.
      toast(e instanceof ApiError && e.status === 409 ? e.message : 'יצירת הקישור נכשלה', 'warn');
    }
  };

  return (
    <div className="parity-unlinked">
      <div className="lib-head">
        <div>
          <h2>
            ללא קישור
            <span>
              {nDocs(docs.length)} · {counted(remote.length, nItems, 'מרוחק', 'מרוחקים')}
            </span>
          </h2>
        </div>
      </div>

      <div className="parity-unlinked-cols">
        <div>
          <div className="eyebrow">מסמכים ללא קישור</div>
          {!docs.length ? <div className="small muted">אין</div> : null}
          <ul className="plain">
            {docs.map((d) => (
              <li key={d.documentId}>
                {mayLink ? (
                  <label>
                    <input
                      type="radio"
                      name={`pick-${g.connectorId}`}
                      aria-label={`בחר ${d.title}`}
                      checked={picked === d.documentId}
                      onChange={() => setPicked(d.documentId)}
                    />
                    {d.title}
                  </label>
                ) : (
                  <span>{d.title}</span>
                )}
                <span className="small muted">
                  {' '}
                  v{d.currentVersion} · {d.updatedAt ? ago(d.updatedAt) : '—'}
                </span>
                <button className="linkish small" onClick={() => nav(`/doc/${d.documentId}`)}>
                  פתח
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="eyebrow">פריטים מרוחקים ללא קישור</div>
          {!remote.length ? <div className="small muted">אין</div> : null}
          <ul className="plain">
            {remote.map((r) => (
              <li key={r.externalId}>
                <b>{r.title}</b>
                <bdi className="lat small muted" dir="ltr">
                  {' '}
                  {r.externalId}
                </bdi>
                {mayLink ? (
                  <button
                    className="btn xs"
                    // Without a document selected there is no pair to make, and the button says so
                    // through its title rather than vanishing — a control that disappears while the
                    // operator is looking for it is worse than one that explains itself.
                    disabled={!picked || create.isPending}
                    title={picked ? 'קשר לפריט הנבחר' : 'בחרו קודם מסמך מהרשימה'}
                    onClick={() => void link(r)}
                  >
                    קשר
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
