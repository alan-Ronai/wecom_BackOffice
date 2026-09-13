import { describe, it, expect } from 'vitest';
import {
  addAction,
  addBasic,
  addShared,
  checkList,
  deleteStep,
  dropAt,
  moveStep,
  renumber,
} from '../../src/lib/editorModel.js';
import { fx } from '../msw/fixtures.js';

describe('editorModel', () => {
  it('adds a step after the selected one and renumbers', () => {
    const d = addBasic(fx.docBrowsing, 'step', 's1', 's1');
    expect(d.phases[0].steps.map((s) => s.num).slice(0, 3)).toEqual(['1', '2', '3']);
    expect(d.phases[0].steps[1].title).toBe('');
    expect(fx.docBrowsing.phases[0].steps).toHaveLength(3); // immutable
  });

  it('embeds a shared block as a new step', () => {
    const d = addShared(fx.docBrowsing, fx.blocks[0], null);
    const last = d.phases.at(-1)!.steps.at(-1)!;
    expect(last.blockId).toBe(fx.blocks[0].id);
    expect(last.title).toBe('ריענון SIM');
  });

  it('embeds a shared block into an empty target step instead', () => {
    const withStep = addBasic(fx.docBrowsing, 'step', 's1', 's1');
    const key = withStep.phases[0].steps[1].key;
    const d = addShared(withStep, fx.blocks[1], key);
    expect(d.phases[0].steps[1].blockId).toBe(fx.blocks[1].id);
    expect(d.phases[0].steps[1].title).toBe('בדיקות במכשיר הלקוח');
  });

  it('moves steps within a phase', () => {
    const d = moveStep(fx.docBrowsing, 's2', -1);
    expect(d.phases[0].steps[0].key).toBe('s2');
    expect(renumber(d).phases[0].steps[0].num).toBe('1');
  });

  it('deletes a step and renumbers', () => {
    const d = deleteStep(fx.docBrowsing, 's2');
    expect(d.phases[0].steps.map((s) => s.key)).toEqual(['s1', 's3']);
    expect(d.phases[0].steps[1].num).toBe('2');
  });

  it('adds an action but refuses to edit an embedded block', () => {
    expect(addAction(fx.docBrowsing, 's1', 'בדיקה').phases[0].steps[0].actions).toHaveLength(3);
    expect(addAction(fx.docBrowsing, 's3', 'בדיקה')).toBe(fx.docBrowsing);
  });

  it('handles drag payloads', () => {
    const moved = dropAt(fx.docBrowsing, 'move:s2', 's1');
    expect(moved.phases[0].steps[0].key).toBe('s2');
    const shared = dropAt(fx.docBrowsing, `shared:${fx.blocks[0].id}`, null, fx.blocks);
    expect(shared.phases.at(-1)!.steps.at(-1)!.blockId).toBe(fx.blocks[0].id);
    const preset = dropAt(fx.docBrowsing, 'preset:בדיקת חוב פתוח', 's1');
    expect(preset.phases[0].steps[0].actions.at(-1)!.text).toBe('בדיקת חוב פתוח');
  });

  it('flags empty steps and passes a complete document', () => {
    const d = addBasic(fx.docBrowsing, 'step', null, null);
    const c = checkList(d, fx.fields, fx.blocks, []);
    expect(c.some(([k, t]) => k === 'warn' && t.includes('ריק'))).toBe(true);
    const clean = checkList(fx.docBrowsing, fx.fields, fx.blocks, fx.docBrowsing.related);
    expect(clean.some(([k]) => k === 'bad')).toBe(false);
    expect(clean[0]).toEqual(['ok', '✓ כל שדות CRM קיימים ב-crm-fields.json']);
  });

  it('flags a missing title and an empty document', () => {
    const c = checkList({ ...fx.docBrowsing, title: '', phases: [] }, fx.fields, fx.blocks, []);
    expect(c.filter(([k]) => k === 'bad')).toHaveLength(2);
  });
});
