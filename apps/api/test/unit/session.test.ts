import { describe, it, expect } from 'vitest';
import {
  newSessionToken,
  hashToken,
  cookieOptions,
  shouldSlide,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from '../../src/lib/session.js';

describe('session utilities', () => {
  it('generates 32-byte base64url tokens that hash deterministically', () => {
    const t = newSessionToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(newSessionToken()).not.toBe(t);
  });
  it('sets secure cookie options outside development', () => {
    expect(cookieOptions('production')).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
    });
    expect(cookieOptions('development').secure).toBe(false);
    expect(SESSION_COOKIE).toBe('kb_session');
    expect(SESSION_TTL_MS).toBe(8 * 3600 * 1000);
  });
  it('slides only after five minutes', () => {
    const now = new Date('2026-01-01T10:00:00Z');
    expect(shouldSlide(new Date('2026-01-01T09:58:00Z'), now)).toBe(false);
    expect(shouldSlide(new Date('2026-01-01T09:50:00Z'), now)).toBe(true);
  });
});
