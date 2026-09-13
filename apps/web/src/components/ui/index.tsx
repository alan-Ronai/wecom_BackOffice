import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Thin wrappers over the legacy class system — no new visual language. */
export function Button({
  variant,
  size,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'navy' | 'danger' | 'ghost';
  size?: 'xs' | 'sm';
}) {
  return (
    <button type="button" {...rest} className={['btn', variant, size, className].filter(Boolean).join(' ')} />
  );
}

export const Chip = ({ tone, children }: { tone?: string; children: ReactNode }) => (
  <span className={`chip ${tone ?? ''}`}>{children}</span>
);

export const Kbd = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="empty">
    <b>{title}</b>
    {children}
  </div>
);

/**
 * I15: a failed query must not render as "nothing here". A 403 on `/blocks` for a user without
 * `blocks.edit` was indistinguishable from "no shared blocks exist yet", which is how permission
 * problems turn into "the app is broken" tickets. Used on the pages where the query *is* the
 * content; secondary lookups still degrade quietly.
 */
export const LoadError = ({ what, error }: { what: string; error?: unknown }) => (
  <div className="empty">
    <b>לא ניתן לטעון {what}</b>
    <div className="small muted">
      {error instanceof Error && error.message ? error.message : 'נסו לרענן · אם התקלה חוזרת פנו ל-IT'}
    </div>
  </div>
);

export const Eyebrow = ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => (
  <div className="eyebrow" style={style}>
    {children}
  </div>
);
