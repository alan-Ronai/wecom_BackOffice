import type { AiSettings } from '@wecom/shared';

/**
 * The knowledge-architecture block the assembler always includes — it is what stops the model
 * inventing item types or proposing a change to published content without an editor's decision.
 * It is not admin-editable, which is why it is a constant here and not a setting.
 */
export const ARCHITECTURE_BLOCK = [
  'עולמות תוכן → נושאים → פריטי ידע. שבעה סוגי פריטים: M אבחון, R טיפול, O תפעול, E הסלמה, S מומחה, T תסריט, I מידע.',
  'רק תוכן שפורסם מוצג לנציגים. שינוי במקור לעולם אינו מעדכן את תצוגת העבודה בלי אישור עורך.',
  'בלוקים משותפים ושדות CRM מופיעים במסמכים רבים — שינוי בהם משפיע על כולם.',
].join('\n');

/**
 * The prompt version the two editable blocks add up to — the same `v4.<brief>.<style>` the API
 * stamps on every suggestion and message, so an admin can read a row in the eval table or the
 * analytics breakdown and know which text produced it.
 *
 * The major is the *system prompt file* (`packages/model/prompts/propose-v4.md`), so it moved to
 * `v4` with the fix wave. On the API side `currentPromptVersion` no longer spells it out — it
 * derives the major from `PROMPT_VERSION` in `@wecom/model` — but this is still a hand-kept
 * mirror, because the web bundle does not depend on `@wecom/model` and the preview is rendered in
 * the browser from the settings the admin is editing, before anything is saved, so it cannot ask
 * the server either. A new prompt file means changing this line too, or an admin reads a version
 * label that no stored row will ever carry.
 */
export const promptVersionOf = (s: AiSettings): string => `v4.${s.brief.version}.${s.style.version}`;

/**
 * Client-side rendering of the system-prompt layout, for the admin preview.
 *
 * The API assembles the real prompt (it also has the retrieved context, the impact set and the
 * few-shot examples, none of which belong in a settings screen). What this has to be honest about
 * is the *order*: an admin editing the brief needs to see where their text lands relative to the
 * architecture block and the task rules, because that is what decides whether it is read as
 * background or as an instruction.
 */
export function buildSystemPromptPreview(s: AiSettings): string {
  return [
    `# הנחיות למערכת (גרסת הנחיות: ${promptVersionOf(s)})`,
    '## על החברה',
    s.brief.text || '(ריק)',
    '## ארכיטקטורת הידע',
    ARCHITECTURE_BLOCK,
    '## סגנון',
    s.style.text || '(ריק)',
    '## כללי המשימה',
    'החזר JSON תקין לפי הסכמה; אל תמציא מזהים; ציין השפעה על מסמכים אחרים.',
  ].join('\n\n');
}
