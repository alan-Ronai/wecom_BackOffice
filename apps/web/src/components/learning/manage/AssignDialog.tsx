import { useState } from 'react';
import { useRoles } from '../../../api/hooks/admin.js';
import { useMentionable } from '../../../api/hooks/collab.js';
import { useAssignUsers, useCreateAudience } from '../../../api/hooks/learningManage.js';
import { useWorlds } from '../../../api/hooks/taxonomy.js';
import { useDebounced } from '../../../lib/useDebounced.js';
import { useToast } from '../../ui/Toast.js';
import { useFocusTrap } from '../../ui/useFocusTrap.js';

const toggle = (xs: string[], v: string) => (xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]);

/**
 * Spec §1.3: an audience is roles × worlds and is re-resolved nightly, so a new hire in the world
 * gets the briefing without anyone re-assigning it; individuals are the ad-hoc escape hatch and
 * are assigned once, by id.
 *
 * Hand-rolled rather than `modal.open` because the dialog owns two independent submit buttons and
 * has to stay open while one of them reports a failure; it reuses the modal's own classes and
 * focus trap so it behaves like every other dialog in the app.
 */
export function AssignDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const roles = useRoles();
  const worlds = useWorlds();
  const [roleNames, setRoleNames] = useState<string[]>([]);
  const [worldSlugs, setWorldSlugs] = useState<string[]>([]);
  /**
   * Held as text, not a number: coercing on every keystroke snapped an emptied field straight back
   * to the default, so clearing it and typing a new value appended to the old one instead of
   * replacing it. The number is derived once, where it is actually sent.
   */
  const [dueDaysText, setDueDaysText] = useState('14');
  const dueDays = Number(dueDaysText) || 14;
  const [q, setQ] = useState('');
  const people = useMentionable(useDebounced(q, 200), true);
  const [picked, setPicked] = useState<{ id: string; displayName: string }[]>([]);
  const createAudience = useCreateAudience(itemId);
  const assign = useAssignUsers(itemId);
  const toast = useToast();
  const trap = useFocusTrap<HTMLDivElement>(true);
  const candidates = (people.data ?? []).filter(
    (p) => !picked.some((x) => x.id === p.id) && (!q || p.displayName.includes(q)),
  );

  return (
    <div
      className="overlay center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        ref={trap}
        className="modal assign-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="הקצאת פריט למידה"
      >
        <h2>
          הקצאת פריט למידה
          <span className="x" role="button" tabIndex={0} title="סגור (Esc)" onClick={onClose}>
            ✕
          </span>
        </h2>
        <fieldset>
          <legend>קהל יעד (תפקידים × עולמות תוכן)</legend>
          <div className="checks" role="group" aria-label="תפקידים">
            {(roles.data ?? []).map((r) => (
              <label key={r.name}>
                <input
                  type="checkbox"
                  aria-label={r.name}
                  checked={roleNames.includes(r.name)}
                  onChange={() => setRoleNames((x) => toggle(x, r.name))}
                />{' '}
                {r.name}
              </label>
            ))}
          </div>
          <div className="checks" role="group" aria-label="עולמות תוכן">
            {(worlds.data ?? []).map((w) => (
              <label key={w.slug}>
                <input
                  type="checkbox"
                  aria-label={w.name}
                  checked={worldSlugs.includes(w.slug)}
                  onChange={() => setWorldSlugs((x) => toggle(x, w.slug))}
                />{' '}
                {w.name}
              </label>
            ))}
          </div>
          <label className="small">
            ימים להשלמה
            <input
              aria-label="ימים להשלמה"
              type="number"
              min={1}
              max={365}
              value={dueDaysText}
              onChange={(e) => setDueDaysText(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn primary sm"
            disabled={!roleNames.length || !worldSlugs.length || createAudience.isPending}
            onClick={() =>
              void createAudience
                .mutateAsync({ roleNames, worldSlugs, userIds: [], dueDays })
                .then((a) => {
                  toast(`הוקצה ל-${a.resolvedUsers} משתמשים`, 'ok');
                  onClose();
                })
                .catch(() => toast('ההקצאה נכשלה', 'warn'))
            }
          >
            הקצה לקהל
          </button>
        </fieldset>
        <fieldset>
          <legend>משתמשים בודדים</legend>
          <label className="small">
            חיפוש משתמש
            <input aria-label="חיפוש משתמש" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {q && candidates.length ? (
            <div className="results">
              {candidates.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPicked((x) => [...x, { id: p.id, displayName: p.displayName }]);
                    setQ('');
                  }}
                >
                  {p.displayName}
                </button>
              ))}
            </div>
          ) : null}
          <div className="chips">
            {picked.map((p) => (
              <span key={p.id} className="chip">
                {p.displayName}{' '}
                <button
                  type="button"
                  aria-label={`הסר ${p.displayName}`}
                  onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            className="btn sm"
            disabled={!picked.length || assign.isPending}
            onClick={() =>
              void assign
                .mutateAsync({ userIds: picked.map((p) => p.id), dueDays })
                .then((r) => {
                  toast(`הוקצה ל-${r.assigned} משתמשים`, 'ok');
                  onClose();
                })
                .catch(() => toast('ההקצאה נכשלה', 'warn'))
            }
          >
            הקצה למשתמשים
          </button>
        </fieldset>
      </div>
    </div>
  );
}
