/**
 * Wave 5 (V4b) — `GET|PUT /admin/workflow`.
 *
 * Ruling: the GET is readable with `docs.read` (the review queue needs `requireApprover` to know
 * whether to show its hint); only the PUT needs `system.admin`. Through the generated client since
 * V6 published V3's routes, and still parsed with `checked` against `@wecom/shared`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { WorkflowSettingsSchema, type WorkflowSettingsPutSchema } from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { checked } from '../stage45.js';

export const useWorkflowSettings = (enabled = true) =>
  useQuery({
    queryKey: keys.admin.workflow,
    enabled,
    staleTime: 60_000,
    queryFn: async () => checked(WorkflowSettingsSchema, await api.GET('/admin/workflow')),
  });

export const usePutWorkflowSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: z.input<typeof WorkflowSettingsPutSchema>) =>
      checked(WorkflowSettingsSchema, await api.PUT('/admin/workflow', { body: patch as never })),
    onSuccess: (s) => {
      qc.setQueryData(keys.admin.workflow, s);
      // Turning the approver requirement on changes what the review queue may do with a decision.
      void qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
};
