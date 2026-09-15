import { describe, it, expect } from 'vitest';
import { MODEL_TIER_PRESETS } from '@wecom/shared';
import { currentPromptVersion, getAiSettings, putAiSettings } from '../../src/lib/aiSettings.js';
import { QUEUES } from '../../src/plugins/boss.js';

/** The fake-db pattern from `workflowSettings.test.ts`: one row set, every call recorded. */
const fakeDb = (rows: { key: string; value: unknown }[]) => {
  const calls: { text: string; values?: unknown[] }[] = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return /select/i.test(text) ? { rows, rowCount: rows.length } : { rows: [], rowCount: 0 };
    },
  };
};
const written = (db: ReturnType<typeof fakeDb>, table: string) =>
  db.calls.filter((c) => new RegExp(`insert into ${table}`, 'i').test(c.text));

describe('AI settings', () => {
  it('returns schema defaults when no row exists', async () => {
    const s = await getAiSettings(fakeDb([]) as never);
    expect(s.brief).toEqual({ text: '', version: 0 });
    expect(s.limits).toEqual({ chatPerUserPerHour: 60, maxContextChars: 24000 });
    expect(s.models.tier).toBe(1);
    expect(s.models.embedDimension).toBe(1024);
  });
  it('fills missing keys from defaults and reads all four rows at once', async () => {
    const db = fakeDb([
      { key: 'ai.brief', value: { text: 'רונאי — ספקית תקשורת', version: 3 } },
      { key: 'ai.limits', value: { chatPerUserPerHour: 120 } },
    ]);
    const s = await getAiSettings(db as never);
    expect(s.brief).toEqual({ text: 'רונאי — ספקית תקשורת', version: 3 });
    expect(s.limits).toEqual({ chatPerUserPerHour: 120, maxContextChars: 24000 });
    expect(s.style.version).toBe(0);
    expect(db.calls).toHaveLength(1); // one `= any($1)`, not four round trips
  });
  it('the prompt version is v3 plus the two text versions', () => {
    expect(
      currentPromptVersion({
        brief: { text: 'a', version: 4 },
        style: { text: 'b', version: 2 },
        models: MODEL_TIER_PRESETS[1] as never,
        limits: { chatPerUserPerHour: 60, maxContextChars: 24000 },
      } as never),
    ).toBe('v3.4.2');
  });
  it('deep-merges a models patch and writes only the row that changed', async () => {
    const db = fakeDb([{ key: 'ai.models', value: { tier: 1, chatModel: 'keep-me' } }]);
    const s = await putAiSettings(db as never, { models: { tier: 2 } }, null);
    expect(s.models.tier).toBe(2);
    expect(s.models.chatModel).toBe('keep-me');
    const upserts = written(db, 'app_settings');
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.values?.[0]).toBe('ai.models');
    expect(written(db, 'ai_setting_versions')).toHaveLength(0);
    expect(db.calls[0]?.text).toMatch(/for update/i);
  });
  it('a brief edit bumps its version and appends a version row', async () => {
    const db = fakeDb([{ key: 'ai.brief', value: { text: 'ישן', version: 1 } }]);
    const s = await putAiSettings(db as never, { brief: { text: 'חדש' } }, 'u1');
    expect(s.brief).toEqual({ text: 'חדש', version: 2 });
    expect(currentPromptVersion(s)).toBe('v3.2.0');
    const versions = written(db, 'ai_setting_versions');
    expect(versions).toHaveLength(1);
    expect(versions[0]?.values?.slice(0, 2)).toEqual(['ai.brief', 2]);
    expect(versions[0]?.values?.[3]).toBe('u1');
  });
  it('re-sending the same brief text writes nothing', async () => {
    const db = fakeDb([{ key: 'ai.brief', value: { text: 'אותו דבר', version: 7 } }]);
    const s = await putAiSettings(db as never, { brief: { text: 'אותו דבר' } }, 'u1');
    expect(s.brief.version).toBe(7);
    expect(written(db, 'app_settings')).toHaveLength(0);
    expect(written(db, 'ai_setting_versions')).toHaveLength(0);
  });
  it('an invalid patch is rejected before anything is written', async () => {
    const db = fakeDb([]);
    await expect(putAiSettings(db as never, { limits: { chatPerUserPerHour: 0 } }, null)).rejects.toThrow();
    expect(written(db, 'app_settings')).toHaveLength(0);
  });
  it('registers the wave 6 queues', () => {
    expect(QUEUES.aiEval).toBe('ai.eval');
    expect(QUEUES.aiReindex).toBe('ai.reindex');
  });
});
