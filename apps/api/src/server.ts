import { buildApp } from './app.js';
import { runMigrations } from './migrate.js';
import { loadConfig } from './config.js';

const config = loadConfig();
// The container entrypoint (deploy/docker-entrypoint-api.sh) already runs migrations
// and sets MIGRATIONS_APPLIED=1; running them again here only doubled start-up time
// and logged a contradicting second line. `pnpm dev`/bare `node dist/server.js` still
// migrate, so a local run needs no extra step.
if (process.env.MIGRATE_ON_START !== 'false' && process.env.MIGRATIONS_APPLIED !== '1') {
  const applied = await runMigrations(config.DATABASE_URL, (m) =>
    console.log(JSON.stringify({ level: 30, msg: m, component: 'migrate' })),
  );
  console.log(JSON.stringify({ level: 30, msg: `migrations applied: ${applied.length}`, applied }));
}
const app = await buildApp();
await app.listen({ port: app.config.PORT, host: '0.0.0.0' });
const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
