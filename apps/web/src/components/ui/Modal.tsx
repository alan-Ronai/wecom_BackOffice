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
import { useHotkeys } from '../../lib/keys.js';
import { useFocusTrap } from './useFocusTrap.js';

export interface ModalOptions {
  title: string;
  /**
   * Rendered under the title, for naming *what* the dialog is acting on.
   *
   * Separate from `title` because `title` is also the `aria-label`, which has to stay a plain
   * string — and because what belongs here is usually a chip or a badge rather than text.
   */
  subtitle?: ReactNode;
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

/**
 * One dialog from the stack, as its own component so it can hold a focus trap.
 *
 * `role="dialog"` was already here; `aria-modal="true"` is what tells a screen reader that the
 * page behind is not available, and `useFocusTrap` is what makes that true for the keyboard.
 */
function Dialog({ entry: m, topmost, onDismiss }: { entry: Entry; topmost: boolean; onDismiss: () => void }) {
  const trap = useFocusTrap<HTMLDivElement>(topmost);
  const dismissWithDefault = () => {
    m.buttons?.[0]?.onClick?.();
    onDismiss();
  };

  return (
    <div
      className={`overlay center${m.dark ? ' dark' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !m.sticky) dismissWithDefault();
      }}
    >
      <div
        ref={trap}
        className={`modal${m.wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={m.title}
      >
        <h2>
          {m.title}
          {/* L3: a real `<button>`, not a `<span role="button">`. The app does carry a delegated
              Enter/Space bridge for its ~100 span-buttons, but a dialog's close control is the one
              that must not depend on it — it is the escape hatch, it lives inside a focus trap, and
              it is the first thing a keyboard user reaches for. */}
          <button
            type="button"
            className="x"
            title="סגור (Esc)"
            aria-label="סגור"
            onClick={dismissWithDefault}
          >
            ✕
          </button>
        </h2>
        {m.subtitle ? <div className="modal-subtitle">{m.subtitle}</div> : null}
        <div>{m.body}</div>
        {m.buttons?.length ? (
          <div className="foot">
            {m.buttons.map((b, i) => (
              <button
                key={i}
                className={`btn ${b.cls ?? ''}`}
                onClick={() => {
                  if (b.onClick?.() === false) return;
                  onDismiss();
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

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

  /**
   * `Escape` closes the topmost dialog — through the shared registry, not a private listener.
   *
   * This used to be a `document`-level capture listener, for a reason that was real at the time:
   * the registry refused every bare key while the caret was in a text field, so a dialog with an
   * input in it could not be closed any other way. That guard now exempts `Escape` (`lib/keys.ts`),
   * which is what lets this be an ordinary `overlay`-scope binding — and being in the registry is
   * what makes the dialog's claim on `Escape` visible to every other screen rather than something
   * they each have to discover by racing it.
   *
   * Declining when the stack is empty lets the keystroke fall through to whatever is underneath.
   */
  useHotkeys('overlay', {
    Escape: () => {
      if (!stack.length) return false;
      setStack((s) => {
        const top = s[s.length - 1];
        top?.buttons?.[0]?.onClick?.();
        return s.slice(0, -1);
      });
    },
  });

  return (
    <Ctx.Provider value={value}>
      {children}
      {stack.map((m, i) => (
        <Dialog
          key={m.id}
          entry={m}
          // Only the dialog on top of the stack traps focus: two traps fighting over `Tab` is
          // worse than none, and a stacked dialog is by definition the one being used.
          topmost={i === stack.length - 1}
          onDismiss={() => setStack((s) => s.filter((x) => x.id !== m.id))}
        />
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
