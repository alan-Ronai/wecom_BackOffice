import type { z } from 'zod';
import type { AuditDiffRowSchema } from '@wecom/shared';

export type DiffRow = z.infer<typeof AuditDiffRowSchema>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `a.b[0].c` — dotted for keys, bracketed for array indices, so a path reads back. */
const join = (base: string, key: string | number): string =>
  typeof key === 'number' ? `${base}[${key}]` : base ? `${base}.${key}` : key;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Flattens two audit snapshots into the rows the audit drawer renders.
 *
 * Recursion stops at anything that is not a plain object: an array of steps is one row
 * ("this list changed"), not forty rows of noise, because an operator reading the trail
 * wants to know *which field* an admin touched, not how a nested structure re-indexed.
 * Rows are only emitted where the two sides actually differ.
 */
export function diffRows(before: unknown, after: unknown, base = '', depth = 0): DiffRow[] {
  if (same(before, after)) return [];
  const MAX_DEPTH = 4;
  if (depth < MAX_DEPTH && (isPlainObject(before) || isPlainObject(after))) {
    const b = isPlainObject(before) ? before : {};
    const a = isPlainObject(after) ? after : {};
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
    // One side is not an object at all: report the replacement, not a phantom per-key diff.
    if (isPlainObject(before) && isPlainObject(after))
      return keys.flatMap((k) => diffRows(b[k], a[k], join(base, k), depth + 1));
  }
  return [{ path: base || '(root)', before: (before ?? null) as never, after: (after ?? null) as never }];
}
