import { useState } from 'react';
import { ApiError } from '../../api/unwrap.js';
import { useCan } from '../../api/hooks/me.js';
import {
  useCreateTopic,
  useCreateWorld,
  useDeactivateTopic,
  useDeactivateWorld,
  usePatchTopic,
  usePatchWorld,
  useReorderTopics,
  useReorderWorlds,
  useTopics,
  useWorlds,
} from '../../api/hooks/taxonomy.js';
import { useDragOrder } from '../../lib/useDragOrder.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';
import { items as nItems, topics as nTopics } from '../../lib/count.js';

/**
 * The contract's slug pattern, checked before the request. The dialog above asks for a Hebrew
 * *name*, so typing a Hebrew slug is the obvious mistake — and it used to produce a 400, an
 * unhandled rejection and no message at all.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

const move = (ids: string[], i: number, dir: -1 | 1): string[] => {
  const j = i + dir;
  if (j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};

/** PRD §2: worlds without limit, topics under each; admins add, rename, order and deactivate (never delete). */
export function TaxonomyPage() {
  const can = useCan();
  const mayEdit = can('taxonomy.manage');
  const worlds = useWorlds(true);
  const [selected, setSelected] = useState<string | null>(null);
  const world = selected ?? worlds.data?.[0]?.slug ?? null;
  const topics = useTopics(world ?? undefined, true);
  const createWorld = useCreateWorld();
  const patchWorld = usePatchWorld();
  const deactivateWorld = useDeactivateWorld();
  const reorderWorlds = useReorderWorlds();
  const createTopic = useCreateTopic();
  const patchTopic = usePatchTopic();
  const deactivateTopic = useDeactivateTopic();
  const reorderTopics = useReorderTopics();
  const modal = useModal();
  const toast = useToast();
  const [newTopic, setNewTopic] = useState({ name: '', slug: '' });
  const wl = worlds.data ?? [];
  const tl = topics.data ?? [];

  /**
   * D-M4: drag ordering *alongside* the ↑/↓ buttons, not instead of them. The buttons are the
   * keyboard path and stay exactly as they were; this is the pointer path for the twenty-item
   * case they make tedious. Both commit through the same `reorder*` mutation.
   */
  const worldDrag = useDragOrder(
    wl.map((w) => w.id),
    (ids) => reorderWorlds.mutate(ids),
    mayEdit,
  );
  const topicDrag = useDragOrder(
    tl.map((t) => t.id),
    (ids) => reorderTopics.mutate({ worldSlug: world!, ids }),
    mayEdit && !!world,
  );

  return (
    <>
      {worlds.isError ? <LoadError what="עולמות תוכן" error={worlds.error} /> : null}
      <div className="lib-head">
        <div>
          <h1>
            עולמות תוכן ונושאים<span>{wl.length} עולמות</span>
          </h1>
          <p>ההיררכיה שהנציג רואה: עולם תוכן → נושא → פריטי ידע. השבתה מסתירה בלבד; היסטוריה נשמרת.</p>
        </div>
        {mayEdit ? (
          <button
            className="btn primary sm"
            onClick={async () => {
              const name = await modal.prompt('עולם תוכן חדש', 'שם');
              if (!name?.trim()) return;
              const slug = await modal.prompt('עולם תוכן חדש', 'מזהה (אותיות לטיניות קטנות ומקפים)');
              if (!slug?.trim()) return;
              if (!SLUG_RE.test(slug.trim())) {
                toast('המזהה חייב להיות אותיות לטיניות קטנות, ספרות ומקפים', 'warn');
                return;
              }
              try {
                await createWorld.mutateAsync({
                  slug: slug.trim(),
                  name: name.trim(),
                  description: '',
                  active: true,
                });
              } catch {
                toast('יצירת עולם התוכן נכשלה', 'warn');
                return;
              }
              toast('עולם התוכן נוצר', 'ok');
            }}
          >
            ✚ עולם תוכן
          </button>
        ) : null}
      </div>
      <div className="taxonomy-admin">
        <ul className="world-list" data-testid="worlds-list">
          {wl.map((w, i) => (
            <li
              key={w.id}
              className={(w.slug === world ? 'on' : '') + (w.active ? '' : ' inactive')}
              title={mayEdit ? 'גרור לשינוי הסדר' : undefined}
              {...worldDrag.rowProps(i)}
            >
              <button type="button" className="link" onClick={() => setSelected(w.slug)}>
                {w.name}
              </button>
              <small>
                {nTopics(w.topicCount)} · {nItems(w.itemCount)}
                {w.active ? '' : ' · מושבת'}
              </small>
              {mayEdit ? (
                <span className="row-actions">
                  <button
                    type="button"
                    aria-label="למעלה"
                    disabled={i === 0}
                    onClick={() =>
                      reorderWorlds.mutate(
                        move(
                          wl.map((x) => x.id),
                          i,
                          -1,
                        ),
                      )
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="למטה"
                    disabled={i === wl.length - 1}
                    onClick={() =>
                      reorderWorlds.mutate(
                        move(
                          wl.map((x) => x.id),
                          i,
                          1,
                        ),
                      )
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`שנה שם · ${w.name}`}
                    onClick={async () => {
                      // (title, label, value) — passing the current name as the *label* left the
                      // field empty and turned the name into the caption.
                      const name = await modal.prompt('שם חדש', 'שם', w.name);
                      if (name?.trim()) patchWorld.mutate({ slug: w.slug, name: name.trim() });
                    }}
                  >
                    ✎
                  </button>
                  {w.active ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!(await modal.confirm(`להשבית את "${w.name}"?`, ''))) return;
                        try {
                          await deactivateWorld.mutateAsync({ slug: w.slug });
                        } catch (err) {
                          /* Only a 409 WORLD_IN_USE means "it still has items in it". A 403, a 500
                             or a dropped connection used to surface as that same confident claim
                             and then re-issue the call with `force: true` — forcing past an error
                             nobody has identified. */
                          if (!(
                            err instanceof ApiError &&
                            err.status === 409 &&
                            err.code === 'WORLD_IN_USE'
                          )) {
                            toast('השבתת עולם התוכן נכשלה', 'warn');
                            return;
                          }
                          if (!(await modal.confirm('בעולם התוכן יש פריטים. להשבית בכל זאת?', ''))) return;
                          try {
                            await deactivateWorld.mutateAsync({ slug: w.slug, force: true });
                          } catch {
                            toast('ההשבתה נכשלה', 'warn');
                            return;
                          }
                        }
                        toast('עולם התוכן הושבת', 'ok');
                      }}
                    >
                      השבת
                    </button>
                  ) : (
                    <button type="button" onClick={() => patchWorld.mutate({ slug: w.slug, active: true })}>
                      הפעל
                    </button>
                  )}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="topics-pane">
          <h2>נושאים{world ? ` · ${wl.find((w) => w.slug === world)?.name ?? world}` : ''}</h2>
          {topics.isError ? <LoadError what="נושאים" error={topics.error} /> : null}
          <ul data-testid="topics-list">
            {tl.map((t, i) => (
              <li
                key={t.id}
                className={t.active ? '' : 'inactive'}
                title={mayEdit ? 'גרור לשינוי הסדר' : undefined}
                {...topicDrag.rowProps(i)}
              >
                <b>{t.name}</b>{' '}
                <small>
                  {t.slug} · {nItems(t.itemCount)}
                  {t.active ? '' : ' · מושבת'}
                </small>
                {mayEdit ? (
                  <span className="row-actions">
                    <button
                      type="button"
                      aria-label="למעלה"
                      disabled={i === 0}
                      onClick={() =>
                        reorderTopics.mutate({
                          worldSlug: world!,
                          ids: move(
                            tl.map((x) => x.id),
                            i,
                            -1,
                          ),
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="למטה"
                      disabled={i === tl.length - 1}
                      onClick={() =>
                        reorderTopics.mutate({
                          worldSlug: world!,
                          ids: move(
                            tl.map((x) => x.id),
                            i,
                            1,
                          ),
                        })
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`שנה שם · ${t.name}`}
                      onClick={async () => {
                        const name = await modal.prompt('שם חדש', 'שם', t.name);
                        if (name?.trim()) patchTopic.mutate({ id: t.id, name: name.trim() });
                      }}
                    >
                      ✎
                    </button>
                    {/* `PATCH /topics/:id` takes `active`, so a topic can come back the same way
                        a world can — offering only "השבת" made deactivation one-way. */}
                    {t.active ? (
                      <button
                        type="button"
                        onClick={async () => {
                          if (await modal.confirm(`להשבית את הנושא "${t.name}"?`, ''))
                            deactivateTopic.mutate(t.id);
                        }}
                      >
                        השבת
                      </button>
                    ) : (
                      <button type="button" onClick={() => patchTopic.mutate({ id: t.id, active: true })}>
                        הפעל
                      </button>
                    )}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {mayEdit && world ? (
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newTopic.name.trim() || !newTopic.slug.trim()) return;
                if (!SLUG_RE.test(newTopic.slug.trim())) {
                  toast('המזהה חייב להיות אותיות לטיניות קטנות, ספרות ומקפים', 'warn');
                  return;
                }
                try {
                  await createTopic.mutateAsync({
                    worldSlug: world,
                    slug: newTopic.slug.trim(),
                    name: newTopic.name.trim(),
                    description: '',
                    active: true,
                  });
                } catch {
                  toast('יצירת הנושא נכשלה', 'warn');
                  return;
                }
                setNewTopic({ name: '', slug: '' });
                toast('הנושא נוצר', 'ok');
              }}
            >
              <input
                aria-label="שם נושא חדש"
                placeholder="שם נושא"
                value={newTopic.name}
                onChange={(e) => setNewTopic({ ...newTopic, name: e.target.value })}
              />
              <input
                aria-label="מזהה נושא חדש"
                placeholder="slug"
                value={newTopic.slug}
                onChange={(e) => setNewTopic({ ...newTopic, slug: e.target.value })}
              />
              <button className="btn sm" type="submit">
                ✚ נושא
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </>
  );
}
