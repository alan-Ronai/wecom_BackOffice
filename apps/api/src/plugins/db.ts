import fp from 'fastify-plugin';
import pg from 'pg';
declare module 'fastify' {
  interface FastifyInstance {
    db: pg.Pool;
  }
}
export default fp(async (app, opts: { pool?: pg.Pool }) => {
  const pool = opts.pool ?? new pg.Pool({ connectionString: app.config.DATABASE_URL, max: 10 });
  /**
   * `pg` re-emits an *idle* client's error on the pool, and an unhandled 'error' event is an
   * uncaught exception: a Postgres restart, failover or `pg_terminate_backend` would take the API
   * down with it (and, in the integration suite, the container stopping under a still-idle client
   * surfaced as a FATAL 57P01 that failed the run after every test had passed). The pool discards
   * the client; the next checkout reconnects.
   */
  pool.on('error', (err) => app.log.warn({ err }, 'idle postgres client error; connection dropped'));
  app.decorate('db', pool);
  app.addHook('onClose', async () => {
    await pool.end();
  });
});
