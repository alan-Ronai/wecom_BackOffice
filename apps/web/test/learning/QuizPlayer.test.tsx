import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { http, HttpResponse } from 'msw';
import type { AttemptResult, PlayerItem } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { server } from '../msw/server.js';
import { QuizPlayer } from '../../src/components/learning/QuizPlayer.js';
import { learningState, sampleQuizPlayer, Q1, Q2 } from '../msw/learning-handlers.js';

/** One `order` question — the kind the API's rules fallback emits for every document it reads. */
const orderQuiz = (): PlayerItem => {
  const item = sampleQuizPlayer();
  return {
    ...item,
    questions: [
      {
        ...item.questions[0]!,
        id: Q1,
        stem: 'סדרו את שלבי הטיפול',
        kind: 'order',
        explanation: 'זה סדר הבדיקות בנוהל.',
        options: [
          { id: 'a', text: 'בדיקת כיסוי' },
          { id: 'b', text: 'איפוס מכשיר' },
          { id: 'c', text: 'תיעוד ב-CRM' },
        ],
      },
    ],
  };
};

const rows = (scope: HTMLElement): (string | null)[] =>
  within(scope)
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.quiz-order-text, .quiz-order-review-text')?.textContent ?? li.textContent);

/** Hands the player a new payload object for the same assignment, the way a refetch would. */
function Refetching({ payloads }: { payloads: PlayerItem[] }) {
  const [i, setI] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setI((n) => Math.min(n + 1, payloads.length - 1))}>
        רענון פיקטיבי
      </button>
      <QuizPlayer item={payloads[i]!} />
    </>
  );
}

