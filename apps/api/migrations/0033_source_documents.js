const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('source_documents', {
    id: id(pgm),
    document_id: {
      type: 'uuid',
      notNull: true,
      unique: true,
      references: 'documents',
      onDelete: 'cascade',
    },
    html: { type: 'text', notNull: true, default: '' },
    text: { type: 'text', notNull: true, default: '' },
    hash: 'text',
    current_version: { type: 'integer', notNull: true, default: 0 },
    etag: { type: 'text', notNull: true, default: pgm.func('gen_random_uuid()::text') },
    updated_by: { type: 'uuid', references: 'users' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createTable('source_document_versions', {
    id: id(pgm),
    source_document_id: {
      type: 'uuid',
      notNull: true,
      references: 'source_documents',
      onDelete: 'cascade',
    },
    version: { type: 'integer', notNull: true },
    html: { type: 'text', notNull: true },
    author_id: { type: 'uuid', references: 'users' },
    label: { type: 'text', notNull: true, default: '' },
    source_revision_id: { type: 'uuid', references: 'source_revisions', onDelete: 'set null' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('source_document_versions', 'source_document_versions_unique', {
    unique: ['source_document_id', 'version'],
  });
  pgm.createTable('assets', {
    id: id(pgm),
    mime: { type: 'text', notNull: true },
    bytes: { type: 'bytea', notNull: true },
    sha256: { type: 'text', notNull: true, unique: true },
    size: { type: 'integer', notNull: true },
    width: 'integer',
    height: 'integer',
    created_by: { type: 'uuid', references: 'users' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // Backfill: every document with a source gets a source document rendered from the latest accepted
  // revision's paragraphs (headings → <hN>, else <p>), as version 1 labelled "יובא מהמקור".
  pgm.sql(`
    with latest as (
      select distinct on (d.id) d.id as document_id, sr.id as revision_id, sr.paragraphs
      from documents d
      join source_revisions sr on sr.source_id = d.source_id and sr.accepted
      where d.source_id is not null and d.deleted_at is null
      order by d.id, sr.imported_at desc
    ), rendered as (
      select document_id, revision_id,
        string_agg(
          case when p->>'heading' is not null
            then '<h' || coalesce((p->>'level')::text, '2') || '>' || replace(replace(replace(coalesce(p->>'heading',''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</h' || coalesce((p->>'level')::text, '2') || '>'
            else '<p>' || replace(replace(replace((select string_agg(r->>'t', '') from jsonb_array_elements(p->'runs') r where coalesce((r->>'del')::text, '') = ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>'
          end, '' order by ord) as html,
        string_agg(coalesce(p->>'heading', (select string_agg(r->>'t', '') from jsonb_array_elements(p->'runs') r)), E'\\n' order by ord) as text
      from latest, jsonb_array_elements(paragraphs) with ordinality as x(p, ord)
      group by document_id, revision_id
    ), ins as (
      insert into source_documents(document_id, html, text, hash, current_version)
      select document_id, html, text, md5(html), 1 from rendered
      returning id, document_id
    )
    insert into source_document_versions(source_document_id, version, html, label, source_revision_id)
    select ins.id, 1, rendered.html, 'יובא מהמקור', rendered.revision_id
    from ins join rendered on rendered.document_id = ins.document_id
  `);
};
exports.down = (pgm) => {
  pgm.dropTable('assets');
  pgm.dropTable('source_document_versions');
  pgm.dropTable('source_documents');
};
