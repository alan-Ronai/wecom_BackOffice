import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { keys } from '../../api/keys.js';
import { unwrap } from '../../api/unwrap.js';
import type { AuthProviders } from '../../api/types.js';

export function LoginPage() {
  const [sp] = useSearchParams();
  const next = sp.get('next') ?? '/library';
  const [error, setError] = useState<string | null>(null);
  const providers = useQuery({
    queryKey: keys.providers,
    queryFn: async (): Promise<AuthProviders> => unwrap(await api.GET('/auth/providers')),
  });

  return (
    <div className="login">
      <div className="card">
        <div className="logo">wecom.</div>
        <div className="muted">מאגר ידע פנימי · כניסה</div>
        {providers.isPending ? <div className="route-loading">טוען…</div> : null}
        {providers.data?.providers.map((p) =>
          p.id === 'local' ? (
            <form
              key={p.id}
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const res = await api.POST('/auth/local', {
                  body: { username: String(f.get('u')), password: String(f.get('p')) },
                });
                if (res.response.ok) window.location.assign(next);
                else setError('שם משתמש או סיסמה שגויים');
              }}
            >
              <label>
                שם משתמש
                <input name="u" autoComplete="username" />
              </label>
              <label>
                סיסמה
                <input name="p" type="password" autoComplete="current-password" />
              </label>
              {error ? <div className="field-error">{error}</div> : null}
              <button className="btn">כניסה מקומית</button>
            </form>
          ) : (
            <a
              key={p.id}
              className="btn primary"
              href={`/api/v1/auth/login?next=${encodeURIComponent(next)}`}
            >
              {p.label}
            </a>
          ),
        )}
        <div className="small muted">הזדהות דרך חשבון Microsoft של החברה. במקרה של בעיה פנו ל-IT.</div>
      </div>
    </div>
  );
}
