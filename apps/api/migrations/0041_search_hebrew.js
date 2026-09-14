/**
 * Search quality: Hebrew stopword handling in the `search_vector` trigger.
 *
 * `documents_search_vector_update()` (migration 0007) builds `search_vector` with
 * PostgreSQL's `simple` text search config, which has no stemming and — critically for
 * Hebrew — no stopword list, so a common word like "של" or "את" matches (and dilutes the
 * rank of) almost every document. There is no built-in `hebrew` text search config in a
 * stock Postgres/pgvector image (it would need a dictionary file baked into the image),
 * so instead this keeps a small, editable stopword table and strips those lexemes out of
 * the vector with `ts_delete()` after tokenising — no filesystem dependency, works on any
 * Postgres the app already targets.
 */
const STOPWORDS = [
  // pronouns / copula
  'אני','אתה','את','אתם','אתן','הוא','היא','הם','הן','אנחנו','זה','זאת','זו','אלה','אלו',
  // prepositions / conjunctions
  'של','את','על','עם','אל','מן','מ','ל','ב','כ','ו','ש','אבל','או','אם','כי','גם','רק','עד','בין','כמו','כאשר',
  // misc function words
  'יש','אין','לא','כן','מה','מי','איך','למה','מתי','איפה','כל','כלשהו','זהו','הזה','הזאת','אלו',
];

exports.up = (pgm) => {
  pgm.createTable('search_hebrew_stopwords', {
    word: { type: 'text', primaryKey: true },
  });
  const values = [...new Set(STOPWORDS)].map((w) => `('${w}')`).join(',');
  pgm.sql(`insert into search_hebrew_stopwords(word) values ${values}`);

  pgm.sql(`
    create or replace function documents_search_vector_update() returns trigger as $$
    declare
      stop text[];
    begin
      select coalesce(array_agg(word), '{}') into stop from search_hebrew_stopwords;
      new.search_vector := ts_delete(
        setweight(to_tsvector('simple', coalesce(new.title,'')), 'A')
        || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B')
        || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'),
        stop
      );
      return new;
    end
    $$ language plpgsql;
  `);
  // Re-fire the trigger for every existing row so already-indexed documents drop stopwords too.
  pgm.sql('update documents set title = title');
};

exports.down = (pgm) => {
  pgm.sql(
    `create or replace function documents_search_vector_update() returns trigger as $$ begin new.search_vector := setweight(to_tsvector('simple', coalesce(new.title,'')), 'A') || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B') || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'); return new; end $$ language plpgsql`,
  );
  pgm.sql('update documents set title = title');
  pgm.dropTable('search_hebrew_stopwords');
};
