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

/**
 * A route whose body schema accepts "no body" (`POST /suggestions/:id/accept`, where an empty
 * body means "accept the whole suggestion") still comes out of the type provider as
 * `requestBody.required: true` with the absent case rendered as the `{ "not": {} }` branch of an
 * `anyOf`. Generated clients then demand a body no caller has ever sent. Recognise that branch,
 * mark the body optional and hand the client the one real shape.
 */
function relaxOptionalBodies(spec: Record<string, unknown>): Record<string, unknown> {
  type Schema = { anyOf?: unknown[] };
  type Body = { required?: boolean; content?: Record<string, { schema?: Schema }> };
  const paths = (spec.paths ?? {}) as Record<string, Record<string, { requestBody?: Body }>>;
  const isAbsent = (s: unknown) =>
    !!s && typeof s === 'object' && 'not' in s && Object.keys((s as { not: object }).not ?? {}).length === 0;
  for (const ops of Object.values(paths))
    for (const op of Object.values(ops)) {
      const media = op?.requestBody?.content?.['application/json'];
      const anyOf = media?.schema?.anyOf;
      if (!media || !Array.isArray(anyOf) || !anyOf.some(isAbsent)) continue;
      op.requestBody!.required = false;
      const rest = anyOf.filter((s) => !isAbsent(s));
      if (rest.length === 1) media.schema = rest[0] as Schema;
      else media.schema!.anyOf = rest;
    }
  return spec;
}

const app = await buildApp({ config: { DATABASE_URL: 'postgres://x:x@127.0.0.1:1/x', NODE_ENV: 'test' } });
await app.ready();
mkdirSync('../../docs/api', { recursive: true });
const spec = relaxOptionalBodies(dropNoContentBodies(app.swagger() as unknown as Record<string, unknown>));
writeFileSync('../../docs/api/openapi.json', JSON.stringify(spec, null, 2) + '\n');
await app.close();
console.log('wrote docs/api/openapi.json');
