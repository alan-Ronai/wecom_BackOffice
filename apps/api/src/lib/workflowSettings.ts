/**
 * Wave 5 (V0) — the one reader/writer for the operator-editable workflow settings stored in
 * `app_settings` under key `workflow`. V2 reads defaults (pass mark, refresh due days,
 * reminder lead time), V3 reads the approver gate and the gap thresholds and serves
 * `GET/PUT /admin/workflow`. Neither lane may re-derive these defaults on its own.
 *
 * The stored JSON is a *patch*, never the full object: everything missing is filled by
 * `WorkflowSettingsSchema`'s defaults at read time, so a settings key added in a later wave
 * needs no migration and no backfill.
 */
import {
  WORKFLOW_SETTINGS_KEY,
  WorkflowSettingsSchema,
  type WorkflowSettings,
  type WorkflowSettingsPut,
} from '@wecom/shared';
import type { Queryable, Tx } from './sql.js';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Nested merge so `PUT { gaps: { staleDays } }` keeps the learning block already stored. */
const deepMerge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(a[k]) ? deepMerge(a[k], v) : v;
  }
  return out;
};

/** Parsing through the schema with empty sub-objects present is what applies every default. */
const effective = (raw: Record<string, unknown>): WorkflowSettings =>
  WorkflowSettingsSchema.parse({ learning: {}, gaps: {}, ...raw });

/** Effective workflow settings: stored JSON (key `workflow`) with schema defaults filling every gap. */
export async function getWorkflowSettings(q: Queryable): Promise<WorkflowSettings> {
  const r = await q.query('select value from app_settings where key=$1', [WORKFLOW_SETTINGS_KEY]);
  return effective((r.rows[0]?.value as Record<string, unknown> | undefined) ?? {});
}

/**
 * Deep-merges `patch` into the stored value and upserts it, returning the effective settings.
 * Takes a transaction client because the read is `for update`: two admins saving different
 * sections at once must not lose one another's half.
 */
export async function putWorkflowSettings(
  tx: Tx,
  patch: WorkflowSettingsPut,
  actorId: string | null,
): Promise<WorkflowSettings> {
  const r = await tx.query('select value from app_settings where key=$1 for update', [WORKFLOW_SETTINGS_KEY]);
  const stored = (r.rows[0]?.value as Record<string, unknown> | undefined) ?? {};
  const merged = deepMerge(stored, patch as Record<string, unknown>);
  const settings = effective(merged); // validates before anything is written
  await tx.query(
    `insert into app_settings(key, value, updated_at, updated_by) values ($1, $2, now(), $3)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
    [WORKFLOW_SETTINGS_KEY, JSON.stringify(merged), actorId],
  );
  return settings;
}
