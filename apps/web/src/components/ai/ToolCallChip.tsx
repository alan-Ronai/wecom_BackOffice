import { AI_TOOLS, type AiToolName } from '@wecom/shared';
import type { ToolChip } from '../../lib/chatReducer.js';

/**
 * "מה המערכת עשתה" — one chip per tool round-trip.
 *
 * The Hebrew labels are read off `AI_TOOLS` rather than re-spelled here: the catalogue is
 * append-only because transcripts store tool names, and a second copy of the labels is the thing
 * that would drift from it.
 */
const LABEL = Object.fromEntries(AI_TOOLS.map((t) => [t.name, t.label])) as Record<AiToolName, string>;

export const toolLabel = (name: string): string => LABEL[name as AiToolName] ?? name;

export function ToolCallChip({ tool }: { tool: ToolChip }) {
  const pending = tool.ok === undefined;
  return (
    <span
      className="chip chip-gray tool-chip"
      title={tool.summary || toolLabel(tool.name)}
      data-tool={tool.name}
    >
      {pending ? (
        <i className="spin" aria-hidden="true" />
      ) : (
        <span aria-hidden="true">{tool.ok ? '✓' : '✕'}</span>
      )}
      {toolLabel(tool.name)}
      {tool.summary ? <span className="muted"> · {tool.summary}</span> : null}
    </span>
  );
}

export function ToolChips({ tools }: { tools: ToolChip[] }) {
  if (!tools.length) return null;
  return (
    <div className="chat-tools">
      {tools.map((t) => (
        <ToolCallChip key={t.id} tool={t} />
      ))}
    </div>
  );
}
