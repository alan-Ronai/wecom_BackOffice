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

/**
 * Same, but "the resource is absent" becomes `null` instead of throwing.
 *
 * Both spellings are accepted: 204 (no content) and 404 (not found). The draft route is the
 * caller — a document that has never been edited has no draft, and that is a normal state, not
 * an error. Accepting both keeps the editor working whichever spelling the API settles on.
 */
export function unwrapMaybe<T>(res: FetchResult<T>): T | null {
  if (res.response.status === 204 || res.response.status === 404) return null;
  return unwrap(res);
}
