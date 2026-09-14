/**
 * A real OIDC issuer for the no-mocks gate, behind `E2E_OIDC=1`.
 *
 * ## Why a real issuer
 *
 * `pnpm e2e:real` exists because msw *is* the contract it is asked to verify. Login was the one
 * flow still exempt from that: with no issuer configured the gate ran `AUTH_FALLBACK=none` and the
 * break-glass local account was the only way in — which tested the last-resort path and left the
 * path every user actually takes untested against a real server. A test issuer closes that: the
 * Microsoft button, the redirect, the PKCE handshake, the signed handshake cookie, the callback,
 * the `groups` claim, `groups_map`, and the session cookie are all exercised end to end.
 *
 * ## What this is not
 *
 * It is not a stand-in for Entra. It speaks OIDC discovery, authorization-code + PKCE and an id
 * token with a `groups` claim, which is the surface `OidcProvider` uses; it has no Graph, so the
 * group-claim overflow path and the nightly sync's `accountEnabled` batch stay on their own
 * integration tests against a Graph stub.
 *
 * `oidc-provider` refuses a plain-http issuer in production mode, which is the correct default and
 * the reason this only ever runs from a test runner whose `NODE_ENV` is not `production`.
 *
 * ## Why it is its own process
 *
 * `scripts/e2e-real.mjs` drives every step with `spawnSync`, which blocks its event loop for the
 * whole of each step — including the several minutes Playwright runs for. An issuer listening in
 * that process would accept the discovery probe and then go deaf the instant the browser needed
 * it, which reads as a plain connection failure in the middle of a redirect and is thoroughly
 * confusing. So this file is also a CLI: `node scripts/e2e-oidc-issuer.mjs --port <n>
 * --redirect-uri <url>`, started like the API and the web server are.
 */

import { pathToFileURL } from 'node:url';

/** The single account the login spec signs in as, and the group that maps to `lead`. */
export const E2E_OIDC_USER = {
  id: 'e2e-lead',
  name: 'בודק E2E',
  email: 'e2e-lead@wecom.test',
  /** Matched against `groups_map.idp_group_id`, which the gate seeds to the `lead` role. */
  group: 'KB-Leads',
};

export const E2E_OIDC_CLIENT = { id: 'kb-e2e', secret: 'e2e-oidc-secret-not-a-real-one' };

/**
 * Starts the issuer on `port` and resolves once it is listening.
 *
 * `redirectUri` is the API's callback *as the browser reaches it* — through the web origin, not
 * the API's own port — because that is the URL the authorization response is sent to and the one
 * the client registration has to match exactly.
 */
export async function startIssuer({ port, redirectUri }) {
  const { default: Provider } = await import('oidc-provider');
  const issuer = `http://127.0.0.1:${port}`;

  const provider = new Provider(issuer, {
    clients: [
      {
        client_id: E2E_OIDC_CLIENT.id,
        client_secret: E2E_OIDC_CLIENT.secret,
        redirect_uris: [redirectUri],
        // The gate drives authorization-code with PKCE, and asks for a client-credentials token
        // nowhere — the Graph calls are not part of this flow.
        grant_types: ['authorization_code'],
        response_types: ['code'],
      },
    ],
    /**
     * Shaped to match what the API actually asks for and what Entra actually answers.
     *
     * `OidcProvider.startLogin` requests `openid profile email` and reads every claim off the **id
     * token**, because that is where Entra puts them: `groups` rides on the app registration's own
     * configuration rather than on a scope the client has to name, and there is no `groups` scope
     * in Entra to ask for. So `groups` hangs off `profile` here, and `conformIdTokenClaims` is
     * turned off — with it on (the spec-conformant default) `oidc-provider` ships an id token
     * carrying only `sub` and leaves the rest at the userinfo endpoint, which this client never
     * calls. Without both of these the login succeeds and the user lands with no name and no
     * roles, which is exactly the failure this spec exists to catch.
     */
    claims: {
      openid: ['sub'],
      profile: ['name', 'groups'],
      email: ['email'],
    },
    scopes: ['openid', 'profile', 'email'],
    conformIdTokenClaims: false,
    findAccount: async (_ctx, id) => ({
      accountId: id,
      claims: () => ({
        sub: id,
        name: E2E_OIDC_USER.name,
        email: E2E_OIDC_USER.email,
        groups: [E2E_OIDC_USER.group],
      }),
    }),
    // The built-in login form the spec fills in. Never enable this anywhere but a test issuer.
    features: { devInteractions: { enabled: true } },
    // Deterministic, so a restart does not invalidate a cookie mid-run.
    cookies: { keys: ['e2e-oidc-cookie-key'] },
  });

  const server = await new Promise((resolve, reject) => {
    const s = provider.listen(port, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  return {
    issuer,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/* ── CLI: `node scripts/e2e-oidc-issuer.mjs --port 9401 --redirect-uri <url>` ── */

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argOf = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const port = Number(argOf('port') ?? 9401);
  const redirectUri = argOf('redirect-uri');
  if (!redirectUri) {
    console.error('e2e-oidc-issuer: --redirect-uri is required');
    process.exit(2);
  }
  const started = await startIssuer({ port, redirectUri });
  console.log(`listening on ${started.issuer}`);
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () => {
      void started.close().then(() => process.exit(0));
    });
}
