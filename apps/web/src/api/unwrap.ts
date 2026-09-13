export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Turns an openapi-fetch result into the payload, or throws a typed ApiError. */
export function unwrap<T>(res: FetchResult<T>): T {
  if (res.error !== undefined || !res.response.ok) {
    const e = (res.error ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(res.response.status, e.code ?? 'ERROR', e.message ?? 'שגיאה', e.details);
  }
  return res.data as T;
}

/** Same, but a 204 becomes `null` instead of an error (used by the draft route). */
export function unwrapMaybe<T>(res: FetchResult<T>): T | null {
  if (res.response.status === 204) return null;
  return unwrap(res);
}
