import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { probeModel } from '../src/services/probes.js';

let server: http.Server;
let url = '';
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b-instruct-q4_K_M' }] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

describe('probeModel', () => {
  it('reports up and hasModel from /api/tags', async () => {
    const r = await probeModel(url, 'qwen2.5:3b-instruct-q4_K_M');
    expect(r.up).toBe(true);
    expect(r.hasModel).toBe(true);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
  it('reports missing model', async () => {
    expect((await probeModel(url, 'llama3:8b')).hasModel).toBe(false);
  });
  it('reports down on connection error', async () => {
    const r = await probeModel('http://127.0.0.1:1', 'x', 300);
    expect(r.up).toBe(false);
    expect(r.hasModel).toBe(false);
  });
});
