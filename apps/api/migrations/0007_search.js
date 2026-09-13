exports.up = (pgm) => {
  pgm.addColumns('documents', { search_text: { type: 'text', notNull: true, default: '' } });
  pgm.sql(`create or replace function documents_search_vector_update() returns trigger as $$ begin new.search_vector := setweight(to_tsvector('simple', coalesce(new.title,'')), 'A') || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B') || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'); return new; end $$ language plpgsql`);
  pgm.sql('create trigger documents_search_vector before insert or update of title, description, search_text on documents for each row execute function documents_search_vector_update()');
  pgm.createIndex('documents', 'title gin_trgm_ops', { method: 'gin', name: 'documents_title_trgm' });
};
exports.down = (pgm) => { pgm.dropIndex('documents', 'title', { name: 'documents_title_trgm' }); pgm.sql('drop trigger if exists documents_search_vector on documents'); pgm.sql('drop function if exists documents_search_vector_update'); pgm.dropColumns('documents', ['search_text']); };
