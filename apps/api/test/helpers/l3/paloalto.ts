import http from 'node:http';

export async function startPaloAltoStub(port = 8086) {
  const mapping = new Map<string, string | null>();
  /** The parameters of each call, however they were sent. */
  const calls: string[] = [];
  /** Only the query string of each call — the API key must never appear here. */
  const querySearches: string[] = [];
  /**
   * PAN-OS takes `type`/`key`/`cmd` as either query parameters or POST form fields. The client
   * sends them as a POST body so the API key never reaches the firewall's access log, and this
   * stub reads both so `calls` still records what was sent — including, for the assertions that
   * care, that the query string carried no `key`.
   */
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const param = (k: string) => body.get(k) ?? url.searchParams.get(k);
      querySearches.push(url.search);
      calls.push(body.toString() || url.search.replace(/^\?/, ''));
      const m = /<ip>([^<]+)<\/ip>/.exec(param('cmd') ?? '');
      const user = m ? mapping.get(m[1]) : undefined;
      res.setHeader('content-type', 'application/xml');
      if (param('key') !== 'k') {
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
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    querySearches,
    setMapping: (ip: string, user: string | null) => {
      mapping.set(ip, user);
    },
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
