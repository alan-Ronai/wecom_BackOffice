import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBlockPage, useImpact } from '../../api/hooks/stage4.js';
import { useDeleteBlock, useFields, useUpsertBlock } from '../../api/hooks/content.js';
import { usePublish } from '../../api/hooks/documents.js';
import { useCan } from '../../api/hooks/me.js';
import type { BlockPage as BlockPageData } from '../../api/stage4.js';
import { CATS } from '../../lib/constants.js';
import { fmtDate } from '../../lib/format.js';
import { Fmt } from '../Fmt.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';

/**
 * `/blocks/:id` — the shared block page (design card 5d).
 *
 * A shared block is one piece of content living inside several documents. Two consequences shape
 * this page: the usage table has to separate **מוטמע** (the text is copied into the document, so
 * the document's published version is stale until it is republished) from **מפנה** (a link, which
 * always reads the latest), and "עדכן את כל ההפניות" therefore means *republish each embedding
 * document* — one publish per document, in sequence, so a failure halfway is visible and the rest
 * of the queue is not silently lost.
 */
export function BlockPage() {
  const { id = '' } = useParams<{ id: string }>();
  const go = useNavigate();
  const page = useBlockPage(id);
  const can = useCan();

  if (page.isError)
    return (
      <div className="scroll-area">
        <div className="lib-body">
          <LoadError what="הבלוק" error={page.error} />
          <button className="btn sm" onClick={() => go('/blocks')}>
            חזרה לבלוקים
          </button>
        </div>
      </div>
    );
  if (!page.data)
    return (
      <div className="scroll-area">
        <div className="lib-body">
          <div className="empty">טוען…</div>
        </div>
      </div>
    );

  return <BlockPageBody data={page.data} canEdit={can('blocks.edit')} canPublish={can('docs.publish')} />;
}

