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

export interface ModelClient {
  name: string;
  available(): Promise<boolean>;
  proposeChanges(ctx: ProposalContext): Promise<ProposedSuggestion[]>;
  embed?(text: string): Promise<number[]>;
  /**
   * Wave 5 (V1). Optional: `RuleBasedModel` does not implement it — the api owns the
   * deterministic rules and treats an absent method exactly like a failed call.
   */
  generateQuestions?(ctx: QuestionContext): Promise<GeneratedQuestion[]>;
}
