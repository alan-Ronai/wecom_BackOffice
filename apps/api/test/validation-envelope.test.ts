import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * E-3: a zod/Fastify schema failure answered with the framework's own error — code
 * `FST_ERR_VALIDATION`, message `body/note Required` — while every other envelope this API
 * produces is `{ code, message (in Hebrew), details, requestId }`. The acceptance review hit it on
 * `POST /source-review/clear` with no `note`, and a missing required field is the error an editor
 * is most likely to see.
 *
 * These go through real routes, not a fixture route, and deliberately through the *public* ones
 * (`config.public`) so the assertion needs no session and no database: validation runs before any
 * handler touches `app.db`. Every route in the app reaches the same `setErrorHandler`, so body,
 * querystring and params failures on these three stand for all of them.
 */
describe('validation errors use the Hebrew error envelope', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({
      config: { DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none' },
      boss: false,
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const hebrew = /[֐-׿]/;

  it('answers a missing required field with code VALIDATION and a Hebrew message', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/local', payload: {} });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION');
    expect(body.message).toMatch(hebrew);
    // None of the framework's English leaks into what the editor reads.
    expect(body.message).not.toMatch(/Required|body\/|FST_ERR/);
    expect(JSON.stringify(body)).not.toContain('FST_ERR_VALIDATION');
    // The machine-readable half an integrator needs is still there, and names the fields.
    expect(body.details).toBeDefined();
    expect(JSON.stringify(body.details)).toContain('email');
    expect(JSON.stringify(body.details)).toContain('password');
    expect(typeof body.requestId).toBe('string');
  });

  it('answers a wrong type the same way', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/local',
      payload: { email: 42, password: 'x' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION');
    expect(body.message).toMatch(hebrew);
    expect(body.details).toBeDefined();
  });

  it('covers a params failure, not just bodies', async () => {
    // `params` is an IdSchema (uuid); the route is public, so this is a pure validation answer.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/not-a-uuid/webhook',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION');
    expect(body.message).toMatch(hebrew);
  });

  /**
   * The change must not swallow an application-raised error, which already carried its own code
   * and Hebrew message. No OIDC issuer is configured here, so `/auth/login` raises one.
   */
  it('leaves an application-raised error alone', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/login' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.code).toBe('PROVIDER_UNAVAILABLE');
    expect(body.message).toMatch(hebrew);
  });
});
