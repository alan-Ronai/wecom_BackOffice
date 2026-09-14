/**
 * Wave 5 (V1) — question generation orchestrator (spec §1.2, §5).
 *
 * The deterministic rules always run; the local model, when it exists and answers, rewrites and
 * extends them. A model failure is never the caller's problem: it is logged and the rules are the
 * answer, with `source: 'rules'` telling the builder what it is looking at. Nothing is saved —
 * the editor curates and then calls `PUT /learning/items/:id/questions`.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { ModelClient, QuestionContext, QuestionContextStep } from '@wecom/model';
import type { Document, GenerateQuestionsBody, GenerateQuestionsResponse, QuizQuestion } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import { getDocument, loadFieldNames } from '../documents/repo.js';
import { generateFromDocument, allSteps } from './fallback.js';
import type { Q } from './repo.js';

export interface GenerateDeps {
  db: Q;
  model: ModelClient | null;
  log: FastifyBaseLogger;
}

const toCtxSteps = (doc: Document): QuestionContextStep[] => {
  const titles = new Map(allSteps(doc).map((s) => [s.key, s.title]));
  return allSteps(doc).map((s) => ({
    key: s.key,
    num: s.num,
    title: s.title,
    actions: s.actions.map((a) => a.text),
    outcomes: s.outcomes.map((o) => ({ text: o.text, gotoTitle: o.goto ? titles.get(o.goto) : undefined })),
    branch: s.branch
      ? { q: s.branch.q, options: s.branch.options.map((o) => ({ label: o.label, text: o.text })) }
      : undefined,
  }));
};

/** Rules always run; the model, when present and available, rewrites/extends and is merged first. Never throws for model failures. */
export async function generateQuestions(
  deps: GenerateDeps,
  body: GenerateQuestionsBody,
): Promise<GenerateQuestionsResponse> {
  const started = Date.now();
  const fieldNames = await loadFieldNames(deps.db);
  const docs: Document[] = [];
  for (const id of body.documentIds) {
    const d = await getDocument(deps.db, id);
    if (!d || !['published', 'partial'].includes(d.status))
      throw httpError(400, 'DOCUMENT_NOT_PUBLISHED', 'ניתן ליצור שאלות רק ממסמכים שפורסמו', {
        documentId: id,
      });
    docs.push(d);
  }
  const rules = docs.flatMap((d) => generateFromDocument(d, body.perDocument, fieldNames));
  let modelQs: QuizQuestion[] = [];
  let source: 'model' | 'rules' = 'rules';
  if (deps.model?.generateQuestions && (await deps.model.available().catch(() => false))) {
    const ctx: QuestionContext = {
      perDocument: body.perDocument,
      seeds: rules,
      documents: docs.map((d) => ({ id: d.id, title: d.title, steps: toCtxSteps(d) })),
    };
    try {
      const allowed = new Set(docs.map((d) => d.id));
      modelQs = (await deps.model.generateQuestions(ctx))
        .filter((q) => allowed.has(q.documentId))
        .map((q) => ({
          ...q,
          generated: true,
          modelConf: q.modelConf ?? null,
          explanation: q.explanation ?? '',
        }));
      if (modelQs.length) source = 'model';
    } catch (err) {
      deps.log.warn({ err }, 'question generation: model failed, using rules');
    }
  }
  // Per document: model questions first, then rules, capped at perDocument.
  const out: QuizQuestion[] = [];
  for (const d of docs) {
    const m = modelQs.filter((q) => q.documentId === d.id);
    const r = rules.filter((q) => q.documentId === d.id);
    out.push(...[...m, ...r].slice(0, body.perDocument));
  }
  return { questions: out, source, tookMs: Date.now() - started };
}
