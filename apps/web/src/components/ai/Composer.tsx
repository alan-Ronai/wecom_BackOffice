import { useState } from 'react';

/**
 * The chat input. Enter sends, Shift+Enter inserts a newline, Escape cancels a streaming reply —
 * the three keys people already expect, with a real `<button>` behind each of them so the pane is
 * usable without any of them.
 */
export function Composer({
  disabled,
  streaming,
  contextLabel,
  onClearContext,
  onSend,
  onStop,
}: {
  disabled: boolean;
  streaming: boolean;
  contextLabel?: string;
  onClearContext?: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    const t = text.trim();
    if (!t || disabled || streaming) return;
    onSend(t);
    setText('');
  };
  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {contextLabel ? (
        <span className="chip chip-blue chat-context">
          {contextLabel}
          {onClearContext ? (
            <button type="button" className="linklike" aria-label="הסר הקשר" onClick={onClearContext}>
              ✕
            </button>
          ) : null}
        </span>
      ) : null}
      <textarea
        rows={2}
        dir="rtl"
        aria-label="הודעה למערכת"
        placeholder={disabled ? 'אין הרשאה לשוחח' : 'שאל, בקש שינוי, או בקש הצעות לשיפור…'}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && streaming) {
            e.preventDefault();
            onStop();
          } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="chat-composer-actions">
        <span className="small muted">Enter לשליחה · Shift+Enter לשורה חדשה</span>
        {streaming ? (
          <button type="button" className="btn sm" onClick={onStop}>
            עצור
          </button>
        ) : (
          <button type="submit" className="btn sm primary" disabled={disabled || !text.trim()}>
            שלח
          </button>
        )}
      </div>
    </form>
  );
}
