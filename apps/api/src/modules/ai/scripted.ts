/**
 * Wave 6 (X2) — a deterministic stand-in for the chat model.
 *
 * The e2e stack runs with `MODEL_DISABLED=true` and no Ollama on the box, so without this every
 * chat assertion there would be a 503; and pointing e2e at a real 7B on CPU would make the suite
 * slow *and* non-deterministic. `AI_TEST_SCRIPT=1` outside production selects it
 * (`chatModel.ts:scriptedChatRequested`) — it is never reachable in a production process.
 *
 * It is a **script**, not a policy. Every refusal in this lane is the orchestrator's:
 * `runTool` refuses a tool outside the caller's tier with `ok: false`, and the article kind caps
 * the tool set at the ask tools whatever the caller holds. The script may happily ask for
 * `propose_source_edit` on behalf of an `ai.ask` caller — and must, because that is exactly the
 * path the permission gate has to be seen refusing, with the reply "אין לי הרשאה לשנות תוכן".
 */
import type { ChatMessage, ChatResult, ModelClient, ToolCall } from '@wecom/model';
import {
  DOCUMENT_ID_LABEL,
  parseRefBlocks,
  renderRefBlocks,
  SECOND_CALL,
  SUGGESTION_ID_LABEL,
} from './prompt.js';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const EDIT_INTENT = /שנה|החלף|תקן|קצר/;
const REFINE_INTENT = /שפר|עדכן את ההצעה/;

const labelled = (text: string, label: string): string | null =>
  new RegExp(`${label}:\\s*(${UUID})`).exec(text)?.[1] ?? null;

/** `"…"`, `«…»` and `'…'`, in the order they appear. */
const quoted = (text: string): string[] =>
  [...text.matchAll(/"([^"]{1,400})"|«([^»]{1,400})»|'([^']{1,400})'/g)].map((m) => m[1] ?? m[2] ?? m[3]);

const lastOfRole = (messages: ChatMessage[], role: ChatMessage['role']): ChatMessage | undefined =>
  [...messages].reverse().find((m) => m.role === role);

/**
 * What the person actually typed, without the context block `withContext` appends.
 *
 * The rules below read the end of the message — "ends with `?`" is the question rule — and the
 * panes always send a context (the open step, the open suggestion, the selection), which arrives
 * as `…\n\n---\nהקשר:\n…` glued onto the end. Matching against the whole string meant the
 * question rule never fired from a pane, which is every pane: an agent's "מה השלב הראשון?" read
 * as no intent at all and answered "הבנתי.". The ids are still taken from the full text — that is
 * where `withContext` puts them.
 */
const asked = (content: string): string => content.split('\n\n---\n')[0]!.trimEnd();

const result = (content: string, toolCalls: ToolCall[] = []): ChatResult => ({
  content,
  toolCalls,
  tokensIn: 1,
  tokensOut: Math.max(1, Math.ceil(content.length / 4)),
});

let counter = 0;
const callId = () => `script_${++counter}`;

export class ScriptedChatModel implements ModelClient {
  name = 'scripted-chat';

  async available(): Promise<boolean> {
    return true;
  }

  async proposeChanges(): Promise<never[]> {
    return [];
  }

  async chat(input: {
    messages: ChatMessage[];
    tools?: { name: string }[];
    onToken?: (t: string) => void;
  }): Promise<ChatResult> {
    const r = this.answer(input.messages);
    for (const piece of r.content.split(/(?<=\s)/)) if (piece) input.onToken?.(piece);
    return r;
  }

  private answer(messages: ChatMessage[]): ChatResult {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = lastOfRole(messages, 'user')?.content ?? '';

    // ── second calls: the proposal tools drive the model themselves ──────────
    if (system.includes(SECOND_CALL.proposeSourceEdit)) return this.rewriteParagraphs(user);
    if (system.includes(SECOND_CALL.refineSuggestion)) return this.echoPayload(user);
    if (system.includes(SECOND_CALL.reviewDocument))
      return result(
        JSON.stringify({
          findings: [{ severity: 'low', stepKey: null, text: 'המסמך קריא; אין ממצאים חריגים.' }],
        }),
      );
    if (system.includes(SECOND_CALL.draftStep))
      return result(
        JSON.stringify({
          num: '99',
          title: 'שלב טיוטה',
          actions: [{ id: 'a1', text: 'בדוק את הפרטים מול הלקוח' }],
          outcomes: [{ kind: 'ok', text: '✓ סיום' }],
        }),
      );

    // ── the conversation itself ──────────────────────────────────────────────
    /*
     * A tool *turn* is the orchestrator calling back with results, which is the case where the
     * conversation ends in a tool message. X6: this read `messages.some(...)`, so from the second
     * user turn onwards in any conversation that had ever used a tool, every message took this
     * branch — no intent was evaluated, no tool was called, and the reply was always the generic
     * "לפי שלב 1, זו התשובה.". W6-E2E-2's refused-write stage is what caught it: the write was
     * never attempted, so the gate never got to refuse it.
     */
    const toolTurn = messages.at(-1)?.role === 'tool';
    if (toolTurn) {
      const last = lastOfRole(messages, 'tool')?.content ?? '';
      if (last.includes('"ok":false'))
        // The gate refused; the script reports the refusal rather than retrying it.
        return result('אין לי הרשאה לשנות תוכן');
      return result('לפי שלב 1, זו התשובה.');
    }

    const documentId = labelled(system, DOCUMENT_ID_LABEL);
    // The ids live in the context block; the *intent* is what the person typed above it.
    const suggestionId = labelled(user, SUGGESTION_ID_LABEL);
    const typed = asked(user);

    if (REFINE_INTENT.test(typed) && suggestionId)
      return result('', [
        { id: callId(), name: 'refine_suggestion', args: { suggestionId, instruction: typed } },
      ]);
    if (EDIT_INTENT.test(typed) && documentId)
      return result('', [
        { id: callId(), name: 'propose_source_edit', args: { documentId, instruction: typed } },
      ]);
    if (typed.endsWith('?') && documentId)
      return result('', [{ id: callId(), name: 'read_document', args: { documentId } }]);
    return result('הבנתי.');
  }

  /** Echo the paragraphs back with the instruction's quoted substitution applied to one of them. */
  private rewriteParagraphs(prompt: string): ChatResult {
    const blocks = parseRefBlocks(prompt);
    const q = quoted(prompt);
    if (blocks.length && q.length) {
      const [from, to] = q.length >= 2 ? [q[0], q[1]] : [null, q[0]];
      const target = from ? blocks.findIndex((b) => b.text.includes(from)) : 0;
      if (target >= 0)
        blocks[target] = {
          ...blocks[target],
          text: from ? blocks[target].text.replace(from, to) : to,
        };
    }
    return result(renderRefBlocks(blocks));
  }

  /** The refine prompt carries the current payload; echoing it back is always the same type. */
  private echoPayload(prompt: string): ChatResult {
    const start = prompt.indexOf('{');
    const end = prompt.lastIndexOf('}');
    if (start === -1 || end <= start) return result('{}');
    return result(prompt.slice(start, end + 1));
  }
}
