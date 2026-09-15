import { Fragment, useState } from 'react';
import {
  DOC_TYPES,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  type DocType,
  type FeedbackKind,
} from '@wecom/shared';
import { useCreateFeedback } from '../../api/hooks/feedback.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { TypeBadge, docTypeLabel, worldLabel } from '../taxonomy/TypeBadge.js';

const isDocType = (v: string | undefined): v is DocType =>
  !!v && (DOC_TYPES as readonly string[]).includes(v);

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
      {/*
        PRD §12: the agent never retypes what the system already knows.

        §5.4's five auto-context fields are all still on screen, but the item and its type are now
        the dialog's header (see `subtitle` below) rather than two more entries in this line —
        naming the thing you are reporting on is a heading's job, and printing the title twice in a
        520 px dialog read as a bug. What is left here is the context you cannot see by looking at
        the header: which world, which version, which step, and that the user and date go too.

        A-4 (review §3): `docTypeLabel` is still used for the fallback in the header — the modal
        used to read `סוג T` where every other surface in the app reads `T · תסריט`, and the bare
        letter is a storage code, not a label anyone outside the team can read.
      */}
      <div className="small muted feedback-context">
        נשמר אוטומטית:{' '}
        {[
          worldSlug ? `עולם ${worldLabel(worldSlug)}` : null,
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

/**
 * Opening the dialog, without the button that usually opens it.
 *
 * A-6 folds the article topbar into an overflow menu on a phone, and a menu item cannot render a
 * `FeedbackButton` — it needs to *call* it. Extracted rather than duplicated so the two entry
 * points cannot drift in what context they attach.
 */
export function useFeedbackDialog(props: FeedbackButtonProps) {
  const modal = useModal();
  return () => {
    const dispose = modal.open({
      title: FEEDBACK_TITLE,
      /**
       * A-4, second half. The dialog is reachable from the article header *and* from every step
       * row, and until now it named neither — an agent who opened it from a step, on a screen
       * where the modal covers the article, had nothing on it identifying what they were about to
       * report on. The chip is the same `TypeBadge` the library, the topic page and the article
       * header use, so the letter is never on its own here either.
       */
      subtitle: props.documentTitle ? (
        <>
          {isDocType(props.docType) ? (
            <TypeBadge docType={props.docType} compact />
          ) : props.docType ? (
            // Same degradation as `docTypeLabel`: an unrecognised code shows as itself rather
            // than as a badge claiming a label it does not have.
            <span className="small muted">{docTypeLabel(props.docType)}</span>
          ) : null}
          <span className="modal-subtitle-text">{props.documentTitle}</span>
        </>
      ) : null,
      body: <FeedbackForm {...props} onDone={() => dispose()} />,
      sticky: true,
    });
  };
}

/** Fixed entry point on every knowledge item (article header) and on every step (PRD §12). */
export function FeedbackButton(props: FeedbackButtonProps) {
  const open = useFeedbackDialog(props);
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
