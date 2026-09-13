import http from 'node:http';

export async function startPaloAltoStub(port = 8086) {
  const mapping = new Map<string, string | null>();
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    calls.push(url.search);
    const m = /<ip>([^<]+)<\/ip>/.exec(url.searchParams.get('cmd') ?? '');
    const user = m ? mapping.get(m[1]) : undefined;
    res.setHeader('content-type', 'application/xml');
    if (url.searchParams.get('key') !== 'k') {
      res.statusCode = 403;
      res.end('<response status="error"><msg>Invalid credentials</msg></response>');
      return;
    }
    if (!user) {
      res.end('<response status="success"><result><entry></entry></result></response>');
      return;
    }
    res.end(
      `<response status="success"><result><entry><ip>${m![1]}</ip><vsys>vsys1</vsys><type>GP</type><user>${user}</user><idle_timeout>3600</idle_timeout></entry></result></response>`,
    );
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    setMapping: (ip: string, user: string | null) => {
      mapping.set(ip, user);
    },
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
