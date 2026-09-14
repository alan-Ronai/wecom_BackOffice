import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { QuizPlayer } from '../../src/components/learning/QuizPlayer.js';
import { learningState, sampleQuizPlayer, Q1, Q2 } from '../msw/learning-handlers.js';

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
  it('shows attempts left when the quiz has a cap', async () => {
    const item = sampleQuizPlayer();
    item.item.maxAttempts = 3;
    item.assignment.maxAttempts = 3;
    item.assignment.attemptsUsed = 2;
    renderWithProviders(<QuizPlayer item={item} />);
    expect(screen.getByText('נותר ניסיון אחד')).toBeInTheDocument();
  });
});
