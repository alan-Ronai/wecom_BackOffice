import { runner } from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function runMigrations(
  databaseUrl: string,
  log: (msg: string) => void = () => undefined,
): Promise<string[]> {
  const applied = await runner({
    databaseUrl,
    dir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    ignorePattern: 'package\\.json',
    log,
    checkOrder: true,
  });
  return applied.map((m) => m.name);
}
