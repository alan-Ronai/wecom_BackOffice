import type { QuizQuestion } from '@wecom/shared';
import { move } from '../../../lib/learning.js';

const QKIND_LABEL: Record<QuizQuestion['kind'], string> = {
  single: 'בחירה יחידה',
  multi: 'בחירה מרובה',
  order: 'סידור',
  free: 'תשובה חופשית',
};

/**
 * What a manager may author.
 *
 * `free` is off the list: the player has no free-text field and the contract's `answers[].text` is
 * never sent, so authoring one produced a question a learner could not answer and the API now
 * rejects on save (400 `UNSUPPORTED_KIND`). Recorded as a deliberate deviation in
 * `docs/wave5-acceptance.md`; the select still shows a stray `free` inherited from an older draft
 * so the editor can see what they have and change it.
 */
export const AUTHORABLE_KINDS: QuizQuestion['kind'][] = ['single', 'multi', 'order'];

let optSeq = 0;
export const newOptionId = (): string => `o${Date.now().toString(36)}${(optSeq++).toString(36)}`;

/**
 * One question, fully controlled: the builder owns the draft list and saves it in one PUT.
 *
 * `groupId` names the radio group and is the builder's to supply. A draft question has no `id`, so
 * this used to fall back to the stem — empty for every freshly added question, which made two new
 * questions one DOM radio group: ticking the answer in the second cleared the first's input while
 * React still believed it was checked.
 */
export function QuestionEditor({
  q,
  groupId,
  onChange,
}: {
  q: QuizQuestion;
  groupId: string;
  onChange: (q: QuizQuestion) => void;
}) {
  const kinds = AUTHORABLE_KINDS.includes(q.kind) ? AUTHORABLE_KINDS : [...AUTHORABLE_KINDS, q.kind];
  const setOpt = (i: number, patch: Partial<QuizQuestion['options'][number]>) =>
    onChange({ ...q, options: q.options.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  /** `single` is exclusive; `multi` toggles, which is what the two input types already promise. */
  const markCorrect = (i: number) =>
    onChange({
      ...q,
      options: q.options.map((o, k) => ({
        ...o,
        correct: q.kind === 'single' ? k === i : k === i ? !o.correct : o.correct,
      })),
    });
  /**
   * The ordering *is* the answer of an `order` question, so every one of its options is correct —
   * the API enforces exactly that — and there is no answer key to tick. Coming back to `single`
   * leaves one.
   */
  const setKind = (kind: QuizQuestion['kind']) => {
    const firstCorrect = Math.max(
      0,
      q.options.findIndex((o) => o.correct),
    );
    onChange({
      ...q,
      kind,
      options:
        kind === 'order'
          ? q.options.map((o) => ({ ...o, correct: true }))
          : kind === 'single'
            ? q.options.map((o, k) => ({ ...o, correct: k === firstCorrect }))
            : q.options,
    });
  };

  return (
    <div className="question-editor">
      <label>
        שאלה
        <textarea
          aria-label="שאלה"
          value={q.stem}
          onChange={(e) => onChange({ ...q, stem: e.target.value })}
          rows={2}
        />
      </label>
      <label className="small">
        סוג שאלה
        <select
          aria-label="סוג שאלה"
          value={q.kind}
          onChange={(e) => setKind(e.target.value as QuizQuestion['kind'])}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {QKIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="options" role="group" aria-label={q.kind === 'order' ? 'סדר נכון' : 'אפשרויות'}>
        {q.kind === 'order' ? (
          <p className="small muted">הסדר כאן הוא הסדר הנכון; הנציג מתבקש לשחזר אותו בנגן.</p>
        ) : null}
        {q.options.map((o, i) => (
          <div className="option" key={o.id}>
            {q.kind === 'order' ? (
              <>
                <span className="option-n">{i + 1}</span>
                <button
                  type="button"
                  aria-label={`העלה את אפשרות ${i + 1}`}
                  disabled={i === 0}
                  onClick={() => onChange({ ...q, options: move(q.options, i, -1) })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`הורד את אפשרות ${i + 1}`}
                  disabled={i === q.options.length - 1}
                  onClick={() => onChange({ ...q, options: move(q.options, i, 1) })}
                >
                  ↓
                </button>
              </>
            ) : (
              <input
                type={q.kind === 'single' ? 'radio' : 'checkbox'}
                name={`correct-${groupId}`}
                aria-label="תשובה נכונה"
                checked={o.correct}
                onChange={() => markCorrect(i)}
              />
            )}
            <input
              aria-label="טקסט האפשרות"
              value={o.text}
              onChange={(e) => setOpt(i, { text: e.target.value })}
            />
            <button
              type="button"
              aria-label="הסר אפשרות"
              disabled={q.options.length <= 2}
              onClick={() => onChange({ ...q, options: q.options.filter((_, k) => k !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            onChange({
              ...q,
              options: [...q.options, { id: newOptionId(), text: '', correct: q.kind === 'order' }],
            })
          }
        >
          ✚ אפשרות
        </button>
      </div>
      <label className="small">
        הסבר (מוצג אחרי המענה)
        <input
          aria-label="הסבר"
          value={q.explanation}
          onChange={(e) => onChange({ ...q, explanation: e.target.value })}
        />
      </label>
    </div>
  );
}
