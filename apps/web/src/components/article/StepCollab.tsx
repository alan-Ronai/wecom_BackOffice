import { useState } from 'react';
import { useAddComment, useCommentAction, type Comment } from '../../api/hooks/collab.js';
import { useCan } from '../../api/hooks/me.js';
import { useToast } from '../ui/Toast.js';
import { ago, copy } from '../../lib/format.js';
import { MentionInput } from './MentionInput.js';
import type { ScriptRow } from '../../api/types.js';

/**
 * Card 6b's per-step collaboration strip: the comment thread and the "הסבר ללקוח" script picker.
 *
 * Comments are distinct from the existing agent notes: a note is advice left for the next agent
 * on the call, a comment is a conversation *about the document* (“this step is wrong”), can
 * mention a colleague, and gets resolved. Both hang off a step, which is why they live here
 * together rather than in the side panel.
 */
function ScriptPicker({
  scripts,
  onInsert,
  onClose,
}: {
  scripts: ScriptRow[];
  onInsert: (s: ScriptRow) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  return (
    <div className="script-picker" role="dialog" aria-label="תסריטים לשלב זה">
      <div className="eyebrow">
        תסריטים לשלב זה ·{' '}
        <bdi className="lat" dir="ltr">
          scripts.json
        </bdi>
      </div>
      {!scripts.length ? <div className="muted small">אין תסריטים מתאימים</div> : null}
      {scripts.map((s) => (
        <div className="pick" key={s.id}>
          <div className="q">{s.text}</div>
          <div className="row">
            <span className="muted small">משמש ב-{s.usedIn.length} מסמכים</span>
            <button
              className="btn xs"
              onClick={() => {
                void copy(s.text);
                toast('הנוסח הועתק ללוח', 'ok');
              }}
            >
              העתק
            </button>
            <button className="btn xs primary" onClick={() => onInsert(s)}>
              הוסף לסיכום
            </button>
          </div>
        </div>
      ))}
      <button className="btn xs ghost" onClick={onClose}>
        סגור
      </button>
    </div>
  );
}

export function StepCollab({
  documentId,
  stepKey,
  comments,
  scripts,
  onInsertScript,
}: {
  documentId: string;
  stepKey: string;
  comments: Comment[];
  scripts: ScriptRow[];
  onInsertScript: (s: ScriptRow) => void;
}) {
  const can = useCan();
  const add = useAddComment(documentId);
  const actions = useCommentAction(documentId);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const mine = comments.filter((c) => c.stepKey === stepKey);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    await add.mutateAsync({ stepKey, text: body });
  };

  return (
    <div className="step-collab">
      <div className="collab-bar">
        <span className="chip chip-gray" aria-label={`${mine.length} תגובות`}>
          💬 {mine.length}
        </span>
        <button
          className="btn xs"
          aria-expanded={picker}
          aria-label="הסבר ללקוח"
          onClick={() => setPicker((v) => !v)}
        >
          🗣 הסבר ללקוח ›
        </button>
      </div>

      {picker ? (
        <ScriptPicker
          scripts={scripts}
          onClose={() => setPicker(false)}
          onInsert={(s) => {
            onInsertScript(s);
            setPicker(false);
          }}
        />
      ) : null}

      <div className="comments">
        {mine.map((c) => (
          <div className={'comment' + (c.resolvedAt ? ' resolved' : '')} key={c.id}>
            <span className="avatar sm">{c.authorInitials}</span>
            <div className="body">
              <div className="who">
                <b>{c.authorName}</b>
                <span className="muted small">{ago(Date.parse(c.createdAt))}</span>
                {c.resolvedAt ? <span className="chip chip-green">פתור · {c.resolvedByName}</span> : null}
              </div>
              <div className="tx">{c.text}</div>
              <div className="acts">
                <button
                  className="lnk"
                  aria-label={`אהבתי · ${c.authorName}`}
                  onClick={() => actions.like.mutate(c.id)}
                >
                  {c.likedByMe ? '♥' : '♡'} {c.likes}
                </button>
                {!c.resolvedAt && can('notes.write') ? (
                  <button
                    className="lnk"
                    aria-label={`סמן כפתור · ${c.authorName}`}
                    onClick={() => actions.resolve.mutate(c.id)}
                  >
                    ✓ פתור
                  </button>
                ) : null}
                {can('notes.moderate') ? (
                  <button
                    className="lnk danger"
                    aria-label={`מחק תגובה · ${c.authorName}`}
                    onClick={() => actions.remove.mutate(c.id)}
                  >
                    מחק
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}

        {can('notes.write') ? (
          <div className="comment compose">
            <MentionInput
              value={text}
              onChange={setText}
              onSubmit={() => void submit()}
              label={`הערה לשלב ${stepKey}`}
              placeholder="הערה לשלב… @ לאזכור"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
