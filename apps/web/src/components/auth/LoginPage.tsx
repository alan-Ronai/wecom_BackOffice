import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, API_BASE } from '../../api/client.js';
import { keys } from '../../api/keys.js';
import { unwrap } from '../../api/unwrap.js';
import type { AuthProviders } from '../../api/types.js';

/**
 * `GET /auth/providers` returns bare ids (`'entra' | 'local'`), not `{ id, label }` objects, so the
 * Hebrew labels live here rather than coming down the wire.
 */
const PROVIDER_LABEL: Record<AuthProviders['providers'][number], string> = {
  entra: 'כניסה עם חשבון Microsoft',
  local: 'כניסה מקומית',
};

export function LoginPage() {
  const [sp] = useSearchParams();
  const returnTo = sp.get('returnTo') ?? sp.get('next') ?? '/library';
  const [error, setError] = useState<string | null>(null);
  const providers = useQuery({
    queryKey: keys.providers,
    queryFn: async () => unwrap(await api.GET('/auth/providers')),
  });

  const list = providers.data?.providers ?? [];
  const fallback = providers.data?.fallback;

  return (
    <div className="login">
      <div className="card">
        <div className="logo">wecom.</div>
        <div className="muted">מאגר ידע פנימי · כניסה</div>
        {providers.isPending ? <div className="route-loading">טוען…</div> : null}
        {providers.isError ? <div className="field-error">לא ניתן לטעון את אפשרויות הכניסה</div> : null}

        {list.includes('entra') ? (
          // The SSO route's querystring is `returnTo`, not `next`.
          <a
            className="btn primary"
            href={`${API_BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
          >
            {PROVIDER_LABEL.entra}
          </a>
        ) : null}

        {list.includes('local') ? (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              const f = new FormData(e.currentTarget);
              // The route validates `{ email, password }`.
              const res = await api.POST('/auth/local', {
                body: { email: String(f.get('email')), password: String(f.get('password')) },
              });
              if (res.response.ok) window.location.assign(returnTo);
              else setError('כתובת דוא״ל או סיסמה שגויים');
            }}
          >
            <label>
              דוא״ל
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              סיסמה
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error ? <div className="field-error">{error}</div> : null}
            <button className="btn">{PROVIDER_LABEL.local}</button>
          </form>
        ) : null}

        {!providers.isPending && !list.length ? (
          <div className="field-error">לא הוגדרה שיטת כניסה בשרת</div>
        ) : null}

        {fallback === 'paloalto' ? (
          <div className="small muted">
            זוהה חיבור דרך{' '}
            <bdi className="lat" dir="ltr">
              Palo Alto
            </bdi>{' '}
            · אם הכניסה נכשלת, הזדהו מול השער הארגוני ונסו שוב.
          </div>
        ) : null}

        <div className="small muted">הזדהות דרך חשבון Microsoft של החברה. במקרה של בעיה פנו ל-IT.</div>
      </div>
    </div>
  );
}
