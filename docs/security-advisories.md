# Dependency advisories — standing decisions

The gate is `pnpm audit --prod` (production dependency tree only; dev-tool advisories are not in
scope for what ships on the VM). Every advisory it reports must either be fixed or appear below
with a reason and a review date. An advisory that is neither is a release blocker.

Re-run after any dependency change:

```bash
pnpm audit --prod
```

Last full review: **2026-09-15**, against the acceptance review's §5 dependency row (1 high,
3 moderate on `main` at `983148e`).

## Fixed

| Advisory | Package | Was | Now | Notes |
|---|---|---|---|---|
| [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) — open redirect via a backslash in `<Link>`/`useNavigate` (CVE-2025-68470 bypass) | `react-router` (via `react-router-dom`) | `^6.26.2` | `^7.18.3` | **The only reachable finding in the set.** The app routes user-supplied values into navigation (`returnTo` on login, `?world=`/`?topic=` on the library), which is exactly the shape the advisory covers. The v6 → v7 upgrade is a major bump, but the app uses only the hook/component API that v7 keeps (`BrowserRouter`, `useRoutes`, `Navigate`, `Link`, `NavLink`, `Outlet`, `useNavigate`, `useLocation`, `useParams`, `useSearchParams`, `RouteObject`) and none of the removed data-router helpers (`json()`, `defer()`), so no source change was needed. Verified: `pnpm --filter @wecom/web typecheck`, 565 unit tests, 38 msw e2e specs and the production build all green. |
| [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) — arbitrary constructor injection via `deserializeErrors()` | `react-router` | `^6.26.2` | `^7.18.3` | SSR-hydration only and this app has no SSR, so it was never reachable; fixed for free by the upgrade above. |
| [GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2) — command injection in the `glob` **CLI** (`-c`/`--cmd` runs matches with `shell: true`) | `glob`, transitively `node-pg-migrate` → `glob` | `>=11.0.0 <11.1.0` | `^11.1.0` | Not reachable — nothing in this repo invokes the `glob` CLI; `node-pg-migrate` uses the library API to list `apps/api/migrations`. Fixed anyway, with a root `pnpm.overrides` entry narrowed to the vulnerable range so it lapses on its own when `node-pg-migrate` widens its dependency. Verified: `migrate.test.ts` and `migrations.test.ts` green against a real Postgres. |

## Accepted, with reasons

| Advisory | Package | Severity | Decision |
|---|---|---|---|
| [GHSA-gh4j-gqv2-49f6](https://github.com/advisories/GHSA-gh4j-gqv2-49f6) — **XMLBuilder** emits unescaped comment/CDATA delimiters, so attacker-controlled values can inject XML structure | `fast-xml-parser` `^4.5.7` (`apps/api`), fixed in `>=5.7.0` | moderate | **Accepted — not reachable.** The vulnerable class is `XMLBuilder`, and this codebase never constructs XML. All three call sites import `XMLParser` only: `modules/auth/paloalto.ts` and `modules/admin/identity-settings.ts` parse the Palo Alto User-ID XML API's responses, and `modules/sources/docx.ts` parses the OOXML inside an uploaded `.docx`. `grep -rn "XMLBuilder" apps packages` returns nothing, and an import of it would have to be written deliberately. The fix is a major version (v4 → v5) that changes parser option semantics, which would need the docx and Palo Alto parsers re-verified — not a change to make inside the pilot window for an unreachable finding. **Revisit** when `apps/api` next touches XML handling, or if an `XMLBuilder` import ever appears. |

## Not in scope

`pnpm audit` without `--prod` also reports advisories in the development toolchain (eslint's
`@humanwhocodes/*`, `rimraf`/`inflight` under test tooling, and so on). Those are tracked by
upgrading the toolchain in the normal course, not by this document.

Worth knowing while reading that: `deploy/Dockerfile.api` copies the whole built workspace into
the runtime image rather than a `--prod` install, because the entrypoint needs the pnpm workspace
context to run migrations. So the dev packages are *present on disk* in the image even though
nothing in the running API ever loads them. That is a reason to keep the toolchain current, and a
candidate cleanup (a `pnpm deploy` runtime stage, or pruning after the build) — it is not a reason
to gate the pilot, since reaching any of that code would already require arbitrary execution
inside the container.
