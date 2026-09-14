import type { SyncLinkRow, SyncLinkState } from '../../api/stage5.js';
import { Chip } from '../ui/index.js';

export const STATE_LABEL: Record<SyncLinkState, { label: string; tone: string }> = {
  synced: { label: 'זהה', tone: 'chip-green' },
  pending_import: { label: 'ממתין לייבוא', tone: 'chip-blue' },
  pending_push: { label: 'ממתין לדחיפה', tone: 'chip-amber' },
  conflict: { label: 'קונפליקט', tone: 'chip-red' },
};

export const StateChip = ({ state }: { state: SyncLinkState }) => (
  <Chip tone={STATE_LABEL[state].tone}>{STATE_LABEL[state].label}</Chip>
);

/**
 * Which way this row can move. A link is not "syncable" in the abstract: one whose remote changed
 * can be imported, one whose local copy moved on can be pushed, and a conflict can do neither
 * until somebody decides what the merged text is.
 */
export const direction = (l: SyncLinkRow): 'import' | 'push' | null =>
  l.state === 'pending_import' ? 'import' : l.state === 'pending_push' ? 'push' : null;
