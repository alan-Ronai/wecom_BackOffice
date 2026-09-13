import type { FastifyInstance } from 'fastify';
import type { Event } from '@wecom/shared';
import { requireUser } from '../../lib/user.js';
import { httpError } from '../../lib/http.js';

const HEARTBEAT_MS = 25_000;
/** One browser tab per agent, plus headroom; beyond this the stream is refused, not queued. */
const MAX_CONNECTIONS = 200;
/** documentId -> category, so a scope check does not query on every event per subscriber. */
const CATEGORY_TTL_MS = 60_000;

const documentIdOf = (e: Event): string | null =>
  'documentId' in e.payload ? ((e.payload as { documentId?: string }).documentId ?? null) : null;

export default async function routes(app: FastifyInstance) {
  let open = 0;
  const categories = new Map<string, { at: number; category: string | null }>();

  const categoryOf = async (documentId: string): Promise<string | null> => {
    const hit = categories.get(documentId);
    if (hit && Date.now() - hit.at < CATEGORY_TTL_MS) return hit.category;
    const r = await app.db.query<{ category: string }>('select category from documents where id=$1', [
      documentId,
    ]);
    const category = r.rows[0]?.category ?? null;
    categories.set(documentId, { at: Date.now(), category });
    return category;
  };

  app.get(
    '/events',
    { config: { requires: ['docs.read'] }, schema: { tags: ['events'], hide: true } },
    async (req, reply) => {
      const user = requireUser(req);
      if (open >= MAX_CONNECTIONS)
        throw httpError(503, 'TOO_MANY_STREAMS', 'יותר מדי חיבורים פתוחים, נסה שוב בעוד רגע');
      reply.hijack();
      const res = reply.raw;
      open++;
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(': connected\n\n');
      const scopes = user.categoryScopes;
      const off = app.events.subscribe((e) => {
        void (async () => {
          // A category-scoped user must not learn about documents outside their scope.
          if (scopes) {
            const id = documentIdOf(e);
            if (id && !scopes.includes((await categoryOf(id)) ?? '')) return;
          }
          // `write` returns false when the socket's buffer is full; a client that
          // cannot keep up is dropped rather than growing the buffer without bound.
          if (!res.write(`event: ${e.name}\ndata: ${JSON.stringify(e)}\n\n`)) res.end();
        })();
      });
      const ping = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        open--;
        clearInterval(ping);
        off();
      };
      req.raw.on('close', close);
      req.raw.on('error', close);
    },
  );
}
