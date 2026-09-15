import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AttemptResult, PlayerItem } from '@wecom/shared';
import { useStartAttempt, useSubmitAttempt } from '../../api/hooks/learning.js';
import { move } from '../../lib/learning.js';
import { Button, LoadError } from '../ui/index.js';

type Phase =
  | { name: 'intro' }
  | { name: 'question'; attemptId: string; i: number }
  | { name: 'result'; result: AttemptResult };

type PlayerQuestion = PlayerItem['questions'][number];

/** Spec §5 leaves the pass mark to the item, then the assignment; this is the floor under both. */
const DEFAULT_PASS_MARK = 80;
const passMarkOf = (item: PlayerItem): number =>
  item.item.passMark ?? item.assignment.passMark ?? DEFAULT_PASS_MARK;

const attemptsLeftLabel = (left: number | null): string =>
  left === null
    ? 'ניתן לנסות שוב ללא הגבלה'
    : left === 1
      ? 'נותר ניסיון אחד'
      : left <= 0
        ? 'לא נותרו ניסיונות'
        : `נותרו ${left} ניסיונות`;

/**
 * The learner's answer to one question, as the contract wants it sent.
 *
 * `single`/`multi` answer with what was ticked. An `order` question answers with the ordering the
 * learner is *looking at*, whether or not they moved a row — the scorer compares the full sequence,
 * so "left as it came" is a real answer and not an empty one. `free` is not playable here (a
 * deliberate deviation, see docs/wave5-acceptance.md) and answers empty rather than trapping the
 * learner on the screen.
 */
