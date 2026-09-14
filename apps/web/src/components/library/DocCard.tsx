import type { DocumentCard } from '@wecom/shared';
import { CATS, PRI } from '../../lib/constants.js';

/** Port of legacy KB.cardFor — chips, title, description and the computed meta row. */
export function DocCard({
  card,
  onOpen,
  onPin,
  onMenu,
}: {
  card: DocumentCard;
  onOpen: () => void;
  onPin: () => void;
  onMenu: (anchor: HTMLElement) => void;
}) {
  const partial = card.status === 'partial';
  const draft = card.status === 'draft';
  const bits: string[] = [`${card.stepCount} שלבים`];
  if (partial) bits.push('חסרים שלבים · לבדיקה');
  else if (card.views) bits.push(`נצפה ${card.views}×`);
  else if (card.linksOut) bits.push(`${card.linksOut} קישורים יוצאים`);
  else if (card.linksIn) bits.push(`מקושר מ-${card.linksIn}`);
  else if (card.hasSharedBlocks) bits.push('בלוק משותף ⧉');
  else if (card.crmFields.length) bits.push(`${card.crmFields.length} שדות CRM`);

  return (
    <div
      className={'tcard' + (partial ? ' partial' : '')}
      tabIndex={0}
      role="button"
      data-doc={card.id}
      data-nopeek=""
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
    >
      <span
        className={'star' + (card.pinned ? ' on' : '')}
        title={card.pinned ? 'בטל הצמדה' : 'הצמד'}
        aria-label={`${card.pinned ? 'בטל הצמדה של' : 'הצמד את'} ${card.title}`}
        aria-pressed={card.pinned}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onPin();
        }}
      >
        ★
      </span>
      <span
        className="kebab"
        title="פעולות"
        aria-label={`פעולות · ${card.title}`}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e.currentTarget);
        }}
      >
        ⋯
      </span>
      <div className="chips">
        <span className="chip chip-blue">{CATS[card.category].short}</span>
        {partial ? (
          <span className="chip chip-amber">מסמך חלקי</span>
        ) : draft ? (
          <span className="chip chip-amber">טיוטה</span>
        ) : (
          <span className={`chip ${PRI[card.priority].cls}`}>{PRI[card.priority].label}</span>
        )}
      </div>
      <div className="title">{card.title}</div>
      <div className="desc">{card.description}</div>
      <div className={'meta' + (partial ? ' warn' : '')}>
        {bits.map((b, i) => (
          <span key={b}>
            {i ? <span>·</span> : null}
            <span>{b}</span>
          </span>
        ))}
        <span className="avs">
          {card.crmFields.length ? (
            <span className="mini-av" title={card.crmFields.join(', ')}>
              CRM
            </span>
          ) : null}
          <span className="mini-av v" title={`גרסה ${card.currentVersion}`}>
            v{card.currentVersion}
          </span>
        </span>
      </div>
    </div>
  );
}
