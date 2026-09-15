import type { LearningItem } from '@wecom/shared';
import { EntryTitle } from './BriefingBuilder.js';

/**
 * The item as the agent will meet it — read-only, and deliberately without the correct flags:
 * the preview is what the learner sees, so an editor checking it cannot accidentally check the
 * answer key instead. Handed straight to `modal.open({ body })`, which renders it inside the app
 * tree, so `EntryTitle` can resolve each entry's real title the way the builder does — a preview
 * listing raw UUIDs told the manager nothing.
 */
export function ItemPreview({ item }: { item: LearningItem }) {
  return (
    <div className="item-preview">
      <h3>{item.title}</h3>
      {item.description ? (
        // Sanitised server-side, like every other rich-text body the app renders.
        <div className="prose" dangerouslySetInnerHTML={{ __html: item.description }} />
      ) : null}
      {item.kind === 'briefing' ? (
        <ol className="preview-entries">
          {item.entries.map((e) => (
            <li key={e.id ?? e.documentId}>
              <b>
                <EntryTitle documentId={e.documentId} asLink={false} />
              </b>
              {e.note ? <div className="small muted">{e.note}</div> : null}
            </li>
          ))}
        </ol>
      ) : (
        <ol className="preview-questions">
          {item.questions.map((q, i) => (
            <li key={q.id ?? `q-${i}`}>
              <div>{q.stem}</div>
              <ul>
                {q.options.map((o) => (
                  <li key={o.id}>{o.text}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