const answerOf = (q: PlayerQuestion, picked: Record<string, string[]>): string[] =>
  picked[q.id] ?? (q.kind === 'order' ? q.options.map((o) => o.id) : []);

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

  /**
   * Selections are held here, keyed by question id, and survive a refetch of the payload: a
   * `learning.*` notification for this very assignment drops the whole `'learning'` prefix over
   * SSE, so the player's query refetches mid-quiz. Only a *different* assignment, or a new version
   * of the item under this one, invalidates an answer in progress — comparing the payload object
   * would restart the quiz every time the cache handed back a fresh parse of the same thing.
   */
  const identity = `${item.assignment.id}:${item.assignment.itemVersion}`;
  const seen = useRef(identity);
  useEffect(() => {
    if (seen.current === identity) return;
    seen.current = identity;
    setPicked({});
    setPhase({ name: 'intro' });
  }, [identity]);

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

  const reorder = useCallback(
    (q: PlayerQuestion, i: number, dir: -1 | 1) =>
      setPicked((p) => ({ ...p, [q.id]: move(answerOf(q, p), i, dir) })),
    [],
  );

  // Number keys pick an option; Enter advances. A container handler rather than the global
  // registry: the player is a focused, modal-like view and does not need a hotkey scope.
  useEffect(() => {
    if (phase.name === 'question') box.current?.focus();
  }, [phase]);

  const next = (p: Extract<Phase, { name: 'question' }>) => {
    // The button is disabled while the PUT is in flight; the keyboard path has to say so too, or
    // two Enters on the last screen submit the same attempt twice.
    if (submit.isPending) return;
    if (p.i + 1 < questions.length) return setPhase({ ...p, i: p.i + 1 });
    submit.mutate(
      {
        attemptId: p.attemptId,
        answers: { answers: questions.map((q) => ({ questionId: q.id, optionIds: answerOf(q, picked) })) },
      },
      { onSuccess: (result) => setPhase({ name: 'result', result }) },
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (phase.name !== 'question') return;
    const q = questions[phase.i];
    const n = Number(e.key);
    const ticks = q.kind === 'single' || q.kind === 'multi';
    if (ticks && n >= 1 && n <= Math.min(4, q.options.length)) {
      choose(q.id, q.options[n - 1].id, q.kind === 'multi');
      e.preventDefault();
    } else if (e.key === 'Enter' && answerable(q, picked)) {
      next(phase);
      e.preventDefault();
    }
  };

  if (phase.name === 'intro')
    return (
      <div className="quiz quiz-intro">
        {item.item.description ? <p>{item.item.description}</p> : null}
        <p>
          {questions.length} שאלות · ציון עובר {passMarkOf(item)}
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
    const sel = answerOf(q, picked);
    const multi = q.kind === 'multi';
    return (
      <div className="quiz" ref={box} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="quiz-progress">
          שאלה {phase.i + 1} מתוך {questions.length}
        </div>
        {/* No `aria-label`: it would override the `<legend>`, which is the group's real name. */}
        <fieldset className="quiz-q">
          <legend>{q.stem}</legend>
          {q.kind === 'free' ? (
            <p className="muted" role="note">
              סוג השאלה הזה אינו נתמך בנגן עדיין, ולכן היא לא תיבדק. אפשר להמשיך לשאלה הבאה — ונשמח אם
              תדווחו על כך לעורך התוכן.
            </p>
          ) : q.kind === 'order' ? (
            <>
              <p className="small muted">סדרו את הפריטים לפי הסדר הנכון בעזרת החצים.</p>
              <ol className="quiz-order">
                {sel.map((id, i) => {
                  const o = q.options.find((x) => x.id === id);
                  if (!o) return null;
                  return (
                    <li key={id} className="quiz-order-row">
                      <span className="quiz-order-text">{o.text}</span>
                      <button
                        type="button"
                        aria-label={`העלה את ${o.text}`}
                        disabled={i === 0}
                        onClick={() => reorder(q, i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`הורד את ${o.text}`}
                        disabled={i === sel.length - 1}
                        onClick={() => reorder(q, i, 1)}
                      >
                        ↓
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            q.options.map((o, i) => (
              <label key={o.id} className={'quiz-opt' + (sel.includes(o.id) ? ' on' : '')}>
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={q.id}
                  checked={sel.includes(o.id)}
                  onChange={() => choose(q.id, o.id, multi)}
                />
                {/* Only the first four have a key that reaches them. */}
                {i < 4 ? <kbd>{i + 1}</kbd> : null} {o.text}
              </label>
            ))
          )}
        </fieldset>
        {submit.isError ? <LoadError what="שליחת התשובות" error={submit.error} /> : null}
        <div className="quiz-nav">
          <Button onClick={() => next(phase)} disabled={!answerable(q, picked) || submit.isPending}>
            {phase.i + 1 < questions.length ? 'הבא' : 'שלח תשובות'}
          </Button>
        </div>
      </div>
    );
  }

  const r = phase.result;
  const passMark = passMarkOf(item);
  return (
    <div className={'quiz quiz-result ' + (r.passed ? 'pass' : 'fail')}>
      <h2>{r.passed ? `עברת! ציון ${r.score}` : `לא עברת הפעם. ציון ${r.score} (ציון עובר ${passMark})`}</h2>
      {!r.passed ? <p className="muted">{attemptsLeftLabel(r.attemptsLeft)}</p> : null}
      <ol className="quiz-review">
        {questions.map((q) => {
          const pq = r.perQuestion.find((x) => x.questionId === q.id);
          const label = (id: string) => q.options.find((o) => o.id === id)?.text ?? id;
          return (
            <li key={q.id} className={pq?.correct ? 'ok' : 'bad'}>
              <b>{q.stem}</b>
              {q.kind === 'order' ? (
                <div>
                  <span>הסדר הנכון:</span>
                  <ol className="quiz-order-review">
                    {(pq?.correctOptionIds ?? []).map((id) => (
                      <li key={id}>{label(id)}</li>
                    ))}
                  </ol>
                </div>
              ) : (
                <div>
                  תשובה נכונה:{' '}
                  {q.options
                    .filter((o) => pq?.correctOptionIds.includes(o.id))
                    .map((o) => o.text)
                    .join(', ')}
                </div>
              )}
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

/**
 * Whether the learner may advance. `order` always has an answer (the ordering on screen) and the
 * unsupported `free` kind must never be a dead end; the ticked kinds need at least one tick.
 */
const answerable = (q: PlayerQuestion, picked: Record<string, string[]>): boolean =>
  q.kind === 'order' || q.kind === 'free' || answerOf(q, picked).length > 0;
