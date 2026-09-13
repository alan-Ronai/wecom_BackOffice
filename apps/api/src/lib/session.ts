import { createHash, randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';

export const SESSION_COOKIE = 'kb_session';
export const SESSION_TTL_MS = 8 * 3600 * 1000;
const SLIDE_AFTER_MS = 5 * 60 * 1000;

export const newSessionToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const cookieOptions = (env: string): CookieSerializeOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env !== 'development',
  path: '/',
  maxAge: SESSION_TTL_MS / 1000,
});
export const shouldSlide = (lastSeenAt: Date, now: Date): boolean =>
  now.getTime() - lastSeenAt.getTime() > SLIDE_AFTER_MS;
