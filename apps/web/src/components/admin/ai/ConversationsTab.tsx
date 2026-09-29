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

/** One screenful. The route's default; the export is unpaged. */
const PAGE_SIZE = 50;

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
  const [q, setQ] = useState<AdminConversationsQuery>({ page: 1, pageSize: PAGE_SIZE });
  const [userInput, setUserInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  /** Any filter change starts over on page 1 — page 3 of a narrower result is usually empty. */
  const filter = (patch: Partial<AdminConversationsQuery>) =>
    setQ((cur) => {
      const next = { ...cur, ...patch, page: 1 };
      // An unchanged value (the debounce firing on mount, the export's flush) keeps the same
      // object: no refetch, and no jump back to page 1 from the page the admin is on.
      return (Object.keys(patch) as (keyof AdminConversationsQuery)[]).every((k) => cur[k] === next[k])
        ? cur
        : next;
    });

  /*
   * Both text boxes are debounced: every keystroke is a new query key, and without this a
   * five-letter name was five round trips to the transcript list.
   */
  useEffect(() => {
    const t = window.setTimeout(() => filter({ userId: userInput.trim() || undefined }), 300);
    return () => window.clearTimeout(t);
  }, [userInput]);
  useEffect(() => {
    const t = window.setTimeout(() => filter({ q: textInput.trim() || undefined }), 300);
    return () => window.clearTimeout(t);
  }, [textInput]);

  const list = useAdminConversations(q);
  const page = q.page ?? 1;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / (list.data.pageSize || PAGE_SIZE))) : 1;
  /*
   * Wave Y review: a page past the end (the last row of the last page deleted, or the total shrunk
   * under a refetch) is clamped back to the last real page instead of stranding the admin on an
   * empty screen. Only against a real answer — placeholder data is the previous query's total.
   */
  const settledPages = list.data && !list.isPlaceholderData ? pages : null;
  useEffect(() => {
    if (settledPages != null && page > settledPages) setQ((cur) => ({ ...cur, page: settledPages }));
  }, [page, settledPages]);
  /** The live filter boxes, not their debounced copy — what the admin sees is what gets exported. */
  const liveText = { userId: userInput.trim() || undefined, q: textInput.trim() || undefined };
  const loading = list.isPending || (list.isPlaceholderData && !list.data?.items.length);
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
          חיפוש בתוכן
          <input
            type="search"
            aria-label="חיפוש בתוכן השיחות"
            placeholder="מילה או ביטוי מתוך ההודעות"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
          />
        </label>
        <label>
          מתאריך
          <input type="date" aria-label="מתאריך" onChange={(e) => filter({ from: toIso(e.target.value) })} />
        </label>
        <label>
          עד תאריך
          <input
            type="date"
            aria-label="עד תאריך"
            onChange={(e) => filter({ to: toIso(e.target.value, true) })}
          />
        </label>
        {/*
          X6 fix wave: there is no feedback filter here. `ConversationsQuerySchema` has `userId`,
          `documentId`, `from`, `to` and (wave Y) `q` — no rating — the list row carries no message-level
          rating to filter on in the browser, and the control that used to stand here only changed
          the query key. A rating is visible per message inside a transcript; filtering the *list*
          by one needs the field on the route first.
        */}
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            // Flush the debounce so the list catches up with the export it is about to describe.
            filter(liveText);
            void exportConversations({ ...q, ...liveText, page: undefined, pageSize: undefined })
              .then(() => toast('הייצוא הורד', 'ok'))
              .catch(() => toast('הייצוא נכשל', 'warn'));
          }}
        >
          ייצוא JSONL
        </button>
      </div>

      <div className="transcript-layout">
        <div className="transcript-list">
          <table className="table" aria-label="שיחות" aria-busy={list.isFetching}>
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
              A filter change is a new query key. The previous screenful stays up while it loads
              (`keepPreviousData`); when there is none — the first load, or an empty previous
              answer — this says "loading", never "no matching conversations" before it knows.
            */}
              {loading ? (
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
          {/* Wave Y (B-M12): the route always paged; the browser now lets you walk the pages. */}
          {list.data && list.data.total > 0 ? (
            <nav className="transcript-pager" aria-label="דפדוף בשיחות">
              <button
                type="button"
                className="btn sm ghost"
                disabled={page <= 1 || list.isFetching}
                onClick={() => setQ((cur) => ({ ...cur, page: page - 1 }))}
              >
                הקודם
              </button>
              <span className="small muted" aria-live="polite">
                עמוד {page} מתוך {pages} · {list.data.total} שיחות
              </span>
              <button
                type="button"
                className="btn sm ghost"
                disabled={page >= pages || list.isFetching}
                onClick={() => setQ((cur) => ({ ...cur, page: page + 1 }))}
              >
                הבא
              </button>
            </nav>
          ) : null}
        </div>

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
