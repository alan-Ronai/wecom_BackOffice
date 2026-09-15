import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PlayerItem } from '@wecom/shared';
import { useBlocks, useFields } from '../../api/hooks/content.js';
import { useAcknowledge } from '../../api/hooks/learning.js';
import { entryDoc } from '../../lib/learning.js';
import { resolvedSteps } from '../../lib/steps.js';
import { DocBody, type StepCtx } from '../article/StepView.js';
import { useToast } from '../ui/Toast.js';
import { Button } from '../ui/index.js';

/** Spec §5: intro, entries rendered exactly like the article, "קראתי והבנתי" at the end. */
export function BriefingReader({ item }: { item: PlayerItem }) {
  const blocks = useBlocks();
  const fields = useFields();
  const ack = useAcknowledge(item.assignment.id);
  const toast = useToast();
  const go = useNavigate();
  // `useBlocks`/`useFields` already unwrap to the arrays, so `data` is the list itself.
  const ctx: StepCtx = useMemo(
    () => ({
      expandAll: true,
      fields: fields.data ?? [],
      docs: [],
      blocks: blocks.data ?? [],
      prefix: 'L-',
    }),
    [fields.data, blocks.data],
  );
  const done = item.assignment.status === 'completed';
  return (
    <div className="briefing">
      {item.item.description ? <p className="briefing-intro">{item.item.description}</p> : null}
      {item.entries.map((e, i) => {
        const doc = entryDoc(e);
        const steps = resolvedSteps(doc, blocks.data);
        return (
          <section key={`${e.documentId}-${i}`} className="briefing-entry" aria-label={e.documentTitle}>
            <h2>{e.documentTitle}</h2>
            {e.changedSinceAssigned ? (
              <div className="banner banner-amber">התוכן עודכן – יש לקרוא שוב</div>
            ) : null}
            {e.note ? <p className="briefing-note">{e.note}</p> : null}
            <DocBody doc={doc} ctx={ctx} steps={steps} />
          </section>
        );
      })}
      <div className="briefing-foot">
        {done ? (
          <span className="chip chip-green">סומן כנקרא</span>
        ) : (
          <Button
            onClick={() =>
              ack.mutate(undefined, {
                onSuccess: () => {
                  toast('התדריך סומן כנקרא');
                  go('/learning');
                },
                onError: () => toast('הסימון נכשל, נסה שוב', 'warn'),
              })
            }
            disabled={ack.isPending}
          >
            קראתי והבנתי
          </Button>
        )}
      </div>
    </div>
  );
}
