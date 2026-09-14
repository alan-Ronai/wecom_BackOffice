import { describe, it, expect } from 'vitest';
import { getWorkflowSettings, putWorkflowSettings } from '../../src/lib/workflowSettings.js';
import { QUEUES } from '../../src/plugins/boss.js';

const fakeDb = (rows: unknown[]) => {
  const calls: { text: string; values?: unknown[] }[] = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows, rowCount: rows.length };
    },
  };
};

describe('workflow settings', () => {
  it('returns schema defaults when no row exists', async () => {
    const s = await getWorkflowSettings(fakeDb([]) as never);
    expect(s.requireApprover).toBe(false);
    expect(s.learning.defaultMaxAttempts).toBeNull();
    expect(s.gaps.staleDays).toBe(180);
  });
  it('fills missing keys from defaults', async () => {
    const s = await getWorkflowSettings(
      fakeDb([{ value: { requireApprover: true, learning: { defaultPassMark: 70 } } }]) as never,
    );
    expect(s.requireApprover).toBe(true);
    expect(s.learning.defaultPassMark).toBe(70);
    expect(s.learning.refreshDueDays).toBe(7);
  });
  it('deep-merges a patch and upserts under key workflow', async () => {
    const db = fakeDb([{ value: { requireApprover: false, learning: { defaultPassMark: 70 } } }]);
    const s = await putWorkflowSettings(db as never, { gaps: { staleDays: 90 } }, null);
    expect(s.learning.defaultPassMark).toBe(70);
    expect(s.gaps.staleDays).toBe(90);
    const upsert = db.calls.find((c) => /insert into app_settings/i.test(c.text));
    expect(upsert?.values?.[0]).toBe('workflow');
  });
  it('registers the wave 5 queues', () => {
    expect(QUEUES.learningResolveAudiences).toBe('learning.resolve_audiences');
    expect(QUEUES.learningReminders).toBe('learning.reminders');
    expect(QUEUES.gapsDetect).toBe('gaps.detect');
  });
});
