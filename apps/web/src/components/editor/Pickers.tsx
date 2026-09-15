import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DocRef } from '@wecom/shared';
import { useFields } from '../../api/hooks/content.js';
import { useDocuments } from '../../api/hooks/documents.js';
import { useDebounced } from '../../lib/useDebounced.js';
import { useModal } from '../ui/Modal.js';
import { TypeBadge, worldShort } from '../taxonomy/TypeBadge.js';

/**
 * G10 — the editor's two quick-command pickers (`legacy/js/views-editor.js`, `pickCrm`/`pickDoc`).
 *
 * `<Fmt>` has always resolved a CRM field name in free text and `[[doc:id]]` into a link, so the
 * *capability* was never missing; what was missing was choosing one. Without a picker an editor
 * has to type a field name character-exact from memory, or paste a raw uuid — and in the port
 * document ids are uuids, where legacy's were slugs, so the link case was strictly worse than the
 * app it replaced.
 *
 * Both pickers are one shape: a search box over a list. The list is a real `<select size>` rather
 * than a div tree with `role="listbox"` painted on, because that is the one listbox that already
 * behaves — arrow keys move the selection, type-ahead works, the value is announced, and it is
 * RTL-correct without a single line of CSS. `Enter` confirms from either control and `Escape`
 * closes through the modal stack's own binding.
 *
 * Neither picker adds an endpoint: `GET /fields` already returns `usedIn`, and `GET /documents`
 * already returns the cards with their `docType` and `worlds`.
 */

const FIELD_STATUS: Record<string, string> = {
  renamed: 'שונה שם',
  new: 'חדש',
  retired: 'הוצא משימוש',
};

/** One picker body: search on top, a native listbox under it, a detail line for the selection. */
function PickerBody({
  searchLabel,
  listLabel,
  q,
  onQ,
  options,
  value,
  onValue,
  onSubmit,
  detail,
  empty,
}: {
  searchLabel: string;
  listLabel: string;
  q: string;
  onQ: (v: string) => void;
  options: { key: string; text: string }[];
  value: string;
  onValue: (v: string) => void;
  onSubmit: () => void;
  detail: ReactNode;
  empty: string;
}) {
  /** ↓/↑ from the search box move the listbox selection, so the hands never leave the query. */
  const step = (dir: number) => {
    const i = options.findIndex((o) => o.key === value);
    const next = options[Math.min(options.length - 1, Math.max(0, i + dir))];
    if (next) onValue(next.key);
  };

  return (
    <div className="form picker">
      <label>
        {searchLabel}
        <input
          type="text"
          autoFocus
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={q}
          onChange={(e) => onQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              step(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              step(-1);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </label>
      <label>
        {listLabel}
        <select
          aria-label={listLabel}
          size={8}
          value={value}
          onChange={(e) => onValue(e.target.value)}
          onDoubleClick={onSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            }
          }}
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.text}
            </option>
          ))}
        </select>
      </label>
      <div className="muted small picker-detail">{options.length ? detail : empty}</div>
    </div>
  );
}

/** Keeps the selection on something that is actually in the filtered list, and reports it up. */
function useSelection(keys: string[], onChange: (v: string) => void) {
  const [value, setValue] = useState('');
  const current = keys.includes(value) ? value : (keys[0] ?? '');
  useEffect(() => onChange(current), [current, onChange]);
  return [current, setValue] as const;
}

function CrmPicker({ onChange, onSubmit }: { onChange: (v: string) => void; onSubmit: () => void }) {
  const fields = useFields();
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (fields.data ?? []).filter(
      (f) => !needle || f.name.toLowerCase().includes(needle) || f.path.toLowerCase().includes(needle),
    );
  }, [fields.data, q]);
  const [value, setValue] = useSelection(
    items.map((f) => f.name),
    onChange,
  );
  const sel = items.find((f) => f.name === value);

  return (
    <PickerBody
      searchLabel="חפש שדה לפי שם או מסלול"
      listLabel="בחר שדה מ-crm-fields.json"
      q={q}
      onQ={setQ}
      options={items.map((f) => ({
        key: f.name,
        text: `${f.name} · ב-${f.usedIn} מסמכים${FIELD_STATUS[f.status] ? ' · ' + FIELD_STATUS[f.status] : ''}`,
      }))}
      value={value}
      onValue={setValue}
      onSubmit={onSubmit}
      empty={fields.isPending ? 'טוען שדות…' : 'אין שדה תואם'}
      detail={
        sel ? (
          <>
            <span className={'chip ' + (sel.status === 'ok' ? 'chip-gray' : 'chip-amber')}>
              {FIELD_STATUS[sel.status] ?? 'פעיל'}
            </span>{' '}
            {sel.path || 'ללא מסלול ב-CRM'}
            {sel.renamedTo ? ` · שמו החדש: ${sel.renamedTo}` : ''}
          </>
        ) : null
      }
    />
  );
}

