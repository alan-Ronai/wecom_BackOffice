import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BaseConfigSchema, ConfigSchema } from '../src/config.js';

const envExample = readFileSync(
  fileURLToPath(new URL('../../../deploy/.env.example', import.meta.url)),
  'utf8',
);

/** The template as an env object — `KEY=value` lines, comments and blanks dropped. */
const shipped = (): Record<string, string> =>
  Object.fromEntries(
    envExample
      .split('\n')
      .map((l) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2]]),
  );

/** Which fields a parse failed on. */
const failedOn = (env: Record<string, string>): string[] => {
  const r = ConfigSchema.safeParse(env);
  return r.success ? [] : [...new Set(r.error.issues.map((i) => String(i.path[0])))].sort();
};

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

  /**
   * W-2. This case used to be called "ships no working value for the two production-guarded
   * secrets" and asserted two regexes — `^SESSION_SECRET=change-me` and an empty
   * `CONNECTOR_KEY`. A regex over the template cannot see the property the documents actually
   * promise, and the gap was not hypothetical: the template shipped
   * `SESSION_SECRET=change-me-to-32-random-chars-minimum`, which satisfied a `^…=change-me`
   * assertion, satisfied `min(16)`, was not the one literal the guard compared against — and
   * booted a production stack on a secret published in this repository.
   *
   * So assert the outcome instead: the template, exactly as shipped, is **refused** in
   * production, and refused on the fields that are the operator's to fill in.
   */
  it('is refused by the production guard until the operator fills in the secrets', () => {
    const env = shipped();
    expect(env.NODE_ENV).toBe('production');
    // Every unfilled field, and only those: anything else failing would mean the template
    // itself has gone stale (a `TRUST_PROXY` that no longer parses, say).
    expect(failedOn(env)).toEqual(['CONNECTOR_HOST_ALLOWLIST', 'CONNECTOR_KEY', 'SESSION_SECRET']);
  });

  it('parses once — and only once — those three carry real values', () => {
    const filled = {
      ...shipped(),
      SESSION_SECRET: 'c3f0a91d7be24568af0c1d2e3b4a5968c7d8e9f0a1b2c3d4e5f60718293a4b5c',
      CONNECTOR_KEY: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      CONNECTOR_HOST_ALLOWLIST: 'wp.wecom.local',
    };
    expect(failedOn(filled)).toEqual([]);
  });

  /**
   * The class, not the literal. Each of these would have started the walkthrough's stack.
   */
  it.each([
    ['the old template placeholder', 'change-me-to-32-random-chars-minimum'],
    ['the dev default', 'dev-secret-change-me-please'],
    ['a long placeholder', 'this-is-an-example-secret-value-for-the-kb'],
    ['a typed passphrase', 'correct-horse-battery-stapl'],
    ['no charset diversity', 'abababababababababababababababababababab'],
  ])('refuses a SESSION_SECRET that is %s', (_what, secret) => {
    const r = ConfigSchema.safeParse({
      ...shipped(),
      SESSION_SECRET: secret,
      CONNECTOR_KEY: '0123456789abcdef'.repeat(4),
    });
    expect(r.success).toBe(false);
    const issue = r.success ? undefined : r.error.issues.find((i) => String(i.path[0]) === 'SESSION_SECRET');
    expect(issue, `SESSION_SECRET=${secret} was accepted`).toBeDefined();
    // The message says what to do about it, in the spelling the documents use.
    expect(issue!.message).toContain('openssl rand -hex 32');
  });

  it('refuses the all-zero CONNECTOR_KEY, and any single repeated digit, naming the fix', () => {
    const base = {
      ...shipped(),
      SESSION_SECRET: 'c3f0a91d7be24568af0c1d2e3b4a5968c7d8e9f0a1b2c3d4e5f60718293a4b5c',
      CONNECTOR_HOST_ALLOWLIST: '*',
    };
    for (const key of ['0'.repeat(64), 'f'.repeat(64)]) {
      const r = ConfigSchema.safeParse({ ...base, CONNECTOR_KEY: key });
      expect(r.success, `CONNECTOR_KEY=${key.slice(0, 4)}… was accepted`).toBe(false);
      const issue = r.success ? undefined : r.error.issues.find((i) => String(i.path[0]) === 'CONNECTOR_KEY');
      expect(issue!.message).toContain('openssl rand -hex 32');
    }
  });

  it('leaves development alone — the dev defaults are what dev is for', () => {
    const r = ConfigSchema.safeParse({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x/y' });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });
});
