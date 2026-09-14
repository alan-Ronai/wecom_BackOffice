import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { WORKFLOW_SETTINGS_KEY, WorkflowSettingsPutSchema, WorkflowSettingsSchema } from '@wecom/shared';
import { audit } from '../../lib/audit.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import { getWorkflowSettings, putWorkflowSettings } from '../../lib/workflowSettings.js';

/**
 * Wave 5 V3: the operator-editable workflow settings — the approver switch, the learning defaults
 * and the gap thresholds. Reading needs `docs.read` because the effective settings shape what an
 * editor sees (whether their publish still decides a review); writing needs `system.admin`.
 */
export default async function workflowRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/workflow',
    {
      config: { requires: ['docs.read'] },
      schema: { tags: ['admin'], response: { 200: WorkflowSettingsSchema } },
    },
    async (req) => {
      requireUser(req);
      return getWorkflowSettings(app.db);
    },
  );

  app.put(
    '/workflow',
    {
      config: { requires: ['system.admin'] },
      schema: { tags: ['admin'], body: WorkflowSettingsPutSchema, response: { 200: WorkflowSettingsSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const patch = req.body;
      return withTransaction(app.db, async (tx) => {
        const before = await getWorkflowSettings(tx);
        const after = await putWorkflowSettings(tx, patch, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'admin.workflow.update',
          entityType: 'app_settings',
          entityId: WORKFLOW_SETTINGS_KEY,
          before,
          after,
          requestId: req.id,
          ip: req.ip,
        });
        return after;
      });
    },
  );
}
