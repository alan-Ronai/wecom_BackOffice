#!/usr/bin/env node
/**
 * Post-processes the `openapi-typescript` output so its path keys line up with the client.
 *
 * The API publishes every route under `/api/v1`, so `docs/api/openapi.json` — and therefore the
 * generated `schema.d.ts` — carries keys like `"/api/v1/documents"`. The browser client sets
 * `baseUrl` to `<origin>/api/v1` (see `src/api/client.ts`), so it calls `api.GET('/documents')`.
 * Rather than repeat the prefix in ~100 call sites, we strip it from the generated keys once, here.
 *
 * This runs as part of `pnpm generate:client`, which `typecheck`, `test` and `build` all depend on,
 * so any drift between `openapi.json` and the client surfaces as a TypeScript error.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/api/schema.d.ts');

const PREFIX = '/api/v1';
/** Top-level path keys only: an indented, quoted key that starts with the prefix. */
const KEY = /^(\s*)"\/api\/v1(\/[^"]*)":/gm;

const before = readFileSync(target, 'utf8');
let stripped = 0;
const after = before.replace(KEY, (_m, indent, rest) => {
  stripped += 1;
  return `${indent}"${rest}":`;
});

if (stripped === 0) {
  console.error(
    `strip-api-prefix: no "${PREFIX}/…" path keys found in ${target}.\n` +
      'Either the API stopped serving under /api/v1 (then drop this script and the baseUrl suffix),\n' +
      'or openapi.json was generated without the prefix. Refusing to write an unverified file.',
  );
  process.exit(1);
}

const leftover = after.split(PREFIX).length - 1;
if (leftover > 0) {
  console.error(
    `strip-api-prefix: ${leftover} occurrence(s) of "${PREFIX}" remain after stripping ` +
      `${stripped} path key(s). They are not top-level path keys, so the generated contract and\n` +
      'the client baseUrl would disagree. Inspect schema.d.ts before proceeding.',
  );
  process.exit(1);
}

writeFileSync(target, after);
console.log(`strip-api-prefix: stripped "${PREFIX}" from ${stripped} path keys in schema.d.ts`);
