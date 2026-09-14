import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, API_BASE } from '../../api/client.js';
import { keys } from '../../api/keys.js';
import { ApiError, unwrap } from '../../api/unwrap.js';
import type { AuthProviders } from '../../api/types.js';

/**
 * `GET /auth/providers` returns bare ids (`'entra' | 'local'`) plus a `fallback`, not
 * `{ id, label }` objects, so the Hebrew labels live here rather than coming down the wire.
 */
const PROVIDER_LABEL: Record<AuthProviders['providers'][number], string> = {
  entra: 'כניסה עם חשבון Microsoft של wecom',
  local: 'כניסה מקומית (מנהל מערכת בלבד)',
};

const loginError = (e: unknown): string => {
  if (!(e instanceof ApiError)) return 'השרת לא זמין · נסו שוב';
  if (e.status === 401 || e.status === 400) return 'כתובת דוא״ל או סיסמה שגויים';
  if (e.status === 429) return 'יותר מדי ניסיונות · נסו שוב בעוד דקה';
  if (e.status === 403) return 'החשבון מושבת · פנו למנהל המערכת';
  return e.message;
};

export function LoginPage() {
  const [sp] = useSearchParams();
  const returnTo = sp.get('returnTo') ?? sp.get('next') ?? '/library';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** "לא אני" — the operator rejects the gateway's identification and picks a provider instead. */
  const [rejected, setRejected] = useState(false);

  const providers = useQuery({
    queryKey: keys.providers,
    queryFn: async () => unwrap(await api.GET('/auth/providers')),
  });

  const list = providers.data?.providers ?? [];
  const fallback = providers.data?.fallback;

  /**
   * The GlobalProtect path: when the server reports a `paloalto` fallback it can identify this
   * client by its gateway session, so `/auth/me` may already answer 200 on the login route. Its
   * own key, not `keys.me`: `RequireAuth` has usually just cached a 401 there, and reusing that
   * cache would hide the very state this probe exists to find.
   */
  const identified = useQuery({
    queryKey: ['login', 'identify'],
    queryFn: async () => unwrap(await api.GET('/auth/me')),
    enabled: fallback === 'paloalto' && !rejected,
    retry: false,
    gcTime: 0,
  });

  const autoUser = !rejected && fallback === 'paloalto' ? identified.data?.user : undefined;

  const notMe = async () => {
    setRejected(true);
    // Discard the implicit gateway session, or the next probe identifies them all over again.
    await api.POST('/auth/logout').catch(() => undefined);
  };

  // The break-glass form is the last resort, so it stays folded away unless it is the only way in.
  const [localOpen, setLocalOpen] = useState(false);
  const showLocal = list.includes('local') && (localOpen || !list.includes('entra'));

  const submitLocal = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      // The route validates `{ email, password }`.
      unwrap(
        await api.POST('/auth/local', {
          body: { email: String(f.get('email')), password: String(f.get('password')) },
        }),
      );
      window.location.assign(returnTo);
    } catch (err) {
      setError(loginError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="card">
        <div className="logo">wecom.</div>
        <div className="muted">מאגר ידע פנימי · שרת LAN פנימי</div>
        {providers.isPending ? <div className="route-loading">טוען…</div> : null}
        {providers.isError ? <div className="field-error">לא ניתן לטעון את אפשרויות הכניסה</div> : null}

        {autoUser ? (
          <div className="auto-id">
            <span className="avatar">{autoUser.initials}</span>
            <div className="who">
              <b>{autoUser.displayName}</b>
              <div className="small muted">
                זוהית אוטומטית דרך{' '}
                <bdi className="lat" dir="ltr">
                  GlobalProtect
                </bdi>
              </div>
            </div>
            <button className="btn ghost sm" onClick={() => void notMe()}>
              לא אני
            </button>
            <button
              className="btn primary"
              style={{ gridColumn: '1 / -1', justifyContent: 'center' }}
              onClick={() => window.location.assign(returnTo)}
            >
              המשך כ־{autoUser.displayName}
            </button>
          </div>
        ) : null}

        {list.includes('entra') ? (
          // The SSO route's querystring is `returnTo`, not `next`.
          <a className="btn primary" href={`${API_BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
            {PROVIDER_LABEL.entra}
          </a>
        ) : null}
        {list.includes('entra') ? (
          <div className="small muted" style={{ marginTop: -8 }}>
            מתחבר דרך{' '}
            <bdi className="lat" dir="ltr">
              Entra ID
            </bdi>{' '}
            · אותה כניסה של ה-VPN
          </div>
        ) : null}

        {list.includes('local') && list.includes('entra') ? (
          <button className="btn ghost sm" aria-expanded={localOpen} onClick={() => setLocalOpen((v) => !v)}>
            {PROVIDER_LABEL.local}
          </button>
        ) : null}

        {showLocal ? (
          <form className="form" onSubmit={submitLocal}>
            <label>
              דוא״ל
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              סיסמה
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error ? <div className="field-error">{error}</div> : null}
            <button className="btn" disabled={busy}>
              {busy ? 'מתחבר…' : 'כניסה'}
            </button>
          </form>
        ) : null}

        {!providers.isPending && !providers.isError && !list.length ? (
          <div className="field-error">לא הוגדרה שיטת כניסה בשרת</div>
        ) : null}

        {fallback === 'paloalto' && !autoUser ? (
          <div className="small muted">
            זוהה חיבור דרך{' '}
            <bdi className="lat" dir="ltr">
              Palo Alto
            </bdi>{' '}
            · אם הכניסה נכשלת, הזדהו מול השער הארגוני ונסו שוב.
          </div>
        ) : null}

        <div className="small muted">
          הכניסה נרשמת ביומן הביקורת. בעיות בזיהוי? פנו ל-IT ·{' '}
          <bdi className="lat" dir="ltr">
            it@wecom.co.il
          </bdi>
        </div>
      </div>
    </div>
  );
}