/**
 * H2 — the search runs on the server, not over whatever page 1 happened to contain.
 *
 * The first version asked for `pageSize: 200` and filtered the result in the browser, which is
 * only a search while the corpus fits in 200 cards. At pilot scale it does not: everything past
 * that page was invisible to the picker, so an editor looking for a document that exists was told
 * "אין מסמך תואם". `ListDocumentsQuerySchema` has always accepted `q` — the picker simply never
 * sent it.
 *
 * Debounced, because this is a keystroke-driven query against `ilike` predicates on a VM that also
 * runs the model service; 200 ms is the same budget the admin user search uses. The empty query
 * still asks for a page of the corpus, so the list is never blank before the first keystroke.
 */
function DocPicker({
  excludeId,
  onChange,
  onSubmit,
}: {
  excludeId?: string;
  onChange: (v: DocRef | undefined) => void;
  onSubmit: () => void;
}) {
  const [q, setQ] = useState('');
  const needle = useDebounced(q.trim(), 200);
  const docs = useDocuments({ ...(needle ? { q: needle } : {}), pageSize: 200, sort: 'title' });
  const items = useMemo(
    () => (docs.data?.items ?? []).filter((d) => d.id !== excludeId),
    [docs.data, excludeId],
  );
  /**
   * The selection is reported up as `{ id, title }`, not as a bare id: the editor writes
   * `[[doc:<id>]]` into the action text and then has to *name* that target beside the field, and
   * the picker is the one place in the app that already knows the title. Handing it over here is
   * what keeps a freshly linked document from rendering as a raw uuid (H2).
   */
  const report = useCallback(
    (id: string) => {
      const d = items.find((x) => x.id === id);
      onChange(d ? { id: d.id, title: d.title } : undefined);
    },
    [items, onChange],
  );
  const [value, setValue] = useSelection(
    items.map((d) => d.id),
    report,
  );
  const sel = items.find((d) => d.id === value);

  return (
    <PickerBody
      searchLabel="חפש מסמך לפי כותרת"
      listLabel="מסמך יעד"
      q={q}
      onQ={setQ}
      // The option text is the title and nothing else — the type and the worlds are chips under
      // the list, where they can be chips, and a `<select>` option can hold no markup.
      options={items.map((d) => ({ key: d.id, text: d.title }))}
      value={value}
      onValue={setValue}
      onSubmit={onSubmit}
      empty={docs.isPending || docs.isFetching ? 'מחפש מסמכים…' : 'אין מסמך תואם'}
      detail={
        sel ? (
          <>
            {sel.docType ? <TypeBadge docType={sel.docType} /> : null}{' '}
            {[sel.category, ...(sel.worlds ?? [])]
              .filter((w, i, all) => w && all.indexOf(w) === i)
              .map((w) => (
                <span key={w} className="chip chip-gray">
                  {worldShort(w)}
                </span>
              ))}{' '}
            {sel.description}
          </>
        ) : null
      }
    />
  );
}

export type PickerKind = 'crm' | 'link';

/**
 * Opens either picker and hands the finished action text back. The text is legacy's, verbatim:
 * `פתח CRM ↗ שדה <name>` and `המשך לפי [[doc:<id>]]` — the second is the token `<Fmt>` resolves,
 * not a rendered title, so the link keeps working when the target is renamed.
 *
 * The link picker also hands back the `DocRef` it resolved. The token is deliberately id-only, so
 * without this the editor would have to find the title again — and the only list it had was page 1
 * of the library, which is how a freshly linked document ended up displayed as a raw uuid (H2).
 */
export function useEditorPickers({
  excludeId,
  onInsert,
}: {
  excludeId?: string;
  onInsert: (text: string, picked?: DocRef) => void;
}) {
  const modal = useModal();

  const open = (kind: PickerKind) => {
    const picked = { current: '', ref: undefined as DocRef | undefined };
    let dispose = () => {};
    const setField = (v: string) => {
      picked.current = v;
    };
    const setDoc = (ref: DocRef | undefined) => {
      picked.current = ref?.id ?? '';
      picked.ref = ref;
    };
    /** `false` keeps the dialog open — nothing is selected, so there is nothing to insert. */
    const apply = () => {
      if (!picked.current) return false;
      if (kind === 'crm') onInsert(`פתח CRM ↗ שדה ${picked.current}`);
      else onInsert(`המשך לפי [[doc:${picked.current}]]`, picked.ref);
      return true;
    };
    const submit = () => {
      if (apply() !== false) dispose();
    };
    dispose = modal.open({
      title: kind === 'crm' ? 'שדה CRM' : 'קישור למסמך',
      body:
        kind === 'crm' ? (
          <CrmPicker onChange={setField} onSubmit={submit} />
        ) : (
          <DocPicker excludeId={excludeId} onChange={setDoc} onSubmit={submit} />
        ),
      buttons: [
        { label: 'ביטול' },
        { label: kind === 'crm' ? 'הוסף' : 'קשר', cls: 'primary', onClick: apply },
      ],
    });
  };

  return { pickCrmField: () => open('crm'), pickDocLink: () => open('link') };
}
