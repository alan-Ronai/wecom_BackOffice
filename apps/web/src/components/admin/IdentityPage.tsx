import { useEffect, useState } from 'react';
import { API_BASE } from '../../api/client.js';
import { useIdentity, useSaveIdentity, useTestIdentity } from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import type { IdentityProvider, IdentitySettings, IdentitySettingsPut } from '../../api/stage5.js';
import { useToast } from '../ui/Toast.js';
import { Chip, LoadError } from '../ui/index.js';
import { WorkflowSettingsSection } from './WorkflowSettingsSection.js';

/** The local edit buffer. Secrets are `null` until typed — see `SecretField`. */
interface Draft {
  oidcEnabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  paEnabled: boolean;
  paHost: string;
  paApiKey: string | null;
  subnets: string;
  sessionHours: number;
}

const toDraft = (s: IdentitySettings): Draft => ({
  oidcEnabled: s.oidc.enabled,
  issuer: s.oidc.issuer ?? '',
  clientId: s.oidc.clientId ?? '',
  clientSecret: null,
  redirectUri: s.oidc.redirectUri ?? '',
  paEnabled: s.paloalto.enabled,
  paHost: s.paloalto.host ?? '',
  paApiKey: null,
  subnets: s.paloalto.subnets.join(', '),
  sessionHours: s.sessionHours,
});

/**
 * A stored secret is never sent back to the browser — the settings carry only `hasSecret`. So the
 * field shows whether one exists and offers to replace it; leaving it alone sends no
 * `clientSecret` key at all, which is what keeps "save the session length" from wiping the
 * client secret as a side effect.
 */
function SecretField({
  label,
  stored,
  value,
  disabled,
  onChange,
}: {
  label: string;
  stored: boolean;
  value: string | null;
  /** Threaded through like every other control here — the server enforces, the UI should agree. */
  disabled?: boolean;
  onChange: (v: string | null) => void;
}) {
  if (value === null)
    return (
      <div className="secret-row">
        <span className="small muted">{label}</span>
        {stored ? <Chip tone="chip-green">מוגדר</Chip> : <Chip tone="chip-amber">לא הוגדר</Chip>}
        <button className="btn xs" disabled={disabled} onClick={() => onChange('')}>
          {stored ? 'החלף' : 'הגדר'}
        </button>
      </div>
    );
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="password"
        autoComplete="new-password"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        className="btn xs ghost"
        style={{ alignSelf: 'flex-start' }}
        disabled={disabled}
        onClick={() => onChange(null)}
      >
        בטל שינוי
      </button>
    </label>
  );
}

