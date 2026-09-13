import { createServer, type Server } from 'node:http';

export interface StubScript {
  chat: (string | { error: number })[];
  tags?: boolean;
  embeddings?: number[];
}

/** Minimal in-process stand-in for an Ollama server (Ollama is not run in CI). */
export async function startOllamaStub(
  script: StubScript,
): Promise<{ url: string; calls: { path: string; body: unknown }[]; close: () => Promise<void> }> {
  const calls: { path: string; body: unknown }[] = [];
  let chatIdx = 0;
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body: unknown = raw ? JSON.parse(raw) : null;
      calls.push({ path: req.url ?? '', body });
      if (req.url === '/api/tags') {
        res.writeHead(script.tags === false ? 500 : 200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b-instruct-q4_K_M' }] }));
      }
      if (req.url === '/api/embeddings') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ embedding: script.embeddings ?? [0.1, 0.2] }));
      }
      if (req.url === '/api/chat') {
        const next = script.chat[Math.min(chatIdx++, script.chat.length - 1)];
        if (typeof next === 'object') {
          res.writeHead(next.error);
          return res.end('error');
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: { role: 'assistant', content: next }, done: true }));
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
