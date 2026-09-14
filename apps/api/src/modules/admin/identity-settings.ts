import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { XMLParser } from 'fast-xml-parser';
import { IdentitySettingsPutSchema, IdentitySettingsSchema, IdentityTestResultSchema } from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { assertProbeUrl, hostAllowlistOf, paloAltoOrigin } from '../../lib/outbound.js';
import { SESSION_TTL_MS } from '../../lib/session.js';
import { withTransaction } from '../../lib/sql.js';
import { SettingsStore, type Q } from './settings-store.js';

export const IDENTITY_KEY = 'identity';
/** A settings page must answer even when the IdP is down, so every probe is bounded. */
const PROBE_TIMEOUT_MS = 3000;

type Settings = z.infer<typeof IdentitySettingsSchema>;
type Put = z.infer<typeof IdentitySettingsPutSchema>;

interface StoredValue {
  oidc?: { enabled?: boolean; issuer?: string | null; clientId?: string | null; redirectUri?: string | null };
  paloalto?: { enabled?: boolean; host?: string | null; subnets?: string[] };
  sessionHours?: number;
}
interface StoredSecrets {
  oidcClientSecret?: string;
  paloAltoApiKey?: string;
}

const parser = new XMLParser({ ignoreAttributes: false });

/**
 * Resolves the effective settings: the `app_settings` row wins field by field, and
 * anything it does not set falls back to the environment. That keeps a container-only
 * deployment (everything in `.env`) working unchanged while letting an operator move
 * individual values into the database from the admin UI.
 */
export async function readIdentitySettings(
  app: FastifyInstance,
  store: SettingsStore,
  q: Q,
): Promise<{
  settings: Settings;
  secrets: { oidcClientSecret: string | null; paloAltoApiKey: string | null };
}> {
  const row = await store.read<StoredValue, StoredSecrets>(q, IDENTITY_KEY);
  const v = (row?.value ?? {}) as StoredValue;
  const c = app.config;
  const oidcClientSecret = row?.secrets.oidcClientSecret ?? c.OIDC_CLIENT_SECRET ?? null;
  const paloAltoApiKey = row?.secrets.paloAltoApiKey ?? c.PALOALTO_API_KEY ?? null;
  const issuer = v.oidc?.issuer ?? c.OIDC_ISSUER ?? null;
  const clientId = v.oidc?.clientId ?? c.OIDC_CLIENT_ID ?? null;
  const redirectUri = v.oidc?.redirectUri ?? c.OIDC_REDIRECT_URI ?? null;
  const host = v.paloalto?.host ?? c.PALOALTO_HOST ?? null;
  const subnets =
    v.paloalto?.subnets ??
    c.PALOALTO_SUBNETS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  // Derived, not stored: "is the groups claim actually in use" is answered by whether
  // anyone mapped an IdP group to a role, and break-glass by whether a local account
  // with a password exists at all.
  const [groups, local] = await Promise.all([
    q.query<{ n: string }>('select count(*) as n from groups_map'),
    q.query<{ n: string }>(
      "select count(*) as n from users where source='local' and password_hash is not null and active",
    ),
  ]);

  return {
    settings: {
      oidc: {
        enabled: v.oidc?.enabled ?? !!(issuer && clientId && oidcClientSecret && redirectUri),
        issuer,
        clientId,
        hasSecret: !!oidcClientSecret,
        redirectUri,
        groupsClaim: Number(groups.rows[0].n) > 0,
      },
      paloalto: {
        enabled: v.paloalto?.enabled ?? (c.AUTH_FALLBACK === 'paloalto' && !!host),
        host,
        hasApiKey: !!paloAltoApiKey,
        subnets,
      },
      local: { breakGlassEnabled: Number(local.rows[0].n) > 0 },
      sessionHours: v.sessionHours ?? SESSION_TTL_MS / 3_600_000,
    },
    secrets: { oidcClientSecret, paloAltoApiKey },
  };
}

