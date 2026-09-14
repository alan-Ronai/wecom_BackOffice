import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { buildApp } from '../src/app.js';

describe('health', () => {
  it('reports db status without a database', async () => {
    const app = await buildApp({
      config: { DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none' },
      boss: false,
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/system/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.db).toBe(false);
    expect(typeof body.version).toBe('string');
    await app.close();
  });
  it('serves openapi json', async () => {
    const app = await buildApp({
      config: { DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none' },
      boss: false,
    });
    const res = await app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(res.json().paths['/api/v1/system/health']).toBeDefined();
    await app.close();
  });
  it('reports model=false and queue=null when nothing is reachable', async () => {
    const app = await buildApp({
      config: { DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none', MODEL_URL: 'http://127.0.0.1:1' },
      boss: false,
    });
    const body = (await app.inject({ method: 'GET', url: '/api/v1/system/health' })).json();
    expect(body.model).toBe(false);
    expect(body.modelStatus).toEqual({
      reachable: false,
      tagPresent: false,
      name: 'qwen2.5:3b-instruct-q4_K_M',
    });
    expect(body.queue).toBeNull();
    await app.close();
  });
  it('reports model availability from app.model when the model is disabled', async () => {
    const app = await buildApp({
      config: {
        DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none',
        MODEL_DISABLED: true,
        NODE_ENV: 'test',
      },
      boss: false,
    });
    const body = (await app.inject({ method: 'GET', url: '/api/v1/system/health' })).json();
    expect(body.model).toBe(true);
    expect(body.modelStatus).toEqual({ reachable: true, tagPresent: true, name: 'rules' });
    expect(body.queue).toBeNull();
    await app.close();
  });

  /**
   * O-2: the regression this route shipped with — Ollama up, `MODEL_NAME` never pulled, and
   * health answering `model: true` so `deploy/smoke.sh` printed "smoke passed".
   */
  it('reports the model unhealthy when Ollama is up but the configured tag is not pulled', async () => {
    const ollama = http.createServer((req, res) => {
      if (req.url === '/api/tags') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ models: [{ name: 'llama3:8b' }] }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => ollama.listen(0, '127.0.0.1', r));
    const port = (ollama.address() as { port: number }).port;
    const app = await buildApp({
      config: {
        DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none',
        MODEL_URL: `http://127.0.0.1:${port}`,
        MODEL_NAME: 'qwen2.5:3b-instruct-q4_K_M',
      },
      boss: false,
    });
    const body = (await app.inject({ method: 'GET', url: '/api/v1/system/health' })).json();
    expect(body.modelStatus).toEqual({
      reachable: true,
      tagPresent: false,
      name: 'qwen2.5:3b-instruct-q4_K_M',
    });
    expect(body.model).toBe(false);
    await app.close();
    await new Promise<void>((r) => ollama.close(() => r()));
  });

  it('reports the model healthy when the configured tag is in the listing', async () => {
    const ollama = http.createServer((req, res) => {
      if (req.url === '/api/tags') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b-instruct-q4_K_M' }] }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => ollama.listen(0, '127.0.0.1', r));
    const port = (ollama.address() as { port: number }).port;
    const app = await buildApp({
      config: {
        DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none',
        MODEL_URL: `http://127.0.0.1:${port}`,
        MODEL_NAME: 'qwen2.5:3b-instruct-q4_K_M',
      },
      boss: false,
    });
    const body = (await app.inject({ method: 'GET', url: '/api/v1/system/health' })).json();
    expect(body.modelStatus).toEqual({
      reachable: true,
      tagPresent: true,
      name: 'qwen2.5:3b-instruct-q4_K_M',
    });
    expect(body.model).toBe(true);
    await app.close();
    await new Promise<void>((r) => ollama.close(() => r()));
  });
});
