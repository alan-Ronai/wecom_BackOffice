import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useConnector,
  useConnectorTypes,
  useSaveConnector,
  useTestConnector,
} from '../../api/hooks/stage5.js';
import { useCan } from '../../api/hooks/me.js';
import {
  SECRET_MASK,
  configFields,
  fieldError,
  formatMap,
  parseMap,
  webhookUrl,
  type ConfigField,
  type ConnectorTestResult,
  type ConnectorTypeInfo,
} from '../../api/stage5.js';
import { useToast } from '../ui/Toast.js';
import { Chip, LoadError } from '../ui/index.js';

/** The four cron expressions an operator actually wants, plus "no schedule". */
const SCHEDULES: [label: string, cron: string | null][] = [
  ['ללא תזמון', null],
  ['כל 15 דק׳', '*/15 * * * *'],
  ['כל 30 דק׳', '*/30 * * * *'],
  ['כל שעה', '0 */1 * * *'],
  ['כל יום ב-06:00', '0 6 * * *'],
];

const STEPS = ['סוג', 'הגדרות', 'בדיקת חיבור', 'תזמון'] as const;

/** A masked secret coming back from the server is a placeholder, not the value. */
const isMask = (v: unknown) => typeof v === 'string' && v.startsWith(SECRET_MASK);

/** How each composite field spells itself as text, and how that text reads back. */
const DRAFT: Record<
  'array' | 'map' | 'json',
  { format: (v: unknown) => string; parse: (text: string) => unknown; hint: string; rows: number }
> = {
  array: {
    format: (v) => (Array.isArray(v) ? v.join(', ') : ''),
    parse: (text) =>
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    hint: 'מופרדים בפסיק',
    rows: 1,
  },
  map: {
    format: formatMap,
    // Unparseable text goes up as itself — see below.
    parse: (text) => parseMap(text) ?? text,
    hint: 'שורה לכל זוג: מפתח = ערך',
    rows: 4,
  },
  json: {
    format: (v) => (v === undefined ? '' : JSON.stringify(v, null, 2)),
    parse: (text) => {
      if (!text.trim()) return undefined;
      try {
        const parsed: unknown = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : text;
      } catch {
        return text;
      }
    },
    hint: 'JSON',
    rows: 6,
  },
};

/**
 * The three fields whose value is not the text the operator types: a comma list (`postTypes`), a
 * free-keyed map (`categoryMap` — `key = value` per line) and an object the wizard does not
 * flatten.
 *
 * The text is **local state**. It has to be: the config holds the parsed value, and re-deriving
 * the text from it on every keystroke reformats what is being typed. `postTypes` showed exactly
 * that — the comma in "posts, pages" was parsed away, the input re-rendered as "posts", and the
 * rest of the words piled onto the first one ("postspages"). What goes *up* is the parsed value
 * while it parses and the raw text while it does not, which is how `fieldError` can say so and
 * how a draft that is not yet an object cannot be posted as one.
 */
