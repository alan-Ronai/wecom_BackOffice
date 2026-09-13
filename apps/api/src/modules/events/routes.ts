import type { FastifyInstance } from 'fastify';
import { requireUser } from '../../lib/user.js';

const HEARTBEAT_MS = 25_000;

export default async function routes(app: FastifyInstance) {
  app.get(
    '/events',
    { config: { requires: ['docs.read'] }, schema: { tags: ['events'], hide: true } },
    async (req, reply) => {
      requireUser(req);
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(': connected\n\n');
      const off = app.events.subscribe((e) => {
        res.write(`event: ${e.name}\ndata: ${JSON.stringify(e)}\n\n`);
      });
      const ping = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
      const close = () => {
        clearInterval(ping);
        off();
      };
      req.raw.on('close', close);
      req.raw.on('error', close);
    },
  );
}
