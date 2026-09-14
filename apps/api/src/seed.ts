import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { DocumentSchema, type Document } from '@wecom/shared';
import { loadConfig } from './config.js';
import { withTransaction, type Tx } from './lib/sql.js';
import { getDocument, recomputeDerived, saveStructure } from './modules/documents/repo.js';
import { textToHtml } from './modules/scripts/html.js';

export interface SeedCounts {
  documents: number;
  cards: number;
  topics: number;
  blocks: number;
  fields: number;
  scripts: number;
  versions: number;
  notes: number;
}

type SeedDocument = Document & { _author: string | null; _topicId: number | null };
interface SeedCard {
  topicId: number;
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  wave: number;
  priority: string;
}
interface SeedBlock {
  id: string;
  slug: string;
  title: string;
  kind: string;
  description?: string;
  script?: string;
  actions: { id: string; text: string }[];
  outcomes: { kind: string; text: string; goto?: string }[];
  currentVersion: number;
  updatedAt: string;
  _author: string | null;
}
interface SeedField {
  name: string;
  status: string;
  renamedTo?: string;
  path: string;
  updatedAt: string;
}
interface SeedScript {
  id: string;
  title: string;
  text: string;
  tags: string[];
  updatedAt: string;
  _usedIn: string[];
}
interface SeedVersion {
  slug: string;
  version: number;
  label: string;
  kind: string;
  author: string | null;
  at: string;
  snapshot: unknown;
}
interface SeedNote {
  slug: string;
  stepKey: string | null;
  author: string;
  text: string;
  likes: number;
  at: string;
}

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../seed/${name}`, import.meta.url), 'utf8')) as T;

/** One local user per legacy author name, so version and note attribution survives the import. */
class Authors {
  private cache = new Map<string, string>();
  constructor(private tx: Tx) {}
  async id(name: string | null): Promise<string | null> {
    if (!name) return null;
    const hit = this.cache.get(name);
    if (hit) return hit;
    const r = await this.tx.query(
      `insert into users(subject, source, email, display_name, initials) values ($1,'local',null,$2,$3)
       on conflict (subject, source) do update set display_name=excluded.display_name returning id`,
      ['seed:' + name, name, name.slice(0, 1)],
    );
    const id = r.rows[0].id as string;
    this.cache.set(name, id);
    return id;
  }
  /** Placeholder accounts that carry the imported like counts (no real person behind them). */
  async likeUser(n: number): Promise<string> {
    return (await this.id('משתמש הדגמה ' + n))!;
  }
}

/** Legacy codes carry the PRD letter (M-00, R-01, O-02, E-01); otherwise the spec rule. */
const docTypeFor = (d: { code?: string; kind: string; phases: unknown[] }): string =>
  d.code && /^[MROES]-/.test(d.code) ? d.code[0]! : d.kind === 'retention' || d.phases.length ? 'R' : 'I';

/** W1: every item is a member of its primary world, plus its legacy topic when it had one. */
const membership = async (tx: Tx, documentId: string, world: string, topicSlug: string | null) => {
  await tx.query(
    'insert into document_worlds(document_id, world_slug) values ($1,$2) on conflict do nothing',
    [documentId, world],
  );
  if (topicSlug)
    await tx.query(
      'insert into document_topics(document_id, topic_id) select $1, t.id from topics t where t.slug=$2 on conflict do nothing',
      [documentId, topicSlug],
    );
};

export async function runSeed(pool: pg.Pool): Promise<SeedCounts> {
  const documents = read<SeedDocument[]>('documents.json');
  const cards = read<SeedCard[]>('cards.json');
  const blocks = read<SeedBlock[]>('blocks.json');
  const fields = read<SeedField[]>('fields.json');
  const scripts = read<SeedScript[]>('scripts.json');
  const versions = read<SeedVersion[]>('versions.json');
  const notes = read<SeedNote[]>('notes.json');

  return withTransaction(pool, async (tx) => {
    const counts: SeedCounts = {
      documents: 0,
      cards: 0,
      topics: 0,
      blocks: 0,
      fields: 0,
      scripts: 0,
      versions: 0,
      notes: 0,
    };
    const authors = new Authors(tx);

    // 1. shared blocks (documents embed them, so they must exist before structures are saved)
    for (const b of blocks) {
      const authorId = await authors.id(b._author);
      const ins = await tx.query(
        `insert into blocks(id, slug, title, kind, description, script, current_version, created_by, updated_by, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) on conflict (slug) do nothing returning id`,
        [
          b.id,
          b.slug,
          b.title,
          b.kind,
          b.description ?? null,
          b.script ?? null,
          b.currentVersion,
          authorId,
          b.updatedAt,
        ],
      );
      if (!ins.rowCount) continue;
      counts.blocks++;
      for (const [i, a] of b.actions.entries())
        await tx.query('insert into block_actions(block_id, position, text) values ($1,$2,$3)', [
          b.id,
          i,
          a.text,
        ]);
      for (const [i, o] of b.outcomes.entries())
        await tx.query(
          'insert into block_outcomes(block_id, position, kind, text, goto_step_key) values ($1,$2,$3,$4,$5)',
          [b.id, i, o.kind, o.text, o.goto ?? null],
        );
      const snapshot = {
        id: b.id,
        slug: b.slug,
        title: b.title,
        kind: b.kind,
        description: b.description,
        script: b.script,
        actions: b.actions,
        outcomes: b.outcomes,
        currentVersion: b.currentVersion,
        updatedAt: b.updatedAt,
      };
      await tx.query(
        'insert into block_versions(block_id, version, snapshot, author_id, label) values ($1,$2,$3,$4,$5)',
        [b.id, b.currentVersion, JSON.stringify(snapshot), authorId, 'ייבוא מהספרייה הסטטית'],
      );
    }

    // 2. CRM fields (detectFieldRefs needs them while structures are saved)
    for (const f of fields) {
      const ins = await tx.query(
        `insert into crm_fields(name, status, renamed_to, path, updated_at) values ($1,$2,$3,$4,$5)
         on conflict (name) do nothing returning name`,
        [f.name, f.status, f.renamedTo ?? null, f.path, f.updatedAt],
      );
      if (ins.rowCount) counts.fields++;
    }

    // 2b. topics: the card row names the topic; a topic with no card is named by its document
    for (const c of cards) {
      const ins = await tx.query(
        `insert into topics(world_id, slug, name, description, position)
         select w.id, $1, $2, $3, $4 from worlds w where w.slug = $5
           and not exists (select 1 from topics t where t.slug = $1) returning id`,
        [`topic-${c.topicId}`, c.title, c.description, c.topicId, c.category],
      );
      if (ins.rowCount) counts.topics++;
    }
    for (const d of documents) {
      if (d._topicId == null) continue;
      const ins = await tx.query(
        `insert into topics(world_id, slug, name, description, position)
         select w.id, $1, $2, $3, $4 from worlds w where w.slug = $5
           and not exists (select 1 from topics t where t.slug = $1) returning id`,
        [`topic-${d._topicId}`, d.title, d.description, d._topicId, d.category],
      );
      if (ins.rowCount) counts.topics++;
    }

    // 3. document rows first, structures second: links between documents need every row to exist
    const fresh: SeedDocument[] = [];
    for (const d of documents) {
      const authorId = await authors.id(d._author);
      const ins = await tx.query(
        `insert into documents(id, slug, code, title, description, category, wave, priority, kind, status,
           current_version, source_ref, doc_type, created_by, updated_by, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',0,$10,$11,$12,$12,$13,$13)
         on conflict (slug) do nothing returning id`,
        [
          d.id,
          d.slug,
          d.code ?? null,
          d.title,
          d.description,
          d.category,
          d.wave,
          d.priority,
          d.kind,
          d.sourceRef ?? null,
          docTypeFor(d),
          authorId,
          d.updatedAt,
        ],
      );
      if (ins.rowCount) {
        counts.documents++;
        fresh.push(d);
        await membership(tx, d.id, d.category, d._topicId == null ? null : `topic-${d._topicId}`);
      }
    }

    // 4. card-only topics: real documents with no phases (see convert-legacy.mjs for the decision)
    for (const c of cards) {
      const ins = await tx.query(
        `insert into documents(id, slug, title, description, category, wave, priority, kind, status, current_version, doc_type)
         values ($1,$2,$3,$4,$5,$6,$7,'steps','draft',0,'I') on conflict (slug) do nothing returning id`,
        [c.id, c.slug, c.title, c.description, c.category, c.wave, c.priority],
      );
      if (!ins.rowCount) continue;
      counts.cards++;
      await membership(tx, c.id, c.category, `topic-${c.topicId}`);
    }

    // 5. structures + the final published state
    for (const d of fresh) {
      const authorId = await authors.id(d._author);
      if (d.phases.length) await saveStructure(tx, d.id, { phases: d.phases, related: d.related }, authorId!);
      await tx.query(
        `update documents set status=$2, current_version=$3, related=$4, updated_by=$5, updated_at=$6 where id=$1`,
        [d.id, d.status, d.currentVersion, JSON.stringify(d.related), authorId, d.updatedAt],
      );
    }

    // 6. version history: the flagship document's real history, one import row for the rest
    const versionsBySlug = new Map<string, SeedVersion[]>();
    for (const v of versions) {
      const list = versionsBySlug.get(v.slug);
      if (list) list.push(v);
      else versionsBySlug.set(v.slug, [v]);
    }
    for (const d of fresh) {
      const history = versionsBySlug.get(d.slug);
      if (history) {
        for (const v of history) {
          const snapshot = DocumentSchema.parse(v.snapshot);
          const ins = await tx.query(
            `insert into document_versions(document_id, version, snapshot, author_id, label, kind, created_at)
             values ($1,$2,$3,$4,$5,$6,$7) on conflict (document_id, version) do nothing returning id`,
            [d.id, v.version, JSON.stringify(snapshot), await authors.id(v.author), v.label, v.kind, v.at],
          );
          if (ins.rowCount) counts.versions++;
        }
        continue;
      }
      const current = await getDocument(tx, d.id);
      const ins = await tx.query(
        `insert into document_versions(document_id, version, snapshot, author_id, label, kind, created_at)
         values ($1,$2,$3,$4,'ייבוא מהספרייה הסטטית','published',$5) on conflict (document_id, version) do nothing returning id`,
        [d.id, d.currentVersion, JSON.stringify(current), await authors.id(d._author), d.updatedAt],
      );
      if (ins.rowCount) counts.versions++;
    }

    // 7. scripts are type-T `text` documents since 0030; `_usedIn` becomes explicit document links
    for (const s of scripts) {
      const ins = await tx.query(
        `insert into documents(id, slug, title, description, category, wave, priority, kind, status, doc_type, tags, body_html, current_version, created_at, updated_at)
         values ($1,$2,$3,'','ops',3,'m','text','published','T',$4,$5,1,$6,$6) on conflict (id) do nothing returning id`,
        [
          s.id,
          'script-' + s.id.replace(/-/g, '').slice(0, 8),
          s.title,
          s.tags,
          textToHtml(s.text),
          s.updatedAt,
        ],
      );
      if (!ins.rowCount) continue;
      counts.scripts++;
      await membership(tx, s.id, 'ops', null);
      const snapshot = await getDocument(tx, s.id);
      await tx.query(
        `insert into document_versions(document_id, version, snapshot, label, kind, created_at) values ($1,1,$2,'ייבוא מהספרייה הסטטית','published',$3) on conflict do nothing`,
        [s.id, JSON.stringify(snapshot), s.updatedAt],
      );
      for (const documentId of s._usedIn)
        await tx.query(
          `insert into document_links(from_document_id, to_document_id, type, origin)
           select $1, $2, 'link', 'explicit' where exists (select 1 from documents where id = $1)`,
          [documentId, s.id],
        );
    }

    // 8. agent notes on the flagship document
    for (const n of notes) {
      const doc = await tx.query('select id from documents where slug=$1', [n.slug]);
      if (!doc.rowCount) continue;
      const authorId = await authors.id(n.author);
      const ins = await tx.query(
        `insert into notes(document_id, step_key, author_id, text, created_at)
         select $1,$2,$3,$4,$5 where not exists (select 1 from notes where document_id=$1 and text=$4) returning id`,
        [doc.rows[0].id, n.stepKey, authorId, n.text, n.at],
      );
      if (!ins.rowCount) continue;
      counts.notes++;
      for (let i = 1; i <= n.likes; i++)
        await tx.query('insert into note_likes(note_id, user_id) values ($1,$2) on conflict do nothing', [
          ins.rows[0].id,
          await authors.likeUser(i),
        ]);
    }

    // 9. derived data for everything that was imported
    for (const d of fresh) {
      const doc = await getDocument(tx, d.id);
      if (doc) await recomputeDerived(tx, doc);
    }

    return counts;
  });
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  try {
    const counts = await runSeed(pool);
    console.log('seeded', counts);
  } finally {
    await pool.end();
  }
}
