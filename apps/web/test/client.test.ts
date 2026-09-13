import { describe, it, expect } from 'vitest';
import { api, API_BASE } from '../src/api/client.js';
import { unwrap, ApiError } from '../src/api/unwrap.js';
import { server } from './msw/server.js';
import { asDenied } from './msw/handlers.js';

describe('api client', () => {
  it('calls the same-origin /api/v1 base', async () => {
    expect(API_BASE.endsWith('/api/v1')).toBe(true);
    const res = await api.GET('/system/health');
    expect(unwrap(res).ok).toBe(true);
  });

  it('turns an error envelope into a typed ApiError', async () => {
    server.use(asDenied('get', '/documents'));
    const res = await api.GET('/documents', { params: { query: {} } });
    expect(() => unwrap(res)).toThrowError(ApiError);
    try {
      unwrap(res);
    } catch (e) {
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).code).toBe('FORBIDDEN');
      expect((e as ApiError).message).toBe('אין הרשאה');
    }
  });
});
