import { FEEDBACK_KIND_LABELS } from '@wecom/shared';
import { useDocumentFeedback } from '../../api/hooks/feedback.js';

export interface PublishFeedbackPickerProps {
  documentId: string;
  value: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Checkbox list of open reports on the item, shown inside the publish dialog (spec §5.4).
 * W6 mounts it in EditorPage.doPublish and forwards `value` as `resolveFeedbackIds`.
 */
export function PublishFeedbackPicker({ documentId, value, onChange }: PublishFeedbackPickerProps) {
  const open = useDocumentFeedback(documentId);
  if (!open.data?.length) return null;
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset className="publish-feedback">
      <legend>לסגור משובים פתוחים עם הגרסה הזו?</legend>
      {open.data.map((f) => (
        <label key={f.id} className="check-row">
          <input type="checkbox" checked={value.includes(f.id)} onChange={() => toggle(f.id)} />
          {FEEDBACK_KIND_LABELS[f.kind]}
          {f.stepKey ? ` · ${f.stepKey}` : ''}
          {f.text ? <span className="small muted"> — {f.text.slice(0, 80)}</span> : null}
        </label>
      ))}
    </fieldset>
  );
}
