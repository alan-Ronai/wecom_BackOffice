import { HttpError } from './http.js';

/**
 * L3's error helpers. The class itself lives in `lib/http.ts` — there used to be two
 * structurally identical but distinct `HttpError` classes, so any `instanceof` check
 * would have been true for half the codebase and false for the other half.
 */
export { HttpError } from './http.js';

export const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', 'נדרשת כניסה למערכת');
export const forbidden = (perm?: string) =>
  new HttpError(403, 'FORBIDDEN', 'אין לך הרשאה לפעולה זו', perm ? { permission: perm } : undefined);
export const notFound = (what = 'הפריט') => new HttpError(404, 'NOT_FOUND', `${what} לא נמצא`);
