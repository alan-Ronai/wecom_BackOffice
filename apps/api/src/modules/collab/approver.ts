import { httpError } from '../../lib/http.js';
import type { Queryable } from '../../lib/sql.js';
import type { ReqUser } from '../../lib/user.js';
import { getWorkflowSettings } from '../../lib/workflowSettings.js';

export const APPROVER_ROLE = 'approver';

/**
 * Spec §1.6 separation of duties: with `workflow.requireApprover` on, holding `docs.publish` no
 * longer decides a review — the decision belongs to the `approver` role, which publishes and
 * applies suggestions but cannot edit. It is a *role*, not a permission, precisely so that it
 * cannot be granted by widening an existing one.
 */
export async function canApprove(q: Queryable, user: ReqUser): Promise<boolean> {
  const s = await getWorkflowSettings(q);
  return !s.requireApprover || user.roles.includes(APPROVER_ROLE);
}

export async function assertCanApprove(q: Queryable, user: ReqUser): Promise<void> {
  if (!(await canApprove(q, user)))
    throw httpError(403, 'APPROVER_REQUIRED', 'נדרש תפקיד מאשר כדי להחליט על בקשת בדיקה');
}
