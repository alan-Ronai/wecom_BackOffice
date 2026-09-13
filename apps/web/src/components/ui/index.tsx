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

export const Eyebrow = ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => (
  <div className="eyebrow" style={style}>
    {children}
  </div>
);
