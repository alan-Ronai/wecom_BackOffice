import { describe, it, expect } from 'vitest';
import { api } from '../src/api/client.js';

describe('api client', () => {
  it('exposes typed GET for health', async () => {
    // no server: expect a network error, not a type error
    await expect(api.GET('/system/health')).rejects.toBeTruthy();
    expect(typeof api.GET).toBe('function');
  });
});
