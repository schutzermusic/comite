import { z } from 'zod';

export const REQUIREMENT_TYPES = ['MATERIAL', 'EQUIPMENT', 'VEHICLE', 'WORKFORCE', 'EXTERNAL_SERVICE',
  'DOCUMENT', 'CUSTOMER_DEPENDENCY', 'OTHER'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Um contrato de entrada para criar e editar — campos ausentes não são tocados. */
export const requirementSchema = z.object({
  projectId: z.string().trim().min(1).max(200).optional(),
  activityId: z.string().uuid().nullable().optional(),
  requirementType: z.enum(REQUIREMENT_TYPES).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(30).nullable().optional(),
  resourceLabel: z.string().trim().max(300).nullable().optional(),
  requiredBy: isoDate.nullable().optional(),
  deliveryLocationLabel: z.string().trim().max(300).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  constraintsNote: z.string().trim().max(2000).nullable().optional(),
  reason: z.string().trim().max(2000).optional(),
});

const KEYS: Record<string, string> = {
  projectId: 'project_id', activityId: 'activity_id', requirementType: 'requirement_type', title: 'title',
  description: 'description', quantity: 'quantity', unit: 'unit', resourceLabel: 'resource_label',
  requiredBy: 'required_by', deliveryLocationLabel: 'delivery_location_label', priority: 'priority',
  constraintsNote: 'constraints_note', reason: 'reason',
};

export function requirementPayload(input: z.infer<typeof requirementSchema>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined && KEYS[k]) out[KEYS[k]] = v;
  return out;
}
