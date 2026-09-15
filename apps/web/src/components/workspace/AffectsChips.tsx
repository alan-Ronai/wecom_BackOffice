import { Link } from 'react-router-dom';
import { plural, type AffectsItem } from '@wecom/shared';

/**
 * "משפיע על מסמך אחד · בלוק משותף אחד · שדה CRM אחד".
 *
 * `affects` is computed server-side by X1 from the graph and the embeddings — a model cannot
 * claim a change touches a document it never saw — so this is purely how an editor reads it
 * before accepting anything.
 *
 * The four plural phrases are spelled here rather than in `lib/count.ts`: that file is shared and
 * is not on this lane's append list, and three of these nouns are counted nowhere else.
 */
const PHRASE: Record<AffectsItem['kind'], (n: number) => string> = {
  document: (n) => plural(n, { one: 'מסמך אחד', two: 'שני מסמכים', many: '# מסמכים' }),
  block: (n) => plural(n, { one: 'בלוק משותף אחד', two: 'שני בלוקים משותפים', many: '# בלוקים משותפים' }),
  field: (n) => plural(n, { one: 'שדה CRM אחד', two: 'שני שדות CRM', many: '# שדות CRM' }),
  topic: (n) => plural(n, { one: 'נושא אחד', two: 'שני נושאים', many: '# נושאים' }),
};

const ORDER: AffectsItem['kind'][] = ['document', 'block', 'field', 'topic'];

const routeOf = (item: AffectsItem): string | null =>
  item.kind === 'document'
    ? `/doc/${item.id}`
    : item.kind === 'block'
      ? `/blocks/${item.id}`
      : item.kind === 'topic'
        ? `/topic/${item.id}`
        : null;

const titleOf = (items: AffectsItem[]): string =>
  items.map((i) => (i.why ? `${i.title} — ${i.why}` : i.title)).join('\n');

export function AffectsChips({ affects, compact }: { affects: AffectsItem[]; compact?: boolean }) {
  if (!affects.length) return null;
  const groups = ORDER.map((kind) => [kind, affects.filter((a) => a.kind === kind)] as const).filter(
    ([, items]) => items.length,
  );

  return (
    <div className={'affects' + (compact ? ' compact' : '')}>
      <span className="small muted">משפיע על</span>
      {groups.map(([kind, items]) => {
        const label = PHRASE[kind](items.length);
        const only = items.length === 1 ? items[0]! : null;
        const route = only ? routeOf(only) : null;
        if (only && route)
          return (
            <Link key={kind} className="chip chip-amber" to={route} title={titleOf(items)}>
              {label}
            </Link>
          );
        if (only)
          return (
            <span key={kind} className="chip chip-amber" title={titleOf(items)}>
              {label}
            </span>
          );
        return (
          <details key={kind} className="affects-group">
            <summary className="chip chip-amber" title={titleOf(items)}>
              {label}
            </summary>
            <ul>
              {items.map((item) => {
                const to = routeOf(item);
                return (
                  <li key={`${item.kind}:${item.id}`} title={item.why}>
                    {to ? <Link to={to}>{item.title}</Link> : item.title}
                    {item.why ? <span className="small muted"> · {item.why}</span> : null}
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
