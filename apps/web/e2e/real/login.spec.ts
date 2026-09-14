import { test, expect } from '@playwright/test';

/**
 * The SSO round trip, against a real issuer — no msw anywhere in the stack.
 *
 * This is the flow every user takes and the one flow `pnpm e2e:real` did not cover: with no issuer
 * configured the gate ran on the break-glass local account, so the last-resort path was verified
 * and the normal one was not. `E2E_OIDC=1` stands up an `oidc-provider` issuer, points the API at
 * it, and seeds `groups_map` so the id token's `groups` claim maps to the `lead` role.
 *
 * What it proves that no mock can: the Microsoft button's href reaches a real `/auth/login`, the
 * PKCE handshake cookie survives the round trip signed, the authorization code is exchanged
 * server-side, the id token's `groups` claim is read, `applyGroupMap` writes the role, and the
 * session cookie that comes back actually authenticates `/auth/me`.
 */
test.describe('SSO login through a real issuer', () => {
  test.skip(process.env.E2E_OIDC !== '1', 'run with E2E_OIDC=1 pnpm e2e:real');

  test('Microsoft button → issuer → callback → library, with the mapped role', async ({ page }) => {
    await page.goto('/library');
    // Signed out, so RequireAuth bounces to the login screen with a returnTo.
    await expect(page).toHaveURL(/\/login/);

    // With an issuer configured the screen leads with SSO and folds the local form away — the
    // opposite of what the no-issuer run sees, which is itself worth asserting.
    const sso = page.getByRole('link', { name: 'כניסה עם חשבון Microsoft של wecom' });
    await expect(sso).toBeVisible();
    await expect(page.getByLabel('דוא״ל')).toHaveCount(0);

    await sso.click();

    // The issuer's own login form — a different origin, which is the point.
    await expect(page).toHaveURL(
      new RegExp(process.env.E2E_OIDC_ISSUER!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    // `oidc-provider`'s dev interaction form. Its fields are labelled by placeholder, and it
    // accepts any password — the issuer is standing in for an identity provider, not testing one.
    await page.getByPlaceholder('Enter any login').fill(process.env.E2E_OIDC_USER!);
    await page.getByPlaceholder('and password').fill('any-password-this-form-accepts');
    await page.getByRole('button', { name: 'Sign-in' }).click();
    // The consent step appears the first time a client asks for these scopes, and not on a rerun
    // against a warm issuer, so it is taken only if it is there.
    const consent = page.getByRole('button', { name: 'Continue' });
    if (await consent.isVisible().catch(() => false)) await consent.click();

    // Back through the API's callback and onto the deep link it was sent from.
    await expect(page).toHaveURL(/\/library/);
    await expect(page.getByTestId('library-grid')).toBeVisible();

    // `/auth/me` is the contract the whole session rests on: the identity came from the id token,
    // and the role came from `groups_map` — neither is something the SPA could have invented.
    // Read from inside the page, not through `page.request`: the session cookie is `Secure`
    // (NODE_ENV=production here), and only the browser treats a loopback origin as trustworthy
    // enough to send it back. An API request context would get an anonymous 401 and say nothing
    // about the session that was just established.
    const body = await page.evaluate(async () => {
      const r = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (!r.ok) throw new Error(`auth/me answered ${r.status}`);
      return (await r.json()) as {
        user: { displayName: string; source: string };
        roles: string[];
        permissions: string[];
      };
    });
    expect(body.user.source).toBe('entra');
    expect(body.user.displayName).toBe(process.env.E2E_OIDC_NAME);
    expect(body.roles).toContain(process.env.E2E_OIDC_ROLE);
    // The mapped role is what it is *for*: a lead may publish, and an unmapped user could not.
    expect(body.permissions).toContain('docs.publish');
  });
});
