import type { Paragraph, ParagraphDiff, Suggestion } from '@wecom/shared';
export interface LinkedStep {
  documentId: string;
  documentTitle: string;
  stepKey: string;
  stepNum: string;
  stepTitle: string;
  anchor: string;
  actions: string[];
  blockId?: string;
}
export interface ProposalContext {
  source: {
    id: string;
    title: string;
    /**
     * The source is ONE remote item (a WordPress post, a JSON/CSV row-group) rather than a
     * multi-topic document, so on the "no matching document" path its sections become the
     * phases of a single card instead of a card each — one item, one document, one sync link.
     * Absent (docx/text uploads) means "one card per section".
     */
    singleDocument?: boolean;
  };
  diffs: ParagraphDiff[];
  paragraphs: Paragraph[];
  linkedSteps: LinkedStep[];
  fields: { name: string; status: string }[];
  blocks: { id: string; title: string; actions: string[] }[];
  /* ── wave 6 (X1): the briefed, impact-aware prompt (spec §1.6, §1.7) ───── */
  /** The admin-edited company brief (`ai.brief`). Absent means "no brief configured". */
  brief?: string;
  /** The admin-edited style rules for agent-facing text (`ai.style`). */
  style?: string;
  /** What the change touches beyond its own steps — the whole point of wave 6. */
  impact?: ImpactSet;
  /** Accepted suggestions of the same type to imitate; X1 budgets how many fit. */
  examples?: FewShotExample[];
  /**
   * `ai.limits.maxContextChars`. The assembler, not the caller, decides what to drop, but
   * it has to be told the budget — a CPU-only 7B with everything appended is a timeout.
   */
  maxContextChars?: number;
}

/**
 * Everything the change reaches, computed by the api from the graph and the embeddings.
 * `usedBy` counts are what make a model cautious about a shared block: they are the
 * difference between "rewrite this action" and "this action appears in nine documents".
 */
export interface ImpactSet {
  documents: { id: string; title: string; why: string }[];
  blocks: { id: string; title: string; usedBy: number }[];
  fields: { name: string; usedBy: number }[];
  topics: { id: string; name: string }[];
  related: { id: string; title: string; similarity: number }[];
}

/** One accepted suggestion, shown to the model as "this is what a good answer looks like". */
export interface FewShotExample {
  diff: string;
  suggestion: ProposedSuggestion;
}
/**
 * What a model returns. Everything the *server* owns is omitted, including wave 6's
 * `affects`: the impact set is computed by the api from the graph and the embeddings
 * (spec §1.6) and stamped onto the row — a model must not be able to claim a change
 * touches a document it never saw.
 */
export type ProposedSuggestion = Omit<
  Suggestion,
  | 'id'
  | 'sourceRevisionId'
  | 'status'
  | 'createdAt'
  | 'decidedBy'
  | 'decidedAt'
  | 'appliedVersionId'
  | 'editedPayload'
  | 'affects'
  | 'editDiff'
  | 'appliedParts'
>;
/* ── wave 5 (V1): quiz question generation (additive, optional) ─────────── */
export interface QuestionContextStep {
  key: string;
  num: string;
  title: string;
  actions: string[];
  outcomes: { text: string; gotoTitle?: string }[];
  branch?: { q: string; options: { label: string; text: string }[] };
}
export interface QuestionContext {
  documents: { id: string; title: string; steps: QuestionContextStep[] }[];
  perDocument: number;
  /** Rule-generated questions the model may rewrite instead of duplicating. */
  seeds: GeneratedQuestion[];
}
export interface GeneratedQuestion {
  documentId: string;
  stepKey: string | null;
  stem: string;
  kind: 'single' | 'multi' | 'order' | 'free';
  options: { id: string; text: string; correct: boolean }[];
  explanation: string;
  modelConf: number | null;
}

/* ── wave 6 (X2): chat ──────────────────────────────────────────────────── */

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Set on an assistant turn that asked for tools. */
  toolCalls?: ToolCall[];
  /** Set on a `tool` turn: which call this is the result of. */
  toolCallId?: string;
}
/**
 * A tool as the model sees it. `parameters` is a JSON Schema object — Ollama's tool calling
 * takes it verbatim, and the server validates the arguments again with zod before running
 * anything, because a model's "valid JSON" is not an authorisation.
 */
export interface ChatToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  tokensIn: number;
  tokensOut: number;
}

export interface ModelClient {
  name: string;
  available(): Promise<boolean>;
  proposeChanges(ctx: ProposalContext): Promise<ProposedSuggestion[]>;
  embed?(text: string): Promise<number[]>;
  /**
   * Wave 6 (X0). Optional, like `generateQuestions`: absent means unsupported, and
   * `RuleBasedModel` implements neither — there is no deterministic fallback for a chat.
   *
   * `onToken` is what makes the SSE stream tokens rather than one blob; `signal` is how a
   * closed browser tab stops occupying the single CPU inference slot.
   */
  chat?(input: {
    model?: string;
    messages: ChatMessage[];
    tools?: ChatToolSpec[];
    onToken?: (t: string) => void;
    signal?: AbortSignal;
  }): Promise<ChatResult>;
  /**
   * Wave 6 (X1). One round trip for a batch of texts — the reindex job after an embedder
   * change is tens of thousands of embeddings, and per-text calls make it hours.
   * Anything that wraps `embed` must wrap this too (`lib/embedStatus.ts`).
   */
  embedBatch?(texts: string[]): Promise<number[][]>;
  /**
   * Wave 5 (V1). Optional: `RuleBasedModel` does not implement it — the api owns the
   * deterministic rules and treats an absent method exactly like a failed call.
   */
  generateQuestions?(ctx: QuestionContext): Promise<GeneratedQuestion[]>;
}