function BlockPageBody({
  data,
  canEdit,
  canPublish,
}: {
  data: BlockPageData;
  canEdit: boolean;
  canPublish: boolean;
}) {
  const go = useNavigate();
  const modal = useModal();
  const toast = useToast();
  const fields = useFields();
  const upsert = useUpsertBlock();
  const del = useDeleteBlock();
  const publish = usePublish();
  const { block, usage, versions } = data;
  const impact = useImpact(`block:${block.id}`);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const embedded = usage.filter((u) => u.mode === 'embedded');
  const references = usage.filter((u) => u.mode === 'reference');
  // One publish per *document*, not per usage row — a block used twice in one document is one
  // republish, and publishing the same document twice would create two pointless versions.
  const embeddingDocuments = [...new Map(embedded.map((u) => [u.documentId, u])).values()];

  /** Republish every document that embeds this block, in sequence, reporting progress. */
  const updateAllReferences = async () => {
    const ok = await modal.confirm(
      'עדכון כל ההפניות',
      `${embeddingDocuments.length} מסמכים מטמיעים את הבלוק. כל אחד מהם יפורסם מחדש כדי לקלוט את הנוסח העדכני, ותיווצר גרסה חדשה בכל אחד.`,
      'עדכן הכל',
      'primary',
    );
    if (!ok) return;
    const label = `עדכון בלוק משותף: ${block.title} (v${block.currentVersion})`;
    const failed: string[] = [];
    setProgress({ done: 0, total: embeddingDocuments.length });
    for (const [i, doc] of embeddingDocuments.entries()) {
      try {
        await publish.mutateAsync({ id: doc.documentId, label });
      } catch {
        failed.push(doc.title);
      }
      setProgress({ done: i + 1, total: embeddingDocuments.length });
    }
    setProgress(null);
    toast(
      failed.length
        ? `עודכנו ${embeddingDocuments.length - failed.length} מתוך ${embeddingDocuments.length} · נכשל: ${failed.join(', ')}`
        : `${embeddingDocuments.length} מסמכים עודכנו`,
      failed.length ? 'warn' : 'ok',
    );
  };

  const doEdit = () => {
    const draft = {
      title: block.title,
      script: block.script ?? '',
      actions: block.actions.map((a) => a.text),
    };
    modal.open({
      title: '✎ עריכת בלוק משותף',
      body: <EditBody block={block} draft={draft} />,
      buttons: [
        {
          label: 'שמור',
          cls: 'primary',
          onClick: () => {
            if (!draft.title.trim()) {
              toast('לבלוק חייב להיות שם', 'warn');
              return false;
            }
            void upsert
              .mutateAsync({
                id: block.id,
                title: draft.title.trim(),
                kind: block.kind,
                description: block.description,
                script: block.kind === 'script' ? draft.script : undefined,
                actions: draft.actions.map((text, i) => ({ id: block.actions[i]?.id ?? `b${i + 1}`, text })),
                outcomes: block.outcomes,
              })
              .then(() => toast('הבלוק נשמר · הטמעות יתעדכנו אחרי פרסום מחדש', 'ok'))
              .catch((e: Error) => toast(e.message, 'warn'));
          },
        },
        { label: 'בטל' },
      ],
    });
  };

  const doDelete = async () => {
    const affected = impact.data?.affectedDocuments ?? usage.length;
    const ok = await modal.confirm(
      'מחיקת בלוק משותף',
      affected
        ? `${affected} מסמכים משתמשים בבלוק. מחיקה תשאיר את הטקסט המוטמע כפי שהוא, אבל ההפניות יישברו ועריכה עתידית לא תתפשט.`
        : 'אף מסמך לא משתמש בבלוק — המחיקה בטוחה.',
      'מחק בלוק',
      'danger',
    );
    if (!ok) return;
    await del.mutateAsync(block.id);
    toast('הבלוק הועבר לסל המיחזור', 'ok');
    go('/blocks');
  };

  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/blocks')}>
            בלוקים משותפים
          </a>
          <span className="sep">/</span>
          <b>⧉ {block.title}</b>
        </div>
        <span className="chip chip-gray">v{block.currentVersion}</span>
        <span className="small muted">{fmtDate(block.updatedAt)}</span>
        <div className="actions">
          <button className="btn sm" onClick={() => go(`/graph?focus=block:${block.id}&depth=2`)}>
            הצג בגרף
          </button>
          {canEdit ? (
            <button className="btn sm" onClick={doEdit}>
              ✎ ערוך בלוק
            </button>
          ) : null}
          {canPublish && embeddingDocuments.length ? (
            <button
              className="btn sm primary"
              disabled={!!progress}
              onClick={() => void updateAllReferences()}
            >
              {progress
                ? `מעדכן ${progress.done}/${progress.total}…`
                : `עדכן את כל ההפניות (${embeddingDocuments.length})`}
            </button>
          ) : null}
        </div>
      </div>

      <div className="scroll-area">
        <div className="lib-body">
          {progress ? (
            <div className="data-banner" role="status">
              <b>
                מעדכן {progress.done} מתוך {progress.total}
              </b>
              <div
                className="progress"
                role="progressbar"
                aria-valuenow={progress.done}
                aria-valuemin={0}
                aria-valuemax={progress.total}
              >
                <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
            </div>
          ) : null}

          <section className="card data-card">
            <div className="hd">
              <b>תוכן הבלוק</b>
              <span className="small muted">{block.kind === 'script' ? 'תסריט' : 'שלב'}</span>
            </div>
            <div style={{ padding: '4px 16px 16px' }}>
              {block.description ? <p className="small muted">{block.description}</p> : null}
              {block.kind === 'script' ? (
                <Fmt
                  as="div"
                  className="script"
                  text={block.script ?? ''}
                  fields={fields.data ?? []}
                  docs={[]}
                />
              ) : (
                <div className="acts">
                  {block.actions.map((a) => (
                    <div className="act" key={a.id}>
                      <span className="caret">›</span>
                      <Fmt text={a.text} fields={fields.data ?? []} docs={[]} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="card data-card">
            <div className="hd">
              <b>שימוש · {usage.length}</b>
              <span className="small muted">
                מוטמע = הטקסט מוצג בתוך המסמך · מפנה = קישור בלבד, תמיד מציג את הנוסח העדכני
              </span>
            </div>
            <div className="data-scroll">
              <table className="table" data-testid="block-usage">
                <thead>
                  <tr>
                    <th>מסמך</th>
                    <th>שלב</th>
                    <th>אופן</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((u) => (
                    <tr
                      key={u.documentId + u.stepKey}
                      className="rowlink"
                      role="button"
                      tabIndex={0}
                      onClick={() => go(`/doc/${u.documentId}/${u.stepKey}`)}
                    >
                      <td>
                        {CATS[u.category].icon} {u.title}
                      </td>
                      <td>{u.stepNum}</td>
                      <td>
                        <span className={'chip ' + (u.mode === 'embedded' ? 'chip-navy' : 'chip-blue')}>
                          {u.mode === 'embedded' ? 'מוטמע' : 'מפנה'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!usage.length ? (
                <div className="small muted" style={{ padding: 12 }}>
                  הבלוק לא משמש באף מסמך
                </div>
              ) : null}
            </div>
            {embedded.length ? (
              <div className="small muted" style={{ padding: '0 16px 14px' }}>
                {embedded.length} הטמעות · {references.length} הפניות. רק ההטמעות דורשות פרסום מחדש.
              </div>
            ) : null}
          </section>

          <section className="card data-card">
            <div className="hd">
              <b>גרסאות</b>
            </div>
            <ol className="timeline">
              {versions
                .slice()
                .reverse()
                .map((v) => (
                  <li key={v.version}>
                    <span className="dot" />
                    <div>
                      <b>v{v.version}</b>
                      <span className="small muted">
                        {' '}
                        {fmtDate(v.createdAt)} · {v.authorName}
                      </span>
                      <div className="small muted">{v.label}</div>
                    </div>
                  </li>
                ))}
              {!versions.length ? <li className="small muted">אין גרסאות</li> : null}
            </ol>
          </section>

          {canEdit ? (
            <section className="card data-card danger-zone">
              <div className="hd">
                <b>אזור מסוכן</b>
              </div>
              <div style={{ padding: '0 16px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="small muted">
                  מחיקה משאירה את הטקסט המוטמע במסמכים, אבל ההפניות יישברו ועריכה עתידית לא תתפשט.
                </span>
                <button className="btn sm danger" onClick={() => void doDelete()}>
                  🗑 מחק בלוק
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Same "write into the caller's draft" shape as the field rename dialog, for the same reason. */
function EditBody({
  block,
  draft,
}: {
  block: BlockPageData['block'];
  draft: { title: string; script: string; actions: string[] };
}) {
  const [title, setTitle] = useState(draft.title);
  const [script, setScript] = useState(draft.script);
  const [actions, setActions] = useState(draft.actions);
  draft.title = title;
  draft.script = script;
  draft.actions = actions;

  return (
    <div className="form">
      <label>
        שם הבלוק
        <input aria-label="שם הבלוק" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {block.kind === 'script' ? (
        <label>
          התסריט
          <textarea aria-label="התסריט" rows={5} value={script} onChange={(e) => setScript(e.target.value)} />
        </label>
      ) : (
        actions.map((text, i) => (
          <label key={i}>
            {`פעולה ${i + 1}`}
            <input
              aria-label={`פעולה ${i + 1}`}
              type="text"
              value={text}
              onChange={(e) => setActions((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </label>
        ))
      )}
    </div>
  );
}
