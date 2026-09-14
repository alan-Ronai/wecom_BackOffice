import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkBackupAge } from '../src/services/backupCheck.js';

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
