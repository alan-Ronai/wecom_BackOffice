import { useState } from 'react';
import type { AiMessage, ConversationKind, MessageRole } from '@wecom/shared';
import {
  exportConversations,
  useAdminConversation,
  useAdminConversations,
  useDeleteConversation,
  type AdminConversationsQuery,
} from '../../../api/hooks/aiAdmin.js';
import { fmtDate, fmtTime } from '../../../lib/format.js';
import { messages as countMessages } from '../../../lib/count.js';
import { useModal } from '../../ui/Modal.js';
import { useToast } from '../../ui/Toast.js';

const KIND_LABEL: Record<ConversationKind, string> = {
  workspace: 'סביבת עבודה',
  editor: 'עורך שלבים',
  article: 'עמוד פריט',
};
const ROLE_LABEL: Record<MessageRole, string> = {
  user: 'משתמש',
  assistant: 'המערכת',
  tool: 'כלי',
  system: 'מערכת',
};

/**
 * One turn of a transcript.
 *
 * The tool names are shown, not hidden behind a summary: when an admin is reading a transcript it
 * is usually because an answer was wrong, and "which tools did it call" is the first question.
 */
function Message({ m }: { m: AiMessage }) {
  return (
    <article className={'transcript-msg ' + m.role} aria-label={ROLE_LABEL[m.role]}>
      <header>
        <b>{ROLE_LABEL[m.role]}</b>
        <span className="muted small">
          {fmtTime(m.createdAt)}
          {m.model ? ` · ${m.model}` : ''}
          {m.latencyMs ? ` · ${Math.round(m.latencyMs / 1000)} שנ׳` : ''}
        </span>
        {m.feedback === 'up' ? (
          <span aria-label="משוב חיובי">👍</span>
        ) : m.feedback === 'down' ? (
          <span aria-label="משוב שלילי">👎</span>
        ) : null}
      </header>
      <p dir="auto">{m.content}</p>
      {m.toolCalls.length ? (
        <div className="chips">
          {m.toolCalls.map((t) => (
            <span key={t.id} className="chip" dir="ltr">
              {t.name}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/**
 * שיחות — the transcript browser (spec §1.5, §4.3).
 *
 * Chat is persisted because an answer an agent acted on is evidence: it is what a complaint is
 * investigated against, what the prompt work is tuned on, and what the export feeds. So this
 * screen has to offer all three — read it, export it, and delete it — and the deletion is
 * permanent and confirmed, because it removes the transcript from the export too.
 */
export function ConversationsTab() {
  const [q, setQ] = useState<AdminConversationsQuery>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useAdminConversations(q);
  const detail = useAdminConversation(openId);
  const del = useDeleteConversation();
  const modal = useModal();
  const toast = useToast();

  return (
    <div className="ai-conversations">
      <div className="row">
        <label>
          משתמש
          <input
            aria-label="משתמש"
            value={q.userId ?? ''}
            onChange={(e) => setQ({ ...q, userId: e.target.value || undefined })}
          />
        </label>
        <label>
          מתאריך
          <input
            type="date"
            aria-label="מתאריך"
            onChange={(e) =>
              setQ({ ...q, from: e.target.value ? new Date(e.target.value).toISOString() : undefined })
            }
          />
        </label>
        <label>
          עד תאריך
          <input
            type="date"
            aria-label="עד תאריך"
            onChange={(e) =>
              setQ({ ...q, to: e.target.value ? new Date(e.target.value).toISOString() : undefined })
            }
          />
        </label>
        <label>
          משוב
          <select
            aria-label="משוב"
            value={q.feedback ?? ''}
            onChange={(e) =>
              setQ({ ...q, feedback: (e.target.value || undefined) as 'up' | 'down' | undefined })
            }
          >
            <option value="">הכל</option>
            <option value="up">חיובי</option>
            <option value="down">שלילי</option>
          </select>
        </label>
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            void exportConversations(q)
              .then(() => toast('הייצוא הורד', 'ok'))
              .catch(() => toast('הייצוא נכשל', 'warn'))
          }
        >
          ייצוא JSONL
        </button>
      </div>

      <div className="transcript-layout">
        <table className="table" aria-label="שיחות">
          <thead>
            <tr>
              <th>מתי</th>
              <th>משתמש</th>
              <th>מסמך</th>
              <th>סוג</th>
              <th>הודעות</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((c) => (
              <tr key={c.id} className={c.id === openId ? 'sel' : ''}>
                <td>
                  <button type="button" className="linklike" onClick={() => setOpenId(c.id)}>
                    {fmtDate(c.createdAt)}
                  </button>
                </td>
                <td>{c.userName || c.userId}</td>
                <td>{c.documentTitle ?? c.documentId ?? '—'}</td>
                <td>{KIND_LABEL[c.kind]}</td>
                <td>{countMessages(c.messageCount)}</td>
                <td>
                  <button
                    type="button"
                    className="btn xs danger"
                    onClick={async () => {
                      const ok = await modal.confirm(
                        'למחוק את השיחה לצמיתות?',
                        'המחיקה מסירה את התמליל מהמאגר ומהייצוא.',
                      );
                      if (!ok) return;
                      try {
                        await del.mutateAsync(c.id);
                        if (openId === c.id) setOpenId(null);
                        toast('השיחה נמחקה', 'ok');
                      } catch {
                        toast('המחיקה נכשלה', 'warn');
                      }
                    }}
                  >
                    מחק
                  </button>
                </td>
              </tr>
            ))}
            {!list.data?.items.length ? (
              <tr>
                <td colSpan={6} className="muted">
                  אין שיחות תואמות.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {openId ? (
          <section className="transcript" aria-label="תמליל">
            {detail.data ? (
              detail.data.messages.map((m) => <Message key={m.id} m={m} />)
            ) : (
              <p className="muted">טוען…</p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
