import type { Block, Document } from '@wecom/shared';
import { escapeHtml, stripFmt, wordDiff } from '@wecom/shared';
import { diffSteps, stepLines, type Blame } from '../../lib/diffSteps.js';
import { Html } from '../Fmt.js';

/** Port of legacy KB.renderDiff — side-by-side step diff with word-level highlighting. */
export function DiffView({
  oldDoc,
  newDoc,
  blocks,
  blame,
  compact,
  leftLabel,
  rightLabel,
}: {
  oldDoc: Document | { phases: Document['phases']; currentVersion?: number };
  newDoc: Document | { phases: Document['phases']; currentVersion?: number };
  blocks?: Block[];
  blame?: Record<string, Blame>;
  compact?: boolean;
  leftLabel?: string;
  rightLabel?: string;
}) {
  const rows = diffSteps(oldDoc, newDoc, blocks);
  const shown = compact ? rows.filter((r) => r.kind !== 'same') : rows;

  return (
    <div className="diff-cols">
      <div className="diff-col">
        <div className="eyebrow">{leftLabel ?? `v${oldDoc.currentVersion ?? 0}`}</div>
        {!shown.length ? <div className="small muted">אין שינויים</div> : null}
        {shown.map((r, i) => {
          if (!r.old)
            return (
              <div className="dstep gone" key={`l${i}`}>
                <span className="n" />
                <div className="b">— אין שלב {r.new?.num} —</div>
              </div>
            );
          const ol = stepLines(r.old, blocks);
          const nl = r.new ? stepLines(r.new, blocks) : [];
          const t = wordDiff(stripFmt(r.old.title), r.new ? stripFmt(r.new.title) : '');
          return (
            <div
              className={'dstep' + (r.kind === 'changed' ? ' chg' : r.kind === 'same' ? ' same' : '')}
              key={`l${i}`}
            >
              <span className="n">{r.old.num}</span>
              <div className="b">
                <Html
                  className="t"
                  as="div"
                  html={r.kind === 'changed' ? t.a : escapeHtml(stripFmt(r.old.title))}
                />
                <div className="l">
                  {ol.map((line, j) => (
                    <Html key={j} as="div" html={wordDiff(line, nl[j] ?? '').a} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="diff-col">
        <div className="eyebrow cur">{rightLabel ?? `v${newDoc.currentVersion ?? ''} · נוכחי`}</div>
        {!shown.length ? <div className="small muted">זהה לגרסה שפורסמה</div> : null}
        {shown.map((r, i) => {
          if (!r.new)
            return (
              <div className="dstep gone" key={`r${i}`}>
                <span className="n" />
                <div className="b">— שלב {r.old?.num} הוסר —</div>
              </div>
            );
          const ol = r.old ? stepLines(r.old, blocks) : [];
          const nl = stepLines(r.new, blocks);
          const t = wordDiff(r.old ? stripFmt(r.old.title) : '', stripFmt(r.new.title));
          const bl = blame?.[r.new.key];
          const blameTxt =
            r.kind === 'added'
              ? 'נוסף' + (bl ? ` · ${bl.author} v${bl.v}` : '')
              : r.kind === 'changed'
                ? 'שונה' + (bl ? ` · ${bl.author} v${bl.v}` : '')
                : '';
          return (
            <div
              className={
                'dstep' + (r.kind === 'changed' ? ' chg cur' : r.kind === 'added' ? ' new' : ' cur same')
              }
              key={`r${i}`}
            >
              <span className="n">{r.new.num}</span>
              <div className="b">
                <div className="t">
                  <Html html={r.kind === 'changed' ? t.b : escapeHtml(stripFmt(r.new.title))} />
                  {blameTxt ? (
                    <span className="blame">
                      {blameTxt}
                      {r.new.blockId ? ' ⧉' : ''}
                    </span>
                  ) : null}
                </div>
                <div className="l">
                  {nl.map((line, j) => (
                    <Html key={j} as="div" html={wordDiff(ol[j] ?? '', line).b} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
