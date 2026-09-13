import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { crmChip } from '@wecom/shared';
import type { Document } from '@wecom/shared';
import { useLinks, useRelated, useVersions } from '../../api/hooks/documents.js';
import { useAddNote, useLikeNote, useNotes } from '../../api/hooks/content.js';
import { useCan } from '../../api/hooks/me.js';
import { CATS } from '../../lib/constants.js';
import { ago, fmtDate } from '../../lib/format.js';
import { Fmt, Html } from '../Fmt.js';
import type { ResolvedStep } from '../../lib/steps.js';
import type { FieldInfo } from '../../lib/format.js';
import { CardMap } from './CardMap.js';

type Tab = 'links' | 'notes' | 'versions';

/** Port of the legacy right-hand panel: קשרים / הערות / גרסאות. */
export function Panel({
  doc,
  steps,
  fields,
  activeKey,
  onSelectStep,
  onShowBlock,
  mobileOpen,
  onCloseMobile,
  results,
}: {
  doc: Document;
  steps: ResolvedStep[];
  fields: FieldInfo[];
  activeKey: string | null;
  onSelectStep: (key: string) => void;
  onShowBlock: (id: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  results: Record<string, unknown>;
}) {
  const go = useNavigate();
  const [tab, setTab] = useState<Tab>('links');
  const [draft, setDraft] = useState('');
  const [stepSel, setStepSel] = useState('');
  const can = useCan();
  const related = useRelated(doc.id);
  const links = useLinks(doc.id);
  const notes = useNotes(doc.id);
  const versions = useVersions(doc.id);
  const addNote = useAddNote(doc.id);
  const likeNote = useLikeNote(doc.id);

  const list = notes.data ?? [];
  const crm = [
    ...new Set(steps.flatMap((s) => fields.filter((f) => stepHasField(s, f.name)).map((f) => f.name))),
  ];
  const blockIds = [...new Set(steps.map((s) => s.blockId).filter(Boolean))] as string[];

  return (
    <aside className={'panel' + (mobileOpen ? ' mobile-open' : '')}>
      <div className="tabs">
        {(
          [
            ['links', 'קשרים'],
            ['notes', `הערות ${list.length}`],
            ['versions', 'גרסאות'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <span
            key={k}
            className={k === tab ? 'on' : ''}
            role="button"
            tabIndex={0}
            onClick={() => setTab(k)}
          >
            {l}
          </span>
        ))}
        {mobileOpen ? (
          <span style={{ flex: '0 0 44px' }} role="button" tabIndex={0} onClick={onCloseMobile}>
            ✕
          </span>
        ) : null}
      </div>
      <div className="pbody">
        {tab === 'links' ? (
          <>
            <div>
              <div className="eyebrow">מסמכים קשורים · אוטומטי</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {related.data?.length ? (
                  related.data.map((r) => (
                    <a key={r.documentId} className="rel" data-doc={r.documentId}>
                      <span className="ic">{CATS[r.category as keyof typeof CATS]?.icon ?? '📄'}</span>
                      <div className="tx">
                        {r.title}
                        <div>{r.why}</div>
                      </div>
                    </a>
                  ))
                ) : (
                  <div className="small muted">לא זוהו קשרים עדיין</div>
                )}
              </div>
            </div>
            <div>
              <div className="eyebrow">שדות CRM במסמך</div>
              <div className="crm-wrap">
                {crm.length ? (
                  <Html
                    html={crm
                      .map((n) => crmChip(fields.find((f) => f.name === n) ?? { name: n, status: 'unknown' }))
                      .join('')}
                  />
                ) : (
                  <span className="small muted">אין שדות CRM</span>
                )}
              </div>
            </div>
            <div>
              <div className="eyebrow">בלוקים משותפים</div>
              <div className="blocks-list">
                {blockIds.length ? (
                  blockIds.map((id) => {
                    const s = steps.find((x) => x.blockId === id);
                    return (
                      <div key={id} role="button" tabIndex={0} onClick={() => onShowBlock(id)}>
                        <span>
                          {s?.block?.title ?? 'בלוק'} ({s?.actions.length ?? 0} פעולות)
                        </span>
                        <span className="u">שלב {s?.num}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="small muted">אין בלוקים משותפים במסמך</div>
                )}
              </div>
            </div>
            <CardMap
              doc={doc}
              steps={steps}
              activeKey={activeKey}
              results={results}
              linksIn={links.data?.in.length ?? 0}
              linksOut={links.data?.out.length ?? 0}
              onSelect={onSelectStep}
            />
          </>
        ) : tab === 'notes' ? (
          <>
            {can('notes.write') ? (
              <div className="note-form">
                <div className="eyebrow">הערת נציג חדשה</div>
                <textarea
                  aria-label="הערת נציג חדשה"
                  placeholder="מה כדאי שנציגים אחרים ידעו? (N מתוך שלב)"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="r">
                  <select aria-label="שלב" value={stepSel} onChange={(e) => setStepSel(e.target.value)}>
                    <option value="">כללי</option>
                    {steps.map((s) => (
                      <option key={s.key} value={s.key}>
                        שלב {s.num}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn sm primary"
                    onClick={() => {
                      if (!draft.trim()) return;
                      addNote.mutate({ stepKey: stepSel || null, text: draft.trim() });
                      setDraft('');
                    }}
                  >
                    הוסף
                  </button>
                </div>
              </div>
            ) : null}
            {!list.length ? <div className="small muted">אין הערות עדיין</div> : null}
            {[...list].reverse().map((n) => {
              const st = n.stepKey ? steps.find((s) => s.key === n.stepKey) : null;
              return (
                <div className="note" key={n.id}>
                  <div className="by">
                    <span>
                      הערת נציג · {n.authorName} · {ago(n.createdAt)}
                    </span>
                    {st ? (
                      <span
                        style={{ cursor: 'pointer' }}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectStep(st.key)}
                      >
                        שלב {st.num}
                      </span>
                    ) : null}
                  </div>
                  <Fmt text={n.text} fields={fields} docs={[]} />
                  <span
                    className={'like' + (n.likedByMe ? ' on' : '')}
                    role="button"
                    tabIndex={0}
                    onClick={() => likeNote.mutate(n.id)}
                  >
                    👍 {n.likes}
                  </span>
                </div>
              );
            })}
          </>
        ) : (
          <div>
            <div className="eyebrow">היסטוריית גרסאות</div>
            <div className="vlist">
              {versions.data?.length ? (
                [...versions.data].reverse().map((v, i) => (
                  <div
                    key={v.version}
                    className={'vi' + (i === 0 ? ' cur' : '')}
                    role="button"
                    tabIndex={0}
                    onClick={() => go(`/history/${doc.id}${i === 0 ? '' : '/' + v.version}`)}
                  >
                    <span className="d" />
                    <div className="b">
                      <div className="t">
                        v{v.version}
                        {i === 0 ? ' · נוכחי' : ''}
                      </div>
                      <div className="m">
                        {v.authorName} · {fmtDate(v.createdAt)}
                      </div>
                      {v.label ? <div className="l">{v.label}</div> : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="small muted">עדיין אין גרסאות שמורות · פרסום מהעורך יוצר גרסה</div>
              )}
            </div>
            <button className="btn sm" style={{ marginTop: 8 }} onClick={() => go(`/history/${doc.id}`)}>
              השוואה מלאה ושחזור
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function stepHasField(s: ResolvedStep, name: string): boolean {
  const text = [
    s.title,
    s.description ?? '',
    ...s.actions.map((a) => a.text),
    s.script ?? '',
    ...(s.branch?.options.map((o) => o.text) ?? []),
  ].join(' · ');
  return text.includes(name);
}
