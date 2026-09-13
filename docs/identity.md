# Identity & RBAC — operations guide

How people sign in to the wecom Knowledge Platform, how permissions are decided, and what to do when
Entra ID is unavailable. Config keys below are spelled exactly as in `apps/api/src/config.ts`
(`ConfigSchema`); see `apps/api/.env.example`.

## 1. Entra ID (Microsoft) app registration

1. Create an app registration in the company tenant (single tenant).
2. Redirect URI (Web): `https://<host>/api/v1/auth/callback` — the same string goes in `OIDC_REDIRECT_URI`.
3. Set `OIDC_ISSUER` to `https://login.microsoftonline.com/<tenant-id>/v2.0`, `OIDC_CLIENT_ID` to the
   application (client) id and `OIDC_CLIENT_SECRET` to a client secret.
4. Token configuration → add the **groups** claim, source "Security groups", emitted in the **ID token**.
   Large group memberships overflow the claim; the API detects the `_claim_names.groups` marker and falls
   back to Microsoft Graph automatically.
5. API permissions (application, then grant admin consent): `User.Read.All` and `GroupMember.Read.All`.
   Graph is used for the overage fallback and for the nightly sync.
6. Restart the API. `GET /api/v1/auth/providers` must list `entra`. If discovery fails at boot the API logs
   `OIDC discovery failed; Entra login disabled until restart` and `/auth/login` answers
   `503 PROVIDER_UNAVAILABLE` until the next restart.

The login flow is authorization code + PKCE (S256), scopes `openid profile email`. The handshake state
(`state`, PKCE verifier, nonce, `returnTo`) lives in a signed, httpOnly cookie `kb_oidc` for 10 minutes.
`returnTo` is only honoured for relative paths; anything else falls back to `/`.

## 2. Mapping Entra groups to roles

Roles are not chosen per user in Entra — they come from `groups_map`, maintained through the admin API:

```
GET  /api/v1/admin/groups-map                    # roles.manage
PUT  /api/v1/admin/groups-map                    # roles.manage, replaces the whole table
     { "entries": [ { "idpGroupId": "<group object id>", "idpGroupName": "KB-Editors", "roleId": "<role id>" } ] }
```

On every login (and nightly) the user's group ids are compared to that table: mapped roles the user should
have are added, mapped roles they no longer qualify for are removed. Roles granted by hand in
`/admin/users/:id` that are **not** present in `groups_map` are never touched by the sync.

## 3. Palo Alto User-ID fallback (LAN)

For agents on the company LAN who never reach the Microsoft login page, the firewall's User-ID mapping can
identify them:

- `AUTH_FALLBACK=paloalto`, `PALOALTO_HOST=<host[:port]>`, `PALOALTO_API_KEY=<XML API key>`,
  `PALOALTO_SUBNETS=10.1.0.0/16,192.168.5.0/24`, `PALOALTO_SCHEME=https` (http is for tests only).
- The lookup runs only when the request IP falls inside `PALOALTO_SUBNETS`, only when no session cookie is
  present, and never overrides an existing session. Failures (timeout, bad key, unknown IP) are silent: the
  request simply stays unauthenticated, and negative answers are cached 60 s per IP.
- A matched `DOMAIN\user` is upserted as a `source='paloalto'` user with no email and no roles. When the same
  person later signs in through Entra with a matching email, the row is upgraded in place (subject and source
  become the Entra identity) so history and roles survive.

## 4. Break-glass local account

Local accounts exist for the case where Entra and the firewall are both unavailable.

```
pnpm --filter @wecom/api create-admin --email root@wecom.co.il --password '<at least 12 chars>' --name 'Admin'
```

The CLI upserts a `source='local'` user (subject = email), stores an argon2id hash, grants the `admin` role and
writes an `admin.create_admin` audit row. Re-running it rotates the password. Sign in at the web app's local
login form (`/login/local`), which posts to:

```
POST /api/v1/auth/local   { "email": "...", "password": "..." }   # 5 requests / minute / IP
```

Wrong credentials answer `401 INVALID_CREDENTIALS`. All other `/api/v1/auth/*` routes allow 20 requests per
minute per IP.

## 5. Sessions

- Cookie `kb_session`, httpOnly, `SameSite=Lax`, `Secure` outside `NODE_ENV=development`, path `/`.
- The database stores only `sha256(token)` in `sessions.token_hash`; the token itself never leaves the cookie.
- Lifetime 8 hours, sliding: a request more than 5 minutes after the last touch extends the expiry and
  refreshes the cookie.
- `POST /api/v1/auth/logout` revokes the current session (audit `auth.logout`).
- Admins can list and revoke sessions: `GET /api/v1/admin/sessions?userId=…` and
  `DELETE /api/v1/admin/sessions/:id` (both `users.manage`). Deactivating a user revokes every session they
  have; re-activating does not bring them back — the user signs in again.

## 6. Permissions and category scopes

Permission strings are the 19 entries of `PERMISSIONS` in `@wecom/shared`; the four system roles (`agent`,
`editor`, `lead`, `admin`) are seeded by migration `0002_identity`. A user's effective permission set is the
union over their roles, resolved once per session and cached 60 seconds.

Routes declare what they need; the auth plugin enforces it before the handler runs:

```ts
app.post('/documents/:id/publish', { config: { requires: ['docs.publish'], scope: 'document' } }, handler);
```

- no session → `401 UNAUTHENTICATED` (a route may opt out with `config: { public: true }`);
- missing permission → `403 FORBIDDEN` with `details.permission`;
- `scope: 'document'` reads `:id`, looks up the document's category and answers `404 NOT_FOUND` when it does
  not exist (or is in the trash) and `403 SCOPE_DENIED` when the category is outside the user's scopes.

Category scopes live on `user_roles.category_scope`: `null` means unrestricted, an array limits the user to
those categories. Scopes from several roles merge as a union, and a single unrestricted role removes the
restriction entirely. `GET /api/v1/auth/me` returns `roles`, `permissions`, `categoryScopes` and preferences.

The `admin` role can never lose `ADMIN_LOCKED` (`roles.manage`, `users.manage`) — such a `PATCH
/admin/roles/:id` answers `409 LOCKED_PERMISSION`; system roles cannot be renamed or deleted
(`409 SYSTEM_ROLE`). Every admin mutation writes an `audit_log` row in the same transaction and returns its
`auditId`; `GET /api/v1/admin/audit` (`audit.read`) queries the log.

## 7. Nightly identity sync

Queue `identity.sync` (`QUEUES.identitySync`) runs at 03:00 Asia/Jerusalem via pg-boss when OIDC is
configured. For every active `source='entra'` user it refreshes roles from `groups_map` through Graph and
deactivates users whose Entra account is disabled or gone (revoking their sessions). One `identity.sync`
audit row records `{ checked, deactivated, roleChanges }`.
