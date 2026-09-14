import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { startOidcMock } from '../helpers/l3/oidc.js';
import { integration } from '../helpers/l3/db.js';
import { OidcProvider } from '../../src/modules/auth/oidc.js';

const run = integration ? describe : describe.skip;
run('OidcProvider', () => {
  let mock: Awaited<ReturnType<typeof startOidcMock>>;
  let graph: http.Server;
  let provider: OidcProvider;
  const graphCalls: string[] = [];
  let batchCalls = 0;
  beforeAll(async () => {
    mock = await startOidcMock(8087);
    graph = http.createServer((req, res) => {
      graphCalls.push(req.url ?? '');
      res.setHeader('content-type', 'application/json');
      if (req.url?.endsWith('/$batch') && req.method === 'POST') {
        batchCalls++;
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          const { requests } = JSON.parse(raw) as {
            requests: { id: string; url: string }[];
          };
          const responses = requests.map((r) => {
            const subject = decodeURIComponent(r.url.split('/users/')[1].split('?')[0]);
            if (subject === 'entra-missing') return { id: r.id, status: 404, body: {} };
            return {
              id: r.id,
              status: 200,
              body: { id: subject, accountEnabled: subject !== 'entra-disabled' },
            };
          });
          res.end(JSON.stringify({ responses }));
        });
        return;
      }
      res.end(JSON.stringify({ value: [{ id: 'grp-a' }, { id: 'grp-b' }] }));
    });
    await new Promise<void>((r) => graph.listen(8088, '127.0.0.1', r));
    provider = new OidcProvider({
      issuer: mock.issuer,
      clientId: 'kb',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/api/v1/auth/callback',
      graphUrl: 'http://127.0.0.1:8088/v1.0',
    });
    await provider.init();
  }, 60000);
  afterAll(async () => {
    await mock.stop();
    await new Promise<void>((r) => graph.close(() => r()));
  });

  it('builds a PKCE authorization url', async () => {
    const s = await provider.startLogin();
    const u = new URL(s.url);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toBe('openid profile email');
    expect(u.searchParams.get('state')).toBe(s.state);
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/v1/auth/callback');
  });

  it('completes the code flow and reads claims', async () => {
    mock.setUser({ sub: 'entra-1', email: 'inbar@wecom.co.il', name: 'ענבר ל.', groups: ['grp-editors'] });
    const s = await provider.startLogin();
    const authRes = await fetch(s.url, { redirect: 'manual' });
    const location = new URL(authRes.headers.get('location')!);
    const result = await provider.finishLogin(location, {
      state: s.state,
      codeVerifier: s.codeVerifier,
      nonce: s.nonce,
    });
    expect(result).toMatchObject({
      subject: 'entra-1',
      email: 'inbar@wecom.co.il',
      displayName: 'ענבר ל.',
      groups: ['grp-editors'],
      groupsOverflow: false,
    });
  });

  it('flags overage and fetches groups from Graph', async () => {
    mock.setUser({
      sub: 'entra-2',
      email: 'big@wecom.co.il',
      name: 'ב',
      _claim_names: { groups: 'src1' },
    });
    const s = await provider.startLogin();
    const location = new URL((await fetch(s.url, { redirect: 'manual' })).headers.get('location')!);
    const r = await provider.finishLogin(location, {
      state: s.state,
      codeVerifier: s.codeVerifier,
      nonce: s.nonce,
    });
    expect(r.groupsOverflow).toBe(true);
    expect(await provider.fetchGroupsFromGraph('entra-2')).toEqual(['grp-a', 'grp-b']);
    expect(graphCalls.find((c) => c.includes('/users/entra-2/memberOf'))).toBeTruthy();
  });

  it('checks many subjects through one $batch call instead of one request per user', async () => {
    const subjects = ['entra-ok-1', 'entra-disabled', 'entra-missing', 'entra-ok-2'];
    batchCalls = 0;
    const disabled = await provider.listDisabledUsers(subjects);
    expect(disabled).toEqual(new Set(['entra-disabled', 'entra-missing']));
    expect(batchCalls).toBe(1);
  });

  it('splits into multiple $batch calls past the 20-subject Graph limit', async () => {
    const subjects = Array.from({ length: 25 }, (_, i) => `entra-many-${i}`);
    batchCalls = 0;
    const disabled = await provider.listDisabledUsers(subjects);
    expect(disabled.size).toBe(0);
    expect(batchCalls).toBe(2);
  });
});
