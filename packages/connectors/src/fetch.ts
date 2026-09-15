import { assertAllowedHost } from './guards.js';

/**
 * How many redirects one connector request may follow.
 *
 * Five is what `curl`'s own default sits near and more than any real WordPress install needs
 * (http→https, and a media URL moved once). The number matters less than the fact that there
 * *is* one: `redirect: 'follow'` will chase a chain until the platform gives up, and every hop
 * is another outbound request made on the API container's behalf.
 */
export const MAX_REDIRECTS = 5;

/** Status codes that carry a `Location` worth following. */
const REDIRECT = new Set([301, 302, 303, 307, 308]);

/**
 * Every outbound request a connector makes, with the host allowlist applied to **each hop**.
 *
 * `assertAllowedHost` used to run once, on the URL the caller passed, and the fetch that
 * followed carried `redirect: 'follow'` — so an allowlisted host could answer `302 Location:
 * http://169.254.169.254/latest/meta-data/iam/security-credentials/` and the platform would
 * chase it for us, hand back the body, and the connector would store it as source content. The
 * allowlist was a check on one string, not on where the request actually went; a redirect is
 * simply a way of asking us to fetch a second URL, and it has to pass the same gate as the
 * first.
 *
 * So: `redirect: 'manual'`, a bounded loop, and `assertAllowedHost` at the top of every
 * iteration. Two further rules the platform's own follower has and we would otherwise lose:
 *
 * - **Credentials do not cross an origin.** A redirect to a different scheme/host/port drops
 *   `authorization` and `cookie`. Without that, H2's same-origin rule would be one `302` away
 *   from being bypassed.
 * - **303, and 301/302 after a POST, become a GET** with no body, as every HTTP client does.
 *
 * The result is a drop-in `fetch`: the connector, the WordPress client and the media HEAD all
 * take this one function, so there is no second outbound path that could forget.
 */
export function guardedFetch(fetchImpl: typeof fetch, allowlist: string[] | undefined): typeof fetch {
  return async (input, init) => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let method = (init?.method ?? 'GET').toUpperCase();
    let body = init?.body;
    const headers = new Headers((init?.headers ?? undefined) as HeadersInit | undefined);

    for (let hop = 0; ; hop++) {
      assertAllowedHost(url, allowlist);
      const res = await fetchImpl(url, { ...init, method, body, headers, redirect: 'manual' });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!REDIRECT.has(res.status) || !location) return res;
      if (hop >= MAX_REDIRECTS)
        throw Object.assign(new Error(`too many redirects (${MAX_REDIRECTS}): ${url}`), {
          statusCode: 400,
          code: 'TOO_MANY_REDIRECTS',
        });

      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw Object.assign(new Error(`redirect to an unusable location: ${location}`), {
          statusCode: 400,
          code: 'HOST_NOT_ALLOWED',
        });
      }
      // A credential is minted for one origin. Anything else is a different party.
      if (next.origin !== new URL(url).origin) {
        headers.delete('authorization');
        headers.delete('cookie');
      }
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        headers.delete('content-type');
        headers.delete('content-disposition');
      }
      url = next.href;
    }
  };
}
