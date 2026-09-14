/**
 * Wave 5 (V4b) — `GET|PUT /admin/workflow`.
 *
 * Ruling: the GET is readable with `docs.read` (the review queue needs `requireApprover` to know
 * whether to show its hint); only the PUT needs `system.admin`. Through the temporary `w5` bridge
 * and parsed with `checked`; V6 swaps the bodies for the generated client.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { WorkflowSettingsSchema, type WorkflowSettingsPutSchema } from '@wecom/shared';
import { keys } from '../keys.js';
import { w5 } from '../wave5.js';

export const useWorkflowSettings = (enabled = true) =>
  useQuery({
    queryKey: keys.admin.workflow,
    enabled,
    staleTime: 60_000,
    queryFn: () => w5(WorkflowSettingsSchema, 'GET', '/admin/workflow'),
  });

export const usePutWorkflowSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: z.input<typeof WorkflowSettingsPutSchema>) =>
      w5(WorkflowSettingsSchema, 'PUT', '/admin/workflow', { body: patch }),
    onSuccess: (s) => {
      qc.setQueryData(keys.admin.workflow, s);
      // Turning the approver requirement on changes what the review queue may do with a decision.
      void qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
};
