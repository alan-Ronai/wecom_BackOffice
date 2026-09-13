import { writeFileSync, mkdirSync } from 'node:fs';
import { buildApp } from './app.js';

/**
 * `z.null()` is the only way to declare a 204 through the zod type provider, and it serialises to
 * `{ enum: ['null'] }` — i.e. the *string* "null" — which makes generated clients believe a
 * no-content response carries a body. 204 means no body, so strip the content block.
 */
function dropNoContentBodies(spec: Record<string, unknown>): Record<string, unknown> {
  const paths = (spec.paths ?? {}) as Record<string, Record<string, { responses?: Record<string, object> }>>;
  for (const ops of Object.values(paths)) {
    for (const op of Object.values(ops)) {
      const res = op?.responses?.['204'];
      if (res && 'content' in res) delete (res as { content?: unknown }).content;
    }
  }
  return spec;
}

const app = await buildApp({ config: { DATABASE_URL: 'postgres://x:x@127.0.0.1:1/x', NODE_ENV: 'test' } });
await app.ready();
mkdirSync('../../docs/api', { recursive: true });
const spec = dropNoContentBodies(app.swagger() as unknown as Record<string, unknown>);
writeFileSync('../../docs/api/openapi.json', JSON.stringify(spec, null, 2) + '\n');
await app.close();
console.log('wrote docs/api/openapi.json');
