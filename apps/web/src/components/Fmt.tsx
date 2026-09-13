import { useMemo, type ElementType } from 'react';
import { fmt, type DocRef, type FieldInfo } from '@wecom/shared';

/**
 * The only place `dangerouslySetInnerHTML` is allowed: the HTML always comes from
 * `fmt`/`crmChip`/`wordDiff` in `@wecom/shared`, which escape every interpolated value.
 */
export function Html({
  html,
  as: Tag = 'span',
  className,
  ...rest
}: {
  html: string;
  as?: ElementType;
  className?: string;
} & Record<string, unknown>) {
  return <Tag className={className} {...rest} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Fmt({
  text,
  fields,
  docs,
  noCrm,
  as,
  className,
}: {
  text: string | null | undefined;
  fields: FieldInfo[];
  docs: DocRef[];
  noCrm?: boolean;
  as?: ElementType;
  className?: string;
}) {
  const html = useMemo(() => fmt(text ?? '', { fields, docs, noCrm }), [text, fields, docs, noCrm]);
  return <Html html={html} as={as} className={className} />;
}
