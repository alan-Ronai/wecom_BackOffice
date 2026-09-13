import { describe, it, expect } from 'vitest';
import {
  AuditEntrySchema,
  BlockSchema,
  CrmFieldSchema,
  DocumentCardSchema,
  DocumentSchema,
  MeSchema,
  NoteSchema,
  RoleSchema,
  ScriptSchema,
  SessionSchema,
  SourceRevisionSchema,
  SourceSchema,
  SuggestionSchema,
  TrashItemSchema,
  UserSchema,
  VersionSchema,
} from '@wecom/shared';
import { fx } from './fixtures.js';

describe('fixtures validate against shared schemas', () => {
  it('documents', () => {
    DocumentSchema.parse(fx.docBrowsing);
    DocumentSchema.parse(fx.docIntl);
    expect(fx.docBrowsing.phases.flatMap((p) => p.steps)).toHaveLength(15);
  });
  it('cards', () => {
    fx.cards.forEach((c) => DocumentCardSchema.parse(c));
    expect(fx.cards.length).toBeGreaterThan(5);
    expect(fx.cards.some((c) => c.status === 'partial')).toBe(true);
    expect(fx.cards.some((c) => c.status === 'draft')).toBe(true);
  });
  it('me / blocks / fields / scripts / notes / versions', () => {
    MeSchema.parse(fx.me);
    fx.blocks.forEach((b) => BlockSchema.parse(b));
    fx.fields.forEach((f) => CrmFieldSchema.parse(f));
    fx.scripts.forEach((s) => ScriptSchema.parse(s));
    fx.notes.forEach((n) => NoteSchema.parse(n));
    fx.versions.forEach((v) => VersionSchema.parse(v));
  });
  it('pipeline', () => {
    fx.sources.forEach((s) => SourceSchema.parse(s));
    SourceRevisionSchema.parse(fx.revision);
    fx.suggestions.forEach((s) => SuggestionSchema.parse(s));
    fx.trash.forEach((t) => TrashItemSchema.parse(t));
  });
  it('admin', () => {
    fx.users.forEach((u) => UserSchema.parse(u));
    fx.roles.forEach((r) => RoleSchema.parse(r));
    fx.sessions.forEach((s) => SessionSchema.parse(s));
    fx.audit.forEach((a) => AuditEntrySchema.parse(a));
  });
});
