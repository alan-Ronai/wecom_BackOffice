import { useState } from 'react';
import type { Suggestion, SuggestionPayload } from '@wecom/shared';
import { CATS } from '../../lib/constants.js';

const TAG: Record<Suggestion['type'], { label: string; tone: string }> = {
  'update-step': { label: 'עדכון שלב', tone: 'amber' },
  'new-card': { label: 'כרטיס חדש', tone: 'green' },
  'new-step': { label: 'שלב חדש', tone: 'green' },
  'update-block': { label: 'עדכון בלוק משותף', tone: 'red' },
  'deprecate-step': { label: 'הוצאה משימוש', tone: 'red' },
  'field-alert': { label: 'התראת שדה', tone: 'amber' },
};

/** One-line summary of what a suggestion would change, per payload type. */
export function payloadSummary(p: SuggestionPayload): string {
  switch (p.type) {
    case 'update-step':
      return p.addActions.length ? '+ ' + p.addActions.join(' · ') : 'עדכון שדות השלב';
    case 'new-card':
      return `כרטיס: ${CATS[p.category].label} · גל ${p.wave} · ${p.phases.flatMap((x) => x.steps).length} שלבים`;
    case 'new-step':
      return `${p.title} · ${p.actions.length} פעולות`;
    case 'update-block':
      return p.actions.at(-1)?.text ?? 'עדכון בלוק';
    case 'deprecate-step':
      return p.reason;
    case 'field-alert':
      return `${p.fieldName} · ${p.issue === 'renamed' ? 'שונה שם' : p.issue === 'retired' ? 'הוצא משימוש' : 'לא מוכר'}`;
  }
}

export function SuggestionCard({
  suggestion,
  canReview,
  canApply,
  onDecide,
  onEdit,
}: {
  suggestion: Suggestion;
  canReview: boolean;
  canApply: boolean;
  onDecide: (decision: 'accept' | 'reject' | 'reset') => void;
  onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const payload = suggestion.editedPayload ?? suggestion.payload;
  const [draft, setDraft] = useState(payloadSummary(payload));
  const tag = TAG[suggestion.type];
  const decided = suggestion.status !== 'pending';

  return (
    <div
      className={
        'sug' +
        (suggestion.status === 'accepted' || suggestion.status === 'applied'
          ? ' acc'
          : suggestion.status === 'rejected'
            ? ' rej'
            : '')
      }
    >
      <div className="hd">
        <span className={'tag ' + tag.tone}>{tag.label}</span>
        <span className="t">{suggestion.title}</span>
        <span className="conf">{suggestion.confidence.toFixed(2)}</span>
      </div>
      <div className="why">{suggestion.rationale}</div>
      {!decided ? (
        <>
          <div className="diff">
            {editing ? (
              <>
                <div className="small muted" style={{ marginBottom: 4 }}>
                  הטקסט שייכנס לשלב / לבלוק
                </div>
                <textarea
                  rows={3}
                  aria-label="עריכת ההצעה"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
                  <button className="btn xs" onClick={() => setEditing(false)}>
                    ביטול
                  </button>
                  <button
                    className="btn xs primary"
                    onClick={() => {
                      onEdit(draft.trim());
                      setEditing(false);
                    }}
                  >
                    שמור עריכה
                  </button>
                </div>
              </>
            ) : (
              payloadSummary(payload)
            )}
          </div>
          <div className="ft">
            <span>מקור: {suggestion.anchor}</span>
            <span>· יעד: {suggestion.targetStepKey ? `שלב ${suggestion.targetStepKey}` : 'כרטיס חדש'}</span>
            {canReview ? (
              <span className="bt">
                <span role="button" tabIndex={0} onClick={() => onDecide('reject')}>
                  דחה
                </span>
                <span role="button" tabIndex={0} onClick={() => setEditing(true)}>
                  ערוך
                </span>
                <span className="p" role="button" tabIndex={0} onClick={() => onDecide('accept')}>
                  אשר
                </span>
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <div
          className="status"
          style={{
            color: suggestion.status === 'rejected' ? 'var(--muted)' : 'var(--ok)',
          }}
        >
          <span>
            {suggestion.status === 'applied'
              ? '✓ הוחל על הספרייה'
              : suggestion.status === 'accepted'
                ? '✓ אושר — יעודכן בפרסום'
                : '✕ נדחה — המנוע ילמד מזה'}
          </span>
          {canApply && suggestion.status !== 'applied' ? (
            <span className="undo" role="button" tabIndex={0} onClick={() => onDecide('reset')}>
              בטל
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
