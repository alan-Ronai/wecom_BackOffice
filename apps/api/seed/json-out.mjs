/**
 * The one way the seed converters write `apps/api/seed/*.json`: expanded `JSON.stringify`, then
 * the repo's own Prettier config (which keeps the expanded objects expanded). `pnpm lint` runs
 * `prettier --check .` over these files, so writing them any other way either fails lint or makes
 * a re-run of a converter show a whole-file diff — and the point of committing the output is that
 * `convert:legacy` + `convert:kira` regenerate it byte-identically.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const here = new URL('./', import.meta.url);

export const seedPath = (name) => fileURLToPath(new URL('./' + name, here));

export const readSeedJson = (name) => JSON.parse(readFileSync(seedPath(name), 'utf8'));

export async function writeSeedJson(name, data) {
  const file = seedPath(name);
  const options = (await prettier.resolveConfig(file)) ?? {};
  const text = await prettier.format(JSON.stringify(data, null, 1), { ...options, filepath: file });
  writeFileSync(file, text);
  console.log(`${name}: ${Array.isArray(data) ? data.length : 1}`);
}
