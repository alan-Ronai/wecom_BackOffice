import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { crmChip } from '@wecom/shared';
import { useBlockUsage, useBlocks, useFieldUsage, useFields } from '../../api/hooks/content.js';
import { useModal } from '../ui/Modal.js';
import { Fmt, Html } from '../Fmt.js';
import { fmtDate, copy } from '../../lib/format.js';
import { useToast } from '../ui/Toast.js';

/** "שדה CRM" popover — status, path and the documents that reference it. */
function FieldBody({ name, onOpen }: { name: string; onOpen: (docId: string) => void }) {
  const fields = useFields();
  const usage = useFieldUsage(name);
  const f = fields.data?.find((x) => x.name === name);
  const docs = usage.data ?? [];
  return (
    <div>
      <p>
        <Html html={crmChip(f ?? { name, status: 'unknown' })} />
        {' · '}
        {f ? `${f.path} · עודכן ${fmtDate(f.updatedAt)}` : 'שדה לא מוכר ב-crm-fields.json'}
      </p>
      {f?.status === 'renamed' ? (
        <p style={{ color: 'var(--red-dark)', fontWeight: 600 }}>
          שונה שם ל-{f.renamedTo} — יש לעדכן את המסמכים המפנים לשם הישן.
        </p>
      ) : null}
      {f?.status === 'new' ? <p style={{ color: 'var(--warn)' }}>שדה חדש — נוסף השבוע.</p> : null}
      <div className="eyebrow" style={{ marginTop: 14 }}>
        ב-{docs.length} מסמכים
      </div>
      <div className="field-docs">
        {docs.length ? (
          docs.map((d) => (
            <a
              key={d.documentId}
              className="rel"
              data-nopeek=""
              role="button"
              tabIndex={0}
              onClick={() => onOpen(d.documentId)}
            >
              <span className="ic">📄</span>
              <div className="tx">
                {d.title}
                <div>v{d.currentVersion}</div>
              </div>
            </a>
          ))
        ) : (
          <div className="muted small">אף מסמך לא מפנה לשדה זה</div>
        )}
      </div>
    </div>
  );
}

function BlockBody({ id, onOpen }: { id: string; onOpen: (docId: string, stepKey?: string) => void }) {
  const blocks = useBlocks();
  const usage = useBlockUsage(id);
  const fields = useFields();
  const b = blocks.data?.find((x) => x.id === id);
  const used = usage.data ?? [];
  if (!b) return <div className="muted small">הבלוק לא נמצא</div>;
  return (
    <div>
      <div className="chips" style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <span className="blockbar">⧉ בלוק משותף · {used.length}</span>
        <span className="chip chip-gray">
          v{b.currentVersion} · {fmtDate(b.updatedAt)}
        </span>
      </div>
      {b.kind === 'script' ? (
        <Fmt as="div" className="script" text={b.script ?? ''} fields={fields.data ?? []} docs={[]} />
      ) : (
        <div className="acts">
          {b.actions.map((a) => (
            <div className="act" key={a.id}>
              <span className="caret">›</span>
              <Fmt text={a.text} fields={fields.data ?? []} docs={[]} />
            </div>
          ))}
        </div>
      )}
      <div className="eyebrow" style={{ marginTop: 14 }}>
        משמש ב-{used.length} מסמכים · שינוי בבלוק מתעדכן בכולם
      </div>
      <div className="field-docs">
        {used.map((u) => (
          <a
            key={u.documentId + u.stepKey}
            className="rel"
            data-nopeek=""
            role="button"
            tabIndex={0}
            onClick={() => onOpen(u.documentId, u.stepKey)}
          >
            <span className="ic">📄</span>
            <div className="tx">
              {u.title}
              <div>
                שלב {u.stepNum} · {u.embedded ? 'מוטמע' : 'מפנה'}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Shared entry points: the palette, the library and the article all open the same dialogs. */
export function useEntityDialogs() {
  const modal = useModal();
  const nav = useNavigate();
  const toast = useToast();

  const showField = useCallback(
    (name: string) => {
      const close = modal.open({
        title: 'שדה CRM',
        body: (
          <FieldBody
            name={name}
            onOpen={(id) => {
              close();
              nav(`/doc/${id}`);
            }}
          />
        ),
      });
    },
    [modal, nav],
  );

  const showBlock = useCallback(
    (id: string) => {
      const close = modal.open({
        title: '⧉ בלוק משותף',
        body: (
          <BlockBody
            id={id}
            onOpen={(docId, stepKey) => {
              close();
              nav(`/doc/${docId}${stepKey ? '/' + stepKey : ''}`);
            }}
          />
        ),
        buttons: [{ label: 'סגור' }],
      });
    },
    [modal, nav],
  );

  const showScript = useCallback(
    (title: string, text: string) => {
      modal.open({
        title: `“ ${title}`,
        body: <div className="script">{text}</div>,
        buttons: [
          {
            label: 'העתק',
            cls: 'primary',
            onClick: () => {
              void copy(text);
              toast('הועתק ללוח', 'ok');
            },
          },
          { label: 'סגור' },
        ],
      });
    },
    [modal, toast],
  );

  return { showField, showBlock, showScript };
}
