import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMentionable } from '../../api/hooks/collab.js';

/**
 * A textarea with `@` autocomplete over `GET /users/mentionable`.
 *
 * The server resolves mentions by **display name**, not by id (`CommentBodySchema` takes plain
 * text and the route turns `@דנה ר.` into a mention + a notification), so the picker inserts the
 * display name verbatim. That is also why the query only starts after the `@`: a display name
 * contains spaces, so the token is everything from the `@` to the end of the word being typed.
 */
const TOKEN = /@([^@\n]{0,40})$/;

export function MentionInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
  rows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label: string;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);

  const token = useMemo(() => {
    const m = TOKEN.exec(value.slice(0, caret));
    return m ? { q: m[1], start: caret - m[0].length } : null;
  }, [value, caret]);

  const candidates = useMentionable(token?.q ?? '');
  const matches = token ? (candidates.data ?? []).slice(0, 5) : [];

  const insert = (displayName: string) => {
    if (!token) return;
    const next = `${value.slice(0, token.start)}@${displayName} ${value.slice(caret)}`;
    onChange(next);
    const pos = token.start + displayName.length + 2;
    setCaret(pos);
    setActive(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(matches.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insert(matches[Math.min(active, matches.length - 1)].displayName);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCaret(0);
        return;
      }
    }
    // Enter submits, Shift+Enter breaks the line — a comment is usually one sentence.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const sync = () => setCaret(ref.current?.selectionStart ?? value.length);

  return (
    <div className="mention-input">
      <textarea
        ref={ref}
        rows={rows}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onClick={sync}
        onKeyUp={sync}
        onKeyDown={onKeyDown}
      />
      {matches.length ? (
        <ul className="mention-menu" role="listbox" aria-label="אזכור משתמש">
          {matches.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={i === active ? 'on' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(m.displayName);
                }}
              >
                <span className="avatar sm">{m.initials}</span>
                <span>{m.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
