import { useNavigate } from 'react-router-dom';
import {
  useConnectorTypes,
  useConnectors,
  useDeleteConnector,
  useRunConnector,
  useTestConnector,
  useToggleConnector,
} from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import type { ConnectorRow, ConnectorTypeInfo, SyncRunResult } from '../../api/stage5.js';
import { ago } from '../../lib/format.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { Chip, LoadError } from '../ui/index.js';

const STATUS: Record<ConnectorRow['lastStatus'], { label: string; tone: string }> = {
  ok: { label: 'תקין', tone: 'chip-green' },
  error: { label: 'שגיאה', tone: 'chip-red' },
  never: { label: 'טרם רץ', tone: 'chip-gray' },
};

const CAPABILITY_LABEL: [keyof ConnectorTypeInfo['capabilities'], string, string][] = [
  ['read', '📥', 'קריאה'],
  ['write', '📤', 'כתיבה'],
  ['webhooks', '🔔', 'webhook'],
  ['identity', '🪪', 'זהות'],
];

/** The one config value worth showing in a table row: where this connector points. */
const endpoint = (c: ConnectorRow): string =>
  String(c.config.baseUrl ?? c.config.path ?? c.config.host ?? c.config.url ?? '—');

/** "כל 30 דק׳" beats a raw cron expression in a row an operator skims once a week. */
export function describeCron(expr: string | null): string {
  if (!expr) return 'ללא תזמון';
  const m = /^\*\/(\d+) \* \* \* \*$/.exec(expr);
  if (m) return `כל ${m[1]} דק׳`;
  const h = /^0 \*\/(\d+) \* \* \*$/.exec(expr);
  if (h) return `כל ${h[1]} שעות`;
  const daily = /^(\d+) (\d+) \* \* \*$/.exec(expr);
  if (daily) return `כל יום ב-${daily[2].padStart(2, '0')}:${daily[1].padStart(2, '0')}`;
  return expr;
}

const runSummary = (r: SyncRunResult): string =>
  r.errors.length
    ? `הריצה הסתיימה עם ${r.errors.length} שגיאות · ${r.errors[0]}`
    : `נקלטו ${r.imported} · נדחפו ${r.pushed} · ${r.conflicts} קונפליקטים`;

export function ConnectorsPage() {
  const connectors = useConnectors();
  const types = useConnectorTypes();
  const run = useRunConnector();
  const test = useTestConnector();
  const toggle = useToggleConnector();
  const remove = useDeleteConnector();
  const modal = useModal();
  const toast = useToast();
  const nav = useNavigate();
  const can = useCan();

  const capsOf = (type: string) => types.data?.find((t) => t.id === type)?.capabilities;
  const items = connectors.data ?? [];

  // `GET /connectors` itself requires `connectors.manage`, so there is no read-only view to fall
  // back to: say so rather than render a table that can only ever answer 403.
  if (!can('connectors.manage'))
    return (
      <div className="empty">
        <b>אין הרשאה לנהל מחברים</b>
        נדרשת ההרשאה connectors.manage
      </div>
    );
  if (connectors.isError) return <LoadError what="המחברים" error={connectors.error} />;

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>
            מחברים<span>{items.length} מחברים</span>
          </h1>
          <p>כל מחבר מצהיר על יכולותיו — המסך מציג רק פעולות שהיכולת תומכת בהן.</p>
        </div>
        <div className="facets">
          <button className="btn primary sm" onClick={() => nav('/admin/connectors/new')}>
            ✚ מחבר
          </button>
        </div>
      </div>

      {!items.length && !connectors.isPending ? (
        <div className="empty">
          <b>אין מחברים</b>
          מחבר מושך תוכן ממקור חיצוני ודוחף אליו בחזרה
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>מחבר</th>
              <th>מצב</th>
              <th>תזמון</th>
              <th>יכולות</th>
              <th>קישורים</th>
              <th>פעיל</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const caps = capsOf(c.type);
              const status = STATUS[c.lastStatus];
              return (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b>
                    <div className="small muted">
                      <bdi className="lat" dir="ltr">
                        {endpoint(c)}
                      </bdi>
                    </div>
                  </td>
                  <td>
                    <Chip tone={status.tone}>{status.label}</Chip>
                    <div className="small muted">
                      {c.lastRunAt ? `ריצה אחרונה ${ago(c.lastRunAt)}` : 'מעולם לא רץ'}
                    </div>
                  </td>
                  <td>{describeCron(c.schedule)}</td>
                  <td>
                    {caps ? (
                      <span
                        title={CAPABILITY_LABEL.filter(([k]) => caps[k])
                          .map(([, , l]) => l)
                          .join(' · ')}
                      >
                        {CAPABILITY_LABEL.filter(([k]) => caps[k])
                          .map(([, icon]) => icon)
                          .join(' ')}
                      </span>
                    ) : (
                      <span className="small muted">—</span>
                    )}
                  </td>
                  <td>
                    {c.links}
                    {c.conflicts ? (
                      <>
                        {' · '}
                        <button className="linkish" onClick={() => nav('/sync?state=conflict')}>
                          {c.conflicts} קונפליקטים
                        </button>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`פעיל: ${c.name}`}
                      checked={c.enabled}
                      onChange={async (e) => {
                        const enabled = e.target.checked;
                        await toggle.mutateAsync({ id: c.id, enabled });
                        toast(enabled ? 'המחבר הופעל' : 'המחבר הושבת', 'ok');
                      }}
                    />
                  </td>
                  <td className="row-actions">
                    <button
                      className="btn xs"
                      disabled={!c.enabled || run.isPending}
                      title={c.enabled ? undefined : 'מחבר מושבת לא רץ'}
                      onClick={async () => {
                        try {
                          toast(runSummary(await run.mutateAsync(c.id)), 'ok');
                        } catch (err) {
                          toast(err instanceof Error ? err.message : 'הריצה נכשלה', 'warn');
                        }
                      }}
                    >
                      הרץ עכשיו
                    </button>
                    <button
                      className="btn xs"
                      disabled={test.isPending}
                      onClick={async () => {
                        try {
                          const r = await test.mutateAsync({ id: c.id });
                          toast(r.message, r.ok ? 'ok' : 'warn');
                        } catch (err) {
                          toast(err instanceof Error ? err.message : 'הבדיקה נכשלה', 'warn');
                        }
                      }}
                    >
                      בדוק חיבור
                    </button>
                    <button className="btn xs" onClick={() => nav(`/admin/connectors/${c.id}`)}>
                      הגדרות
                    </button>
                    <button
                      className="btn xs danger"
                      aria-label={`מחק ${c.name}`}
                      onClick={async () => {
                        const ok = await modal.confirm(
                          'מחיקת מחבר',
                          // The links are the part that does not come back.
                          `${c.links} קישורי סנכרון יימחקו איתו. המסמכים עצמם יישארו.`,
                          'מחק',
                          'danger',
                        );
                        if (!ok) return;
                        await remove.mutateAsync(c.id);
                        toast('המחבר נמחק', 'ok');
                      }}
                    >
                      מחק
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
