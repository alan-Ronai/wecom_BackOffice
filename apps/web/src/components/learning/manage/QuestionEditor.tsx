import type { QuizQuestion } from '@wecom/shared';

const QKIND_LABEL: Record<QuizQuestion['kind'], string> = {
  single: 'בחירה יחידה',
  multi: 'בחירה מרובה',
  order: 'סידור',
  free: 'תשובה חופשית',
};

let optSeq = 0;
const newOptionId = () => `o${Date.now().toString(36)}${(optSeq++).toString(36)}`;

/** One question, fully controlled: the builder owns the draft list and saves it in one PUT. */
export function QuestionEditor({ q, onChange }: { q: QuizQuestion; onChange: (q: QuizQuestion) => void }) {
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
          onChange={(e) => onChange({ ...q, kind: e.target.value as QuizQuestion['kind'] })}
        >
          {(Object.keys(QKIND_LABEL) as QuizQuestion['kind'][]).map((k) => (
            <option key={k} value={k}>
              {QKIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {q.kind === 'free' ? null : (
        <div className="options" role="group" aria-label="אפשרויות">
          {q.options.map((o, i) => (
            <div className="option" key={o.id}>
              <input
                type={q.kind === 'single' ? 'radio' : 'checkbox'}
                name={`correct-${q.id ?? q.stem}`}
                aria-label="תשובה נכונה"
                checked={o.correct}
                onChange={() => markCorrect(i)}
              />
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
              onChange({ ...q, options: [...q.options, { id: newOptionId(), text: '', correct: false }] })
            }
          >
            ✚ אפשרות
          </button>
        </div>
      )}
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
