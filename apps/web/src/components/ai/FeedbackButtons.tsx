import { useState } from 'react';
import { useModal } from '../ui/Modal.js';

/**
 * 👍 / 👎 on one assistant reply. A thumbs-down asks for the one line that makes the rating
 * usable — "what was missing" is the field prompt work is actually driven from — but the rating
 * is posted whether or not a note is written.
 */
export function FeedbackButtons({
  messageId,
  initial,
  onRate,
}: {
  messageId: string;
  initial?: 'up' | 'down' | null;
  onRate: (messageId: string, rating: 'up' | 'down', note?: string) => void;
}) {
  const modal = useModal();
  const [rating, setRating] = useState<'up' | 'down' | null>(initial ?? null);

  const rate = async (next: 'up' | 'down') => {
    setRating(next);
    if (next === 'up') {
      onRate(messageId, 'up');
      return;
    }
    const note = await modal.prompt('מה היה חסר?', 'הערה', '');
    onRate(messageId, 'down', note?.trim() ? note.trim() : undefined);
  };

  return (
    <div className="chat-feedback">
      <button
        type="button"
        className="btn xs ghost"
        aria-label="תשובה טובה"
        aria-pressed={rating === 'up'}
        onClick={() => void rate('up')}
      >
        👍
      </button>
      <button
        type="button"
        className="btn xs ghost"
        aria-label="תשובה לא טובה"
        aria-pressed={rating === 'down'}
        onClick={() => void rate('down')}
      >
        👎
      </button>
    </div>
  );
}
