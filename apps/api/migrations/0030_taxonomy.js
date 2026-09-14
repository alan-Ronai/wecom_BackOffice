/**
 * W1 (wave 4): content worlds + topics as data, multi-membership, doc_type M/R/O/E/S/T/I, tags,
 * `text` kind + body_html, scripts folded into type-T documents, user_roles.category_scope → world_scope.
 * Spec: docs/superpowers/specs/2026-09-14-kb-wave4-prd-gaps-design.md §2.1
 */
const WORLDS = [
  ['sim', 'SIM / eSIM'],
  ['tech', 'תמיכה טכנית'],
  ['billing', 'חיובים'],
  ['plans', 'מסלולים'],
  ['intl', 'חו"ל ונדידה'],
  ['ops', 'טיפול בשיחה'],
];
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
const now = (pgm) => ({ type: 'timestamptz', notNull: true, default: pgm.func('now()') });
const who = () => ({
  created_by: { type: 'uuid', references: 'users' },
  updated_by: { type: 'uuid', references: 'users' },
});
const q = (s) => s.replace(/'/g, "''");

/** 0007's function plus tags at weight B. */
const SEARCH_FN_WITH_TAGS = `create or replace function documents_search_vector_update() returns trigger as $$ begin new.search_vector := setweight(to_tsvector('simple', coalesce(new.title,'')), 'A') || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B') || setweight(to_tsvector('simple', coalesce(array_to_string(new.tags, ' '),'')), 'B') || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'); return new; end $$ language plpgsql`;
/**
 * Verbatim copy of **0027**'s definition, which is what is live when this file runs — not
 * 0007's. Restoring 0007's would drop the `ts_delete(…, kb_stopwords())` from the index side
 * while 0027's `kb_tsquery`/`kb_tsquery_prefix` keep stripping the same stopwords at query
 * time: the two halves disagree and a query containing a Hebrew stopword stops matching. That
 * is precisely the regression 0027 exists to prevent, and rolling back through 0035…0030 is
 * exactly what a bad wave-4 deploy does.
 */
const SEARCH_FN_ORIGINAL = `
  create or replace function documents_search_vector_update() returns trigger as $$
  begin
    new.search_vector := ts_delete(
      setweight(to_tsvector('simple', coalesce(new.title,'')), 'A')
      || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B')
      || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'),
      kb_stopwords()
    );
    return new;
  end
  $$ language plpgsql;
`;
const ISO = (col) => `to_char(${col} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

exports.up = (pgm) => {
  // 1. worlds (seeded from the six legacy categories, same order as the sidebar)
  pgm.createTable('worlds', {
    id: id(pgm),
    slug: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true, default: '' },
    position: { type: 'integer', notNull: true, default: 0 },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: now(pgm),
    updated_at: now(pgm),
    ...who(),
  });
  WORLDS.forEach(([slug, name], i) =>
    pgm.sql(`insert into worlds(slug, name, position) values ('${slug}', '${q(name)}', ${i})`),
  );

  // 2. topics
  pgm.createTable('topics', {
    id: id(pgm),
    world_id: { type: 'uuid', notNull: true, references: 'worlds', onDelete: 'cascade' },
    slug: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true, default: '' },
    position: { type: 'integer', notNull: true, default: 0 },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: now(pgm),
    updated_at: now(pgm),
    ...who(),
  });
  pgm.addConstraint('topics', 'topics_world_slug_unique', { unique: ['world_id', 'slug'] });

  // 3. documents.category becomes a reference to worlds.slug (still the primary world)
  pgm.dropConstraint('documents', 'documents_category_check');
  pgm.sql(
    'alter table documents add constraint documents_category_fkey foreign key (category) references worlds(slug) on update cascade',
  );

  // 4. memberships
  pgm.createTable(
    'document_worlds',
    {
      document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
      world_slug: { type: 'text', notNull: true },
    },
    { constraints: { primaryKey: ['document_id', 'world_slug'] } },
  );
  pgm.sql(
    'alter table document_worlds add constraint document_worlds_world_slug_fkey foreign key (world_slug) references worlds(slug) on delete cascade on update cascade',
  );
  pgm.createIndex('document_worlds', 'world_slug');
  pgm.createTable(
    'document_topics',
    {
      document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
      topic_id: { type: 'uuid', notNull: true, references: 'topics', onDelete: 'cascade' },
    },
    { constraints: { primaryKey: ['document_id', 'topic_id'] } },
  );
  pgm.createIndex('document_topics', 'topic_id');
  pgm.sql('insert into document_worlds(document_id, world_slug) select id, category from documents');

  // 5. legacy topic_id → one topic per id (the card row, slug 'topic-N', names it), then membership
  pgm.sql(`insert into topics(world_id, slug, name, description, position)
    select w.id, 'topic-' || x.topic_id, x.title, x.description, x.topic_id
    from (select distinct on (topic_id) topic_id, category, title, description
            from documents where topic_id is not null
           order by topic_id, (slug like 'topic-%') desc, created_at) x
    join worlds w on w.slug = x.category
    on conflict do nothing`);
  // `topics` is unique on (world_id, slug), so matching by slug alone would attach a document
  // to a same-named topic in another world on a database whose legacy `topic_id` was
  // per-category. The shipped dataset has no id spanning two categories; scope the join anyway.
  pgm.sql(`insert into document_topics(document_id, topic_id)
    select d.id, t.id from documents d
      join worlds w on w.slug = d.category
      join topics t on t.world_id = w.id and t.slug = 'topic-' || d.topic_id
    where d.topic_id is not null on conflict do nothing`);
  pgm.dropColumns('documents', ['topic_id']);

  // 6. doc_type (code prefix wins; then the spec rule)
  pgm.addColumns('documents', { doc_type: { type: 'text' } });
  pgm.sql(`update documents d set doc_type = case
      when d.code ~ '^[MROESTI]-' then left(d.code, 1)
      when d.kind = 'retention' then 'R'
      when exists (select 1 from phases p where p.document_id = d.id) then 'R'
      else 'I' end`);
  pgm.alterColumn('documents', 'doc_type', { notNull: true, default: 'R' });
  pgm.addConstraint('documents', 'documents_doc_type_check', {
    check: "doc_type in ('M','R','O','E','S','T','I')",
  });
  pgm.createIndex('documents', 'doc_type');

  // 7. tags + search vector
  pgm.addColumns('documents', { tags: { type: 'text[]', notNull: true, default: '{}' } });
  pgm.createIndex('documents', 'tags', { method: 'gin', name: 'documents_tags_gin' });
  pgm.sql('drop trigger if exists documents_search_vector on documents');
  pgm.sql(SEARCH_FN_WITH_TAGS);
  pgm.sql(
    'create trigger documents_search_vector before insert or update of title, description, search_text, tags on documents for each row execute function documents_search_vector_update()',
  );

  // 8. text kind + body
  pgm.addColumns('documents', { body_html: { type: 'text' } });
  pgm.addConstraint('documents', 'documents_kind_check', {
    check: "kind in ('steps','retention','text')",
  });

  // 9. scripts → type-T documents; script_refs → document_links
  pgm.sql(`insert into documents(id, slug, title, description, category, wave, priority, kind, status, doc_type, tags, body_html,
                                 current_version, created_by, updated_by, created_at, updated_at, deleted_at, deleted_by)
    select s.id, 'script-' || left(replace(s.id::text, '-', ''), 8), s.title, '',
           coalesce((select d.category from script_refs r join documents d on d.id = r.document_id
                      where r.script_id = s.id group by d.category order by count(*) desc, d.category limit 1), 'ops'),
           3, 'm', 'text', 'published', 'T', s.tags,
           '<p>' || replace(replace(replace(replace(s.text, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\\n', '<br>') || '</p>',
           1, s.created_by, s.updated_by, s.created_at, s.updated_at, s.deleted_at, s.deleted_by
    from scripts s`);
  pgm.sql(`insert into document_worlds(document_id, world_slug)
    select d.id, d.category from documents d where d.doc_type = 'T' and d.kind = 'text' on conflict do nothing`);
  pgm.sql(`insert into document_versions(document_id, version, snapshot, author_id, label, kind, created_at)
    select d.id, 1, jsonb_build_object(
        'id', d.id, 'slug', d.slug, 'title', d.title, 'description', '', 'category', d.category,
        'wave', 3, 'priority', 'm', 'kind', 'text', 'status', 'published', 'currentVersion', 1,
        'phases', '[]'::jsonb, 'related', '[]'::jsonb, 'docType', 'T', 'tags', to_jsonb(d.tags),
        'bodyHtml', d.body_html, 'createdAt', ${ISO('d.created_at')}, 'updatedAt', ${ISO('d.updated_at')}),
      d.updated_by, 'הומר מתסריט', 'system', d.updated_at
    from documents d where d.doc_type = 'T' and d.kind = 'text' and d.slug like 'script-%'`);
  pgm.sql(`insert into document_links(from_document_id, from_step_key, to_document_id, type, origin)
    select r.document_id, r.step_key, r.script_id, 'link', 'explicit' from script_refs r`);
  pgm.dropTable('script_refs');
  pgm.dropTable('scripts');

  // 10. RBAC scopes are world slugs now
  pgm.renameColumn('user_roles', 'category_scope', 'world_scope');
};

exports.down = (pgm) => {
  pgm.renameColumn('user_roles', 'world_scope', 'category_scope');

  // scripts back out of documents (same shapes as 0003)
  pgm.createTable('scripts', {
    id: id(pgm),
    title: { type: 'text', notNull: true },
    text: { type: 'text', notNull: true },
    tags: { type: 'text[]', notNull: true, default: '{}' },
    created_at: now(pgm),
    updated_at: now(pgm),
    ...who(),
    deleted_at: 'timestamptz',
    deleted_by: { type: 'uuid', references: 'users' },
  });
  pgm.createTable(
    'script_refs',
    {
      script_id: { type: 'uuid', notNull: true, references: 'scripts', onDelete: 'cascade' },
      document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
      step_key: 'text',
    },
    { constraints: { primaryKey: ['script_id', 'document_id'] } },
  );
  // 0028 created these; without them a rollback-then-forward leaves the tables unindexed.
  pgm.createIndex('script_refs', 'script_id', { ifNotExists: true });
  pgm.createIndex('script_refs', 'document_id', { ifNotExists: true });
  pgm.sql(`insert into scripts(id, title, text, tags, created_at, updated_at, created_by, updated_by, deleted_at, deleted_by)
    select d.id, d.title,
           replace(replace(replace(replace(replace(regexp_replace(coalesce(d.body_html, ''), '^<p>|</p>$', '', 'g'),
             '<br>', E'\\n'), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&amp;', '&'),
           d.tags, d.created_at, d.updated_at, d.created_by, d.updated_by, d.deleted_at, d.deleted_by
    from documents d where d.doc_type = 'T' and d.kind = 'text' and d.slug like 'script-%'`);
  pgm.sql(`insert into script_refs(script_id, document_id, step_key)
    select distinct on (l.to_document_id, l.from_document_id) l.to_document_id, l.from_document_id, l.from_step_key
    from document_links l join scripts s on s.id = l.to_document_id
    where l.type = 'link' and l.origin = 'explicit' on conflict do nothing`);
  pgm.sql('delete from documents where id in (select id from scripts)');

  pgm.dropConstraint('documents', 'documents_kind_check');
  pgm.dropColumns('documents', ['body_html']);
  pgm.sql('drop trigger if exists documents_search_vector on documents');
  pgm.sql(SEARCH_FN_ORIGINAL);
  pgm.sql(
    'create trigger documents_search_vector before insert or update of title, description, search_text on documents for each row execute function documents_search_vector_update()',
  );
  pgm.dropIndex('documents', 'tags', { name: 'documents_tags_gin' });
  pgm.dropColumns('documents', ['tags']);
  pgm.dropIndex('documents', 'doc_type');
  pgm.dropConstraint('documents', 'documents_doc_type_check');
  pgm.dropColumns('documents', ['doc_type']);

  pgm.addColumns('documents', { topic_id: 'integer' });
  pgm.sql(`update documents d set topic_id = substring(t.slug from 'topic-(\\d+)')::int
    from document_topics dt join topics t on t.id = dt.topic_id
    where dt.document_id = d.id and t.slug ~ '^topic-\\d+$'`);
  pgm.dropTable('document_topics');
  pgm.dropTable('document_worlds');
  pgm.sql('alter table documents drop constraint documents_category_fkey');
  pgm.addConstraint('documents', 'documents_category_check', {
    check: "category in ('sim','tech','billing','plans','intl','ops')",
  });
  pgm.dropTable('topics');
  pgm.dropTable('worlds');
};
