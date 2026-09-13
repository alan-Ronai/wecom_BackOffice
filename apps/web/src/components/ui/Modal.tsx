import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ModalOptions {
  title: string;
  body: ReactNode;
  buttons?: { label: string; cls?: string; onClick?: () => boolean | void }[];
  wide?: boolean;
  dark?: boolean;
  sticky?: boolean;
}

interface Entry extends ModalOptions {
  id: number;
}

export interface ModalApi {
  open: (o: ModalOptions) => () => void;
  close: () => void;
  confirm: (title: string, body: ReactNode, okLabel?: string, okCls?: string) => Promise<boolean>;
  prompt: (title: string, label: string, value?: string, multiline?: boolean) => Promise<string | null>;
  count: number;
}

const Ctx = createContext<ModalApi | null>(null);

function PromptBody({
  label,
  value,
  multiline,
  onChange,
  onSubmit,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => onChange(v), [v, onChange]);
  return (
    <div className="form">
      <label>
        {label}
        {multiline ? (
          <textarea aria-label={label} rows={4} value={v} autoFocus onChange={(e) => setV(e.target.value)} />
        ) : (
          <input
            aria-label={label}
            type="text"
            value={v}
            autoFocus
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
        )}
      </label>
    </div>
  );
}

export function ModalProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([]);
  const seq = useRef(0);

  const close = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  const open = useCallback((o: ModalOptions) => {
    const id = ++seq.current;
    setStack((s) => [...s, { ...o, id }]);
    return () => setStack((s) => s.filter((m) => m.id !== id));
  }, []);

  const confirm = useCallback(
    (title: string, body: ReactNode, okLabel = 'אישור', okCls = 'primary') =>
      new Promise<boolean>((resolve) => {
        open({
          title,
          body: <p>{body}</p>,
          buttons: [
            { label: 'ביטול', onClick: () => resolve(false) },
            { label: okLabel, cls: okCls, onClick: () => resolve(true) },
          ],
        });
      }),
    [open],
  );

  const prompt = useCallback(
    (title: string, label: string, value = '', multiline = false) =>
      new Promise<string | null>((resolve) => {
        const box = { current: value };
        let dispose = () => {};
        const submit = () => {
          resolve(box.current);
          dispose();
        };
        dispose = open({
          title,
          body: (
            <PromptBody
              label={label}
              value={value}
              multiline={multiline}
              onChange={(v) => {
                box.current = v;
              }}
              onSubmit={submit}
            />
          ),
          buttons: [
            { label: 'ביטול', onClick: () => resolve(null) },
            { label: 'אישור', cls: 'primary', onClick: () => resolve(box.current) },
          ],
        });
      }),
    [open],
  );

  const value = useMemo<ModalApi>(
    () => ({ open, close, confirm, prompt, count: stack.length }),
    [open, close, confirm, prompt, stack.length],
  );

  useEffect(() => {
    if (!stack.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setStack((s) => {
          const top = s[s.length - 1];
          top?.buttons?.[0]?.onClick?.();
          return s.slice(0, -1);
        });
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [stack.length]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {stack.map((m) => (
        <div
          key={m.id}
          className={`overlay center${m.dark ? ' dark' : ''}`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !m.sticky) {
              m.buttons?.[0]?.onClick?.();
              setStack((s) => s.filter((x) => x.id !== m.id));
            }
          }}
        >
          <div className={`modal${m.wide ? ' wide' : ''}`} role="dialog" aria-label={m.title}>
            <h2>
              {m.title}
              <span
                className="x"
                role="button"
                tabIndex={0}
                title="סגור (Esc)"
                onClick={() => {
                  m.buttons?.[0]?.onClick?.();
                  setStack((s) => s.filter((x) => x.id !== m.id));
                }}
              >
                ✕
              </span>
            </h2>
            <div>{m.body}</div>
            {m.buttons?.length ? (
              <div className="foot">
                {m.buttons.map((b, i) => (
                  <button
                    key={i}
                    className={`btn ${b.cls ?? ''}`}
                    onClick={() => {
                      if (b.onClick?.() === false) return;
                      setStack((s) => s.filter((x) => x.id !== m.id));
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </Ctx.Provider>
  );
}

const NOOP: ModalApi = {
  open: () => () => {},
  close: () => {},
  confirm: () => Promise.resolve(false),
  prompt: () => Promise.resolve(null),
  count: 0,
};

export const useModal = (): ModalApi => useContext(Ctx) ?? NOOP;
