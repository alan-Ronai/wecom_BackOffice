import { useMemo, useState } from 'react';
import type { Block, CrmField, Document } from '@wecom/shared';
import { resolvedSteps } from '../../lib/steps.js';
import type { Check } from '../../lib/editorModel.js';
import { DocBody, type StepCtx } from '../article/StepView.js';
import { DiffView } from '../history/DiffView.js';
import { SourcePane } from '../source/SourcePane.js';

type Tab = 'preview' | 'json' | 'diff' | 'source';

/** Port of the legacy right pane: live preview / JSON / diff, plus the pre-publish checks. */
export function SidePane({
  doc,
  published,
  checks,
  fields,
  blocks,
}: {
  doc: Document;
  published: Document | undefined;
  checks: Check[];
  fields: CrmField[];
  blocks: Block[];
}) {
  const [tab, setTab] = useState<Tab>('preview');
  const steps = useMemo(() => resolvedSteps(doc, blocks), [doc, blocks]);
  const ctx: StepCtx = { expandAll: true, fields, docs: [], blocks, prefix: 'P-' };

  return (
    <aside className="ed-side">
      <div className="tabs">
        {(
          [
            ['preview', 'תצוגה חיה'],
            ['json', 'JSON'],
            ['diff', 'Diff'],
            // W4: the source document beside the working view, read-only — editing it is the
            // `/edit/:id/source` route's job, and a new item has no document to read yet.
            ...(doc.id === 'new' ? [] : ([['source', 'מקור']] as [Tab, string][])),
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
        <span className="hint">
          {tab === 'preview'
            ? 'כמו שהנציג יראה'
            : tab === 'source'
              ? 'מקור הידע המלא'
              : tab === 'diff'
                ? published
                  ? `מול v${published.currentVersion}`
                  : 'מסמך חדש'
                : 'מבנה הנתונים'}
        </span>
      </div>
      <div className="body">
        {tab === 'preview' ? (
          <div className="preview">
            <article className="doc">
              <div className="doc-head">
                <h1>{doc.title}</h1>
                <p>{doc.description}</p>
              </div>
              <DocBody doc={doc} ctx={ctx} steps={steps} />
            </article>
          </div>
        ) : tab === 'json' ? (
          <pre>{JSON.stringify(doc, null, 2)}</pre>
        ) : tab === 'source' ? (
          <SourcePane documentId={doc.id} canEdit={false} sourceId={doc.sourceId} />
        ) : (
          <DiffView
            oldDoc={published ?? { ...doc, phases: [] }}
            newDoc={doc}
            blocks={blocks}
            compact
            leftLabel={published ? `v${published.currentVersion}` : 'מסמך חדש'}
            rightLabel="טיוטה"
          />
        )}
        <div className="checks">
          <div className="eyebrow">בדיקות לפני פרסום</div>
          <div className="rows">
            {checks.map(([k, t]) => (
              <span key={t} className={k}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
