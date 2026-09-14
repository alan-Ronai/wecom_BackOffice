import { Link } from 'react-router-dom';

/**
 * Shown instead of the article when the API answers 404 `NOT_PUBLISHED` (§5.5): the item exists,
 * the reader simply may not see it. It must not read as "deleted" or as a broken link, so it says
 * what happened and offers the way back.
 *
 * The heading is a real `<h2>` rather than `<Empty>`'s `<b>` so the page announces as a heading to
 * a screen reader — this is the whole page, not an empty slot inside one.
 */
export function UnavailablePage() {
  return (
    <div className="page center">
      <div className="empty">
        <h2>פריט זה אינו זמין כרגע</h2>
        <p>הפריט קיים אך אינו מפורסם, אינו בתוקף או הועבר לארכיון.</p>
        <Link className="btn primary" to="/library">
          חזרה לספרייה
        </Link>
      </div>
    </div>
  );
}
