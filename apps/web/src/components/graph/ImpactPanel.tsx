import { useNavigate } from 'react-router-dom';
import type { GraphNode, ImpactResponse } from '../../api/stage4.js';
import { LINK_TYPE_LABEL, NODE_KINDS } from '../../lib/constants.js';
import { useNav } from '../shell/navStore.js';
import { LoadError } from '../ui/index.js';

/** `doc:<uuid>` → `/doc/<uuid>`, `field:<name>` → `/fields/<name>`, and so on. */
export function hrefForNode(id: string): string | null {
  const i = id.indexOf(':');
  if (i < 0) return null;
  const kind = id.slice(0, i);
  const rest = id.slice(i + 1);
  if (kind === 'doc') return `/doc/${rest}`;
  if (kind === 'block') return `/blocks/${rest}`;
  if (kind === 'field') return `/fields/${encodeURIComponent(rest)}`;
  if (kind === 'source') return `/sources/${rest}`;
  return null;
}

/**
 * "מה נשבר אם אמחק" — the side panel of the graph (design card 5b).
 *
 * Deletion in this product is never local: a shared block lives inside five documents and a CRM
 * field is referenced by name in step text, so the only honest answer to "can I delete this" is
 * the inbound edge list. That is what `GET /graph/impact/:nodeId` returns and all this panel does
 * is show it before anyone commits.
 */
export function ImpactPanel({
  node,
  impact,
  loading,
  error,
  onFocus,
}: {
  node?: GraphNode;
  impact?: ImpactResponse;
  loading: boolean;
  error?: unknown;
  onFocus: () => void;
}) {
  const go = useNavigate();
  const nav = useNav();

  if (!node)
    return (
      <aside className="graph-panel" aria-label="פרטי צומת">
        <div className="empty">
          <b>בחרו צומת</b>
          לחיצה על צומת מציגה מה מפנה אליו ומה יישבר אם יימחק
        </div>
      </aside>
    );

  const kind = NODE_KINDS[node.kind];
  const href = hrefForNode(node.id);
  const docId = node.kind === 'document' ? node.id.slice('doc:'.length) : undefined;

  return (
    <aside className="graph-panel" aria-label="פרטי צומת">
      <div className="hd">
        <span className="eyebrow">נבחר</span>
        <b>{node.label}</b>
        <span className="small muted">
          {kind.label}
          {node.category ? ' · ' + node.category : ''} · {node.degree} קשרים
        </span>
      </div>

      <div className="body">
        <div className="graph-actions">
          {href ? (
            <button className="btn sm primary" onClick={() => (docId ? nav.openDoc(docId) : go(href))}>
              פתח
            </button>
          ) : null}
          {docId ? (
            <button
              className="btn sm"
              onClick={() => nav.openDoc(docId, { title: node.label, newTab: true })}
            >
              פתח בלשונית
            </button>
          ) : null}
          <button className="btn sm" onClick={onFocus}>
            מקד כאן
          </button>
        </div>

        <div className="eyebrow" style={{ marginTop: 16 }}>
          מה נשבר אם אמחק
        </div>
        {error ? (
          <LoadError what="ניתוח ההשפעה" error={error} />
        ) : loading ? (
          <div className="small muted">בודק…</div>
        ) : !impact ? null : (
          <>
            {/* The number is the headline, so it is its own element — and each stat carries the
                whole sentence as its accessible name, because "3" on its own says nothing. */}
            <div className="impact-sum">
              <span aria-label={`${impact.affectedDocuments} מסמכים מושפעים`}>
                <b>{impact.affectedDocuments}</b> מסמכים מושפעים
              </span>
              <span
                className={impact.brokenLinks ? 'warn' : ''}
                aria-label={`${impact.brokenLinks} קישורים יישברו`}
              >
                <b>{impact.brokenLinks}</b> קישורים יישברו
              </span>
            </div>
            {!impact.inbound.length ? (
              <div className="small muted">אף מסמך לא מפנה לצומת הזה — מחיקה בטוחה.</div>
            ) : (
              <div className="field-docs">
                {impact.inbound.map((row, i) => (
                  <a
                    key={row.documentId + (row.stepKey ?? '') + i}
                    className="rel"
                    data-nopeek=""
                    role="button"
                    tabIndex={0}
                    onClick={() => go(`/doc/${row.documentId}${row.stepKey ? '/' + row.stepKey : ''}`)}
                  >
                    <span className="ic">📄</span>
                    <div className="tx">
                      {row.title}
                      <div>
                        {row.stepKey ? `שלב ${row.stepKey} · ` : ''}
                        {LINK_TYPE_LABEL[row.type] ?? row.type}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
