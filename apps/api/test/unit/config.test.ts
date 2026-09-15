import { describe, it, expect } from 'vitest';
import { DEV_CONNECTOR_KEY, DEV_SESSION_SECRET, loadConfig } from '../../src/config.js';

const base = { DATABASE_URL: 'postgres://kb:pw@db:5432/kb' } as const;
const prod = {
  ...base,
  NODE_ENV: 'production' as const,
  // A real `openssl rand -hex 32` value: the production guard now rejects the class of weak
  // ones (placeholders, short, one repeated character), so a test fixture has to be a real one.
  SESSION_SECRET: 'c3f0a91d7be24568af0c1d2e3b4a5968c7d8e9f0a1b2c3d4e5f60718293a4b5c',
  CONNECTOR_KEY: '0123456789abcdef'.repeat(4),
  CONNECTOR_HOST_ALLOWLIST: 'wp.wecom.local',
  TRUST_PROXY: '172.16.0.0/12',
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

  /**
   * W-2. The guard compared against exactly one literal, so the *other* placeholder — the one
   * `deploy/.env.example` actually shipped — passed it, and the walkthrough's production stack
   * started and signed session cookies with a string published in this repository. What has to be
   * refused is the class, and each arm below is a property of the value rather than a known
   * string: too short, placeholder language, one character repeated.
   */
  it('refuses the whole class of weak session secrets, not one literal', () => {
    const refused = [
      'change-me-to-32-random-chars-minimum', // what the template shipped
      'CHANGE_ME_PLEASE_THIS_IS_A_LONG_ONE',
      'my-example-session-secret-value-here',
      'short-but-not-a-placeholder-x', // 29 characters
      'abababababababababababababababababab',
    ];
    for (const secret of refused)
      expect(() => loadConfig({ ...prod, SESSION_SECRET: secret }), secret).toThrow(
        /SESSION_SECRET.*openssl rand -hex 32/s,
      );
    // A generated value is accepted, whatever it happens to contain.
    expect(() =>
      loadConfig({
        ...prod,
        SESSION_SECRET: '7b1d4e0af35c92687d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e',
      }),
    ).not.toThrow();
  });

  it('refuses a CONNECTOR_KEY that is one hex digit repeated', () => {
    for (const key of ['0'.repeat(64), 'f'.repeat(64), 'C'.repeat(64)])
      expect(() => loadConfig({ ...prod, CONNECTOR_KEY: key }), key.slice(0, 3)).toThrow(
        /CONNECTOR_KEY.*openssl rand -hex 32/s,
      );
  });

  /**
   * §5 / item 18. An empty CONNECTOR_HOST_ALLOWLIST means "any public host", and an unset
   * TRUST_PROXY meant "trust every X-Forwarded-For" in production. Both are decisions a
   * deployment has to write down, like SESSION_SECRET — not defaults to arrive at by omission.
   */
  it('refuses to run the e2e configuration as a deployment', () => {
    // deploy/e2e.env carries WECOM_E2E_STACK=1; only scripts/e2e-compose.mjs sets the runner key.
    expect(() => loadConfig({ ...prod, WECOM_E2E_STACK: '1' })).toThrow(/WECOM_E2E_STACK/);
    expect(() => loadConfig({ ...prod, WECOM_E2E_STACK: '1', WECOM_E2E_RUNNER: '1' })).not.toThrow();
    expect(() => loadConfig({ ...base, NODE_ENV: 'test', WECOM_E2E_STACK: '1' })).not.toThrow();
  });

  it('requires CONNECTOR_HOST_ALLOWLIST and TRUST_PROXY in production', () => {
    expect(() => loadConfig({ ...prod, CONNECTOR_HOST_ALLOWLIST: '' })).toThrow(/CONNECTOR_HOST_ALLOWLIST/);
    expect(() => loadConfig({ ...prod, CONNECTOR_HOST_ALLOWLIST: '   ' })).toThrow(
      /CONNECTOR_HOST_ALLOWLIST/,
    );
    expect(() => loadConfig({ ...prod, TRUST_PROXY: '' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ ...prod, TRUST_PROXY: undefined })).toThrow(/TRUST_PROXY/);
    // `*` is the explicit way to say "any public host" — allowed, but written down.
    expect(() => loadConfig({ ...prod, CONNECTOR_HOST_ALLOWLIST: '*' })).not.toThrow();
    // Neither is required outside production, where the dev defaults stand.
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'test', CONNECTOR_HOST_ALLOWLIST: '', TRUST_PROXY: '' }),
    ).not.toThrow();
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
