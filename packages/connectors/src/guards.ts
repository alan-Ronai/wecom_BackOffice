import { isAbsolute, resolve, sep } from 'node:path';
import ipaddr from 'ipaddr.js';

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
   * Hostnames an outbound connector may talk to.
   *
   * Three settings, and they are not the same:
   *
   * - **Empty** — unrestricted. This is a LAN product and the WordPress instance is normally on
   *   a private address, so nothing but link-local metadata is refused. `ConfigSchema` will not
   *   let a production deployment arrive here (§5); it is the dev/test shape.
   * - **`*`** — any **public** host. Loopback, RFC1918 private space, link-local, IPv6 unique
   *   local and the rest of the non-routable ranges are refused, because "I accept outbound
   *   requests to the internet" is not the same statement as "I accept requests to the model on
   *   127.0.0.1:11434 and to the database port". Something written down as the safe-but-open
   *   setting has to *be* the safe-but-open setting.
   * - **A list** — exactly those hosts, whatever range they are in. An entry starting with `.`
   *   matches that domain and its subdomains. Listing `127.0.0.1` or `wp.lan` is how a LAN
   *   install says yes to its own machines, and it always wins: explicit beats `*`.
   *
   * The public/non-public test reads IP *literals* (and `localhost`). A DNS name that resolves
   * into private space is admitted under `*` — refusing it would need a resolve-then-pin fetch,
   * which is a larger change than this; name the hosts if that matters to your deployment.
   */
  hostAllowlist?: string[];
}

/** Cloud/link-local metadata, never a legitimate connector target. */
const ALWAYS_BLOCKED = /^(169\.254\.|fe80:)/i;

/** `ipaddr.range()` values that are not a public host, and how to say so. */
const NOT_PUBLIC: Record<string, string> = {
  unspecified: 'unspecified address',
  broadcast: 'broadcast address',
  multicast: 'multicast address',
  linkLocal: 'link-local',
  loopback: 'loopback',
  carrierGradeNat: 'carrier-grade NAT',
  private: 'private range',
  uniqueLocal: 'IPv6 unique local',
  reserved: 'reserved range',
};

/** `localhost` and anything under it are loopback wherever this runs. */
const LOOPBACK_NAME = /(^|\.)localhost$/;

/**
 * Why `host` is not a public host, or `null` if it is (or cannot be judged without DNS).
 *
 * `::ffff:127.0.0.1` is unwrapped first: an IPv4-mapped address is the IPv4 address, and
 * treating it as an opaque IPv6 unicast is how a loopback slips past a check like this.
 */
function nonPublicReason(host: string): string | null {
  if (LOOPBACK_NAME.test(host)) return 'loopback';
  if (!ipaddr.isValid(host)) return null; // a DNS name — not resolved here, see the doc above
  let addr = ipaddr.parse(host);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress())
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  return NOT_PUBLIC[addr.range()] ?? null;
}

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
  const entries = allowlist.map((e) => e.trim().toLowerCase()).filter(Boolean);

  // An explicitly named host is allowed whatever range it is in — that is how a LAN install
  // says yes to its own machines — and it is checked first so it wins over `*`.
  const named = entries.some((e) =>
    e === '*' ? false : e.startsWith('.') ? host === e.slice(1) || host.endsWith(e) : host === e,
  );
  if (named) return;

  // `*` is "any public host", and it means that literally: the ranges below are what an
  // operator who wrote it down was not agreeing to reach — the model on 127.0.0.1:11434, the
  // database port, the rest of the LAN. Naming them is how you say yes to them.
  if (entries.includes('*')) {
    const why = nonPublicReason(host);
    if (why) deny(`${why}; CONNECTOR_HOST_ALLOWLIST=* covers public hosts only — list it by name`);
    return;
  }
  deny('not in CONNECTOR_HOST_ALLOWLIST');
}
