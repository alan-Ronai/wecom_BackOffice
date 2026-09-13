import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('health', () => {
  it('reports db status without a database', async () => {
    const app = await buildApp({ config: { DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/system/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.db).toBe(false);
    expect(typeof body.version).toBe('string');
    await app.close();
  });
  it('serves openapi json', async () => {
    const app = await buildApp({ config: { DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none' } });
    const res = await app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(res.json().paths['/api/v1/system/health']).toBeDefined();
    await app.close();
  });
});
