import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import type { Document } from '@wecom/shared';
import { api } from '../../api/client.js';
import { keys } from '../../api/keys.js';
import { unwrap } from '../../api/unwrap.js';
import { useDocument, useDocuments, useRestore, useVersions } from '../../api/hooks/documents.js';
import { useBlocks } from '../../api/hooks/content.js';
import { useCan } from '../../api/hooks/me.js';
import { useMe } from '../../api/hooks/me.js';
import { CATS } from '../../lib/constants.js';
import { download, fmtDate } from '../../lib/format.js';
import { blameMap, diffStats, diffSteps } from '../../lib/diffSteps.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { DiffView } from './DiffView.js';

const MAX_SNAPSHOTS = 25;

/** Document picker when no `:id` is in the route (legacy history view). */
function Picker() {
  const go = useNavigate();
  const docs = useDocuments({ sort: 'updated' });
  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/library')}>
            ספרייה
          </a>
          <span className="sep">/</span>
          <b>היסטוריית גרסאות</b>
        </div>
      </div>
      <div className="scroll-area">
        <div className="lib-body">
          <div className="lib-head">
            <div>
              <h1>היסטוריית גרסאות</h1>
              <p>בחר מסמך כדי להשוות גרסאות, לראות מי שינה כל בלוק ולשחזר</p>
            </div>
          </div>
          <div className="grid">
            {(docs.data?.items ?? []).map((d) => (
              <div
                className="tcard"
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => go(`/history/${d.id}`)}
              >
                <div className="chips">
                  <span className="chip chip-blue">{CATS[d.category].short}</span>
                  <span className="chip chip-gray">v{d.currentVersion}</span>
                </div>
                <div className="title">{d.title}</div>
                <div className="meta">
                  <span>{d.currentVersion} גרסאות</span>
                  <span>·</span>
                  <span>
                    {d.authorName ?? ''} · {fmtDate(d.updatedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export function HistoryPage() {
  const { id, v } = useParams<{ id?: string; v?: string }>();
  const go = useNavigate();
  const can = useCan();
  const me = useMe();
  const modal = useModal();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'published' | 'mine'>('all');

  const docQ = useDocument(id);
  const versionsQ = useVersions(id);
  const blocks = useBlocks();
  const restore = useRestore(id ?? '');

  const versions = useMemo(
    () => [...(versionsQ.data ?? [])].sort((a, b) => b.version - a.version),
    [versionsQ.data],
  );
  const curV = versions[0]?.version ?? docQ.data?.currentVersion ?? 1;
  const older = versions.filter((x) => x.version < curV);
  const cmpV =
    v && versions.some((x) => x.version === Number(v)) && Number(v) !== curV
      ? Number(v)
      : (older[0]?.version ?? null);

  // Snapshots power both the comparison and the blame map; capped so a long history stays cheap.
  const snapshotVersions = versions.slice(0, MAX_SNAPSHOTS).map((x) => x.version);
  const snapshots = useQueries({
    queries: snapshotVersions.map((n) => ({
      queryKey: keys.version(id ?? '', n),
      enabled: !!id,
      queryFn: async (): Promise<Document> =>
        unwrap(await api.GET('/documents/{id}/versions/{v}', { params: { path: { id: id!, v: n } } })),
    })),
  });
  const snapshotOf = (n: number | null): Document | undefined =>
    n == null ? undefined : snapshots[snapshotVersions.indexOf(n)]?.data;

  const loadedSnapshots = snapshots.map((s) => s.data);
  const snapshotsReady = loadedSnapshots.filter(Boolean).length;
  const blame = useMemo(() => {
    const list = versions
      .map((x, i) => ({ version: x.version, author: x.authorName, doc: loadedSnapshots[i] }))
      .filter((x): x is { version: number; author: string; doc: Document } => !!x.doc);
    return blameMap(list, blocks.data);
    // `snapshotsReady` stands in for the snapshot array, which is a new reference every render.
  }, [versions, snapshotsReady, blocks.data]); // eslint-disable-line

  if (!id) return <Picker />;
  if (docQ.isPending) return <div className="route-loading">טוען…</div>;
  const doc = docQ.data;
  if (!doc)
    return (
      <div className="empty">
        <b>המסמך לא נמצא</b>
      </div>
    );

  const oldDoc = snapshotOf(cmpV);
  const rows = oldDoc ? diffSteps(oldDoc, doc, blocks.data) : [];
  const st = diffStats(rows);
  const shown = versions.filter(
    (x) =>
      filter === 'all' ||
      (filter === 'published' && x.kind === 'published') ||
      (filter === 'mine' && x.authorName === me.data?.user.displayName),
  );

  const doRestore = async () => {
    if (cmpV == null) return;
    const ok = await modal.confirm(
      `שחזור ל-v${cmpV}`,
      `המסמך יחזור למצב של גרסה v${cmpV}. השחזור נשמר כגרסה חדשה (v${curV + 1}), כך שאפשר לבטל גם אותו.`,
      `שחזר ל-v${cmpV}`,
      'navy',
    );
    if (!ok) return;
    const next = await restore.mutateAsync(cmpV);
    toast(`שוחזר מגרסה v${cmpV} כגרסה v${next.currentVersion}`, 'ok');
  };

  return (
    <div className="hist-layout">
      <aside className="hist-side">
        <div className="hd">
          <b>היסטוריית גרסאות</b>
          <span>{doc.title}</span>
        </div>
        <div className="filters">
          {(
            [
              ['all', 'הכל'],
              ['published', 'פורסם'],
              ['mine', 'שלי'],
            ] as const
          ).map(([k, l]) => (
            <span
              key={k}
              className={'facet' + (filter === k ? ' on' : '')}
              style={{ padding: '3px 9px', fontSize: 11 }}
              role="button"
              tabIndex={0}
              onClick={() => setFilter(k)}
            >
              {l}
            </span>
          ))}
        </div>
        <div className="vlist">
          {!shown.length ? (
            <div className="small muted" style={{ padding: 10 }}>
              אין גרסאות תואמות
            </div>
          ) : null}
          {shown.map((x) => {
            const isCur = x.version === curV;
            const isCmp = x.version === cmpV;
            const prev = versions.find((y) => y.version < x.version);
            const prevSnap = prev ? snapshotOf(prev.version) : undefined;
            const mine = isCur ? doc : snapshotOf(x.version);
            const stats =
              prevSnap && mine
                ? (() => {
                    const s = diffStats(diffSteps(prevSnap, mine, blocks.data));
                    return [
                      s.added ? `+${s.added} שלבים` : null,
                      s.changed ? `~${s.changed} שונו` : null,
                      s.removed ? `−${s.removed}` : null,
                    ].filter(Boolean) as string[];
                  })()
                : [];
            return (
              <div
                key={x.version}
                className={'vi' + (isCur ? ' cur' : isCmp ? ' cmp' : '')}
                title={isCur ? 'הגרסה הנוכחית' : 'לחץ להשוואה מול הגרסה הנוכחית'}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!isCur) go(`/history/${id}/${x.version}`, { replace: true });
                }}
              >
                <span className="d" />
                <div className="b">
                  <div className="t">
                    v{x.version}
                    {isCur ? ' · נוכחי' : isCmp ? ' · בהשוואה' : ''}
                  </div>
                  <div className="m">
                    {x.authorName} · {fmtDate(x.createdAt)}
                  </div>
                  {x.label ? <div className="l">{x.label}</div> : null}
                  {stats.length ? (
                    <div className="s">
                      {stats.map((s) => (
                        <span key={s} className={s.startsWith('+') ? 'add' : s.startsWith('−') ? 'rem' : ''}>
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <div className="hist-main">
        <div className="topbar">
          <Hamburger />
          <button className="btn ghost sm" onClick={() => go(`/doc/${id}`)}>
            → למסמך
          </button>
          {cmpV != null ? (
            <span className="vtag">v{cmpV}</span>
          ) : (
            <span className="muted">אין גרסה קודמת להשוואה</span>
          )}
          {cmpV != null ? <span className="muted">←→</span> : null}
          <span className="vtag cur">v{curV} נוכחי</span>
          {cmpV != null ? (
            <span className="muted" style={{ marginInlineStart: 12, whiteSpace: 'nowrap' }}>
              {[
                st.changed ? `${st.changed} שונו` : null,
                st.added ? `${st.added} נוסף` : null,
                st.removed ? `${st.removed} הוסר` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'ללא שינויים בשלבים'}
            </span>
          ) : null}
          <div className="actions">
            <button
              className="btn sm"
              onClick={() =>
                modal.open({
                  title: `JSON · v${cmpV ?? curV}`,
                  wide: true,
                  body: <pre>{JSON.stringify(oldDoc ?? doc, null, 2)}</pre>,
                  buttons: [
                    {
                      label: 'הורד',
                      onClick: () =>
                        download(`${doc.slug}-v${cmpV ?? curV}.json`, JSON.stringify(oldDoc ?? doc, null, 2)),
                    },
                    { label: 'סגור' },
                  ],
                })
              }
            >
              הצג JSON
            </button>
            {cmpV != null && can('docs.restore', doc) ? (
              <button className="btn navy sm" onClick={() => void doRestore()}>
                שחזר ל-v{cmpV}
              </button>
            ) : null}
          </div>
        </div>
        {oldDoc ? (
          <DiffView
            oldDoc={oldDoc}
            newDoc={doc}
            blocks={blocks.data}
            blame={blame}
            leftLabel={`v${cmpV} · ${fmtDate(versions.find((x) => x.version === cmpV)?.createdAt ?? doc.updatedAt)}`}
            rightLabel={`v${curV} · ${fmtDate(doc.updatedAt)} · נוכחי`}
          />
        ) : (
          <div className="empty">
            <b>זו הגרסה הראשונה של המסמך</b>פרסום מהעורך יוסיף גרסאות להשוואה
          </div>
        )}
      </div>
    </div>
  );
}
