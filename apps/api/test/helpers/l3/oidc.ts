import { OAuth2Server } from 'oauth2-mock-server';

export async function startOidcMock(port = 8085) {
  const server = new OAuth2Server();
  await server.issuer.keys.generate('RS256');
  let claims: Record<string, unknown> = {
    sub: 'entra-sub-1',
    email: 'inbar@wecom.co.il',
    name: 'ענבר ל.',
    groups: ['grp-editors'],
  };
  server.service.on('beforeTokenSigning', (token) => {
    Object.assign(token.payload, claims);
  });
  server.service.on('beforeUserinfo', (userInfoResponse) => {
    Object.assign(userInfoResponse.body, claims);
  });
  await server.start(port, 'localhost');
  return {
    issuer: `http://localhost:${port}`,
    setUser: (c: Record<string, unknown>) => {
      claims = c;
    },
    stop: () => server.stop(),
  };
}
