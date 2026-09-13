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

  async listDisabledUsers(subjects: string[]): Promise<Set<string>> {
    const disabled = new Set<string>();
    for (const s of subjects) {
      try {
        const u: { accountEnabled?: boolean } = await this.graphGet(
          `/users/${encodeURIComponent(s)}?$select=id,accountEnabled`,
        );
        if (u.accountEnabled === false) disabled.add(s);
      } catch (e) {
        if (String(e).includes('404')) disabled.add(s);
      }
    }
    return disabled;
  }
}
