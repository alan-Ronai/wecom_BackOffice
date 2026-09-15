/**
 * Reads the chat SSE stream (`POST /ai/conversations/:id/messages`). The generated client cannot
 * consume a streaming body, so this is the one hand-written transport that stays after X6.
 *
 * Frames are `event: <type>\ndata: <json>\n\n`; only `data:` is used — the event name is a
 * duplicate of `type` and the contract is the JSON. Every frame is parsed with `ChatEventSchema`
 * so a server that changes shape surfaces as an `error` event, not a blank bubble. A non-2xx
 * response carries the usual JSON envelope and is thrown as `ApiError`.
 */
import { ChatEventSchema, type ChatEvent, type SendMessageBody } from '@wecom/shared';
import { API_BASE } from './client.js';
import { ApiError } from './unwrap.js';

export interface StreamChatInput {
  conversationId: string;
  body: SendMessageBody;
  signal: AbortSignal;
  onEvent: (e: ChatEvent) => void;
}

const isAbort = (err: unknown): boolean => (err as { name?: string } | null)?.name === 'AbortError';

/**
 * The signal is honoured by cancelling the *reader*, not by handing it to `fetch`.
 *
 * Cancelling a fetch body closes the underlying connection, which is what "עצור" has to do, and
 * it is the only spelling that works in both runtimes this code has to survive: under jsdom the
 * `AbortSignal` the app constructs is jsdom's, while `fetch` is undici's, and undici rejects a
 * foreign signal outright ("Expected signal to be an instance of AbortSignal") — so passing it
 * would make every send fail in the test environment and nowhere else.
 */
export async function streamChat({ conversationId, body, signal, onEvent }: StreamChatInput): Promise<void> {
  if (signal.aborted) return;
  let res: Response;
  try {
    res = await globalThis.fetch(`${API_BASE}/ai/conversations/${conversationId}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (isAbort(err) || signal.aborted) return;
    throw err;
  }
  if (signal.aborted) return;
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? 'שגיאה', e.details);
  }
  if (!res.body) throw new ApiError(res.status, 'NO_BODY', 'השרת לא החזיר זרם');

  const reader = res.body.getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) break;
      buf += dec.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        emit(buf.slice(0, idx), onEvent);
        buf = buf.slice(idx + 2);
        idx = buf.indexOf('\n\n');
      }
    }
    if (!signal.aborted && buf.trim()) emit(buf, onEvent);
  } catch (err) {
    if (!isAbort(err) && !signal.aborted) throw err;
  } finally {
    signal.removeEventListener('abort', cancel);
    try {
      reader.releaseLock();
    } catch {
      /* already released by the cancel above */
    }
  }
}

function emit(frame: string, onEvent: (e: ChatEvent) => void): void {
  const data = frame
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('\n');
  if (!data) return;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    onEvent({ type: 'error', code: 'BAD_FRAME', message: 'השרת שלח תשובה לא תקינה' });
    return;
  }
  const parsed = ChatEventSchema.safeParse(json);
  onEvent(
    parsed.success ? parsed.data : { type: 'error', code: 'CONTRACT', message: 'תשובת השרת אינה תואמת את החוזה' },
  );
}
