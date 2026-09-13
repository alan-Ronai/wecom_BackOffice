import { useNavigate } from 'react-router-dom';
import { useBlocks, useFields, useUpsertBlock } from '../../api/hooks/content.js';
import { useCan } from '../../api/hooks/me.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { Fmt } from '../Fmt.js';
import { useEntityDialogs } from './dialogs.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';

/** Port of legacy KB.views.blocks. */
export function BlocksPage() {
  const go = useNavigate();
  const blocks = useBlocks();
  const fields = useFields();
  const dialogs = useEntityDialogs();
  const modal = useModal();
  const toast = useToast();
  const can = useCan();
  const upsert = useUpsertBlock();
  const list = blocks.data ?? [];

  const newBlock = async () => {
    const name = await modal.prompt('בלוק משותף חדש', 'שם הבלוק');
    if (!name?.trim()) return;
    await upsert.mutateAsync({
      title: name.trim(),
      kind: 'step',
      actions: [{ id: 'b1', text: '' }],
      outcomes: [
        { kind: 'ok', text: '✓ הסתדר – סיום' },
        { kind: 'next', text: '→ לא הסתדר – המשך' },
      ],
    });
    toast('הבלוק נוצר', 'ok');
  };

  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/library')}>
            ספרייה
          </a>
          <span className="sep">/</span>
          <b>בלוקים משותפים</b>
        </div>
        <div className="actions">
          {can('blocks.edit') ? (
            <button className="btn primary" onClick={() => void newBlock()}>
              ✚ בלוק חדש
            </button>
          ) : null}
        </div>
      </div>
      <div className="scroll-area">
        <div className="lib-body">
          <div className="lib-head">
            <div>
              <h1>
                בלוקים משותפים<span>{list.length} בלוקים</span>
              </h1>
              <p>שלב או תסריט שנכתב פעם אחת ומוטמע בכמה מסמכים. עריכה של הבלוק מתעדכנת בכולם.</p>
            </div>
          </div>
          {blocks.isError ? <LoadError what="בלוקים משותפים" error={blocks.error} /> : null}
          <div className="grid">
            {list.map((b) => (
              <div
                className="tcard"
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => dialogs.showBlock(b.id)}
              >
                <div className="chips">
                  <span className="blockbar">⧉ {b.kind === 'script' ? 'תסריט' : 'שלב'}</span>
                  <span className="chip chip-gray">v{b.currentVersion}</span>
                </div>
                <div className="title">{b.title}</div>
                <div className="desc">
                  {b.kind === 'script' ? (
                    (b.script ?? '').slice(0, 110) + '…'
                  ) : (
                    <Fmt
                      text={b.actions.map((a) => a.text).join(' ← ')}
                      fields={fields.data ?? []}
                      docs={[]}
                    />
                  )}
                </div>
                <div className="meta">
                  <span>{b.actions.length} פעולות</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
