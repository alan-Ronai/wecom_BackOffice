import type { Template } from '../../api/hooks/collab.js';
import { useTemplates } from '../../api/hooks/collab.js';
import { cat } from '../../lib/constants.js';
import { LoadError } from '../ui/index.js';

const stepCount = (t: Template) => t.phases.reduce((n, p) => n + p.steps.length, 0);

/**
 * Card 6c's "התחל מתבנית".
 *
 * Offered when a new knowledge item is still empty, because a template *replaces* the structure —
 * applying it over work already typed would silently discard it. "התחל ריק" is a first-class
 * choice rather than a dismissal, so nobody has to guess how to decline.
 */
export function TemplateGallery({ onPick, onBlank }: { onPick: (t: Template) => void; onBlank: () => void }) {
  const templates = useTemplates();

  return (
    <section className="tpl-gallery" aria-label="התחל מתבנית">
      <div className="lib-head">
        <div>
          <h1>
            התחל מתבנית<span>{templates.data?.length ?? 0} תבניות</span>
          </h1>
          <p>תבנית קובעת שלבים, תוצאות והרשאות התחלתיות. אפשר לשנות הכול אחר כך.</p>
        </div>
        <button className="btn" onClick={onBlank}>
          התחל ריק
        </button>
      </div>

      {templates.isError ? <LoadError what="תבניות" error={templates.error} /> : null}

      <div className="grid">
        {(templates.data ?? []).map((t) => (
          <button
            className="tcard tpl"
            key={t.id}
            aria-label={`התחל מתבנית ${t.name}`}
            onClick={() => onPick(t)}
          >
            <div className="chips">
              <span className="chip chip-blue">{t.kind === 'retention' ? 'שימור' : 'שלבים'}</span>
              {t.category ? <span className="chip chip-gray">{cat(t.category).label}</span> : null}
              {t.builtIn ? <span className="chip chip-green">מובנה</span> : null}
            </div>
            <div className="title">{t.name}</div>
            <div className="desc">{t.description}</div>
            <div className="meta">
              <span>{stepCount(t)} שלבים</span>
              <span>·</span>
              <span>{t.phases.length} קבוצות</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