function DraftField({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const kind = field.type as 'array' | 'map' | 'json';
  const { format, parse, hint, rows } = DRAFT[kind];
  const show = (v: unknown) => (typeof v === 'string' && kind !== 'array' ? v : format(v));
  const [text, setText] = useState(() => show(value));
  // An edit form loads its config *after* mount, so the seeded text has to catch up — but only
  // when what arrived is not what this control already says, or every keystroke would fight it.
  useEffect(() => {
    if (JSON.stringify(parse(text)) !== JSON.stringify(value)) setText(show(value));
  }, [value]);

  const props = {
    'aria-label': field.title,
    value: text,
    dir: kind === 'json' ? ('ltr' as const) : undefined,
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      onChange(parse(e.target.value));
    },
  };
  return (
    <label>
      {field.title + (field.required ? ' *' : '')}
      {rows > 1 ? <textarea rows={rows} {...props} /> : <input {...props} />}
      <span className="small muted">{field.description ?? hint}</span>
    </label>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = field.title + (field.required ? ' *' : '');

  if (field.type === 'array' || field.type === 'map' || field.type === 'json')
    return <DraftField field={field} value={value} onChange={onChange} />;

  if (field.type === 'boolean')
    return (
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          aria-label={field.title}
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.title}
      </label>
    );

  if (field.type === 'enum')
    return (
      <label>
        {label}
        <select
          aria-label={field.title}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.enum ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );

  if (field.type === 'secret' && isMask(value))
    return (
      <div className="secret-row">
        <span className="small muted">{field.title}</span>
        <Chip tone="chip-green">מוגדר</Chip>
        <button className="btn xs" onClick={() => onChange('')}>
          החלף
        </button>
      </div>
    );

  return (
    <label>
      {label}
      <input
        aria-label={field.title}
        type={field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : 'text'}
        dir={field.type === 'url' || field.type === 'secret' ? 'ltr' : undefined}
        placeholder={field.placeholder}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
      />
      {field.description ? <span className="small muted">{field.description}</span> : null}
    </label>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div className="copy-row">
      <span className="small muted">{label}</span>
      <bdi className="lat" dir="ltr">
        {value}
      </bdi>
      <button
        className="btn xs"
        aria-label={`העתק ${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          toast('הועתק', 'ok');
        }}
      >
        העתק
      </button>
    </div>
  );
}

/**
 * One wizard for both `/admin/connectors/new` and `/admin/connectors/:id`.
 *
 * The form is not hand-written per connector: the fields come from the type's `configSchema`, so a
 * connector the backend adds later renders here without a frontend change. Editing an existing
 * connector skips the type step — the type is not something a saved connector can change.
 */
export function ConnectorWizard() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const toast = useToast();
  const can = useCan();

  const types = useConnectorTypes();
  const existing = useConnector(id);
  const save = useSaveConnector();
  const test = useTestConnector();

  const [step, setStep] = useState(editing ? 1 : 0);
  const [typeId, setTypeId] = useState('');
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [schedule, setSchedule] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectorTestResult | null>(null);
  /**
   * What the server said the config was when this form loaded, so `submit` can send the keys the
   * operator actually changed rather than the whole object. `null` while creating.
   */
  const [loaded, setLoaded] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!existing.data) return;
    setTypeId(existing.data.type);
    setName(existing.data.name);
    // All four connector routes answer the same row shape, with secrets already masked in
    // `config` — see the assertion in `api/stage5.ts` that holds the contract to that.
    setConfig({ ...existing.data.config });
    setLoaded({ ...existing.data.config });
    setSchedule(existing.data.schedule);
  }, [existing.data]);

  const type: ConnectorTypeInfo | undefined = types.data?.find((t) => t.id === typeId);
  const fields = useMemo(() => (type ? configFields(type.configSchema) : []), [type]);

  /**
   * The connector's own rules, applied per field (`fieldError`). This used to be
   * `f.required && !config[f.key]` over a field list that was always empty, so "חסרים שדות חובה"
   * could never fire and the wizard walked cheerfully to a 400 (walkthrough W-1).
   */
  const errors = useMemo(() => {
    const out = new Map<string, string>();
    for (const f of fields) {
      const message = fieldError(f, config[f.key]);
      if (message) out.set(f.key, message);
    }
    return out;
  }, [fields, config]);
  const canSave = !!typeId && !!name.trim() && errors.size === 0;

  if (!can('connectors.manage'))
    return (
      <div className="empty">
        <b>אין הרשאה לנהל מחברים</b>
        נדרשת ההרשאה connectors.manage
      </div>
    );
  if (existing.isError) return <LoadError what="המחבר" error={existing.error} />;
  if (types.isError) return <LoadError what="סוגי המחברים" error={types.error} />;

  /**
   * A saved connector is tested by id, so the server tests what it actually stored — including
   * the secret this browser never received. A new one has no id yet, so its typed config is sent
   * for a dry run instead.
   */
  const runTest = async () => {
    setResult(null);
    try {
      const payload = Object.fromEntries(Object.entries(config).filter(([, v]) => !isMask(v)));
      setResult(await test.mutateAsync(id ? { id } : { type: typeId, config: payload }));
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'הבדיקה נכשלה' });
    }
  };

  /**
   * The config to send, which is deliberately not "the form state".
   *
   * Two things are filtered out. A **masked** value is a placeholder for a secret the server
   * already holds and this browser was never given; sending it back would overwrite the real
   * secret with four bullet characters. An **unchanged** value is one the server already has
   * right, and on an edit there is no reason to restate it — which also means that if the form
   * somehow loads empty, `submit` sends `{}` keys rather than blanking every key the connector
   * has. Creating sends everything, because there is nothing on the server yet to preserve.
   */
  const configPayload = (): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(config).filter(
        ([k, v]) => !isMask(v) && (!loaded || !Object.is(JSON.stringify(loaded[k]), JSON.stringify(v))),
      ),
    );

  const submit = async () => {
    const payload = configPayload();
    try {
      const saved = await save.mutateAsync(
        id
          ? {
              id,
              patch: {
                name: name.trim(),
                // On an edit with nothing changed, the key is omitted rather than sent empty:
                // PATCH takes a whole config object, and `{}` is the spelling that clears one.
                ...(Object.keys(payload).length ? { config: payload } : {}),
                schedule,
              },
            }
          : { create: { type: typeId, name: name.trim(), config: payload, schedule } },
      );
      toast(editing ? 'המחבר נשמר' : 'המחבר נוצר', 'ok');
      nav(`/admin/connectors/${saved.id}`);
      setStep(3);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'השמירה נכשלה', 'warn');
    }
  };

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>{editing ? `הגדרות · ${name}` : 'מחבר חדש'}</h1>
          <p>ההגדרות נשמרות מוצפנות בשרת. סיסמאות ומפתחות לא נשמרים בדפדפן.</p>
        </div>
        <div className="facets">
          <button className="btn sm" onClick={() => nav('/admin/connectors')}>
            חזרה למחברים
          </button>
        </div>
      </div>

      <ol className="wizard-steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <button
              className="linkish"
              // The type step is meaningless once a connector exists.
              disabled={editing && i === 0}
              onClick={() => setStep(i)}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      <section className="settings-card">
        {step === 0 ? (
          <div className="form">
            <div className="eyebrow">שלב 1 · סוג המחבר</div>
            {(types.data ?? []).map((t) => (
              <label key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                  type="radio"
                  name="connector-type"
                  aria-label={t.name}
                  checked={typeId === t.id}
                  onChange={() => {
                    setTypeId(t.id);
                    setName((n) => n || t.name);
                    // Schema defaults, so the next step opens filled in rather than blank.
                    setConfig(
                      Object.fromEntries(
                        configFields(t.configSchema)
                          .filter((f) => f.default !== undefined)
                          .map((f) => [f.key, f.default]),
                      ),
                    );
                  }}
                />
                {t.name}
                <span className="small muted">
                  {(['read', 'write', 'webhooks', 'identity'] as const)
                    .filter((k) => t.capabilities[k])
                    .join(' · ')}
                </span>
              </label>
            ))}
            <button
              className="btn primary"
              style={{ alignSelf: 'flex-start' }}
              disabled={!typeId}
              onClick={() => setStep(1)}
            >
              המשך
            </button>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="form">
            <div className="eyebrow">שלב 2 · הגדרות {type?.name ?? ''}</div>
            <label>
              שם המחבר *
              <input aria-label="שם המחבר" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            {fields.map((f) => (
              <Fragment key={f.key}>
                <Field
                  field={f}
                  value={config[f.key]}
                  onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))}
                />
                {errors.has(f.key) ? (
                  <div className="field-error" role="status">
                    {f.title}: {errors.get(f.key)}
                  </div>
                ) : null}
              </Fragment>
            ))}
            <button
              className="btn primary"
              style={{ alignSelf: 'flex-start' }}
              disabled={!canSave}
              onClick={() => setStep(2)}
            >
              המשך לבדיקה
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="form">
            <div className="eyebrow">שלב 3 · בדיקת חיבור</div>
            <p className="small muted">
              {editing
                ? 'הבדיקה רצה בשרת מול ההגדרות השמורות, כולל הסוד שלא נשלח לדפדפן.'
                : 'הבדיקה רצה מול ההגדרות שהוקלדו, לפני שהמחבר נשמר.'}
            </p>
            <button
              className="btn"
              style={{ alignSelf: 'flex-start' }}
              disabled={test.isPending}
              onClick={() => void runTest()}
            >
              {test.isPending ? 'בודק…' : 'בדוק חיבור'}
            </button>
            {result ? (
              <div className={`field-error ${result.ok ? 'ok' : ''}`} role="status">
                {result.ok ? '✓ ' : '✕ '}
                {result.message}
              </div>
            ) : (
              <div className="small muted">טרם נבדק</div>
            )}
            <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => setStep(3)}>
              המשך לתזמון
            </button>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="form">
            <div className="eyebrow">שלב 4 · תזמון</div>
            <label>
              תדירות
              <select
                aria-label="תדירות"
                value={schedule ?? ''}
                onChange={(e) => setSchedule(e.target.value || null)}
              >
                {SCHEDULES.map(([label, cron]) => (
                  <option key={label} value={cron ?? ''}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {/*
              The write contract declares `schedule` as a non-null string, so "ללא תזמון" is the
              one choice on this screen a save cannot carry. Saying so is better than letting the
              select show a state the server will not be in. See `writeBody` in `api/stage5.ts`.
            */}
            {editing && schedule === null && existing.data?.schedule ? (
              <div className="field-error" role="status">
                הסרת תזמון אינה נתמכת עדיין בשרת — התזמון הקיים (
                <bdi className="lat" dir="ltr">
                  {existing.data.schedule}
                </bdi>
                ) יישמר. ניתן לכבות את המחבר במסך המחברים.
              </div>
            ) : null}

            {type?.capabilities.webhooks && id ? (
              <>
                <div className="eyebrow" style={{ marginTop: 10 }}>
                  Webhook
                </div>
                <p className="small muted">
                  התקינו את התוסף באתר והדביקו את הכתובת והסוד. עדכון באתר יגיע מיד במקום להמתין לריצה הבאה.
                </p>
                <CopyRow label="כתובת" value={webhookUrl(id)} />
                {isMask(config.webhookSecret) ? (
                  <div className="small muted">
                    הסוד שמור בשרת ולא ניתן להצגה — החליפו אותו בשלב ההגדרות כדי לקבל ערך חדש.
                  </div>
                ) : config.webhookSecret ? (
                  <CopyRow label="סוד" value={String(config.webhookSecret)} />
                ) : (
                  <div className="small muted">לא הוגדר סוד webhook.</div>
                )}
              </>
            ) : null}
            {type?.capabilities.webhooks && !id ? (
              <div className="small muted">כתובת ה-webhook נוצרת אחרי השמירה הראשונה.</div>
            ) : null}

            <button
              className="btn primary"
              style={{ alignSelf: 'flex-start' }}
              disabled={!canSave || save.isPending}
              onClick={() => void submit()}
            >
              {editing ? 'שמור' : 'צור מחבר'}
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}