async function testOidc(
  issuer: string | null,
  allowlist: string[],
): Promise<z.infer<typeof IdentityTestResultSchema>> {
  if (!issuer) return { provider: 'oidc', ok: false, message: 'לא הוגדר issuer' };
  const url = issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration';
  // Before the fetch, not after: the probe reports the URL, the HTTP status and the fetch
  // error text, which is exactly what makes an unguarded one an internal port scanner. The
  // refusal is an `ok: false` result rather than a 400 — the settings page asked "can you
  // reach this?", and "I am not allowed to try" is an answer to that question.
  try {
    assertProbeUrl(url, allowlist);
  } catch (err) {
    return { provider: 'oidc', ok: false, message: (err as Error).message, details: { url } };
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok)
      return { provider: 'oidc', ok: false, message: `גילוי נכשל (HTTP ${res.status})`, details: { url } };
    const doc = (await res.json()) as Record<string, unknown>;
    const ok = typeof doc.authorization_endpoint === 'string' && typeof doc.token_endpoint === 'string';
    return {
      provider: 'oidc',
      ok,
      message: ok ? 'גילוי OIDC הצליח' : 'מסמך הגילוי חסר נקודות קצה',
      details: {
        url,
        issuer: doc.issuer ?? null,
        authorizationEndpoint: doc.authorization_endpoint ?? null,
        tokenEndpoint: doc.token_endpoint ?? null,
      },
    };
  } catch (err) {
    return {
      provider: 'oidc',
      ok: false,
      message: 'לא ניתן להגיע ל-issuer: ' + (err as Error).message,
      details: { url },
    };
  }
}

async function testPaloAlto(
  host: string | null,
  apiKey: string | null,
  scheme: 'https' | 'http',
  allowlist: string[],
): Promise<z.infer<typeof IdentityTestResultSchema>> {
  if (!host) return { provider: 'paloalto', ok: false, message: 'לא הוגדר שרת Palo Alto' };
  if (!apiKey) return { provider: 'paloalto', ok: false, message: 'לא הוגדר מפתח API' };
  // The cheapest authenticated op command: it proves the key is accepted without
  // touching a user mapping that may legitimately be empty.
  const cmd = '<show><system><info></info></system></show>';
  let url: string;
  try {
    url = `${paloAltoOrigin(host, scheme, allowlist)}/api/`;
  } catch (err) {
    return { provider: 'paloalto', ok: false, message: (err as Error).message, details: { host } };
  }
  try {
    // The key goes in the body, never the query string. PAN-OS accepts `key` as a POST
    // parameter, and a key in a URL lands in the target's access log — and, when `host` is
    // whatever an admin last saved, in *somebody's* access log. That is how a write-only
    // credential becomes exfiltratable by anyone who can reach `PUT /admin/identity`.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ type: 'op', key: apiKey, cmd }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const text = await res.text();
    const doc = parser.parse(text) as { response?: { '@_status'?: string; msg?: unknown } };
    const status = doc.response?.['@_status'];
    const ok = res.ok && status === 'success';
    return {
      provider: 'paloalto',
      ok,
      message: ok ? 'החיבור ל-Palo Alto הצליח' : 'החיבור נדחה על ידי החומה',
      // Never the key itself, and never the raw body — it can echo the query string.
      details: { host, httpStatus: res.status, status: status ?? null },
    };
  } catch (err) {
    return {
      provider: 'paloalto',
      ok: false,
      message: 'לא ניתן להגיע לחומה: ' + (err as Error).message,
      details: { host },
    };
  }
}

