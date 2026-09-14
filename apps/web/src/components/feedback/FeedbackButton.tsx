import { Fragment, useState } from 'react';
import { FEEDBACK_KINDS, FEEDBACK_KIND_LABELS, type FeedbackKind } from '@wecom/shared';
import { useCreateFeedback } from '../../api/hooks/feedback.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';

export interface FeedbackButtonProps {
  documentId: string;
  documentVersion: number;
  stepKey?: string;
  size?: 'xs' | 'sm';
  /* §5.4 lists the auto-context as (item, type, world, version, step). The first three are on
     screen behind the modal, but the point of the block is to show exactly what is being sent —
     and the callers have all of them, so passing them costs nothing. */
  documentTitle?: string;
  docType?: string;
  worldSlug?: string;
}

export const FEEDBACK_TITLE = 'דיווח על בעיה / משוב';

function FeedbackForm({
  documentId,
  documentVersion,
  stepKey,
  documentTitle,
  docType,
  worldSlug,
  onDone,
}: FeedbackButtonProps & { onDone: () => void }) {
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [text, setText] = useState('');
  const create = useCreateFeedback(documentId);
  const toast = useToast();
  const submit = async () => {
    if (!kind) return;
    await create.mutateAsync({ kind, text: text.trim(), stepKey });
    toast('תודה! המשוב נשלח לעורכי התוכן', 'ok');
    onDone();
  };
  return (
    <div className="form feedback-form">
      <fieldset>
        <legend className="small muted">מה הבעיה?</legend>
        {FEEDBACK_KINDS.map((k) => (
          <label key={k} className="radio-row">
            <input
              type="radio"
              name="feedback-kind"
              value={k}
              checked={kind === k}
              onChange={() => setKind(k)}
            />
            {FEEDBACK_KIND_LABELS[k]}
          </label>
        ))}
      </fieldset>
      <label>
        הסבר קצר (לא חובה)
        <textarea
          aria-label="הסבר קצר"
          rows={3}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {/* PRD §12: the agent never retypes what the system already knows. */}
      <div className="small muted feedback-context">
        נשמר אוטומטית:{' '}
        {[
          documentTitle,
          docType ? `סוג ${docType}` : null,
          worldSlug ? `עולם ${worldSlug}` : null,
          `גרסה v${documentVersion}`,
          stepKey ? `שלב ${stepKey}` : null,
          'משתמש ותאריך',
        ]
          .filter(Boolean)
          .map((part, i) => (
            <Fragment key={i}>
              {i ? ' · ' : ''}
              <span>{part}</span>
            </Fragment>
          ))}
      </div>
      <div className="foot">
        <button type="button" className="btn" onClick={onDone}>
          ביטול
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!kind || create.isPending}
          onClick={() => void submit()}
        >
          שלח
        </button>
      </div>
      {create.isError ? <div className="small warn">שליחת המשוב נכשלה · נסו שוב</div> : null}
    </div>
  );
}

/** Fixed entry point on every knowledge item (article header) and on every step (PRD §12). */
export function FeedbackButton(props: FeedbackButtonProps) {
  const modal = useModal();
  const open = () => {
    const dispose = modal.open({
      title: FEEDBACK_TITLE,
      body: <FeedbackForm {...props} onDone={() => dispose()} />,
      sticky: true,
    });
  };
  return (
    <button
      type="button"
      className={['btn', 'ghost', props.size ?? 'sm', 'feedback-btn'].join(' ')}
      title={FEEDBACK_TITLE}
      // The emoji is decoration; the accessible name stays the plain Hebrew label.
      aria-label={FEEDBACK_TITLE}
      onClick={open}
    >
      <span aria-hidden="true">💬 </span>
      {FEEDBACK_TITLE}
    </button>
  );
}
