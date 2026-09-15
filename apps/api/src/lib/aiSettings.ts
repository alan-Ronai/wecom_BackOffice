/**
 * Wave 6 (X0) — the one reader/writer for the admin-editable AI settings. Mirrors wave 5's
 * `workflowSettings.ts`: the stored JSON is a *patch*, never the full object, so every key a
 * later lane adds to `AiSettingsSchema` reads back as its default with no migration and no
 * backfill. X1 reads `brief`/`style`/`limits` to assemble the v3 prompt, X2 reads `limits`
 * for the rate limit and the context budget, X4b serves `/admin/ai`.
 *
 * Unlike `workflow`, this lives in **four** `app_settings` rows (`ai.brief`, `ai.style`,
 * `ai.models`, `ai.limits`, seeded `{}` by 0050) rather than one, because the brief and the
 * style rules are versioned documents in their own right: every change bumps that key's
 * `version` and appends to `ai_setting_versions`, and the pair is what `currentPromptVersion`
 * stamps onto each suggestion and each message. Without it, "the model got worse" is an
 * unanswerable question.
 */
import {
  AI_SETTINGS_KEYS,
  AiSettingsSchema,
  type AiSettings,
  type AiSettingsKey,
  type AiSettingsPut,
} from '@wecom/shared';
import type { Queryable, Tx } from './sql.js';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Nested merge so a PUT of `{ models: { tier } }` keeps the slot overrides already stored. */
const deepMerge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(a[k]) ? deepMerge(a[k], v) : v;
  }
  return out;
};

/** `ai.brief` → `brief`. The row key is namespaced; the settings object is not. */
const section = (key: AiSettingsKey) => key.slice('ai.'.length) as keyof AiSettings;

/** Parsing with every sub-object present is what applies the defaults. */
const effective = (stored: Partial<Record<keyof AiSettings, unknown>>): AiSettings =>
  AiSettingsSchema.parse({ brief: {}, style: {}, models: {}, limits: {}, ...stored });

const readRows = async (
  q: Queryable,
  forUpdate = false,
): Promise<Record<keyof AiSettings, Record<string, unknown>>> => {
  const r = await q.query(
    `select key, value from app_settings where key = any($1::text[])${forUpdate ? ' for update' : ''}`,
    [[...AI_SETTINGS_KEYS]],
  );
  const out = {} as Record<keyof AiSettings, Record<string, unknown>>;
  for (const key of AI_SETTINGS_KEYS) out[section(key)] = {};
  for (const row of r.rows as { key: AiSettingsKey; value: unknown }[])
    if (isPlainObject(row.value)) out[section(row.key)] = row.value;
  return out;
};

/** Effective AI settings: the four stored patches with schema defaults filling every gap. */
export async function getAiSettings(q: Queryable): Promise<AiSettings> {
  return effective(await readRows(q));
}

/**
 * The prompt version every suggestion and every message records: `v3.<brief>.<style>`.
 * v3 is the wave 6 system prompt itself (spec §1.7); the two numbers are what an admin
 * changed since. A prompt-quality regression is then attributable to a row in
 * `ai_setting_versions` rather than to a hunch.
 */
export const currentPromptVersion = (settings: AiSettings): string =>
  `v3.${settings.brief.version}.${settings.style.version}`;

/**
 * Deep-merges `patch` into the stored rows and upserts the ones that changed, returning the
 * effective settings. Takes a transaction client because the read is `for update`: two
 * admins saving different sections at once must not lose one another's half.
 *
 * Editing `brief` or `style` bumps that key's `version` and writes an `ai_setting_versions`
 * row, so the text behind any stamped prompt version can always be recovered.
 */
export async function putAiSettings(
  tx: Tx,
  patch: AiSettingsPut,
  actorId: string | null,
): Promise<AiSettings> {
  const stored = await readRows(tx, true);
  const merged = {} as Record<keyof AiSettings, Record<string, unknown>>;
  const changed: AiSettingsKey[] = [];
  for (const key of AI_SETTINGS_KEYS) {
    const name = section(key);
    const incoming = (patch as Record<string, unknown>)[name];
    if (!isPlainObject(incoming)) {
      merged[name] = stored[name];
      continue;
    }
    const next = deepMerge(stored[name], incoming);
    // A versioned text block bumps only when its text actually moved: a PUT that re-sends
    // the same brief must not manufacture a version nobody wrote.
    if ((name === 'brief' || name === 'style') && next.text !== stored[name].text)
      next.version = Number(stored[name].version ?? 0) + 1;
    merged[name] = next;
    if (JSON.stringify(next) !== JSON.stringify(stored[name])) changed.push(key);
  }
  const settings = effective(merged); // validates before anything is written
  for (const key of changed) {
    const name = section(key);
    await tx.query(
      `insert into app_settings(key, value, updated_at, updated_by) values ($1, $2, now(), $3)
         on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
      [key, JSON.stringify(merged[name]), actorId],
    );
    if (name === 'brief' || name === 'style')
      await tx.query(
        `insert into ai_setting_versions(key, version, value, updated_by) values ($1, $2, $3, $4)
           on conflict (key, version) do nothing`,
        [key, settings[name].version, JSON.stringify(merged[name]), actorId],
      );
  }
  return settings;
}
