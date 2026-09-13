/** Errors that carry the `{ code, message, details? }` envelope fields the app error handler serialises. */
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

export const httpError = (statusCode: number, code: string, message: string, details?: unknown) =>
  new HttpError(statusCode, code, message, details);

export const notFound = (what = 'הפריט') => httpError(404, 'NOT_FOUND', what + ' לא נמצא');
export const forbidden = () => httpError(403, 'FORBIDDEN', 'אין הרשאה לפעולה זו');
export const badRequest = (message: string, details?: unknown) =>
  httpError(400, 'BAD_REQUEST', message, details);
