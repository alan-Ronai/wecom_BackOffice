import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { REQUEST_ID_HEADER } from '../src/plugins/logging.js';

const DB = 'postgres://nobody:none@127.0.0.1:1/none';
describe('logging', () => {
  it('echoes an incoming request id and generates one when missing', async () => {
    const app = await buildApp({ config: { DATABASE_URL: DB }, boss: false });
    const r1 = await app.inject({
      method: 'GET',
      url: '/api/v1/system/health',
      headers: { [REQUEST_ID_HEADER]: 'abc-123' },
    });
    expect(r1.headers[REQUEST_ID_HEADER]).toBe('abc-123');
    const r2 = await app.inject({ method: 'GET', url: '/api/v1/system/health' });
    expect(String(r2.headers[REQUEST_ID_HEADER])).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });
});
