import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BaseConfigSchema } from '../src/config.js';

const envExample = readFileSync(
  fileURLToPath(new URL('../../../deploy/.env.example', import.meta.url)),
  'utf8',
);

/**
 * `deploy/.env.example` is what `INSTALL.md` step 3 tells the operator to copy, and it
 * had drifted from `ConfigSchema` — `CONNECTOR_KEY` was missing entirely, so an operator
 * who set up the WordPress connector got the all-zero encryption key. Keep them in step.
 */
describe('deploy/.env.example', () => {
  it('documents every ConfigSchema key', () => {
    const documented = new Set(
      envExample
        .split('\n')
        .map((l) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(l.trim())?.[1])
        .filter((k): k is string => !!k),
    );
    const missing = Object.keys(BaseConfigSchema.shape).filter((k) => !documented.has(k));
    expect(missing).toEqual([]);
  });

  it('ships no working value for the two production-guarded secrets', () => {
    // Both must be filled in by the operator; a copied template must not start in production.
    expect(/^SESSION_SECRET=change-me/m.test(envExample)).toBe(true);
    expect(/^CONNECTOR_KEY=\s*$/m.test(envExample)).toBe(true);
  });
});
