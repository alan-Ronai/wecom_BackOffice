import { describe, it, expect } from 'vitest';
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
    expect(body.queue).toBeNull();
    await app.close();
  });
});
