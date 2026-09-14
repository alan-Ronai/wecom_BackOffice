/**
 * A-1 (acceptance review §3, §7 item 15) — the per-step "what next".
 *
 * The review drove `תקלת גלישה בחו"ל`, where none of the four steps carries a rule: `1`/`2`/`3`
 * did nothing, progress sat at 0%, and the call aside kept telling the agent to press them. So the
 * two things worth asserting are that a step says where the call goes from *it*, and that the
 * digits are advertised only where they do something.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Document, Phase, Step } from '@wecom/shared';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import * as fx from '../msw/fixtures.js';
import { nextHint } from '../../src/lib/nextHint.js';
import { DocBody, type StepCtx } from '../../src/components/article/StepView.js';
import { resolvedSteps } from '../../src/lib/steps.js';

const phase: Phase = { id: 'p1', label: '', steps: [] };
const step = (s: Partial<Step> & { key: string; num: string }): Step & { phase: Phase } => ({
  title: `כותרת ${s.num}`,
  blockRefs: [],
  deps: [],
  actions: [],
  outcomes: [],
  ...s,
  phase,
});

describe('nextHint', () => {
  it('names the next step when nothing branches', () => {
    const steps = [step({ key: 's1', num: '1' }), step({ key: 's2', num: '2', title: 'בדיקת APN' })];
    const h = nextHint(steps[0], steps);
    expect(h.text).toBe('מה הלאה · שלב 2: בדיקת APN');
    expect(h.choices).toBe(0);
    expect(h.terminal).toBe(false);
  });

  it('says the call ends on the last step', () => {
    const steps = [step({ key: 's1', num: '1' })];
    const h = nextHint(steps[0], steps);
    expect(h.text).toBe('מה הלאה · סיום השיחה');
    expect(h.terminal).toBe(true);
  });

  it('lists every destination when the outcomes branch', () => {
    const steps = [
      step({
        key: 's1',
        num: '1',
        outcomes: [
          { kind: 'ok', text: '✓ תקין', goto: 's3' },
          { kind: 'alert', text: '⚑ חסום' },
        ],
      }),
      step({ key: 's2', num: '2', title: 'המשך רגיל' }),
      step({ key: 's3', num: '3', title: 'דילוג קדימה' }),
    ];
    const h = nextHint(steps[0], steps);
    // `✓` jumps to s3; `⚑` has no goto, so `useCall` falls through to the next step in order.
    expect(h.text).toBe('מה הלאה · לפי התוצאה: שלב 3: דילוג קדימה · שלב 2: המשך רגיל');
    expect(h.choices).toBe(2);
  });

  it('collapses to one destination when every outcome leads to the same place', () => {
    const steps = [
      step({
        key: 's1',
        num: '1',
        outcomes: [
          { kind: 'ok', text: 'א', goto: 's2' },
          { kind: 'next', text: 'ב', goto: 's2' },
        ],
      }),
      step({ key: 's2', num: '2', title: 'יעד יחיד' }),
    ];
    expect(nextHint(steps[0], steps).text).toBe('מה הלאה · שלב 2: יעד יחיד');
  });

  it('reads a branch the same way it reads outcomes', () => {
    const steps = [
      step({
        key: 's1',
        num: '1',
        branch: {
          q: 'מה מוצג?',
          options: [
            { kind: 'if', label: 'ניצל 100%', text: 'הסבר', goto: 's3' },
            { kind: 'then', label: 'חבילה פעילה', text: 'המשך', goto: 's2' },
          ],
        },
      }),
      step({ key: 's2', num: '2', title: 'המשך' }),
      step({ key: 's3', num: '3', title: 'הסבר וסיום' }),
    ];
    const h = nextHint(steps[0], steps);
    expect(h.choices).toBe(2);
    expect(h.text).toContain('שלב 3: הסבר וסיום');
    expect(h.text).toContain('שלב 2: המשך');
  });

  it('resolves a dangling goto the way the call actually behaves', () => {
    // `useCall.pickOutcome` falls back to the next step in order when `goto` names a step that is
    // not in the list, so a hint promising the missing step would be a lie.
    const steps = [
      step({ key: 's1', num: '1', outcomes: [{ kind: 'ok', text: 'א', goto: 'sX' }] }),
      step({ key: 's2', num: '2', title: 'הבא בתור' }),
    ];
    expect(nextHint(steps[0], steps).text).toBe('מה הלאה · שלב 2: הבא בתור');
  });

  it('counts at most three choices — that is all the keyboard reaches', () => {
    const steps = [
      step({
        key: 's1',
        num: '1',
        outcomes: [1, 2, 3, 4].map((i) => ({ kind: 'next' as const, text: String(i) })),
      }),
      step({ key: 's2', num: '2' }),
    ];
    expect(nextHint(steps[0], steps).choices).toBe(3);
  });
});

describe('the article shows the hint per step', () => {
  it('renders "מה הלאה" under the open step and in the call aside', async () => {
    renderWithProviders(<App />, { route: `/doc/${fx.docBrowsing.id}` });
    // The step title also appears in the aside's jump rail, so address the step by its key.
    await screen.findAllByText('בדיקת חסימת גלישה בארץ');
    const box = document.querySelector('.doc-body .step[data-step="s1"]') as HTMLElement;
    expect(within(box).getByText(/^מה הלאה ·/)).toBeInTheDocument();
    // The aside echoes it, which is where the review found the wrong (constant) hint.
    expect((await screen.findByTestId('aside-next')).textContent).toMatch(/^מה הלאה ·/);
  });
});

describe('a document whose steps carry no rule', () => {
  /** The review's case: four steps, no outcomes, so `1`/`2`/`3` are inert. */
  const doc = {
    ...fx.docBrowsing,
    phases: [
      {
        id: 'p1',
        label: '',
        steps: [
          { ...step({ key: 'a', num: '1', title: 'בדיקה ראשונה' }), phase: undefined },
          { ...step({ key: 'b', num: '2', title: 'בדיקה אחרונה' }), phase: undefined },
        ].map(({ phase: _p, ...s }) => s as Step),
      },
    ],
  } as unknown as Document;

  const ctx: StepCtx = {
    fields: [],
    docs: [],
    callMode: true,
    activeKey: 'a',
    results: {},
  };

  it('does not advertise 1-3 on a step that has no outcomes', () => {
    const steps = resolvedSteps(doc, []);
    render(<DocBody doc={doc} ctx={ctx} steps={steps} />);
    const first = screen.getByText('בדיקה ראשונה').closest('.step') as HTMLElement;
    // The `↵ · 1 / 2 / 3` affordance in the step head is what the review saw advertised.
    expect(first.querySelector('.head .k')).toBeNull();
    expect(within(first).getByText('מה הלאה · שלב 2: בדיקה אחרונה')).toBeInTheDocument();
  });

  it('marks the terminal step as the end of the call', () => {
    const steps = resolvedSteps(doc, []);
    render(<DocBody doc={doc} ctx={{ ...ctx, activeKey: 'b' }} steps={steps} />);
    const last = screen.getByText('בדיקה אחרונה').closest('.step') as HTMLElement;
    const line = within(last).getByText('מה הלאה · סיום השיחה');
    expect(line).toHaveAttribute('data-terminal');
  });
});
