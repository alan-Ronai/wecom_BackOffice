import type { Block, Document, Phase, Step } from '@wecom/shared';

export interface ResolvedStep extends Step {
  phase: Phase;
  block?: Block;
  blockMissing?: boolean;
}

export const allSteps = (doc: Document | undefined): (Step & { phase: Phase })[] =>
  doc?.phases.flatMap((p) => p.steps.map((s) => ({ ...s, phase: p }))) ?? [];

export const findStep = (doc: Document | undefined, key: string | undefined | null) =>
  key ? allSteps(doc).find((s) => s.key === key) : undefined;

/**
 * Port of legacy KB.resolveStep: a step that embeds a shared block reads the block's
 * actions/script at render time, so editing the block updates every document at once.
 */
export function resolveStep(step: Step & { phase: Phase }, blocks: Block[] | undefined): ResolvedStep {
  if (!step.blockId) return step;
  const block = blocks?.find((b) => b.id === step.blockId);
  if (!block) return { ...step, blockMissing: true };
  return {
    ...step,
    title: step.title || block.title,
    description: step.description ?? block.description,
    actions: block.actions,
    outcomes: step.outcomes.length ? step.outcomes : block.outcomes,
    script: step.script ?? block.script,
    block,
  };
}

export const resolvedSteps = (doc: Document | undefined, blocks: Block[] | undefined): ResolvedStep[] =>
  allSteps(doc).map((s) => resolveStep(s, blocks));

/** Every block id a step embeds or references. */
export const stepBlockIds = (s: Step): string[] =>
  [s.blockId, ...s.blockRefs].filter((x): x is string => !!x);
