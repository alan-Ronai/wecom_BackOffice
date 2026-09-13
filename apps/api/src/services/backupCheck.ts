import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface BackupCheckResult {
  ok: boolean;
  latestFile: string | null;
  ageHours: number | null;
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
    if (candidates.length === 0) return { ok: false, latestFile: null, ageHours: null };
    let latest: { name: string; mtimeMs: number } | null = null;
    for (const name of candidates) {
      const s = await stat(path.join(backupDir, name));
      if (!latest || s.mtimeMs > latest.mtimeMs) latest = { name, mtimeMs: s.mtimeMs };
    }
    const ageHours = (Date.now() - latest!.mtimeMs) / 3_600_000;
    return { ok: ageHours <= maxAgeHours, latestFile: latest!.name, ageHours };
  } catch {
    return { ok: false, latestFile: null, ageHours: null };
  }
}
