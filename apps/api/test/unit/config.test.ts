import { describe, it, expect } from 'vitest';
import { DEV_CONNECTOR_KEY, DEV_SESSION_SECRET, loadConfig } from '../../src/config.js';

const base = { DATABASE_URL: 'postgres://kb:pw@db:5432/kb' } as const;
const prod = {
  ...base,
  NODE_ENV: 'production' as const,
  SESSION_SECRET: 'a'.repeat(32),
  CONNECTOR_KEY: 'ab'.repeat(32),
};

describe('ConfigSchema', () => {
  it('keeps the dev defaults outside production', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'test' });
    expect(c.SESSION_SECRET).toBe(DEV_SESSION_SECRET);
    expect(c.CONNECTOR_KEY).toBe(DEV_CONNECTOR_KEY);
  });

  it('refuses to start in production with either dev secret', () => {
    // With the all-zero CONNECTOR_KEY the WordPress application password and the
    // webhook secret are decryptable from the ciphertext and the public source.
    expect(() => loadConfig({ ...prod, CONNECTOR_KEY: DEV_CONNECTOR_KEY })).toThrow(/CONNECTOR_KEY/);
    expect(() => loadConfig({ ...prod, CONNECTOR_KEY: DEV_CONNECTOR_KEY.toUpperCase() })).toThrow(
      /CONNECTOR_KEY/,
    );
    // A known SESSION_SECRET lets an attacker forge the signed OIDC handshake cookie.
    expect(() => loadConfig({ ...prod, SESSION_SECRET: DEV_SESSION_SECRET })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig(prod)).not.toThrow();
  });

  it('reads MODEL_DISABLED as a real boolean', () => {
    // `z.coerce.boolean()` made every non-empty string true, so MODEL_DISABLED=false
    // disabled the model and the operator saw a permanently red smoke test.
    expect(loadConfig({ ...base, MODEL_DISABLED: 'false' as never }).MODEL_DISABLED).toBe(false);
    expect(loadConfig({ ...base, MODEL_DISABLED: 'true' as never }).MODEL_DISABLED).toBe(true);
    expect(loadConfig({ ...base, MODEL_DISABLED: '0' as never }).MODEL_DISABLED).toBe(false);
    expect(loadConfig({ ...base, MODEL_DISABLED: '1' as never }).MODEL_DISABLED).toBe(true);
    expect(loadConfig(base).MODEL_DISABLED).toBe(false);
    // Anything ambiguous is a start-up error rather than a silent `true`.
    expect(() => loadConfig({ ...base, MODEL_DISABLED: 'nope' as never })).toThrow();
  });
});
