import { useEffect, useState } from 'react';
import type { LearningItem, QuizQuestion } from '@wecom/shared';
import { useGenerateQuestions, usePutQuestions } from '../../../api/hooks/learningManage.js';
import { useToast } from '../../ui/Toast.js';
import { DocumentPicker, type PickedDoc } from './DocumentPicker.js';
import { QuestionEditor } from './QuestionEditor.js';

const move = <T,>(xs: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (j < 0 || j >= xs.length) return xs;
  const n = [...xs];
  [n[i], n[j]] = [n[j]!, n[i]!];
  return n;
};

const valid = (q: QuizQuestion) =>
  q.stem.trim().length > 0 &&
  (q.kind === 'free' ||
    (q.options.length >= 2 && q.options.every((o) => o.text.trim()) && q.options.some((o) => o.correct)));

/** Spec §1.2 / §5: pick documents → generate → curate → save. Nothing is saved until "שמור שאלות". */
export function QuizBuilder({ item }: { item: LearningItem }) {
  const [questions, setQuestions] = useState<QuizQuestion[]>(item.questions);
  const [docs, setDocs] = useState<PickedDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const gen = useGenerateQuestions(item.id);
  const put = usePutQuestions(item.id);
  const toast = useToast();
  useEffect(() => setQuestions(item.questions), [item.questions]);
  const dirty = JSON.stringify(questions) !== JSON.stringify(item.questions);
  const anchor = docs[0]?.id ?? item.entries[0]?.documentId ?? item.questions[0]?.documentId ?? '';

  const generate = async () => {
    try {
      const r = await gen.mutateAsync({ documentIds: docs.map((d) => d.id), perDocument: 3 });
      setQuestions((qs) => [...qs, ...r.questions]);
      toast(
        r.source === 'model'
          ? `נוצרו ${r.questions.length} שאלות בעזרת המודל`
          : `נוצרו ${r.questions.length} שאלות לפי כללים`,
        'ok',
      );
    } catch {
      toast('יצירת השאלות נכשלה', 'warn');
    }
  };

  const save = async () => {
    if (!questions.every(valid)) {
      setError('לכל שאלה נדרשת לפחות תשובה נכונה אחת');
      return;
    }
    setError(null);
    try {
      await put.mutateAsync({ questions });
      toast('השאלות נשמרו', 'ok');
    } catch {
      toast('השמירה נכשלה', 'warn');
    }
  };

  return (
    <section aria-label="שאלות">
      <h2>שאלות</h2>
      <div className="gen-row">
        <DocumentPicker exclude={docs.map((d) => d.id)} onPick={(d) => setDocs((ds) => [...ds, d])} />
        <div className="chips">
          {docs.map((d) => (
            <span key={d.id} className="chip">
              {d.title}{' '}
              <button
                type="button"
                aria-label={`הסר ${d.title}`}
                onClick={() => setDocs((ds) => ds.filter((x) => x.id !== d.id))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          className="btn sm"
          disabled={!docs.length || gen.isPending}
          onClick={() => void generate()}
        >
          צור שאלות
        </button>
      </div>
      <ul className="builder-list" data-testid="questions-list">
        {questions.map((q, i) => (
          <li key={q.id ?? `new-${i}`}>
            <div className="chips">
              {q.generated ? <span className="chip chip-amber">נוצר אוטומטית</span> : null}
              {q.modelConf !== null ? (
                <span className="chip">ביטחון {Math.round(q.modelConf * 100)}%</span>
              ) : null}
            </div>
            <QuestionEditor
              q={q}
              // Any edit makes the question the editor's, not the model's — the badge is a claim
              // about provenance, and a curated question is no longer model output.
              onChange={(nq) =>
                setQuestions((qs) => qs.map((x, k) => (k === i ? { ...nq, generated: false } : x)))
              }
            />
            <div className="row-actions">
              <button
                type="button"
                aria-label="למעלה"
                disabled={i === 0}
                onClick={() => setQuestions((qs) => move(qs, i, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="למטה"
                disabled={i === questions.length - 1}
                onClick={() => setQuestions((qs) => move(qs, i, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label="הסר שאלה"
                onClick={() => setQuestions((qs) => qs.filter((_, k) => k !== i))}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="row-actions">
        <button
          type="button"
          className="btn sm"
          disabled={!anchor}
          title={anchor ? undefined : 'בחרו קודם פריט ידע'}
          onClick={() =>
            setQuestions((qs) => [
              ...qs,
              {
                documentId: anchor,
                stepKey: null,
                stem: '',
                kind: 'single',
                options: [
                  { id: 'a', text: '', correct: true },
                  { id: 'b', text: '', correct: false },
                ],
                explanation: '',
                generated: false,
                modelConf: null,
              },
            ])
          }
        >
          ✚ שאלה ידנית
        </button>
        <button
          type="button"
          className="btn primary sm"
          disabled={!dirty || put.isPending}
          onClick={() => void save()}
        >
          שמור שאלות
        </button>
      </div>
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
