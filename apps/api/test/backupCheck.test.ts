import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backupHealth, checkBackupAge } from '../src/services/backupCheck.js';

let dir: string | null = null;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe('checkBackupAge', () => {
  it('reports not ok when the directory has no backup files', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kb-backup-'));
    const r = await checkBackupAge(dir);
    expect(r.ok).toBe(false);
    expect(r.latestFile).toBeNull();
    expect(r.ageHours).toBeNull();
  });

  it('reports not ok when the directory is missing', async () => {
    const r = await checkBackupAge('/nonexistent/path/for/kb-backup-check');
    expect(r.ok).toBe(false);
  });

  it('reports ok with a recent backup file and picks the newest one', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kb-backup-'));
    const older = path.join(dir, 'kb-20200101-0000.dump');
    const newer = path.join(dir, 'kb-20260913-0215.dump');
    await writeFile(older, 'x');
    await writeFile(newer, 'x');
    const oldTime = new Date(Date.now() - 40 * 3_600_000);
    await utimes(older, oldTime, oldTime);
    const r = await checkBackupAge(dir);
    expect(r.ok).toBe(true);
    expect(r.latestFile).toBe('kb-20260913-0215.dump');
    expect(r.ageHours).toBeLessThan(1);
    expect(r.latestAt).not.toBeNull();
    expect(new Date(r.latestAt!).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('ignores files that are not deploy/backup.sh dumps', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kb-backup-'));
    // The old pattern looked for `.sql.gz`, which backup.sh has never written.
    await writeFile(path.join(dir, 'kb-20260913-0215.sql.gz'), 'x');
    await writeFile(path.join(dir, 'notes.txt'), 'x');
    const r = await checkBackupAge(dir);
    expect(r.ok).toBe(false);
    expect(r.latestFile).toBeNull();
  });

  it('reports not ok when the newest file is older than maxAgeHours', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kb-backup-'));
    const stale = path.join(dir, 'kb-20200101-0000.dump');
    await writeFile(stale, 'x');
    const staleTime = new Date(Date.now() - 40 * 3_600_000);
    await utimes(stale, staleTime, staleTime);
    const r = await checkBackupAge(dir, 26);
    expect(r.ok).toBe(false);
    expect(r.ageHours).toBeGreaterThan(26);
  });
});

/**
 * W-9 — a fresh install reported `lastBackupOk: false`.
 *
 * `system.backup-check` runs at API start-up, and at install time there is no dump yet, so health
 * and `/admin/system` showed a red backup status at the end of a clean, correct install. The
 * boolean could not say otherwise: "nobody has taken one" and "the last one is 40 hours old" were
 * both `false`, and `deploy/smoke.sh` warns on both.
 */
describe('backupHealth', () => {
  const checkedAt = '2026-09-15T06:00:00.000Z';
  const latestAt = '2026-09-15T02:00:00.000Z';

  it('is `never` before the worker has recorded anything', () => {
    expect(backupHealth(null)).toEqual({
      status: 'never',
      latestAt: null,
      ageHours: null,
      checkedAt: null,
    });
  });

  it('is `never` when the worker ran and found no dump — which is the fresh install', () => {
    expect(backupHealth({ ok: false, latestFile: null, ageHours: null, latestAt: null, checkedAt })).toEqual({
      status: 'never',
      latestAt: null,
      ageHours: null,
      checkedAt,
    });
  });

  it('is `stale` only when a dump exists and is too old — the one to act on', () => {
    expect(
      backupHealth({ ok: false, latestFile: 'kb-20260913-0215.dump', ageHours: 40, latestAt, checkedAt }),
    ).toEqual({ status: 'stale', latestAt, ageHours: 40, checkedAt });
  });

  it('is `ok` with a recent dump', () => {
    expect(
      backupHealth({ ok: true, latestFile: 'kb-20260915-0215.dump', ageHours: 4, latestAt, checkedAt }),
    ).toEqual({ status: 'ok', latestAt, ageHours: 4, checkedAt });
  });
});
