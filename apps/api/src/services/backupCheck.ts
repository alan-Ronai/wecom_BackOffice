import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

export interface BackupCheckResult {
  ok: boolean;
  latestFile: string | null;
  ageHours: number | null;
  /** mtime of the latest matching dump, ISO 8601 — null when no backup was found. */
  latestAt: string | null;
}

const BACKUP_FILE_RE = /^kb-\d{8}-\d{4}\.dump$/;

/**
 * Verifies that a recent nightly backup exists in `backupDir` (written by
 * deploy/backup.sh as kb-YYYYmmdd-HHMM.dump, pg_dump custom format). Used by the
 * `system.backup-check` job so `GET /admin/system` can surface a stale-backup
 * warning without reaching into the filesystem itself. The API container must
 * mount the backup directory read-only (see deploy/docker-compose.yml).
 */
export async function checkBackupAge(backupDir: string, maxAgeHours = 26): Promise<BackupCheckResult> {
  try {
    const entries = await readdir(backupDir);
    const candidates = entries.filter((f) => BACKUP_FILE_RE.test(f));
    if (candidates.length === 0) return { ok: false, latestFile: null, ageHours: null, latestAt: null };
    let latest: { name: string; mtimeMs: number } | null = null;
    for (const name of candidates) {
      const s = await stat(path.join(backupDir, name));
      if (!latest || s.mtimeMs > latest.mtimeMs) latest = { name, mtimeMs: s.mtimeMs };
    }
    const ageHours = (Date.now() - latest!.mtimeMs) / 3_600_000;
    return {
      ok: ageHours <= maxAgeHours,
      latestFile: latest!.name,
      ageHours,
      latestAt: new Date(latest!.mtimeMs).toISOString(),
    };
  } catch {
    return { ok: false, latestFile: null, ageHours: null, latestAt: null };
  }
}

const SYSTEM_STATE_KEY = 'backup_check';

/**
 * Persists the `system.backup-check` worker's result (see `plugins/boss.ts`) so
 * `GET /system/health` and `GET /admin/system` can show *the worker's* last verdict —
 * `lastBackupAt` / `lastBackupOk` — without re-touching the filesystem on every request,
 * and so the result survives past the job that produced it (the worker and the request
 * that reads it are not always the same process).
 */
export async function recordBackupCheck(
  db: pg.Pool | pg.PoolClient,
  result: BackupCheckResult,
): Promise<void> {
  await db.query(
    `insert into system_state(key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [SYSTEM_STATE_KEY, JSON.stringify(result)],
  );
}

export interface RecordedBackupCheck extends BackupCheckResult {
  checkedAt: string;
}

/** The most recent worker-recorded result, or null if the worker has never run yet. */
export async function getRecordedBackupCheck(
  db: pg.Pool | pg.PoolClient,
): Promise<RecordedBackupCheck | null> {
  try {
    const r = await db.query('select value, updated_at from system_state where key=$1', [SYSTEM_STATE_KEY]);
    if (!r.rowCount) return null;
    const value = r.rows[0].value as BackupCheckResult;
    return { ...value, checkedAt: new Date(r.rows[0].updated_at as Date).toISOString() };
  } catch {
    // system_state may not exist yet (pre-migration) — callers fall back to a live check.
    return null;
  }
}
