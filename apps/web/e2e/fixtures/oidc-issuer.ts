/**
 * Starts a local OIDC issuer on :9400 for the login spec. It only runs when `E2E_OIDC=1`
 * (and the API is configured with `OIDC_ISSUER=http://localhost:9400`); otherwise the login
 * spec skips itself and the rest of the suite runs against the msw-backed build.
 */
export default async function globalSetup(): Promise<(() => Promise<void>) | void> {
  if (process.env.E2E_OIDC !== '1') return;

  // Resolved through a variable so `tsc` does not require the package to be installed for the
  // default (mock-backed) run; it is a devDependency for the `E2E_OIDC=1` path.
  const moduleName = 'oidc-provider';
  const mod = (await import(/* @vite-ignore */ moduleName)) as unknown as {
    default: new (issuer: string, config: unknown) => { listen(port: number): { close(): void } };
  };
  const Provider = mod.default;
  const redirect = (process.env.E2E_BASE_URL ?? 'http://localhost:8080') + '/api/v1/auth/callback';

  const issuer = new Provider('http://localhost:9400', {
    clients: [
      {
        client_id: 'kb-e2e',
        client_secret: 'e2e-secret',
        redirect_uris: [redirect],
      },
    ],
    claims: { openid: ['sub'], profile: ['name'], email: ['email'], groups: ['groups'] },
    scopes: ['openid', 'profile', 'email', 'groups'],
    findAccount: (_ctx: unknown, id: string) => ({
      accountId: id,
      claims: () => ({ sub: id, name: 'בודק E2E', email: 'e2e@wecom.test', groups: ['KB-Leads'] }),
    }),
    features: { devInteractions: { enabled: true } },
  });

  const server = issuer.listen(9400);
  return async () => {
    server.close();
  };
}
