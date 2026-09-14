import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AttemptResult, PlayerItem } from '@wecom/shared';
import { useStartAttempt, useSubmitAttempt } from '../../api/hooks/learning.js';
import { Button, LoadError } from '../ui/index.js';

type Phase =
  | { name: 'intro' }
  | { name: 'question'; attemptId: string; i: number }
  | { name: 'result'; result: AttemptResult };

const attemptsLeftLabel = (left: number | null): string =>
  left === null
    ? 'ניתן לנסות שוב ללא הגבלה'
    : left === 1
      ? 'נותר ניסיון אחד'
      : left <= 0
        ? 'לא נותרו ניסיונות'
        : `נותרו ${left} ניסיונות`;

/** Spec §5: one question per screen, keys 1–4, review with explanations, pass/fail, retry. */
export function QuizPlayer({ item }: { item: PlayerItem }) {
  const questions = item.questions;
  const [phase, setPhase] = useState<Phase>({ name: 'intro' });
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const start = useStartAttempt(item.assignment.id);
  const submit = useSubmitAttempt();
  const box = useRef<HTMLDivElement>(null);

  const initialLeft =
    item.assignment.maxAttempts === null
      ? null
      : Math.max(0, item.assignment.maxAttempts - item.assignment.attemptsUsed);

  const begin = () =>
    start.mutate(undefined, {
      onSuccess: (attemptId) => {
        setPicked({});
        setPhase({ name: 'question', attemptId, i: 0 });
      },
    });

  const choose = useCallback(
    (qId: string, optId: string, multi: boolean) =>
      setPicked((p) => {
        const cur = p[qId] ?? [];
        if (!multi) return { ...p, [qId]: [optId] };
        return { ...p, [qId]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId] };
      }),
    [],
  );

  // Number keys pick an option; Enter advances. A container handler rather than the global
  // registry: the player is a focused, modal-like view and does not need a hotkey scope.
  useEffect(() => {
    if (phase.name === 'question') box.current?.focus();
  }, [phase]);

  const next = (p: Extract<Phase, { name: 'question' }>) => {
    if (p.i + 1 < questions.length) return setPhase({ ...p, i: p.i + 1 });
    submit.mutate(
      {
        attemptId: p.attemptId,
        answers: { answers: questions.map((q) => ({ questionId: q.id, optionIds: picked[q.id] ?? [] })) },
      },
      { onSuccess: (result) => setPhase({ name: 'result', result }) },
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (phase.name !== 'question') return;
    const q = questions[phase.i];
    const n = Number(e.key);
    if (n >= 1 && n <= Math.min(4, q.options.length)) {
      choose(q.id, q.options[n - 1].id, q.kind === 'multi');
      e.preventDefault();
    } else if (e.key === 'Enter' && (picked[q.id]?.length ?? 0) > 0) {
      next(phase);
      e.preventDefault();
    }
  };

  if (phase.name === 'intro')
    return (
      <div className="quiz quiz-intro">
        {item.item.description ? <p>{item.item.description}</p> : null}
        <p>
          {questions.length} שאלות · ציון עובר {item.item.passMark ?? item.assignment.passMark ?? 80}
          {item.item.estimatedMinutes ? ` · כ-${item.item.estimatedMinutes} דק׳` : ''}
        </p>
        <p className="muted">{attemptsLeftLabel(initialLeft)}</p>
        {start.isError ? <LoadError what="פתיחת הניסיון" error={start.error} /> : null}
        <Button onClick={begin} disabled={start.isPending || initialLeft === 0}>
          {item.assignment.attemptsUsed ? 'נסה שוב' : 'התחל שאלון'}
        </Button>
      </div>
    );

  if (phase.name === 'question') {
    const q = questions[phase.i];
    const sel = picked[q.id] ?? [];
    const multi = q.kind === 'multi';
    return (
      <div className="quiz" ref={box} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="quiz-progress">
          שאלה {phase.i + 1} מתוך {questions.length}
        </div>
        <fieldset className="quiz-q" aria-label={q.stem}>
          <legend>{q.stem}</legend>
          {q.options.map((o, i) => (
            <label key={o.id} className={'quiz-opt' + (sel.includes(o.id) ? ' on' : '')}>
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={q.id}
                checked={sel.includes(o.id)}
                onChange={() => choose(q.id, o.id, multi)}
              />
              <kbd>{i + 1}</kbd> {o.text}
            </label>
          ))}
        </fieldset>
        {submit.isError ? <LoadError what="שליחת התשובות" error={submit.error} /> : null}
        <div className="quiz-nav">
          <Button onClick={() => next(phase)} disabled={!sel.length || submit.isPending}>
            {phase.i + 1 < questions.length ? 'הבא' : 'שלח תשובות'}
          </Button>
        </div>
      </div>
    );
  }

  const r = phase.result;
  const passMark = item.item.passMark ?? item.assignment.passMark ?? 80;
  return (
    <div className="quiz quiz-result">
      <h2>{r.passed ? `עברת! ציון ${r.score}` : `לא עברת הפעם. ציון ${r.score} (ציון עובר ${passMark})`}</h2>
      {!r.passed ? <p className="muted">{attemptsLeftLabel(r.attemptsLeft)}</p> : null}
      <ol className="quiz-review">
        {questions.map((q) => {
          const pq = r.perQuestion.find((x) => x.questionId === q.id);
          return (
            <li key={q.id} className={pq?.correct ? 'ok' : 'bad'}>
              <b>{q.stem}</b>
              <div>
                תשובה נכונה:{' '}
                {q.options
                  .filter((o) => pq?.correctOptionIds.includes(o.id))
                  .map((o) => o.text)
                  .join(', ')}
              </div>
              {pq?.explanation ? <div className="muted">הסבר: {pq.explanation}</div> : null}
            </li>
          );
        })}
      </ol>
      <div className="quiz-nav">
        {!r.passed && (r.attemptsLeft === null || r.attemptsLeft > 0) ? (
          <Button onClick={begin}>נסה שוב</Button>
        ) : null}
        <Link to="/learning" className="btn">
          חזרה ללמידה שלי
        </Link>
      </div>
    </div>
  );
}
