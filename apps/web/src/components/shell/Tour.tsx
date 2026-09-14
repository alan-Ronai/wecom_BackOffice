import { useState } from 'react';
import { useUiPrefs } from '../../api/hooks/uiPrefs.js';

interface Stop {
  title: string;
  body: string;
  kbd?: string;
}

/**
 * Card 6e's first-login tour.
 *
 * Five stops, all about the keyboard, because that is what this app is for and it is the part
 * nobody discovers by clicking around. "דלג על הסיור" is offered at every stop rather than only
 * at the end — a tour you cannot leave is worse than no tour.
 *
 * Completion is stored in preferences (`tourDone`), not in `localStorage`, so it follows the user
 * to the next machine instead of greeting them again on every device.
 */
const STOPS: Stop[] = [
  {
    title: 'פותח חיפוש בכל המקורות',
    body: 'מחפש בכרטיסים, בשלבים, בשדות CRM ובמסמכי המקור — ומקפיץ ישר לשלב הרלוונטי.',
    kbd: 'Ctrl K',
  },
  {
    title: 'מצב שיחה — ניווט במקלדת',
    body: 'חצים מעבירים בין שלבים, 1-3 בוחרים תוצאה, G ואז מספר קופץ לשלב. הסיכום נבנה תוך כדי.',
    kbd: '↑ ↓ · 1-3 · G',
  },
  {
    title: 'הסיכום לתיעוד',
    body: 'כל תוצאה שבחרת נכנסת לסיכום. C מעתיק אותו ללוח, מוכן להדבקה ב-CRM.',
    kbd: 'C',
  },
  {
    title: 'הצמדה ומעבר מהיר',
    body: 'P מצמיד את המסמך הנוכחי, והפירור העליון פותח את שאר המסמכים באותה קטגוריה.',
    kbd: 'P',
  },
  {
    title: 'כל הקיצורים',
    body: 'סימן שאלה פותח את מפת הקיצורים המלאה, מכל מסך.',
    kbd: '?',
  },
];

export function Tour() {
  const { prefs, save } = useUiPrefs();
  const [i, setI] = useState(0);

  if (prefs.tourDone) return null;
  const stop = STOPS[i];
  const last = i === STOPS.length - 1;
  const finish = () => save({ tourDone: true });

  return (
    <div className="tour" role="dialog" aria-label="סיור היכרות" aria-live="polite">
      <div className="tour-head">
        <span className="eyebrow">
          שלב {i + 1} מתוך {STOPS.length}
        </span>
        {stop.kbd ? <kbd>{stop.kbd}</kbd> : null}
      </div>
      <b>{stop.title}</b>
      <p>{stop.body}</p>
      <div className="tour-foot">
        <button className="btn xs ghost" onClick={finish}>
          דלג על הסיור
        </button>
        {i > 0 ? (
          <button className="btn xs" onClick={() => setI((n) => n - 1)}>
            הקודם
          </button>
        ) : null}
        <button className="btn xs primary" onClick={() => (last ? finish() : setI((n) => n + 1))}>
          {last ? 'סיימתי' : 'הבא'}
        </button>
      </div>
    </div>
  );
}
