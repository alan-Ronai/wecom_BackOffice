import fp from 'fastify-plugin';
import pg from 'pg';
declare module 'fastify' {
  interface FastifyInstance {
    db: pg.Pool;
  }
}
export default fp(async (app, opts: { pool?: pg.Pool }) => {
  const pool = opts.pool ?? new pg.Pool({ connectionString: app.config.DATABASE_URL, max: 10 });
  app.decorate('db', pool);
  app.addHook('onClose', async () => {
    await pool.end();
  });
});
