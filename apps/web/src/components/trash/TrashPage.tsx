import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useEmptyTrash,
  usePurgeTrash,
  useRestoreAllTrash,
  useRestoreTrash,
  useTrash,
} from '../../api/hooks/trash.js';
import { useCan } from '../../api/hooks/me.js';
import { useFields } from '../../api/hooks/content.js';
import { TRASH_DAYS } from '../../lib/constants.js';
import { ago } from '../../lib/format.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';
import { Fmt } from '../Fmt.js';
import type { TrashItem } from '../../api/types.js';

const TYPE_LABEL: Record<string, string> = {
  document: '',
  block: 'בלוק משותף: ',
  field: 'שדה: ',
  script: 'תסריט: ',
};

/** Port of legacy views-trash.js: countdown, impact and restore. */
export function TrashPage() {
  const go = useNavigate();
  const trash = useTrash();
  const fields = useFields();
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const restore = useRestoreTrash();
  const purge = usePurgeTrash();
  const restoreAll = useRestoreAllTrash();
  const empty = useEmptyTrash();
  const [sel, setSel] = useState<Set<string>>(new Set());

  const items = [...(trash.data?.items ?? [])].sort(
    (a, b) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt),
  );
  const mayRestore = can('docs.restore');
  const toggle = (id: string) =>
    setSel((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selected = items.filter((t) => sel.has(t.id));

  const impactOf = (e: TrashItem) =>
    e.impact.brokenLinks ? (
      <span className="chip chip-red" title={e.impact.documents.map((d) => d.title).join(' · ')}>
        {e.impact.brokenLinks} קישורים שבורים
      </span>
    ) : (
      <span className="chip chip-green">ללא השפעה</span>
    );

  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/library')}>
            ספרייה
          </a>
          <span className="sep">/</span>
          <b>סל מיחזור</b>
        </div>
      </div>
      <div className="scroll-area">
        <div className="trash-body">
          <div className="hd">
            <h2>
              סל מיחזור{' '}
              <span>
                {items.length} פריטים · נמחקים סופית אחרי {TRASH_DAYS} יום
              </span>
            </h2>
            <div className="btns">
              {mayRestore && selected.length ? (
                <button
                  className="btn sm navy"
                  onClick={async () => {
                    for (const t of selected) await restore.mutateAsync({ type: t.type, id: t.id });
                    setSel(new Set());
                    toast('שוחזרו פריטים', 'ok');
                  }}
                >
                  שחזר {selected.length} נבחרים
                </button>
              ) : null}
              {mayRestore && selected.length ? (
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    const ok = await modal.confirm(
                      'מחיקה לצמיתות',
                      `${selected.length} פריטים יימחקו לצמיתות. לא ניתן לבטל.`,
                      'מחק לצמיתות',
                      'danger',
                    );
                    if (!ok) return;
                    for (const t of selected) await purge.mutateAsync({ type: t.type, id: t.id });
                    setSel(new Set());
                  }}
                >
                  מחק לצמיתות
                </button>
              ) : null}
              {mayRestore ? (
                <button
                  className="btn sm"
                  disabled={!items.length}
                  onClick={async () => {
                    await restoreAll.mutateAsync(undefined);
                    toast('כל הפריטים שוחזרו', 'ok');
                  }}
                >
                  שחזר הכל
                </button>
              ) : null}
              {mayRestore ? (
                <button
                  className="btn sm danger"
                  disabled={!items.length}
                  onClick={async () => {
                    const ok = await modal.confirm(
                      'ריקון סל המיחזור',
                      // Not "all N will be deleted": an item that was ever published is kept out
                      // of a manual purge, so the dialog says what the route actually does and
                      // the toast reports what it actually did.
                      `עד ${items.length} פריטים יימחקו לצמיתות. פריטים שפורסמו בעבר יישארו בסל. לא ניתן לבטל.`,
                      'רוקן סל',
                      'danger',
                    );
                    if (!ok) return;
                    const res = await empty.mutateAsync(undefined);
                    toast(
                      res.skipped
                        ? `נמחקו ${res.purged} · ${res.skipped} נשארו (פורסמו בעבר)`
                        : `נמחקו ${res.purged} פריטים`,
                      'ok',
                    );
                  }}
                >
                  רוקן סל
                </button>
              ) : null}
            </div>
          </div>

          {trash.isError ? <LoadError what="סל המיחזור" error={trash.error} /> : null}
          {trash.isPending ? (
            <div className="route-loading">טוען…</div>
          ) : !items.length && !trash.isError ? (
            <div className="empty">
              <b>סל המיחזור ריק</b>
              פריטים שנמחקים נשמרים כאן {TRASH_DAYS} יום לפני מחיקה סופית
            </div>
          ) : (
            <>
              <div className="trow head">
                <span />
                <span>פריט</span>
                <span>נמחק על ידי</span>
                <span>מחיקה סופית</span>
                <span>השפעה</span>
              </div>
              {items.map((e) => {
                const leftMs = Date.parse(e.purgeAt) - Date.now();
                const leftDays = Math.max(0, leftMs / 864e5);
                const pct = Math.min(100, Math.round(((TRASH_DAYS - leftDays) / TRASH_DAYS) * 100));
                const urgent = leftDays <= 3;
                return (
                  <div className={'trow' + (urgent ? ' urgent' : '')} key={e.id}>
                    <span
                      className={'cb' + (sel.has(e.id) ? ' on' : '')}
                      role="checkbox"
                      tabIndex={0}
                      aria-checked={sel.has(e.id)}
                      aria-label={`בחר ${e.title}`}
                      onClick={() => toggle(e.id)}
                    >
                      {sel.has(e.id) ? '✓' : ''}
                    </span>
                    <div>
                      <div className="t">{(TYPE_LABEL[e.type] ?? '') + e.title}</div>
                      <Fmt as="div" className="m" text={e.meta} fields={fields.data ?? []} docs={[]} noCrm />
                    </div>
                    <div className="cd">
                      {e.deletedBy}
                      <div className="m">{ago(e.deletedAt)}</div>
                    </div>
                    <div>
                      <div className={'cd' + (urgent ? ' red' : '')}>
                        {leftDays < 1
                          ? 'היום'
                          : `בעוד ${Math.ceil(leftDays)} ${Math.ceil(leftDays) === 1 ? 'יום' : 'ימים'}`}
                      </div>
                      <div className="bar">
                        <i
                          className={pct > 85 ? 'hot' : pct > 50 ? 'mid' : ''}
                          style={{ width: `${Math.max(3, pct)}%` }}
                        />
                      </div>
                    </div>
                    <div className="imp">
                      {impactOf(e)}
                      {mayRestore ? (
                        <span
                          className="restore"
                          role="button"
                          tabIndex={0}
                          onClick={async () => {
                            await restore.mutateAsync({ type: e.type, id: e.id });
                            toast(`"${e.title}" שוחזר למקור`, 'ok');
                          }}
                        >
                          שחזר
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </>
  );
}
