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
  source: { id: string; title: string };
  diffs: ParagraphDiff[];
  paragraphs: Paragraph[];
  linkedSteps: LinkedStep[];
  fields: { name: string; status: string }[];
  blocks: { id: string; title: string; actions: string[] }[];
}
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
>;
export interface ModelClient {
  name: string;
  available(): Promise<boolean>;
  proposeChanges(ctx: ProposalContext): Promise<ProposedSuggestion[]>;
  embed?(text: string): Promise<number[]>;
}
