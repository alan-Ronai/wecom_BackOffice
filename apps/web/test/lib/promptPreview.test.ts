import { describe, it, expect } from 'vitest';
import { buildSystemPromptPreview, promptVersionOf } from '../../src/lib/promptPreview.js';
import { sampleSettings } from '../msw/ai-admin.js';

describe('system prompt preview', () => {
  it('lays out brief, architecture, style and rules in order with the prompt version', () => {
    const p = buildSystemPromptPreview(sampleSettings());
    expect(p.indexOf('## על החברה')).toBeLessThan(p.indexOf('## ארכיטקטורת הידע'));
    expect(p.indexOf('## ארכיטקטורת הידע')).toBeLessThan(p.indexOf('## סגנון'));
    expect(p.indexOf('## סגנון')).toBeLessThan(p.indexOf('## כללי המשימה'));
    expect(p).toContain('wecom היא חברת תקשורת');
    expect(p).toContain('גרסת הנחיות: v4.2.1');
  });

  it('marks an empty block rather than dropping its heading', () => {
    const p = buildSystemPromptPreview(sampleSettings({ style: { text: '', version: 0 } }));
    expect(p).toContain('## סגנון\n\n(ריק)');
    // The major is the prompt *file*; it moved to v4 with the fix wave, in step with
    // `currentPromptVersion` in the api. A label the server will never stamp is worse than none.
    expect(promptVersionOf(sampleSettings({ style: { text: '', version: 0 } }))).toBe('v4.2.0');
  });
});
