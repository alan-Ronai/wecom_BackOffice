/**
 * Wave 6 (X2) — the only SQL the chat lane runs against its own four tables.
 *
 * Nothing here writes to `documents`, `source_documents` or `suggestions`: a chat turn is a
 * transcript row, and the single write path into content is
 * `POST /ai/proposed-edits/:id/decide`, which goes through `saveSourceDocument` like any
 * other source save (spec §1.3).
 *
 * Row mappers produce exactly the `wave6.ts` shapes — camelCase, ISO dates, jsonb columns
 * passed through — so a route can return a row without a second normalisation pass.
 */
import type {
  AiMessage,
  AiToolCall,
  AiToolResult,
  Conversation,
  ConversationKind,
  ConversationsQuery,
  ProposedEditOp,
  ProposedEdits,
  ProposedEditsStatus,
} from '@wecom/shared';
import type { Queryable, Tx } from '../../lib/sql.js';

export type Q = Queryable;

type Row = Record<string, unknown>;

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

const toConversation = (r: Row): Conversation => ({
  id: r.id as string,
  kind: r.kind as ConversationKind,
  documentId: (r.document_id as string) ?? null,
  documentTitle: (r.document_title as string) ?? null,
  sourceRevisionId: (r.source_revision_id as string) ?? null,
  userId: r.user_id as string,
  userName: (r.user_name as string) ?? '',
  title: (r.title as string) ?? '',
  model: (r.model as string) ?? null,
  promptVersion: (r.prompt_version as string) ?? null,
  messageCount: Number(r.message_count ?? 0),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const toMessage = (r: Row): AiMessage => ({
  id: r.id as string,
  conversationId: r.conversation_id as string,
  seq: Number(r.seq),
  role: r.role as AiMessage['role'],
  content: (r.content as string) ?? '',
  toolCalls: (r.tool_calls as AiToolCall[]) ?? [],
  toolResults: (r.tool_results as AiToolResult[]) ?? [],
  proposedEditsId: (r.proposed_edits_id as string) ?? null,
  refinedSuggestionId: (r.refined_suggestion_id as string) ?? null,
  tokensIn: Number(r.tokens_in ?? 0),
  tokensOut: Number(r.tokens_out ?? 0),
  latencyMs: Number(r.latency_ms ?? 0),
  model: (r.model as string) ?? null,
  promptVersion: (r.prompt_version as string) ?? null,
  feedback: (r.feedback as AiMessage['feedback']) ?? null,
  createdAt: iso(r.created_at),
});

const toProposedEdits = (r: Row): ProposedEdits => ({
  id: r.id as string,
  messageId: r.message_id as string,
  documentId: r.document_id as string,
  baseSourceVersion: Number(r.base_source_version),
  ops: (r.ops as ProposedEditOp[]) ?? [],
  status: r.status as ProposedEditsStatus,
  decidedBy: (r.decided_by as string) ?? null,
  decidedAt: isoOrNull(r.decided_at),
  resultingSourceVersion:
    r.resulting_source_version === null || r.resulting_source_version === undefined
      ? null
      : Number(r.resulting_source_version),
});

const CONVERSATION_SELECT = `select c.id, c.kind, c.document_id, d.title document_title, c.source_revision_id,
         c.user_id, coalesce(u.display_name, '') user_name, c.title, c.model, c.prompt_version,
         (select count(*)::int from ai_messages m where m.conversation_id = c.id) message_count,
         c.created_at, c.updated_at
    from ai_conversations c
    left join documents d on d.id = c.document_id
    left join users u on u.id = c.user_id`;

/* ── conversations ───────────────────────────────────────────────────────── */

export async function createConversation(
  tx: Tx,
  input: {
    kind: ConversationKind;
    documentId: string | null;
    sourceRevisionId: string | null;
    userId: string;
    title: string;
    model: string;
    promptVersion: string;
  },
): Promise<Conversation> {
  const r = await tx.query(
    `insert into ai_conversations(kind, document_id, source_revision_id, user_id, title, model, prompt_version)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [
      input.kind,
      input.documentId,
      input.sourceRevisionId,
      input.userId,
      input.title,
      input.model,
      input.promptVersion,
    ],
  );
  return (await getConversation(tx, r.rows[0].id as string))!;
}

/** Live conversations only: a soft-deleted transcript is gone for every caller, admin included. */
export async function getConversation(q: Q, id: string): Promise<Conversation | null> {
  const r = await q.query(`${CONVERSATION_SELECT} where c.id=$1 and c.deleted_at is null`, [id]);
  return r.rowCount ? toConversation(r.rows[0]) : null;
}

/**
 * `userId: null` is the admin transcript browser — every author. Anything else narrows to one
 * person, which is what the non-admin list route always passes.
 */
export async function listConversations(
  q: Q,
  query: Omit<ConversationsQuery, 'mine' | 'userId'> & { userId: string | null },
): Promise<{ items: Conversation[]; total: number }> {
  const where = `where c.deleted_at is null
      and ($1::uuid is null or c.user_id = $1)
      and ($2::uuid is null or c.document_id = $2)
      and ($3::text is null or c.kind = $3)
      and ($4::timestamptz is null or c.created_at >= $4)
      and ($5::timestamptz is null or c.created_at <= $5)`;
  const params = [
    query.userId,
    query.documentId ?? null,
    query.kind ?? null,
    query.from ?? null,
    query.to ?? null,
  ];
  const total = await q.query(`select count(*)::int n from ai_conversations c ${where}`, params);
  const r = await q.query(
    `${CONVERSATION_SELECT} ${where} order by c.updated_at desc limit $6 offset $7`,
    [...params, query.pageSize, (query.page - 1) * query.pageSize],
  );
  return { items: r.rows.map(toConversation), total: total.rows[0].n as number };
}

/** `title` is written once, when the conversation is still untitled (see `titleFrom`). */
export async function touchConversation(tx: Tx, id: string, title?: string): Promise<void> {
  await tx.query(
    `update ai_conversations set updated_at = now(), title = case when title = '' then coalesce($2, title) else title end
     where id = $1`,
    [id, title ?? null],
  );
}

export async function softDeleteConversation(tx: Tx, id: string): Promise<boolean> {
  const r = await tx.query(
    'update ai_conversations set deleted_at = now() where id=$1 and deleted_at is null',
    [id],
  );
  return r.rowCount === 1;
}

/* ── messages ────────────────────────────────────────────────────────────── */

/**
 * `for update` on the conversation row, not on `ai_messages`: two concurrent turns in the
 * same conversation must serialise, and the unique `(conversation_id, seq)` is the backstop
 * if they somehow do not.
 */
export async function nextSeq(tx: Tx, conversationId: string): Promise<number> {
  await tx.query('select id from ai_conversations where id=$1 for update', [conversationId]);
  const r = await tx.query(
    'select coalesce(max(seq),0)+1 as n from ai_messages where conversation_id=$1',
    [conversationId],
  );
  return Number(r.rows[0].n);
}

export type InsertMessage = Omit<AiMessage, 'id' | 'createdAt' | 'feedback'>;

export async function insertMessage(tx: Tx, m: InsertMessage): Promise<AiMessage> {
  const r = await tx.query(
    `insert into ai_messages(conversation_id, seq, role, content, tool_calls, tool_results,
        proposed_edits_id, refined_suggestion_id, tokens_in, tokens_out, latency_ms, model, prompt_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
    [
      m.conversationId,
      m.seq,
      m.role,
      m.content,
      m.toolCalls.length ? JSON.stringify(m.toolCalls) : null,
      m.toolResults.length ? JSON.stringify(m.toolResults) : null,
      m.proposedEditsId,
      m.refinedSuggestionId,
      m.tokensIn,
      m.tokensOut,
      m.latencyMs,
      m.model ?? '',
      m.promptVersion ?? '',
    ],
  );
  return toMessage(r.rows[0]);
}

export type MessagePatch = Partial<
  Pick<
    AiMessage,
    | 'content'
    | 'toolCalls'
    | 'toolResults'
    | 'proposedEditsId'
    | 'refinedSuggestionId'
    | 'tokensIn'
    | 'tokensOut'
    | 'latencyMs'
  >
>;

const PATCH_COLUMNS: Record<keyof MessagePatch, string> = {
  content: 'content',
  toolCalls: 'tool_calls',
  toolResults: 'tool_results',
  proposedEditsId: 'proposed_edits_id',
  refinedSuggestionId: 'refined_suggestion_id',
  tokensIn: 'tokens_in',
  tokensOut: 'tokens_out',
  latencyMs: 'latency_ms',
};

export async function updateMessage(tx: Tx, id: string, patch: MessagePatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof MessagePatch, string][]) {
    const value = patch[key];
    if (value === undefined) continue;
    params.push(Array.isArray(value) ? JSON.stringify(value) : value);
    sets.push(`${column} = $${params.length}`);
  }
  if (!sets.length) return;
  await tx.query(`update ai_messages set ${sets.join(', ')} where id = $1`, params);
}

/**
 * `forUserId` joins that caller's own rating onto each row — `AiMessageSchema.feedback` is
 * "the caller's own rating", never someone else's.
 */
export async function listMessages(
  q: Q,
  conversationId: string,
  forUserId: string | null = null,
): Promise<AiMessage[]> {
  const r = await q.query(
    `select m.*, f.rating feedback
       from ai_messages m
       left join ai_message_feedback f on f.message_id = m.id and f.user_id = $2
      where m.conversation_id = $1 order by m.seq`,
    [conversationId, forUserId],
  );
  return r.rows.map(toMessage);
}

/** The conversation a message belongs to, for the feedback route's participant check. */
export async function conversationOfMessage(q: Q, messageId: string): Promise<Conversation | null> {
  const r = await q.query('select conversation_id from ai_messages where id=$1', [messageId]);
  return r.rowCount ? getConversation(q, r.rows[0].conversation_id as string) : null;
}

export async function setFeedback(
  tx: Tx,
  messageId: string,
  userId: string,
  rating: 'up' | 'down',
  note: string,
): Promise<void> {
  await tx.query(
    `insert into ai_message_feedback(message_id, user_id, rating, note) values ($1,$2,$3,$4)
     on conflict (message_id, user_id) do update set rating = excluded.rating, note = excluded.note, created_at = now()`,
    [messageId, userId, rating, note],
  );
}

/* ── proposed edits ──────────────────────────────────────────────────────── */

export async function createProposedEdits(
  tx: Tx,
  input: { messageId: string; documentId: string; baseSourceVersion: number; ops: ProposedEditOp[] },
): Promise<ProposedEdits> {
  const r = await tx.query(
    `insert into ai_proposed_edits(message_id, document_id, base_source_version, ops)
     values ($1,$2,$3,$4) returning *`,
    [input.messageId, input.documentId, input.baseSourceVersion, JSON.stringify(input.ops)],
  );
  return toProposedEdits(r.rows[0]);
}

export async function getProposedEdits(q: Q, id: string): Promise<ProposedEdits | null> {
  const r = await q.query('select * from ai_proposed_edits where id=$1', [id]);
  return r.rowCount ? toProposedEdits(r.rows[0]) : null;
}

/** The conversation behind a proposal, for the decide route's owner check. */
export async function conversationOfProposedEdits(
  q: Q,
  id: string,
): Promise<Conversation | null> {
  const r = await q.query(
    `select m.conversation_id from ai_proposed_edits p join ai_messages m on m.id = p.message_id where p.id = $1`,
    [id],
  );
  return r.rowCount ? getConversation(q, r.rows[0].conversation_id as string) : null;
}

/**
 * `status='proposed'` in the predicate is the whole concurrency story: two decides on the same
 * proposal race into this update and exactly one row comes back, so the loser is a 409 rather
 * than a second source save.
 */
export async function decideProposedEdits(
  tx: Tx,
  id: string,
  status: ProposedEditsStatus,
  userId: string,
  resultingSourceVersion: number | null,
): Promise<ProposedEdits | null> {
  const r = await tx.query(
    `update ai_proposed_edits set status=$2, decided_by=$3, decided_at=now(), resulting_source_version=$4
     where id=$1 and status='proposed' returning *`,
    [id, status, userId, resultingSourceVersion],
  );
  return r.rowCount ? toProposedEdits(r.rows[0]) : null;
}

/* ── transcript export ───────────────────────────────────────────────────── */

export interface ExportRow {
  conversation: Conversation;
  messages: AiMessage[];
  feedback: { messageId: string; userId: string; rating: string; note: string }[];
}

export interface ExportFilter {
  from?: string;
  to?: string;
  userId?: string;
  documentId?: string;
}

const EXPORT_PAGE = 100;

/**
 * An async generator rather than one query: a year of transcripts is more than a reply buffer,
 * and the route streams a line per conversation as each page arrives.
 */
export async function* exportCursor(q: Q, filter: ExportFilter): AsyncIterable<ExportRow> {
  let offset = 0;
  for (;;) {
    const page = await q.query(
      `select c.id from ai_conversations c
        where c.deleted_at is null
          and ($1::uuid is null or c.user_id = $1)
          and ($2::uuid is null or c.document_id = $2)
          and ($3::timestamptz is null or c.created_at >= $3)
          and ($4::timestamptz is null or c.created_at <= $4)
        order by c.created_at limit $5 offset $6`,
      [
        filter.userId ?? null,
        filter.documentId ?? null,
        filter.from ?? null,
        filter.to ?? null,
        EXPORT_PAGE,
        offset,
      ],
    );
    if (!page.rowCount) return;
    for (const row of page.rows as { id: string }[]) {
      const conversation = await getConversation(q, row.id);
      if (!conversation) continue;
      const messages = await listMessages(q, row.id);
      const fb = await q.query(
        `select f.message_id, f.user_id, f.rating, f.note from ai_message_feedback f
           join ai_messages m on m.id = f.message_id where m.conversation_id = $1 order by f.created_at`,
        [row.id],
      );
      yield {
        conversation,
        messages,
        feedback: (fb.rows as Row[]).map((x) => ({
          messageId: x.message_id as string,
          userId: x.user_id as string,
          rating: x.rating as string,
          note: (x.note as string) ?? '',
        })),
      };
    }
    offset += page.rowCount;
  }
}