describe('<QuizPlayer>', () => {
  it('walks one question per screen with number keys, submits, and shows the review on a pass', async () => {
    renderWithProviders(<QuizPlayer item={sampleQuizPlayer()} />);
    await userEvent.click(screen.getByRole('button', { name: 'התחל שאלון' }));
    await waitFor(() => expect(learningState.attempts).toHaveLength(1));
    expect(await screen.findByText('שאלה 1 מתוך 2')).toBeInTheDocument();
    const q1 = screen.getByRole('group', { name: /הצעד הראשון/ });
    await userEvent.keyboard('2'); // option b via the number keys
    expect(within(q1).getByRole('radio', { name: /בדיקת כיסוי במיקום/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'הבא' }));
    expect(await screen.findByText('שאלה 2 מתוך 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /תוצאת Speedtest/ }));
    await userEvent.click(screen.getByRole('button', { name: 'שלח תשובות' }));
    expect(await screen.findByText('עברת! ציון 100')).toBeInTheDocument();
    expect(learningState.attempts[0].answers).toEqual({
      answers: [
        { questionId: Q1, optionIds: ['b'] },
        { questionId: Q2, optionIds: ['a'] },
      ],
    });
    // Review screen: every question with its explanation.
    expect(screen.getAllByText(/הסבר:/)).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'חזרה ללמידה שלי' })).toBeInTheDocument();
  });
  it('offers an unlimited retry after a fail', async () => {
    learningState.nextResultPassed = false;
    renderWithProviders(<QuizPlayer item={sampleQuizPlayer()} />);
    await userEvent.click(screen.getByRole('button', { name: 'התחל שאלון' }));
    await screen.findByText('שאלה 1 מתוך 2');
    await userEvent.keyboard('1');
    await userEvent.click(screen.getByRole('button', { name: 'הבא' }));
    await userEvent.keyboard('2');
    await userEvent.click(screen.getByRole('button', { name: 'שלח תשובות' }));
    expect(await screen.findByText('לא עברת הפעם. ציון 50 (ציון עובר 80)')).toBeInTheDocument();
    expect(screen.getByText('ניתן לנסות שוב ללא הגבלה')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(await screen.findByText('שאלה 1 מתוך 2')).toBeInTheDocument();
    expect(learningState.attempts).toHaveLength(2);
  });
  it('plays an order question with the arrow buttons and submits the ordering it shows', async () => {
    let sent: unknown = null;
    const result: AttemptResult = {
      attemptId: 'd0000000-0000-4000-8000-000000000001',
      score: 100,
      passed: true,
      attemptsLeft: null,
      perQuestion: [
        {
          questionId: Q1,
          correct: true,
          correctOptionIds: ['c', 'a', 'b'],
          explanation: 'זה סדר הבדיקות בנוהל.',
        },
      ],
    };
    server.use(
      http.put('/api/v1/learning/attempts/:id', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(result);
      }),
    );
    renderWithProviders(<QuizPlayer item={orderQuiz()} />);
    await userEvent.click(screen.getByRole('button', { name: 'התחל שאלון' }));
    const q = await screen.findByRole('group', { name: /סדרו את שלבי הטיפול/ });
    expect(rows(q)).toEqual(['בדיקת כיסוי', 'איפוס מכשיר', 'תיעוד ב-CRM']);
    // The ordering is an answer from the first render, so the only control is enabled straight away.
    const send = screen.getByRole('button', { name: 'שלח תשובות' });
    expect(send).toBeEnabled();
    await userEvent.click(within(q).getByRole('button', { name: 'הורד את בדיקת כיסוי' }));
    await userEvent.click(within(q).getByRole('button', { name: 'העלה את תיעוד ב-CRM' }));
    expect(rows(q)).toEqual(['איפוס מכשיר', 'תיעוד ב-CRM', 'בדיקת כיסוי']);
    await userEvent.click(screen.getByRole('button', { name: 'שלח תשובות' }));
    expect(await screen.findByText('עברת! ציון 100')).toBeInTheDocument();
    expect(sent).toEqual({ answers: [{ questionId: Q1, optionIds: ['b', 'c', 'a'] }] });
    // The review names the correct sequence, in order.
    const review = screen.getByText('הסדר הנכון:').parentElement!;
    expect(rows(review)).toEqual(['תיעוד ב-CRM', 'בדיקת כיסוי', 'איפוס מכשיר']);
  });

  it('never dead-ends on an unsupported free-text question', async () => {
    const item = orderQuiz();
    item.questions[0]!.kind = 'free';
    item.questions[0]!.options = [];
    renderWithProviders(<QuizPlayer item={item} />);
    await userEvent.click(screen.getByRole('button', { name: 'התחל שאלון' }));
    expect(await screen.findByText(/אינו נתמך בנגן/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שלח תשובות' })).toBeEnabled();
  });

  it('keeps the learner’s selections when the payload refetches mid-quiz', async () => {
    const bumped = sampleQuizPlayer();
    bumped.assignment.itemVersion = 2;
    renderWithProviders(<Refetching payloads={[sampleQuizPlayer(), sampleQuizPlayer(), bumped]} />);
    await userEvent.click(screen.getByRole('button', { name: 'התחל שאלון' }));
    await screen.findByText('שאלה 1 מתוך 2');
    await userEvent.keyboard('2');
    // A `learning.*` event invalidates the whole prefix: the same assignment comes back as a new
    // object. The tick, and the screen the learner is on, have to survive it.
    await userEvent.click(screen.getByRole('button', { name: 'רענון פיקטיבי' }));
    expect(screen.getByText('שאלה 1 מתוך 2')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /בדיקת כיסוי במיקום/ })).toBeChecked();
    // A new version of the item under the learner does restart it: the attempt was against
    // questions that no longer exist.
    await userEvent.click(screen.getByRole('button', { name: 'רענון פיקטיבי' }));
    expect(await screen.findByRole('button', { name: 'התחל שאלון' })).toBeInTheDocument();
  });

  it('shows attempts left when the quiz has a cap', async () => {
    const item = sampleQuizPlayer();
    item.item.maxAttempts = 3;
    item.assignment.maxAttempts = 3;
    item.assignment.attemptsUsed = 2;
    renderWithProviders(<QuizPlayer item={item} />);
    expect(screen.getByText('נותר ניסיון אחד')).toBeInTheDocument();
  });
});
