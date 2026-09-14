import { useNavigate, useParams } from 'react-router-dom';
import { DOC_TYPE_LABELS } from '@wecom/shared';
import { useTopicView } from '../../api/hooks/taxonomy.js';
import { ApiError } from '../../api/unwrap.js';
import { Empty, LoadError } from '../ui/index.js';
import { TypeBadge, worldLabel, worldShort } from './TypeBadge.js';
import { fmtDate } from '../../lib/format.js';

/**
 * PRD §6: every item of a topic, grouped by type, so the agent moves between diagnosis, route
 * and operation without searching.
 */
export function TopicPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  // A topic view is recorded server-side by `GET /topics/:id/items` (W5's `topic_views`), not
  // through `POST /telemetry`: `telemetry_events.document_id` is an FK to `documents`, so a
  // topic id could never land there. This screen *is* the topic browse, so it records — stated
  // explicitly because `ArticlePage` reads the same list with `record: false`.
  const view = useTopicView(id, { record: true });

  if (view.error instanceof ApiError && view.error.status === 404)
    return <Empty title="הנושא לא נמצא">ייתכן שהנושא הועבר לארכיון או שהקישור שגוי.</Empty>;
  if (view.isError) return <LoadError what="נושא" error={view.error} />;
  if (!view.data) return <div className="empty">טוען…</div>;

  const { topic, world, groups } = view.data;
  return (
    <div className="topic-page">
      <div className="lib-head">
        <div>
          <div className="eyebrow">{worldLabel(world.slug)}</div>
          <h1>
            {topic.name}
            <span>{topic.itemCount} פריטים</span>
          </h1>
          {topic.description ? <p>{topic.description}</p> : null}
        </div>
      </div>
      {groups.length === 0 ? <Empty title="אין פריטים בנושא">פריטים שפורסמו יופיעו כאן.</Empty> : null}
      {groups.map((g) => (
        <section key={g.docType} className="topic-group" data-testid="topic-group" data-doctype={g.docType}>
          <h2>
            <TypeBadge docType={g.docType} />
            <span className="muted">{g.items.length}</span>
          </h2>
          <div className="grid">
            {g.items.map((it) => (
              <div
                key={it.id}
                className="tcard"
                role="button"
                tabIndex={0}
                onClick={() => nav(`/doc/${it.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') nav(`/doc/${it.id}`);
                }}
              >
                <div className="chips">
                  <TypeBadge docType={it.docType} compact />
                  {it.worlds.map((w) => (
                    <span key={w} className="chip chip-blue" title={worldLabel(w)}>
                      {worldShort(w)}
                    </span>
                  ))}
                </div>
                <div className="title">{it.title}</div>
                <div className="desc">{it.description}</div>
                <div className="meta">
                  {it.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                  <span className="muted">עודכן {fmtDate(it.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="muted small">סדר הקבוצות: {Object.values(DOC_TYPE_LABELS).join(' → ')}</p>
    </div>
  );
}
