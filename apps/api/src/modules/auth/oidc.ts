import * as client from 'openid-client';
import type { Config } from '../../config.js';

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  graphUrl?: string;
};
export type LoginStart = { url: string; state: string; codeVerifier: string; nonce: string };
export type DirectoryGroup = { id: string; displayName: string; description?: string };

/**
 * Escapes a value for an OData string literal: the only metacharacter inside `'…'` is the quote
 * itself, which is escaped by doubling it.
 *
 * Without this, a group name containing an apostrophe (`O'Brien's team` — or a deliberate
 * `x') or startswith(displayName,'`) closes the literal and the rest of the operator's text is
 * parsed as filter syntax against the whole directory. The value is also length-capped by
 * `GroupSearchQuerySchema` before it reaches here.
 */
export const escapeODataString = (v: string): string => v.replace(/'/g, "''");
export type LoginResult = {
  subject: string;
  email: string | null;
  displayName: string;
  groups: string[];
  groupsOverflow: boolean;
};

export class OidcProvider {
  private config!: client.Configuration;
  private graphToken: { value: string; exp: number } | null = null;
  constructor(private cfg: OidcConfig) {}

  static configured(c: Config): boolean {
    return !!(c.OIDC_ISSUER && c.OIDC_CLIENT_ID && c.OIDC_CLIENT_SECRET && c.OIDC_REDIRECT_URI);
  }
  static fromConfig(c: Config): OidcProvider {
    return new OidcProvider({
      issuer: c.OIDC_ISSUER!,
      clientId: c.OIDC_CLIENT_ID!,
      clientSecret: c.OIDC_CLIENT_SECRET!,
      redirectUri: c.OIDC_REDIRECT_URI!,
      ...(c.OIDC_GRAPH_URL ? { graphUrl: c.OIDC_GRAPH_URL.replace(/\/+$/, '') } : {}),
    });
  }

  async init(): Promise<void> {
    const options = this.cfg.issuer.startsWith('http://')
      ? { execute: [client.allowInsecureRequests] }
      : undefined;
    this.config = await client.discovery(
      new URL(this.cfg.issuer),
      this.cfg.clientId,
      this.cfg.clientSecret,
      undefined,
      options,
    );
  }

  async startLogin(): Promise<LoginStart> {
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const url = client.buildAuthorizationUrl(this.config, {
      redirect_uri: this.cfg.redirectUri,
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return { url: url.href, state, codeVerifier, nonce };
  }

  async finishLogin(
    currentUrl: URL,
    expected: { state: string; codeVerifier: string; nonce: string },
  ): Promise<LoginResult> {
    const tokens = await client.authorizationCodeGrant(this.config, currentUrl, {
      pkceCodeVerifier: expected.codeVerifier,
      expectedState: expected.state,
      expectedNonce: expected.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims()!;
    const groups = Array.isArray(claims.groups) ? (claims.groups as string[]) : [];
    const overflow =
      !Array.isArray(claims.groups) &&
      typeof claims._claim_names === 'object' &&
      claims._claim_names != null &&
      'groups' in (claims._claim_names as object);
    const email =
      (claims.email as string | undefined) ?? (claims.preferred_username as string | undefined) ?? null;
    return {
      subject: claims.sub,
      email: email ? email.toLowerCase() : null,
      displayName: (claims.name as string | undefined) ?? email ?? claims.sub,
      groups,
      groupsOverflow: overflow,
    };
  }

  private async graphAccessToken(): Promise<string> {
    if (this.graphToken && this.graphToken.exp > Date.now() + 30_000) return this.graphToken.value;
    const t = await client.clientCredentialsGrant(this.config, {
      scope: 'https://graph.microsoft.com/.default',
    });
    this.graphToken = { value: t.access_token, exp: Date.now() + (t.expiresIn() ?? 300) * 1000 };
    return t.access_token;
  }

  private async graphGet<T>(path: string): Promise<T> {
    const base = this.cfg.graphUrl ?? 'https://graph.microsoft.com/v1.0';
    const res = await fetch(path.startsWith('http') ? path : base + path, {
      headers: { authorization: 'Bearer ' + (await this.graphAccessToken()) },
    });
    if (!res.ok) throw new Error(`graph ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  private async graphPost<T>(path: string, body: unknown): Promise<T> {
    const base = this.cfg.graphUrl ?? 'https://graph.microsoft.com/v1.0';
    const res = await fetch(path.startsWith('http') ? path : base + path, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + (await this.graphAccessToken()),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`graph ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  /**
   * `GET /groups?$filter=startswith(displayName,'…')` — the admin screen's group picker.
   *
   * One page, not the pagination loop `fetchGroupsFromGraph` runs: this answers a box somebody is
   * typing into, and a search that walks a 10 000-group tenant before rendering its first result is
   * not a search. `$top` bounds it; a narrower prefix is how an operator reaches a group past it.
   */
  async searchGroups(q: string, top = 25): Promise<DirectoryGroup[]> {
    const filter = `startswith(displayName,'${escapeODataString(q)}')`;
    const page = await this.graphGet<{ value: DirectoryGroup[] }>(
      `/groups?$filter=${encodeURIComponent(filter)}&$select=id,displayName,description&$top=${top}`,
    );
    return page.value.map((g) => ({
      id: g.id,
      displayName: g.displayName,
      ...(g.description ? { description: g.description } : {}),
    }));
  }

  async fetchGroupsFromGraph(subject: string): Promise<string[]> {
    const ids: string[] = [];
    let next: string | undefined = `/users/${encodeURIComponent(subject)}/memberOf?$select=id&$top=999`;
    while (next) {
      const page: { value: { id: string }[]; '@odata.nextLink'?: string } = await this.graphGet(next);
      ids.push(...page.value.map((v) => v.id));
      next = page['@odata.nextLink'];
    }
    return ids;
  }
  listUserGroups(subject: string): Promise<string[]> {
    return this.fetchGroupsFromGraph(subject);
  }

  /**
   * `GET /users/{id}?$select=accountEnabled` for every subject, but batched through
   * Graph's `$batch` endpoint (max 20 sub-requests per call — see
   * https://learn.microsoft.com/graph/json-batching) instead of one HTTP round trip
   * per user. A missing user (404) counts as disabled, same as before.
   */
  async listDisabledUsers(subjects: string[]): Promise<Set<string>> {
    const disabled = new Set<string>();
    const BATCH_SIZE = 20;
    for (let i = 0; i < subjects.length; i += BATCH_SIZE) {
      const chunk = subjects.slice(i, i + BATCH_SIZE);
      const requests = chunk.map((s, idx) => ({
        id: String(idx),
        method: 'GET',
        url: `/users/${encodeURIComponent(s)}?$select=id,accountEnabled`,
      }));
      try {
        const res = await this.graphPost<{
          responses: { id: string; status: number; body?: { accountEnabled?: boolean } }[];
        }>('/$batch', { requests });
        for (const r of res.responses) {
          const subject = chunk[Number(r.id)];
          if (!subject) continue;
          if (r.status === 404) disabled.add(subject);
          else if (r.status === 200 && r.body?.accountEnabled === false) disabled.add(subject);
        }
      } catch {
        // A failed batch (network blip, throttling) falls back to per-user lookups for
        // just that chunk rather than losing the whole sync run.
        for (const s of chunk) {
          try {
            const u: { accountEnabled?: boolean } = await this.graphGet(
              `/users/${encodeURIComponent(s)}?$select=id,accountEnabled`,
            );
            if (u.accountEnabled === false) disabled.add(s);
          } catch (e) {
            if (String(e).includes('404')) disabled.add(s);
          }
        }
      }
    }
    return disabled;
  }
}
