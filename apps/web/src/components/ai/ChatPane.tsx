/**
 * PLACEHOLDER — X4a ships the real `ChatPane` at this path and X6 deletes this file at merge.
 *
 * It exists so the two X4b mounts (`EditorChatDock`, `ArticleAskPane`) can be written, typed and
 * tested against the agreed props while the lanes run in parallel. The props are X4a's, verbatim:
 * changing them here would mean changing them twice.
 */
import type { ReactNode } from 'react';

export interface ChatPaneProps {
  kind: 'workspace' | 'editor' | 'article';
  documentId: string;
  sourceRevisionId?: string;
  context?: { stepKey?: string; suggestionId?: string; selection?: string };
  /** No write tools, no composer affordances beyond asking (the article pane). */
  readOnly?: boolean;
  /** The dock and the ask pane are narrow; the workspace page is not. */
  compact?: boolean;
  onProposedEdits?: (proposedEditsId: string) => void;
  onRefinedSuggestion?: (suggestionId: string) => void;
  /** Every `tool_result` frame, so a host can consume the one it cares about (`draft_step`). */
  onToolResult?: (name: string, payload: unknown, messageId: string) => void;
  /** Step number → step key, so a citation can link to `/doc/:id/:stepKey`. */
  stepIndex?: Record<string, string>;
  className?: string;
}

export function ChatPane({ className }: ChatPaneProps): ReactNode {
  return <div className={['chat-pane', 'muted', className].filter(Boolean).join(' ')}>הצ&apos;אט נטען…</div>;
}
