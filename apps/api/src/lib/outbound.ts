import { assertAllowedHost } from '@wecom/connectors';
import { httpError } from './http.js';

/**
 * Guards for the outbound calls the *admin* surface makes — the OIDC discovery probe and the
 * Palo Alto probe/lookup.
 *
 * The connector paths already route every outbound request through
 * `packages/connectors/src/guards.ts`, on the reasoning that `connectors.manage` is an
 * application permission and not shell access. The identity settings reached the network with
 * no guard at all, from an operator-supplied `issuer` and `host` that `PUT /admin/identity`
 * *persists*, and reported the outcome (URL, HTTP status, error text) back to the caller —
 * a usable internal port scanner from inside the API container. The same reasoning applies, so
 * the same allowlist does.
 *
 * The allowlist is `CONNECTOR_HOST_ALLOWLIST`, deliberately shared: an operator hardening a
 * deployment should name the hosts this installation may talk to once, not once per subsystem.
 * Empty means unrestricted (link-local is still refused) — see `docs/operations.md`.
 */
export const hostAllowlistOf = (csv: string): string[] =>
  csv
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

const bad = (message: string): never => {
  throw httpError(400, 'HOST_NOT_ALLOWED', message);
};

/** `assertAllowedHost`, but raising the API's own 400 envelope instead of the connector error. */
const allowed = (url: string, allowlist: string[]): void => {
  try {
    assertAllowedHost(url, allowlist);
  } catch {
    bad('הכתובת אינה ברשימת המארחים המותרים');
  }
};

/**
 * A full URL an admin probe may fetch: `http`/`https` only (a bare `z.string().url()` accepts
 * anything `new URL()` does, including `file:` and `gopher:`), and inside the allowlist.
 */
export function assertProbeUrl(url: string, allowlist: string[]): void {
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    bad('הכתובת אינה תקינה');
    return;
  }
  if (scheme !== 'http:' && scheme !== 'https:') bad('רק כתובות http/https נתמכות');
  allowed(url, allowlist);
}

/**
 * A Palo Alto `host` setting is a bare authority — `firewall.example` or `10.0.0.1:4443` — and
 * nothing else. It was `z.string().nullable()` with no validation and interpolated straight into
 * `${scheme}://${host}/api/?…`, so a value like `evil.example/x?` took over the path and the
 * query of a request that carries the stored API key. Returns the validated origin.
 */
export function paloAltoOrigin(host: string, scheme: 'https' | 'http', allowlist: string[]): string {
  if (/[/?#@\\\s]/.test(host)) bad('כתובת החומה חייבת להיות שם מארח בלבד, ללא נתיב או פרמטרים');
  const url = `${scheme}://${host}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    bad('כתובת החומה אינה תקינה');
    return '';
  }
  // `new URL('https://a b')` throws, but `new URL('https://user@h')` does not — the `@` guard
  // above covers credentials; this catches anything else the parser normalised away.
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) bad('כתובת החומה חייבת להיות שם מארח בלבד');
  allowed(url, allowlist);
  return parsed.origin;
}