export default async function identitySettingsRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const store = new SettingsStore(app.db, app.config.CONNECTOR_KEY);
  const allowlist = hostAllowlistOf(app.config.CONNECTOR_HOST_ALLOWLIST);

  app.get(
    '/identity',
    {
      config: { requires: ['system.admin'] },
      schema: { tags: ['admin'], response: { 200: IdentitySettingsSchema } },
    },
    // Secrets are write-only: the response says whether one is set, never what it is.
    async () => (await readIdentitySettings(app, store, app.db)).settings,
  );

  app.put(
    '/identity',
    {
      config: { requires: ['system.admin'] },
      schema: {
        tags: ['admin'],
        body: IdentitySettingsPutSchema,
        response: { 200: IdentitySettingsSchema },
      },
    },
    async (req) => {
      const body: Put = req.body;
      // Validate what is about to be *persisted*, not only what is about to be probed:
      // `POST /admin/identity/test` reads these back, and so does the sign-in path.
      if (body.oidc?.issuer) assertProbeUrl(body.oidc.issuer, allowlist);
      if (body.paloalto?.host) paloAltoOrigin(body.paloalto.host, app.config.PALOALTO_SCHEME, allowlist);
      return withTransaction(app.db, async (tx) => {
        const current = await store.read<StoredValue, StoredSecrets>(tx, IDENTITY_KEY);
        const before = (await readIdentitySettings(app, store, tx)).settings;
        const v = (current?.value ?? {}) as StoredValue;
        const value: StoredValue = {
          oidc: {
            ...v.oidc,
            ...(body.oidc?.enabled !== undefined ? { enabled: body.oidc.enabled } : {}),
            ...(body.oidc?.issuer !== undefined ? { issuer: body.oidc.issuer } : {}),
            ...(body.oidc?.clientId !== undefined ? { clientId: body.oidc.clientId } : {}),
            ...(body.oidc?.redirectUri !== undefined ? { redirectUri: body.oidc.redirectUri } : {}),
          },
          paloalto: {
            ...v.paloalto,
            ...(body.paloalto?.enabled !== undefined ? { enabled: body.paloalto.enabled } : {}),
            ...(body.paloalto?.host !== undefined ? { host: body.paloalto.host } : {}),
            ...(body.paloalto?.subnets !== undefined ? { subnets: body.paloalto.subnets } : {}),
          },
          sessionHours: body.sessionHours ?? v.sessionHours,
        };
        // `undefined` keeps the stored secret (the UI sends nothing for "unchanged");
        // an explicit `null` clears it back to the environment fallback.
        const secrets: Partial<StoredSecrets> = {};
        if (body.oidc?.clientSecret !== undefined)
          secrets.oidcClientSecret = body.oidc.clientSecret ?? undefined;
        if (body.paloalto?.apiKey !== undefined) secrets.paloAltoApiKey = body.paloalto.apiKey ?? undefined;
        await store.write<StoredValue, StoredSecrets>(tx, IDENTITY_KEY, value, secrets, req.user?.id ?? null);
        const after = (await readIdentitySettings(app, store, tx)).settings;
        await audit(tx, {
          actorId: req.user?.id ?? null,
          action: 'admin.identity.update',
          entityType: 'app_settings',
          entityId: IDENTITY_KEY,
          // `before`/`after` are the masked views, so the audit trail never stores a secret.
          before,
          after,
          requestId: req.id,
          ip: req.ip,
        });
        // The auth layer caches the effective TTL for a minute; a deliberate change should
        // take effect on the next sign-in, not on the next cache expiry.
        app.sessions.invalidateTtl();
        return after;
      });
    },
  );

  app.post(
    '/identity/test',
    {
      config: { requires: ['system.admin'] },
      schema: {
        tags: ['admin'],
        body: z.object({ provider: z.enum(['oidc', 'paloalto']) }),
        response: { 200: IdentityTestResultSchema },
      },
    },
    async (req) => {
      const { settings, secrets } = await readIdentitySettings(app, store, app.db);
      const result =
        req.body.provider === 'oidc'
          ? await testOidc(settings.oidc.issuer, allowlist)
          : await testPaloAlto(
              settings.paloalto.host,
              secrets.paloAltoApiKey,
              app.config.PALOALTO_SCHEME,
              allowlist,
            );
      await app.audit(req, 'admin.identity.test', 'app_settings', IDENTITY_KEY, null, {
        provider: result.provider,
        ok: result.ok,
      });
      return result;
    },
  );
}
