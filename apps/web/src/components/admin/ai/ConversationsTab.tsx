import { useEffect, useState } from 'react';
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
 * `<input type="date">` gives a *local* calendar day. `new Date('YYYY-MM-DD')` reads it as UTC
 * midnight, so in Israel (UTC+2/+3) "עד the 14th" ended at 02:00 or 03:00 on the 14th and dropped
 * most of the selected day. Built with the local constructor instead, and "עד" is the end of the
 * day. Same pair as `SuggestionAnalyticsTab` / `analytics/AnalyticsPage.tsx` — a page-local
 * helper in each, not a shared API.
 */
const toIso = (d: string, endOfDay = false): string | undefined => {
  if (!d) return undefined;
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return endOfDay
    ? new Date(y, m - 1, day, 23, 59, 59, 999).toISOString()
    : new Date(y, m - 1, day, 0, 0, 0, 0).toISOString();
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
  const [userInput, setUserInput] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  /*
   * The user box is debounced: every keystroke is a new query key, and without this a five-letter
   * name was five round trips to the transcript list.
   */
  useEffect(() => {
    const t = window.setTimeout(
      () => setQ((cur) => ({ ...cur, userId: userInput.trim() || undefined })),
      300,
    );
    return () => window.clearTimeout(t);
  }, [userInput]);

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
          <input aria-label="משתמש" value={userInput} onChange={(e) => setUserInput(e.target.value)} />
        </label>
        <label>
          מתאריך
          <input
            type="date"
            aria-label="מתאריך"
            onChange={(e) => setQ({ ...q, from: toIso(e.target.value) })}
          />
        </label>
        <label>
          עד תאריך
          <input
            type="date"
            aria-label="עד תאריך"
            onChange={(e) => setQ({ ...q, to: toIso(e.target.value, true) })}
          />
        </label>
        {/*
          X6 fix wave: there is no feedback filter here. `ConversationsQuerySchema` has `userId`,
          `documentId`, `from` and `to` and nothing else, the list row carries no message-level
          rating to filter on in the browser, and the control that used to stand here only changed
          the query key. A rating is visible per message inside a transcript; filtering the *list*
          by one needs the field on the route first.
        */}
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
            {/*
              A filter change is a new query key, so `list.data` is empty until the fetch lands.
              Without this branch the table claimed "no matching conversations" on every keystroke
              and every date change, before it knew.
            */}
            {list.isPending ? (
              <tr>
                <td colSpan={6} className="muted">
                  טוען…
                </td>
              </tr>
            ) : !list.data?.items.length ? (
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
