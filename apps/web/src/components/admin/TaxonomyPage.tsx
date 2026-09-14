import { useState } from 'react';
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
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';

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
  const topics = useTopics(world ?? undefined);
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
              const slug = await modal.prompt('מזהה (אותיות לטיניות קטנות ומקפים)', 'slug');
              if (!slug?.trim()) return;
              await createWorld.mutateAsync({
                slug: slug.trim(),
                name: name.trim(),
                description: '',
                active: true,
              });
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
            <li key={w.id} className={(w.slug === world ? 'on' : '') + (w.active ? '' : ' inactive')}>
              <button type="button" className="link" onClick={() => setSelected(w.slug)}>
                {w.name}
              </button>
              <small>
                {w.topicCount} נושאים · {w.itemCount} פריטים{w.active ? '' : ' · מושבת'}
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
                      const name = await modal.prompt('שם חדש', w.name);
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
                        } catch {
                          if (await modal.confirm('בעולם התוכן יש פריטים. להשבית בכל זאת?', ''))
                            await deactivateWorld.mutateAsync({ slug: w.slug, force: true });
                        }
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
              <li key={t.id}>
                <b>{t.name}</b>{' '}
                <small>
                  {t.slug} · {t.itemCount} פריטים
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
                        const name = await modal.prompt('שם חדש', t.name);
                        if (name?.trim()) patchTopic.mutate({ id: t.id, name: name.trim() });
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (await modal.confirm(`להשבית את הנושא "${t.name}"?`, ''))
                          deactivateTopic.mutate(t.id);
                      }}
                    >
                      השבת
                    </button>
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
                await createTopic.mutateAsync({
                  worldSlug: world,
                  slug: newTopic.slug.trim(),
                  name: newTopic.name.trim(),
                  description: '',
                  active: true,
                });
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
