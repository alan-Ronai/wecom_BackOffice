import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BriefingEntry, LearningItem } from '@wecom/shared';
import { useDocument } from '../../../api/hooks/documents.js';
import { usePutEntries } from '../../../api/hooks/learningManage.js';
import { move } from '../../../lib/learning.js';
import { useToast } from '../../ui/Toast.js';
import { DocumentPicker } from './DocumentPicker.js';

/**
 * An entry the server sent carries no title — only the document id — so each row resolves its own.
 * A component per row rather than a batch lookup: the list is short, and the query is the one the
 * article page has usually already cached.
 */
export function EntryTitle({
  documentId,
  fallback,
  asLink = true,
}: {
  documentId: string;
  fallback?: string;
  /** The preview reuses this for the title only: a link inside the modal would navigate behind it. */
  asLink?: boolean;
}) {
  const doc = useDocument(documentId);
  const title = doc.data?.title ?? fallback ?? documentId;
  return asLink ? (
    <Link to={`/doc/${documentId}`} onClick={(e) => e.stopPropagation()}>
      {title}
    </Link>
  ) : (
    <>{title}</>
  );
}

/** Ordered set of published documents with a per-item note (spec §1.1). Saved whole with "שמור פריטים". */
export function BriefingBuilder({ item }: { item: LearningItem }) {
  const [entries, setEntries] = useState<BriefingEntry[]>(item.entries);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const put = usePutEntries(item.id);
  const toast = useToast();
  useEffect(() => setEntries(item.entries), [item.entries]);
  const dirty = JSON.stringify(entries) !== JSON.stringify(item.entries);

  return (
    <section aria-label="פריטי התדריך">
      <h2>פריטי ידע בתדריך</h2>
      <DocumentPicker
        exclude={entries.map((e) => e.documentId)}
        onPick={(d) => {
          setTitles((t) => ({ ...t, [d.id]: d.title }));
          setEntries((es) => [...es, { documentId: d.id, stepKey: null, note: '' }]);
        }}
      />
      <ul className="builder-list" data-testid="entries-list">
        {entries.map((e, i) => (
          <li key={e.id ?? e.documentId}>
            <div>
              <b>
                <EntryTitle documentId={e.documentId} fallback={titles[e.documentId]} />
              </b>
            </div>
            <label className="small">
              הערה לנציג
              <input
                aria-label="הערה לנציג"
                value={e.note}
                onChange={(ev) =>
                  setEntries((es) => es.map((x, k) => (k === i ? { ...x, note: ev.target.value } : x)))
                }
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                aria-label="למעלה"
                disabled={i === 0}
                onClick={() => setEntries((es) => move(es, i, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="למטה"
                disabled={i === entries.length - 1}
                onClick={() => setEntries((es) => move(es, i, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label="הסר"
                onClick={() => setEntries((es) => es.filter((_, k) => k !== i))}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn primary sm"
        disabled={!dirty || entries.length === 0 || put.isPending}
        onClick={() =>
          void put
            .mutateAsync({ entries })
            .then(() => toast('הפריטים נשמרו', 'ok'))
            .catch(() => toast('השמירה נכשלה', 'warn'))
        }
      >
        שמור פריטים
      </button>
    </section>
  );
}
