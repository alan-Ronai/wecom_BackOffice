import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * §6.2 / item 19 — "every route is covered by an integration test" was a claim, not a check.
 * 133 OpenAPI paths and 400+ integration tests, and nothing failed when a new route shipped
 * untested. This is the check.
 *
 * It is deliberately coarse: it asserts that *some* test in `apps/api/test/**` issues a request
 * whose method and path match the OpenAPI entry. It cannot tell a thorough test from a smoke
 * test, and it is not meant to — its whole job is to fail loudly on a route nothing calls at all,
 * which is the failure mode that actually happened.
 *
 * A route that genuinely cannot be reached from this suite goes in `route-coverage-allowlist.json`
 * **with a reason**; the allowlist is itself asserted to be free of dead entries, so a route that
 * later gains a test cannot sit in it forever.
 */
const HERE = fileURLToPath(new URL('.', import.meta.url));
const OPENAPI = fileURLToPath(new URL('../../../docs/api/openapi.json', import.meta.url));
const ALLOWLIST = join(HERE, 'route-coverage-allowlist.json');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Every `.ts` file under apps/api/test, including helpers and fixtures. */
function testSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...testSources(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * `'/api/v1/fields/' + encodeURIComponent(name) + '/usage'` is one URL, not two fragments. Folding
 * it into the single literal `'/api/v1/fields/${}/usage'` lets the same pass that reads template
 * literals read it too — without this the scanner sees the prefix only and reports a false gap
 * for every route whose path parameter is spliced in this way.
 *
 * The pattern is anchored on a literal that already starts with `/api/v1`, and the spliced
 * expression may not contain a `;` (it may contain its own quoted string, as
 * `encodeURIComponent('…')` does), so it cannot run away across unrelated source.
 */
function foldConcatenations(flat: string): string {
  const CONCAT = /(['"])(\/api\/v1[^'"]*)\1 *\+ *(?:[^'";]|'[^']*')+? *\+ *\1([^'"]*)\1/g;
  let out = flat;
  for (let i = 0; i < 10; i++) {
    const next = out.replace(CONCAT, (_m, q, head, tail) => `${q}${head}\${}${tail}${q}`);
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * The (method, path) pairs the suite actually issues.
 *
 * Three spellings are in use across the suite and all three are read:
 *   `app.inject({ method: 'POST', url: '/api/v1/…' })` — sometimes across several lines, and
 *     sometimes with the two keys the other way round, so the source is flattened and each `url:`
 *     is paired with the nearest `method:` within a small window. Fastify's `inject` defaults to
 *     GET, so a `url:` with no method nearby is recorded as a GET.
 *   `get('/api/v1/…')` / `post(url, payload)` — the per-file helpers most suites define, and
 *     any name ending in the verb (`authedGet`, `api.post`, `del`).
 *   `inject('POST', '/api/v1/…')` — the positional helper in the wiring tests.
 */
function requestedRoutes(): Set<string> {
  const found = new Set<string>();
  const verbOf = (raw: string) => (raw.toLowerCase() === 'del' ? 'DELETE' : raw.toUpperCase());
  for (const file of testSources(HERE)) {
    const flat = foldConcatenations(readFileSync(file, 'utf8').replace(/\s+/g, ' '));
    const add = (verb: string, raw: string) => {
      const path = raw.split(/[?#]/)[0];
      if (path.startsWith('/api/v1/')) found.add(`${verbOf(verb)} ${path}`);
    };

    // 1. `url: '…'`, paired with the nearest `method: 'VERB'`.
    const methods: { at: number; verb: string }[] = [];
    for (const m of flat.matchAll(/method: *'(GET|POST|PUT|PATCH|DELETE)'/g))
      methods.push({ at: m.index!, verb: m[1] });
    for (const m of flat.matchAll(/url: *(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const at = m.index!;
      const near = methods
        .filter((x) => Math.abs(x.at - at) < 300)
        .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
      add(near?.verb ?? 'GET', m[2]);
    }

    // 2. `get('/api/v1/…')`, `post(`, `patchDoc(`… — any identifier ending in the verb.
    for (const m of flat.matchAll(
      /\b[A-Za-z0-9_$]*?(get|post|put|patch|delete|del)\( *(['"`])(\/api\/v1[^'"`]*)/gi,
    ))
      add(m[1], m[3]);

    // 3. `inject('POST', '/api/v1/…')`.
    for (const m of flat.matchAll(
      /inject\( *['"`](GET|POST|PUT|PATCH|DELETE)['"`] *, *(['"`])(\/api\/v1[^'"`]*)/gi,
    ))
      add(m[1], m[3]);
  }
  return found;
}

/**
 * `/api/v1/documents/{id}/versions/{version}` against a recorded
 * `/api/v1/documents/${doc.id}/versions/2`: a path parameter matches either a literal segment or
 * a template interpolation.
 */
const pathMatcher = (openapiPath: string): RegExp =>
  new RegExp(
    `^${openapiPath
      .split('/')
      .map((seg) =>
        /^\{.*\}$/.test(seg)
          ? '(?:\\$\\{[^}]*\\}|[^/]+)'
          : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join('/')}$`,
  );

describe('OpenAPI route coverage', () => {
  const spec = JSON.parse(readFileSync(OPENAPI, 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as Record<string, string>;
  const requested = requestedRoutes();

  const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => ({ key: `${m.toUpperCase()} ${path}`, path, m })),
  );

  const covered = (path: string, verb: string) => {
    const re = pathMatcher(path);
    for (const entry of requested) {
      const [v, p] = [entry.slice(0, entry.indexOf(' ')), entry.slice(entry.indexOf(' ') + 1)];
      if (v === verb.toUpperCase() && re.test(p)) return true;
    }
    return false;
  };

  it('has at least one integration test per OpenAPI path and method', () => {
    const gaps = operations
      .filter((op) => !covered(op.path, op.m))
      .map((op) => op.key)
      .filter((key) => !(key in allowlist));
    expect(
      gaps,
      `these OpenAPI operations are not exercised by any test in apps/api/test/**.\n` +
        `Add a test, or add the operation to apps/api/test/route-coverage-allowlist.json with a reason.\n` +
        gaps.map((g) => `  ${g}`).join('\n'),
    ).toEqual([]);
  });

  it('carries no stale allowlist entries', () => {
    const unknown = Object.keys(allowlist).filter((k) => !operations.some((op) => op.key === k));
    expect(unknown, 'allowlisted operations that no longer exist in the OpenAPI document').toEqual(
      [],
    );
    const nowCovered = Object.keys(allowlist).filter((k) => {
      const op = operations.find((o) => o.key === k);
      return op && covered(op.path, op.m);
    });
    expect(nowCovered, 'allowlisted operations that now have a test — remove them').toEqual([]);
  });

  it('gives every allowlisted operation a non-trivial reason', () => {
    const thin = Object.entries(allowlist)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([k]) => k);
    expect(thin).toEqual([]);
  });

  /** A guard on the scanner itself: if it silently stopped finding requests, everything "passes". */
  it('found a plausible number of requests in the suite', () => {
    expect(requested.size).toBeGreaterThan(100);
  });
});
