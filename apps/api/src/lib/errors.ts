export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
export const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', 'נדרשת כניסה למערכת');
export const forbidden = (perm?: string) =>
  new HttpError(403, 'FORBIDDEN', 'אין לך הרשאה לפעולה זו', perm ? { permission: perm } : undefined);
export const notFound = (what = 'הפריט') => new HttpError(404, 'NOT_FOUND', `${what} לא נמצא`);