export function IdentityPage() {
  const settings = useIdentity();
  const save = useSaveIdentity();
  const test = useTestIdentity();
  const toast = useToast();
  const can = useCan();
  const mayEdit = can('system.admin');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [result, setResult] = useState<{ provider: IdentityProvider; ok: boolean; message: string } | null>(
    null,
  );

  useEffect(() => {
    if (settings.data) setDraft(toDraft(settings.data));
  }, [settings.data]);

  if (settings.isError) return <LoadError what="הגדרות הזהות" error={settings.error} />;
  // `!draft` covers two very different states, and only one of them is "wait". If the query has
  // settled with nothing — an empty 200, a 204 — there is nothing further coming, and spinning
  // forever tells the operator the page is working when it is not.
  if (!draft && settings.isPending) return <div className="route-loading">טוען…</div>;
  if (!draft) return <LoadError what="הגדרות הזהות" error={settings.error} />;

  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const body = (): IdentitySettingsPut => ({
    oidc: {
      enabled: draft.oidcEnabled,
      issuer: draft.issuer || null,
      clientId: draft.clientId || null,
      redirectUri: draft.redirectUri || null,
      // Only when the operator actually typed a new one.
      ...(draft.clientSecret !== null ? { clientSecret: draft.clientSecret || null } : {}),
    },
    paloalto: {
      enabled: draft.paEnabled,
      host: draft.paHost || null,
      subnets: draft.subnets
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      ...(draft.paApiKey !== null ? { apiKey: draft.paApiKey || null } : {}),
    },
    sessionHours: draft.sessionHours,
  });

  const runTest = async (provider: IdentityProvider) => {
    setResult(null);
    try {
      setResult(await test.mutateAsync(provider));
    } catch (e) {
      setResult({ provider, ok: false, message: e instanceof Error ? e.message : 'הבדיקה נכשלה' });
    }
  };

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>זהות וכניסה</h1>
          <p>
            סודות נשמרים מוצפנים בשרת ולא נשלחים חזרה לדפדפן. משתני סביבה משמשים כברירת מחדל כשאין ערך שמור.
          </p>
        </div>
        <div className="facets">
          {/* The only honest end-to-end check: go through the real SSO round trip and come back. */}
          <a
            className="btn sm"
            href={`${API_BASE}/auth/login?returnTo=${encodeURIComponent('/admin/identity')}`}
          >
            כניסת בדיקה
          </a>
          {mayEdit ? (
            <button
              className="btn primary sm"
              // The schema caps the session at 72 hours; a 400 here would discard every other
              // field the operator had just filled in.
              disabled={save.isPending || draft.sessionHours < 1 || draft.sessionHours > 72}
              onClick={async () => {
                try {
                  await save.mutateAsync(body());
                  toast('ההגדרות נשמרו', 'ok');
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'השמירה נכשלה', 'warn');
                }
              }}
            >
              שמור
            </button>
          ) : null}
        </div>
      </div>

      {result ? (
        <div className={`field-error ${result.ok ? 'ok' : ''}`} role="status">
          {result.ok ? '✓ ' : '✕ '}
          {result.message}
        </div>
      ) : null}

      <section className="settings-card">
        <div className="eyebrow">
          <bdi className="lat" dir="ltr">
            OIDC
          </bdi>{' '}
          · Entra ID
        </div>
        <div className="form">
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              aria-label="הפעל OIDC"
              checked={draft.oidcEnabled}
              disabled={!mayEdit}
              onChange={(e) => set({ oidcEnabled: e.target.checked })}
            />
            הפעל כניסה דרך Entra ID
          </label>
          <label>
            Issuer
            <input
              aria-label="Issuer"
              dir="ltr"
              value={draft.issuer}
              disabled={!mayEdit}
              onChange={(e) => set({ issuer: e.target.value })}
            />
          </label>
          <label>
            Client ID
            <input
              aria-label="Client ID"
              dir="ltr"
              value={draft.clientId}
              disabled={!mayEdit}
              onChange={(e) => set({ clientId: e.target.value })}
            />
          </label>
          <SecretField
            label="Client secret"
            stored={settings.data?.oidc.hasSecret ?? false}
            value={draft.clientSecret}
            disabled={!mayEdit}
            onChange={(v) => set({ clientSecret: v })}
          />
          <label>
            Redirect URI
            <input
              aria-label="Redirect URI"
              dir="ltr"
              value={draft.redirectUri}
              disabled={!mayEdit}
              onChange={(e) => set({ redirectUri: e.target.value })}
            />
          </label>
          <div className="small muted">
            תביעת הקבוצות {settings.data?.oidc.groupsClaim ? 'מתקבלת' : 'לא מתקבלת'} מהאסימון — מיפוי הקבוצות
            לתפקידים נמצא במסך "מיפוי קבוצות".
          </div>
          {mayEdit ? (
            <button
              className="btn sm"
              style={{ alignSelf: 'flex-start' }}
              disabled={test.isPending}
              onClick={() => void runTest('oidc')}
            >
              בדוק חיבור
            </button>
          ) : null}
        </div>
      </section>

      <section className="settings-card">
        <div className="eyebrow">
          <bdi className="lat" dir="ltr">
            Palo Alto
          </bdi>{' '}
          · GlobalProtect
        </div>
        <div className="form">
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              aria-label="הפעל זיהוי דרך השער"
              checked={draft.paEnabled}
              disabled={!mayEdit}
              onChange={(e) => set({ paEnabled: e.target.checked })}
            />
            זהה משתמשים לפי מיפוי המשתמשים של השער
          </label>
          <label>
            כתובת השער
            <input
              aria-label="כתובת השער"
              dir="ltr"
              value={draft.paHost}
              disabled={!mayEdit}
              onChange={(e) => set({ paHost: e.target.value })}
            />
          </label>
          <SecretField
            label="מפתח API"
            stored={settings.data?.paloalto.hasApiKey ?? false}
            value={draft.paApiKey}
            disabled={!mayEdit}
            onChange={(v) => set({ paApiKey: v })}
          />
          <label>
            רשתות מורשות
            <input
              aria-label="רשתות מורשות"
              dir="ltr"
              placeholder="10.20.4.0/24, 10.20.9.0/24"
              value={draft.subnets}
              disabled={!mayEdit}
              onChange={(e) => set({ subnets: e.target.value })}
            />
          </label>
          <div className="small muted">מופרדות בפסיק. רק פניות מהן ייחשבו מזוהות על ידי השער.</div>
          {mayEdit ? (
            <button
              className="btn sm"
              style={{ alignSelf: 'flex-start' }}
              disabled={test.isPending}
              onClick={() => void runTest('paloalto')}
            >
              בדוק חיבור
            </button>
          ) : null}
        </div>
      </section>

      <section className="settings-card">
        <div className="eyebrow">מושבים</div>
        <div className="form">
          <label>
            אורך מושב (שעות)
            <input
              aria-label="אורך מושב (שעות)"
              type="number"
              min={1}
              max={72}
              value={draft.sessionHours}
              disabled={!mayEdit}
              onChange={(e) => set({ sessionHours: Number(e.target.value) })}
            />
          </label>
          {draft.sessionHours < 1 || draft.sessionHours > 72 ? (
            <div className="field-error">בין שעה אחת ל-72 שעות</div>
          ) : null}
          <div className="small muted">
            כניסה מקומית (חירום): {settings.data?.local.breakGlassEnabled ? 'מופעלת' : 'מושבתת'} · מוגדרת בשרת
            בלבד.
          </div>
        </div>
      </section>

      {/* wave 5 (V4b): the approver switch and the learning/gap thresholds. It owns its own card
          and its own read of `GET /admin/workflow`, which is `docs.read` — only Save is admin. */}
      <WorkflowSettingsSection />
    </>
  );
}
