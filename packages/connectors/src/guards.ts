import { isAbsolute, resolve, sep } from 'node:path';

/**
 * Deployment-supplied limits on what a connector config may reach. `connectors.manage`
 * is an application permission, not shell access, and the blast radius of an
 * unconstrained connector includes the secrets that protect everything else
 * (`deploy/.env`, `/proc/self/environ`, cloud metadata). The registry is built with
 * these from `ConfigSchema`; a connector constructed without them is unrestricted,
 * which is what the unit tests use.
 */
export interface ConnectorGuards {
  /** A file-backed connector may only read inside this absolute directory. */
  fileRoot?: string;
  /**
   * Hostnames an outbound connector may talk to. Empty means "unrestricted" —
   * this is a LAN product and the WordPress instance is normally on a private
   * address, so private ranges are deliberately NOT blocked by default; the
   * allowlist is the control. An entry starting with `.` matches any subdomain, and the single
   * entry `*` means "any public host" — the explicit spelling of what an empty list does, which
   * `ConfigSchema` requires a production deployment to write down rather than fall into (§5).
   */
  hostAllowlist?: string[];
}

/** Cloud/link-local metadata, never a legitimate connector target. */
const ALWAYS_BLOCKED = /^(169\.254\.|fe80:)/i;

/**
 * Resolves `path` inside `root`, refusing anything that escapes it — including an
 * absolute path elsewhere on the filesystem, which is exactly how a
 * `connectors.manage` holder could have read `deploy/.env` or `/proc/self/environ`
 * back out through a source revision. A relative path is taken relative to the root.
 */
export function resolveWithin(root: string | undefined, path: string): string {
  if (!root) return path;
  const base = resolve(root);
  const full = isAbsolute(path) ? resolve(path) : resolve(base, path);
  if (full !== base && !full.startsWith(base + sep))
    throw Object.assign(new Error(`path is outside ${base}: ${path}`), {
      statusCode: 400,
      code: 'PATH_NOT_ALLOWED',
    });
  return full;
}

/** Throws when `url`'s host is link-local or outside a configured allowlist. */
export function assertAllowedHost(url: string, allowlist: string[] | undefined): void {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    throw Object.assign(new Error(`not a URL: ${url}`), { statusCode: 400, code: 'HOST_NOT_ALLOWED' });
  }
  const deny = (why: string): never => {
    throw Object.assign(new Error(`host not allowed (${why}): ${host}`), {
      statusCode: 400,
      code: 'HOST_NOT_ALLOWED',
    });
  };
  if (ALWAYS_BLOCKED.test(host)) deny('link-local');
  if (!allowlist?.length) return;
  // `*` is the deliberate "any public host" setting; link-local is still refused above.
  if (allowlist.some((e) => e.trim() === '*')) return;
  const ok = allowlist.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    return e.startsWith('.') ? host === e.slice(1) || host.endsWith(e) : host === e;
  });
  if (!ok) deny('not in CONNECTOR_HOST_ALLOWLIST');
}
