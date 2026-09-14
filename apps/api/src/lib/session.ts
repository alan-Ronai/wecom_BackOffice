import { createHash, randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';

export const SESSION_COOKIE = 'kb_session';
/** The default when an operator has not set `sessionHours` — see `SessionStore.ttlMs()`. */
export const SESSION_TTL_MS = 8 * 3600 * 1000;
const SLIDE_AFTER_MS = 5 * 60 * 1000;

export const newSessionToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
/**
 * `ttlMs` is the effective session length, which an operator may set through
 * `PUT /admin/identity`. It is a parameter rather than the module constant because the cookie's
 * `maxAge` and the `sessions.expires_at` row have to agree: a browser that keeps a cookie for
 * eight hours against a one-hour row is the same lie in the other direction.
 */
export const cookieOptions = (env: string, ttlMs: number = SESSION_TTL_MS): CookieSerializeOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env !== 'development',
  path: '/',
  maxAge: Math.round(ttlMs / 1000),
});
export const shouldSlide = (lastSeenAt: Date, now: Date): boolean =>
  now.getTime() - lastSeenAt.getTime() > SLIDE_AFTER_MS;
