import { useMentionable } from '../../api/hooks/collab.js';
import { fmtDate } from '../../lib/format.js';

/** The slice of a document the ownership block reads. */
export type OwnerFieldsDoc = {
  ownerId?: string | null;
  editorId?: string | null;
  approverName?: string | null;
  publishedAt?: string | null;
};

export type OwnerPatch = { ownerId?: string | null; editorId?: string | null };

/**
 * Owner ("גורם מקצועי אחראי") and responsible editor selects for the editor's metadata panel.
 * Approver and publish date are read-only: they are stamped by the publish route, not chosen.
 *
 * People come from wave 3's `GET /users/mentionable` (`always` — there is no `@` to trigger on
 * here, the list is shown up front).
 */
export function OwnerFields({
  doc,
  onChange,
}: {
  doc: OwnerFieldsDoc;
  onChange: (patch: OwnerPatch) => void;
}) {
  const people = useMentionable('', true);
  const opts = people.data ?? [];
  const select = (label: string, value: string | null | undefined, key: 'ownerId' | 'editorId') => (
    <label key={key}>
      {label}
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange({ [key]: e.target.value || null })}
      >
        <option value="">— לא הוגדר —</option>
        {opts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="form owner-fields">
      {select('גורם מקצועי אחראי', doc.ownerId, 'ownerId')}
      {select('עורך אחראי', doc.editorId, 'editorId')}
      <div className="muted">
        {doc.approverName ? `מאשר: ${doc.approverName}` : 'טרם אושר'}
        {doc.publishedAt ? ` · פורסם ${fmtDate(doc.publishedAt)}` : ''}
      </div>
    </div>
  );
}
